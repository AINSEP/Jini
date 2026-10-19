import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultModelDiscoveryDeps, modelProbeTimeoutMs, parseClaudeInitializeMetadata, parsePiRpcMetadata, probeAgentCatalog, probeClaudeInitialize, probeCliCache, probeCliSubcommand, probeProviderApi } from '../model-discovery-adapters.js';
import { ModelProbeError } from '../model-discovery-shared.js';
import type { AgentDiscoveryConfiguration, ModelDiscoveryContext, ModelDiscoveryDeps, ModelProbeResult } from '../model-discovery-types.js';

const context: ModelDiscoveryContext = { executable: '/cli', cwd: '/workspace', env: { HOME: '/home/fake' } };
const signal = new AbortController().signal;
const config = (declared: Partial<AgentDiscoveryConfiguration> = {}): AgentDiscoveryConfiguration => ({ fallbackModels: () => [], ...declared });
const rpcResult: ModelProbeResult = { models: [{ id: 'model-rpc', label: 'Model RPC', identityKind: 'concrete' }], source: 'rpc', coverage: 'account' };
const claudeInit = (rows: unknown[]) => JSON.stringify({ type: 'control_response', response: { subtype: 'success', response: { models: rows } } });

function fakeDeps(options: { stdout?: string; files?: Record<string, string> } = {}) {
  const calls: string[] = [];
  const runs: { args: readonly string[]; timeoutMs: number }[] = [];
  const files = new Map(Object.entries(options.files ?? {}));
  const deps: ModelDiscoveryDeps = {
    process: { async run({ args, timeoutMs }) { runs.push({ args, timeoutMs }); calls.push('process'); return { stdout: options.stdout ?? '', stderr: '' }; } },
    fs: { async read(path) { return files.get(path) ?? null; } },
    http: { async list() { calls.push('http'); return { ok: true, kind: 'success', latencyMs: 1, models: [{ id: 'model-api', label: 'Model API' }] }; } },
    credential: { async connection() { return { protocol: 'openai', apiKey: 'test-key', baseUrl: 'https://provider.example/v1' }; } },
    acp: { async probe({ args }) { calls.push(`acp:${args.join(' ')}`); return rpcResult; } },
    rpc: { async probe({ agentId }) { calls.push(`rpc:${agentId}`); return rpcResult; } },
    clock: { now: () => 0 }, cache: new Map(),
  };
  return { deps, calls, runs, files };
}
function failingProcess(deps: ModelDiscoveryDeps, error: Error) {
  deps.process.run = async () => { throw error; };
}
async function probeError(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { return error instanceof ModelProbeError ? error.code : `other:${(error as Error).message}`; }
  return 'resolved';
}

describe('parseClaudeInitializeMetadata', () => {
  it('returns null when no line is a successful control response with a model array', () => {
    const lines = ['not json', 'null', '{"type":"other"}', JSON.stringify({ type: 'control_response', response: { subtype: 'error' } }), JSON.stringify({ type: 'control_response' }), JSON.stringify({ type: 'control_response', response: { subtype: 'success', response: { models: 'x' } } })];
    expect(parseClaudeInitializeMetadata(lines.join('\n'))).toBeNull();
  });
  it('uses only the first matching control response', () => {
    const parsed = parseClaudeInitializeMetadata([claudeInit([{ value: 'model-a' }]), claudeInit([{ value: 'model-b' }])].join('\n'));
    expect(parsed?.models.map(row => row.id)).toEqual(['model-a']);
  });
  it('skips empty rows and rows without a string value', () => {
    expect(parseClaudeInitializeMetadata(claudeInit([null, { value: 3 }, { value: 'model-a' }]))?.models).toEqual([{ id: 'model-a', label: 'model-a', identityKind: 'concrete' }]);
  });
  it('falls back from a blank display name to the resolved id, then the selection id', () => {
    const parsed = parseClaudeInitializeMetadata(claudeInit([{ value: ' sonnet ', resolvedModel: ' claude-sonnet-x ', displayName: '  ' }, { value: 'opus', resolvedModel: 7 }]));
    expect(parsed?.models).toEqual([
      { id: 'sonnet', label: 'claude-sonnet-x', identityKind: 'alias', resolvedId: 'claude-sonnet-x' },
      { id: 'claude-sonnet-x', label: 'claude-sonnet-x', identityKind: 'concrete' },
      { id: 'opus', label: 'opus', identityKind: 'alias' },
    ]);
  });
  it('marks a row whose resolved id equals its id as concrete without a duplicate row', () => {
    expect(parseClaudeInitializeMetadata(claudeInit([{ value: 'model-a', resolvedModel: 'model-a', displayName: 'Model A' }]))?.models).toEqual([{ id: 'model-a', label: 'Model A', identityKind: 'concrete', resolvedId: 'model-a' }]);
  });
  it('drops a default row that resolves to a non-concrete id and claims no default', () => {
    expect(parseClaudeInitializeMetadata(claudeInit([{ value: 'default', resolvedModel: 'opus' }]))).toEqual({ models: [], source: 'rpc', coverage: 'account' });
  });
});

describe('parsePiRpcMetadata', () => {
  it('ignores malformed, unsuccessful and incomplete responses', () => {
    const stdout = ['nope', '{"type":"event"}', '{"type":"response","success":false,"command":"get_state","data":{"model":{"provider":"p","id":"x"}}}',
      '{"type":"response","success":true,"command":"get_available_models","data":{"models":[{"provider":"p"},{"provider":"p","id":"m1"}]}}',
      '{"type":"response","success":true,"command":"get_available_models","data":{}}',
      '{"type":"response","success":true,"command":"get_state","data":{"model":{"provider":"p"}}}'].join('\n');
    expect(parsePiRpcMetadata(stdout)).toEqual({ models: [{ id: 'p/m1', label: 'm1', provider: 'p', identityKind: 'concrete' }], source: 'rpc', coverage: 'account' });
  });
  it('throws a TypeError on a JSON null line (pinned current behaviour, not a deliberate refusal)', () => {
    expect(() => parsePiRpcMetadata('null')).toThrow(TypeError);
  });
  it('refuses output without any model rows as malformed', () => {
    expect(() => parsePiRpcMetadata('{"type":"response","success":true,"command":"get_state","data":{"model":{"provider":"p","id":"x"}}}')).toThrow(new ModelProbeError('malformed-response'));
  });
});

describe('probeCliCache', () => {
  it('reads the Codex cache under CODEX_HOME and keeps slug, value and id rows', async () => {
    const fake = fakeDeps({ files: { '/codex/models_cache.json': JSON.stringify({ models: [{ slug: 'a', display_name: 'A' }, { value: 'b', displayName: 'B' }, { id: 'c' }, { other: 1 }] }) } });
    expect(await probeCliCache('codex', { ...context, env: { CODEX_HOME: '/codex' } }, fake.deps, signal)).toEqual({ models: [
      { id: 'a', label: 'A', identityKind: 'concrete' }, { id: 'b', label: 'B', identityKind: 'concrete' }, { id: 'c', label: 'c', identityKind: 'concrete' },
    ], source: 'cli-cache', coverage: 'observed' });
  });
  it('returns no Codex rows when the cache has no model array', async () => {
    const fake = fakeDeps({ files: { '/home/fake/.codex/models_cache.json': '{}' } });
    expect((await probeCliCache('codex', context, fake.deps, signal)).models).toEqual([]);
  });
  it('qualifies OpenCode cache rows by provider and skips providers without models', async () => {
    const fake = fakeDeps({ files: { '/xdg/opencode/models.json': JSON.stringify({ openai: { models: { 'gpt-x': { name: 'GPT X' }, 'gpt-y': {} } }, empty: null, bare: {} }) } });
    expect((await probeCliCache('opencode', { ...context, env: { HOME: '/home/fake', XDG_CACHE_HOME: '/xdg' } }, fake.deps, signal)).models).toEqual([
      { id: 'openai/gpt-x', label: 'GPT X', provider: 'openai', identityKind: 'concrete' },
      { id: 'openai/gpt-y', label: 'openai/gpt-y', provider: 'openai', identityKind: 'concrete' },
    ]);
  });
  it('reads the OpenCode cache under the home cache directory by default', async () => {
    const fake = fakeDeps({ files: { '/home/fake/.cache/opencode/models.json': '{}' } });
    expect((await probeCliCache('opencode', context, fake.deps, signal)).models).toEqual([]);
  });
  it('reads Claude and CodeBuddy option caches from their settings files', async () => {
    const cache = JSON.stringify({ additionalModelOptionsCache: [{ value: 'model-a' }] });
    const fake = fakeDeps({ files: { '/claude/.claude.json': cache, '/home/fake/.claude.json': '{}', '/home/fake/.codebuddy/settings.json': cache } });
    expect((await probeCliCache('claude', { ...context, env: { HOME: '/home/fake', CLAUDE_CONFIG_DIR: '/claude' } }, fake.deps, signal)).models).toEqual([{ id: 'model-a', label: 'model-a', identityKind: 'concrete' }]);
    expect((await probeCliCache('claude', context, fake.deps, signal)).models).toEqual([]);
    expect((await probeCliCache('codebuddy', context, fake.deps, signal)).models).toEqual([{ id: 'model-a', label: 'model-a', identityKind: 'concrete' }]);
  });
  it('refuses agents without a cache as unsupported', async () => {
    expect(await probeError(probeCliCache('kimi', context, fakeDeps().deps, signal))).toBe('unsupported-version');
  });
  it('reports a missing or unreadable cache as offline', async () => {
    const fake = fakeDeps({ files: { '/home/fake/.codebuddy/settings.json': '[1]' } });
    expect(await probeError(probeCliCache('codex', context, fake.deps, signal))).toBe('offline');
    expect(await probeError(probeCliCache('codebuddy', context, fake.deps, signal))).toBe('offline');
  });
});

describe('probeProviderApi', () => {
  it('lists provider models with the configured selection as the effective model', async () => {
    const fake = fakeDeps();
    let seenModel: string | undefined;
    fake.deps.credential.connection = async ({ context: effective }) => { seenModel = effective.model; return { protocol: 'openai', apiKey: 'k', baseUrl: 'https://p.example' }; };
    const result = await probeProviderApi('qwen', { ...context, env: { HOME: '/home/fake', QWEN_MODEL: 'qwen-x' } }, fake.deps, signal);
    expect(seenModel).toBe('qwen-x');
    expect(result).toEqual({ models: [{ id: 'model-api', label: 'Model API' }], source: 'provider-api', coverage: 'provider' });
  });
  it('keeps the caller context when nothing is configured', async () => {
    const fake = fakeDeps();
    let seen: ModelDiscoveryContext | undefined;
    fake.deps.credential.connection = async ({ context: effective }) => { seen = effective; return { protocol: 'openai', apiKey: 'k', baseUrl: 'https://p.example' }; };
    await probeProviderApi('mimo', context, fake.deps, signal);
    expect(seen).toBe(context);
  });
  it('prefixes Aider rows with the provider of a qualified selection unless already prefixed', async () => {
    const fake = fakeDeps();
    fake.deps.http.list = async () => ({ ok: true, kind: 'success', latencyMs: 1, models: [{ id: 'gpt-x', label: 'X' }, { id: 'openai/gpt-y', label: 'Y' }] });
    const result = await probeProviderApi('aider', { ...context, env: { HOME: '/home/fake', AIDER_MODEL: 'openai/gpt-x' } }, fake.deps, signal);
    expect(result.models.map(row => row.id)).toEqual(['openai/gpt-x', 'openai/gpt-y']);
  });
  it('does not prefix Aider rows for an unqualified selection', async () => {
    const fake = fakeDeps();
    const result = await probeProviderApi('aider', { ...context, env: { HOME: '/home/fake', AIDER_MODEL: 'gpt-x' } }, fake.deps, signal);
    expect(result.models.map(row => row.id)).toEqual(['model-api']);
  });
  it('refuses a missing credential as auth-missing', async () => {
    const fake = fakeDeps();
    fake.deps.credential.connection = async () => null;
    expect(await probeError(probeProviderApi('qwen', context, fake.deps, signal))).toBe('auth-missing');
  });
  it('refuses Bedrock and Azure protocols as unsupported', async () => {
    const fake = fakeDeps();
    for (const protocol of ['bedrock', 'azure'] as const) {
      fake.deps.credential.connection = async () => ({ protocol, apiKey: 'k', baseUrl: 'https://p.example' });
      expect(await probeError(probeProviderApi('qwen', context, fake.deps, signal))).toBe('unsupported-version');
    }
    expect(fake.calls).not.toContain('http');
  });
  it('maps listing failures to auth-missing, timeout or offline', async () => {
    const fake = fakeDeps();
    const outcomes: string[] = [];
    for (const [ok, kind] of [[false, 'auth_failed'], [false, 'timeout'], [false, 'forbidden'], [true, 'success']] as const) {
      fake.deps.http.list = async () => ({ ok, kind, latencyMs: 1 });
      outcomes.push(await probeError(probeProviderApi('qwen', context, fake.deps, signal)));
    }
    expect(outcomes).toEqual(['auth-missing', 'timeout', 'offline', 'offline']);
  });
});

describe('probeAgentCatalog routing', () => {
  it('sends declared ACP agents to the ACP port with their arguments', async () => {
    const fake = fakeDeps();
    expect(await probeAgentCatalog('trae-cli', context, config({}), fake.deps, signal)).toBe(rpcResult);
    expect(fake.calls).toEqual(['acp:acp serve']);
  });
  it('sends Pi, Copilot and Droid to the RPC port', async () => {
    const fake = fakeDeps();
    for (const agentId of ['pi', 'copilot', 'droid']) await probeAgentCatalog(agentId, context, config({}), fake.deps, signal);
    expect(fake.calls).toEqual(['rpc:pi', 'rpc:copilot', 'rpc:droid']);
  });
  it('sends Aider, Qwen and Mimo to the provider API', async () => {
    const fake = fakeDeps();
    for (const agentId of ['aider', 'qwen', 'mimo']) expect((await probeAgentCatalog(agentId, context, config({}), fake.deps, signal)).source).toBe('provider-api');
  });
  it('uses Claude initialize metadata first', async () => {
    const fake = fakeDeps({ stdout: claudeInit([{ value: 'model-a' }]) });
    expect((await probeAgentCatalog('claude', context, config({}), fake.deps, signal)).source).toBe('rpc');
  });
  it('falls back from Claude initialize to the provider API, then the cache', async () => {
    const fake = fakeDeps({ files: { '/home/fake/.claude.json': JSON.stringify({ additionalModelOptionsCache: [{ value: 'model-c' }] }) } });
    expect((await probeAgentCatalog('claude', context, config({}), fake.deps, signal)).source).toBe('provider-api');
    fake.deps.credential.connection = async () => null;
    expect(await probeAgentCatalog('claude', context, config({}), fake.deps, signal)).toEqual({ models: [{ id: 'model-c', label: 'model-c', identityKind: 'concrete' }], source: 'cli-cache', coverage: 'observed' });
  });
  it('falls back from CodeBuddy initialize straight to its cache', async () => {
    const fake = fakeDeps({ files: { '/home/fake/.codebuddy/settings.json': '{}' } });
    expect((await probeAgentCatalog('codebuddy', context, config({}), fake.deps, signal)).source).toBe('cli-cache');
    expect(fake.calls).toEqual(['process']);
    fake.deps.process.run = async () => ({ stdout: claudeInit([{ value: 'model-a' }]), stderr: '' });
    expect((await probeAgentCatalog('codebuddy', context, config({}), fake.deps, signal)).source).toBe('rpc');
  });
  it('caps declared listings at the agent budget, reserving two seconds for disk-cache agents', async () => {
    const fake = fakeDeps({ stdout: 'model-a\n' });
    const parse = ({ stdout }: { stdout: string }) => stdout.trim() ? [{ id: stdout.trim(), label: stdout.trim(), identityKind: 'concrete' as const }] : null;
    await probeAgentCatalog('codex', context, config({ args: ['debug'], parse, timeoutMs: 9_500 }), fake.deps, signal);
    await probeAgentCatalog('antigravity', context, config({ args: ['models'], parse, timeoutMs: 9_500 }), fake.deps, signal);
    await probeAgentCatalog('antigravity', context, config({ args: ['models'], parse }), fake.deps, signal);
    expect(fake.runs.map(run => run.timeoutMs)).toEqual([8_000, 9_500, 8_000]);
  });
  it('recovers a failed Codex or OpenCode listing from the disk cache', async () => {
    const fake = fakeDeps({ files: { '/home/fake/.codex/models_cache.json': '{"models":[{"slug":"a"}]}' } });
    failingProcess(fake.deps, new Error('listing failed'));
    expect((await probeAgentCatalog('codex', context, config({ args: ['debug'] }), fake.deps, signal)).source).toBe('cli-cache');
    fake.files.set('/home/fake/.cache/opencode/models.json', '{}');
    expect((await probeAgentCatalog('opencode', context, config({ args: ['models'] }), fake.deps, signal)).source).toBe('cli-cache');
  });
  it('rethrows the listing error when the disk cache also fails', async () => {
    const fake = fakeDeps();
    failingProcess(fake.deps, new Error('listing failed'));
    expect(await probeError(probeAgentCatalog('opencode', context, config({ args: ['models'] }), fake.deps, signal))).toBe('other:listing failed');
  });
  it('rethrows a failed listing for agents without a disk cache', async () => {
    const fake = fakeDeps();
    failingProcess(fake.deps, new Error('listing failed'));
    expect(await probeError(probeAgentCatalog('antigravity', context, config({ args: ['models'] }), fake.deps, signal))).toBe('other:listing failed');
  });
  it('parses generic CLI listings for undeclared CLI agents', async () => {
    const fake = fakeDeps({ stdout: 'Models\n- model-a - Model A\n' });
    expect(await probeAgentCatalog('crush', context, config({}), fake.deps, signal)).toEqual({ models: [{ id: 'model-a', label: 'Model A', identityKind: 'concrete' }], source: 'cli', coverage: 'account' });
    expect(fake.runs[0]!.args).toEqual(['models']);
  });
  it('refuses agents with no discovery category as unsupported', async () => {
    expect(await probeError(probeAgentCatalog('unknown-agent', context, config({}), fakeDeps().deps, signal))).toBe('unsupported-version');
  });
});

describe('probeAgentCatalog for AMR', () => {
  const amrMetadata = (models: ModelProbeResult['models'], defaultSelectionId?: string): ModelProbeResult => ({ models, source: 'rpc', coverage: 'account', ...(defaultSelectionId ? { defaultSelectionId } : {}) });
  it('uses ACP metadata and defaults to the env, native, then first concrete model', async () => {
    const fake = fakeDeps();
    const rows = [{ id: 'default', label: 'Default', identityKind: 'routing-mode' as const }, { id: 'model-a', label: 'A', identityKind: 'concrete' as const }];
    fake.deps.acp.probe = async () => amrMetadata(rows);
    expect((await probeAgentCatalog('amr', context, config({}), fake.deps, signal)).defaultSelectionId).toBe('model-a');
    fake.deps.acp.probe = async () => amrMetadata(rows, 'native-x');
    expect((await probeAgentCatalog('amr', context, config({}), fake.deps, signal)).defaultSelectionId).toBe('native-x');
    expect((await probeAgentCatalog('amr', { ...context, env: { VELA_DEFAULT_MODEL: 'env-x' } }, config(), fake.deps, signal)).defaultSelectionId).toBe('env-x');
    expect(fake.runs).toEqual([]);
  });
  it('falls back to the JSON list command when ACP has no concrete model', async () => {
    const fake = fakeDeps({ stdout: 'listed' });
    fake.deps.acp.probe = async () => amrMetadata([{ id: 'default', label: 'Default', identityKind: 'routing-mode' }]);
    const parse = () => [{ id: 'default', label: 'Default', identityKind: 'routing-mode' as const }, { id: 'model-b', label: 'B', identityKind: 'concrete' as const }];
    expect(await probeAgentCatalog('amr', context, config({ parse }), fake.deps, signal)).toEqual({ models: parse(), source: 'cli', coverage: 'account', defaultSelectionId: 'model-b' });
    expect(fake.runs).toEqual([{ args: ['model', 'list', '--format', 'json'], timeoutMs: 10_000 }]);
    expect((await probeAgentCatalog('amr', { ...context, env: { VELA_DEFAULT_MODEL: 'env-x' } }, config({ parse }), fake.deps, signal)).defaultSelectionId).toBe('env-x');
  });
  it('claims no default when the list command yields no native row', async () => {
    const fake = fakeDeps();
    fake.deps.acp.probe = async () => { throw new Error('acp down'); };
    expect(await probeAgentCatalog('amr', context, config({}), fake.deps, signal)).toEqual({ models: [], source: 'cli', coverage: 'account' });
  });
  it('rethrows the ACP failure without listing once the probe is cancelled', async () => {
    const fake = fakeDeps();
    const controller = new AbortController(); controller.abort();
    fake.deps.acp.probe = async () => { throw new Error('acp cancelled'); };
    expect(await probeError(probeAgentCatalog('amr', context, config({}), fake.deps, controller.signal))).toBe('other:acp cancelled');
    expect(fake.runs).toEqual([]);
  });
});

describe('default credential connection', () => {
  const connect = (agentId: string, env: Record<string, string>, model?: string) =>
    defaultModelDiscoveryDeps.credential.connection({ agentId, context: { ...context, env, ...(model ? { model } : {}) }, signal });
  it('uses the Anthropic key for Claude regardless of the selected model', async () => {
    expect(await connect('claude', { ANTHROPIC_API_KEY: 'a', ANTHROPIC_BASE_URL: 'https://a.example' })).toEqual({ protocol: 'anthropic', baseUrl: 'https://a.example', apiKey: 'a' });
  });
  it('returns null without a selected model', async () => {
    expect(await connect('claude', {})).toBeNull();
    expect(await connect('mimo', { OPENAI_API_KEY: 'o' })).toBeNull();
  });
  it('reads the Aider and Qwen selection from their env', async () => {
    expect(await connect('aider', { AIDER_MODEL: 'openrouter/x', OPENROUTER_API_KEY: 'r', OPENROUTER_API_BASE: 'https://r.example' })).toEqual({ protocol: 'openai', baseUrl: 'https://r.example', apiKey: 'r' });
    expect(await connect('qwen', { QWEN_MODEL: 'claude-x', ANTHROPIC_API_KEY: 'a', ANTHROPIC_BASE_URL: 'https://a.example' })).toEqual({ protocol: 'anthropic', baseUrl: 'https://a.example', apiKey: 'a' });
  });
  it('treats a Qwen OpenAI model or base URL as an OpenAI selection', async () => {
    expect(await connect('qwen', { OPENAI_MODEL: 'qwen-x', OPENAI_API_KEY: 'o', OPENAI_API_BASE: 'https://o.example' })).toEqual({ protocol: 'openai', baseUrl: 'https://o.example', apiKey: 'o' });
    expect(await connect('qwen', { OPENAI_BASE_URL: 'https://b.example', OPENAI_API_KEY: 'o' }, 'qwen-y')).toEqual({ protocol: 'openai', baseUrl: 'https://b.example', apiKey: 'o' });
    expect(await connect('qwen', { OPENAI_API_KEY: 'o' }, 'qwen-y')).toBeNull();
  });
  it('fills default provider URLs from the catalog when none is configured', async () => {
    for (const [model, env] of [['claude-x', { ANTHROPIC_API_KEY: 'k' }], ['gemini-x', { GEMINI_API_KEY: 'k' }], ['openrouter/x', { OPENROUTER_API_KEY: 'k' }], ['gpt-x', { OPENAI_API_KEY: 'k' }]] as const) {
      const input = await connect('mimo', env, model);
      expect(input?.baseUrl).toMatch(/^https:\/\//);
    }
    expect((await connect('claude', { ANTHROPIC_API_KEY: 'k' }))?.baseUrl).toMatch(/^https:\/\//);
  });
  it('returns null when the selected provider has no key', async () => {
    for (const model of ['anthropic/x', 'google/x', 'openrouter/x', 'openai/x', 'o3', 'mystery']) expect(await connect('mimo', {}, model)).toBeNull();
  });
});

describe('shared CLI adapters', () => {
  it('gives ACP and RPC-style agents a longer probe budget', () => {
    expect([modelProbeTimeoutMs('kilo'), modelProbeTimeoutMs('claude'), modelProbeTimeoutMs('droid'), modelProbeTimeoutMs('crush')]).toEqual([15_000, 15_000, 15_000, 10_000]);
  });
  it('reports the CLI default model line and refuses unparseable output', async () => {
    const fake = fakeDeps({ stdout: 'Default model: model-a\nmodel-a\n' });
    const parse = ({ stdout }: { stdout: string }) => stdout.includes('model-a') ? [{ id: 'model-a', label: 'A', identityKind: 'concrete' as const }] : null;
    expect((await probeCliSubcommand(context, config({ parse }), fake.deps, signal)).defaultSelectionId).toBe('model-a');
    expect(fake.runs[0]).toEqual({ args: [], timeoutMs: 8_000 });
    expect(await probeError(probeCliSubcommand(context, config({ args: ['x'] }), fake.deps, signal))).toBe('malformed-response');
  });
  it('reads generic JSON listings as arrays or a models field', async () => {
    const fake = fakeDeps({ stdout: JSON.stringify(['model-a', { id: 'model-b', name: 'B' }, { model: 'model-c' }, { other: 1 }, null]) });
    expect((await probeAgentCatalog('qoder', context, config(), fake.deps, signal)).models).toEqual([
      { id: 'model-a', label: 'model-a', identityKind: 'concrete' }, { id: 'model-b', label: 'B', identityKind: 'concrete' }, { id: 'model-c', label: 'model-c', identityKind: 'concrete' },
    ]);
    const wrapped = fakeDeps({ stdout: JSON.stringify({ models: ['model-d'] }) });
    expect((await probeAgentCatalog('amp', context, config(), wrapped.deps, signal)).models.map(row => row.id)).toEqual(['model-d']);
  });
  it('falls back to line parsing for JSON without a model list', async () => {
    const fake = fakeDeps({ stdout: '0' });
    expect((await probeAgentCatalog('deepseek', context, config(), fake.deps, signal)).models).toEqual([{ id: '0', label: '0', identityKind: 'concrete' }]);
    const object = fakeDeps({ stdout: '{"model":"x"}' });
    expect((await probeAgentCatalog('deepseek', context, config(), object.deps, signal)).models).toEqual([]);
  });
});

describe('probeClaudeInitialize', () => {
  const init = claudeInit([{ value: 'default', resolvedModel: 'model-a' }]);
  it('passes setting sources and hook-disabled inline settings, claiming the concrete default', async () => {
    const fake = fakeDeps({ stdout: init });
    const result = await probeClaudeInitialize({ ...context, settingSources: ['user', 'project'], settings: ' {"model":"m"}' }, fake.deps, signal);
    expect(result.defaultSelectionId).toBe('model-a');
    expect(fake.runs[0]!.args.slice(-4)).toEqual(['--setting-sources', 'user,project', '--settings', '{"model":"m","disableAllHooks":true}']);
    expect(fake.runs[0]!.timeoutMs).toBe(15_000);
  });
  it('reads a settings file and skips the flag when it is missing or unparseable', async () => {
    const fake = fakeDeps({ stdout: init, files: { '/s.json': '{"a":1}', '/bad.json': 'nope' } });
    await probeClaudeInitialize({ ...context, settings: '/s.json' }, fake.deps, signal);
    await probeClaudeInitialize({ ...context, settings: '/bad.json' }, fake.deps, signal);
    await probeClaudeInitialize({ ...context, settings: '/missing.json' }, fake.deps, signal);
    const settingsFlags = fake.runs.map(run => run.args.filter(arg => arg === '--settings').length);
    expect(settingsFlags).toEqual([settingsFlags[2]! + 1, settingsFlags[2], settingsFlags[2]]);
  });
  it('refuses an initialize reply without models as malformed', async () => {
    expect(await probeError(probeClaudeInitialize(context, fakeDeps({ stdout: claudeInit([]) }).deps, signal))).toBe('malformed-response');
  });
});

describe('default filesystem and RPC ports', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'jini-model-discovery-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });
  it('walks up to the nearest directory containing .git', async () => {
    mkdirSync(join(dir, 'repo/.git'), { recursive: true }); mkdirSync(join(dir, 'repo/a/b'), { recursive: true });
    expect(await defaultModelDiscoveryDeps.fs.projectRoot!({ cwd: join(dir, 'repo/a/b'), signal })).toBe(join(dir, 'repo'));
  });
  it('stops at the filesystem root or on cancellation without a project root', async () => {
    expect(await defaultModelDiscoveryDeps.fs.projectRoot!({ cwd: '/', signal })).toBeNull();
    const controller = new AbortController(); controller.abort();
    expect(await defaultModelDiscoveryDeps.fs.projectRoot!({ cwd: join(dir, 'repo/a/b'), signal: controller.signal })).toBeNull();
  });
  it('reads a missing file as null', async () => {
    expect(await defaultModelDiscoveryDeps.fs.read(join(dir, 'missing.json'), { signal })).toBeNull();
  });
  it('reports an unreachable provider endpoint as a failed listing', async () => {
    const result = await defaultModelDiscoveryDeps.http.list({ protocol: 'openai', baseUrl: 'http://127.0.0.1:9', apiKey: 'k', signal });
    expect(result.ok).toBe(false);
  });
  it('refuses RPC discovery for agents other than Pi, Copilot and Droid', async () => {
    expect(await probeError(defaultModelDiscoveryDeps.rpc.probe({ agentId: 'kimi', context, signal }))).toBe('unsupported-version');
  });
});
