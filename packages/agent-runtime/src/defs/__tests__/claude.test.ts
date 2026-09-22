import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAnthropicLiveModelCacheForTesting } from '../../anthropic-live-models.js';
import { agentCapabilities } from '../../capabilities.js';
import { setClaudeCodeModelIoForTesting, type ClaudeCodeModelIo } from '../../claude-code-models.js';
import { claudeAgentDef } from '../claude.js';
import { sanitizeCustomModel } from '../../models.js';

afterEach(() => {
  agentCapabilities.delete('claude');
});

describe('claudeAgentDef shape', () => {
  it('declares the expected identity and transport fields', () => {
    expect(claudeAgentDef.id).toBe('claude');
    expect(claudeAgentDef.bin).toBe('claude');
    expect(claudeAgentDef.fallbackBins).toEqual(['openclaude']);
    expect(claudeAgentDef.promptViaStdin).toBe(true);
    expect(claudeAgentDef.promptInputFormat).toBe('stream-json');
    expect(claudeAgentDef.streamFormat).toBe('claude-stream-json');
    expect(claudeAgentDef.externalMcpInjection).toBe('claude-mcp-json');
    expect(claudeAgentDef.resumesSessionViaCli).toBe(true);
    expect(claudeAgentDef.authProbe).toEqual({ args: ['auth', 'status'], timeoutMs: 5000 });
    expect(claudeAgentDef.fallbackModels.map((m) => m.id)).toEqual([
      'default',
      'fable',
      'sonnet',
      'opus',
      'haiku',
      'claude-fable-5-1',
      'claude-fable-5',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-opus-4-5',
      'claude-sonnet-4-5',
    ]);
  });
});

describe('claudeAgentDef.buildArgs', () => {
  it('produces the base argv with no capability flags, no model, no dirs, no session', () => {
    const args = claudeAgentDef.buildArgs('hi', [], []);
    expect(args).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
    ]);
  });

  it('adds --include-partial-messages only when the capability probe recorded partialMessages', () => {
    agentCapabilities.set('claude', { partialMessages: true });
    const args = claudeAgentDef.buildArgs('hi', [], []);
    expect(args).toContain('--include-partial-messages');
  });

  it('omits --include-partial-messages when the capability entry says false', () => {
    agentCapabilities.set('claude', { partialMessages: false });
    const args = claudeAgentDef.buildArgs('hi', [], []);
    expect(args).not.toContain('--include-partial-messages');
  });

  it('omits --include-partial-messages when there is no capability entry at all', () => {
    const args = claudeAgentDef.buildArgs('hi', [], []);
    expect(args).not.toContain('--include-partial-messages');
  });

  it('adds --model <id> for a concrete model selection', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], { model: 'sonnet' });
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
  });

  it('omits --model for the "default" sentinel', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], { model: 'default' });
    expect(args).not.toContain('--model');
  });

  // The picker's reasoning-effort choice has to reach the CLI as real argv,
  // not merely be stored: `claude --effort <level>` is the flag, and it is
  // probe-gated on `capabilityFlags['--effort']` because an older build
  // rejects an unknown option with exit 1 rather than degrading.
  it('adds --effort <level> for every level the CLI accepts, once the probe recorded the capability', () => {
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
      agentCapabilities.set('claude', { effort: true });
      const args = claudeAgentDef.buildArgs('hi', [], [], { reasoning: level });
      expect(args).toContain('--effort');
      expect(args[args.indexOf('--effort') + 1]).toBe(level);
    }
  });

  it('omits --effort when the capability probe never saw the flag, so an older build is not killed by an unknown option', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], { reasoning: 'high' });
    expect(args).not.toContain('--effort');
  });

  // 'ultra' is codex's vocabulary, not Claude Code's — the CLI answers an
  // unrecognized level with a stderr warning and then runs at its default, so
  // forwarding one would look like the setting applied while doing nothing.
  it('drops a level from another runtime\'s vocabulary rather than forwarding it', () => {
    agentCapabilities.set('claude', { effort: true });
    expect(claudeAgentDef.buildArgs('hi', [], [], { reasoning: 'ultra' })).not.toContain('--effort');
    expect(claudeAgentDef.buildArgs('hi', [], [], { reasoning: 'default' })).not.toContain('--effort');
  });

  it('omits --model when falsy', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], { model: '' });
    expect(args).not.toContain('--model');
  });

  it('adds --add-dir with all non-empty string dirs when addDir capability is not explicitly false', () => {
    const args = claudeAgentDef.buildArgs('hi', [], ['/a', '', '/b']);
    const idx = args.indexOf('--add-dir');
    expect(idx).toBeGreaterThan(-1);
    expect(args.slice(idx + 1, idx + 3)).toEqual(['/a', '/b']);
  });

  it('omits --add-dir entirely when the filtered dirs list is empty', () => {
    const args = claudeAgentDef.buildArgs('hi', [], ['']);
    expect(args).not.toContain('--add-dir');
  });

  it('tolerates an explicit null extraAllowedDirs (the `|| []` fallback, distinct from the default param)', () => {
    const args = claudeAgentDef.buildArgs('hi', [], null as unknown as string[]);
    expect(args).not.toContain('--add-dir');
  });

  it('omits --add-dir when the capability probe explicitly recorded addDir: false, even with dirs present', () => {
    agentCapabilities.set('claude', { addDir: false });
    const args = claudeAgentDef.buildArgs('hi', [], ['/a']);
    expect(args).not.toContain('--add-dir');
  });

  it('includes --add-dir when addDir capability is explicitly true', () => {
    agentCapabilities.set('claude', { addDir: true });
    const args = claudeAgentDef.buildArgs('hi', [], ['/a']);
    expect(args).toContain('--add-dir');
  });

  it('uses --resume <id> when runtimeContext.resumeSessionId is a non-empty string', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {}, { resumeSessionId: 'sess-123' });
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-123');
    expect(args).not.toContain('--session-id');
  });

  it('uses --session-id <id> when resumeSessionId is absent but newSessionId is present', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {}, { newSessionId: 'new-456' });
    expect(args).toContain('--session-id');
    expect(args[args.indexOf('--session-id') + 1]).toBe('new-456');
    expect(args).not.toContain('--resume');
  });

  it('emits neither --resume nor --session-id when both are absent', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {}, {});
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--session-id');
  });

  it('treats an empty-string resumeSessionId as absent and falls through to newSessionId', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {}, { resumeSessionId: '', newSessionId: 'new-789' });
    expect(args).not.toContain('--resume');
    expect(args).toContain('--session-id');
  });

  it('treats a null resumeSessionId as absent', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {}, { resumeSessionId: null });
    expect(args).not.toContain('--resume');
  });

  it('treats an empty-string newSessionId as absent (no --session-id emitted)', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {}, { newSessionId: '' });
    expect(args).not.toContain('--session-id');
  });

  it('always appends --permission-mode bypassPermissions as the trailing flag', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], { model: 'opus' }, { resumeSessionId: 'x' });
    expect(args.slice(-2)).toEqual(['--permission-mode', 'bypassPermissions']);
  });

  it('omits --permission-mode bypassPermissions entirely when permissionMode is "restricted"', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], { permissionMode: 'restricted' });
    expect(args).not.toContain('--permission-mode');
    expect(args).not.toContain('bypassPermissions');
  });

  it('still bypasses permissions when permissionMode is left unset (backward-compatible default)', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {});
    expect(args.slice(-2)).toEqual(['--permission-mode', 'bypassPermissions']);
  });

  it('defaults extraAllowedDirs/options/runtimeContext when omitted entirely', () => {
    expect(() => claudeAgentDef.buildArgs('hi', [])).not.toThrow();
  });

  it('adds --strict-mcp-config --mcp-config <path> when runtimeContext.mcpJsonPath is set', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {}, { mcpJsonPath: '/tmp/run-abc/.mcp.json' });
    expect(args).toContain('--strict-mcp-config');
    const idx = args.indexOf('--mcp-config');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('/tmp/run-abc/.mcp.json');
  });

  it('omits --strict-mcp-config and --mcp-config when mcpJsonPath is absent (default, unchanged behavior)', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {}, {});
    expect(args).not.toContain('--strict-mcp-config');
    expect(args).not.toContain('--mcp-config');
  });

  it('omits --mcp-config for an empty-string mcpJsonPath', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {}, { mcpJsonPath: '' });
    expect(args).not.toContain('--mcp-config');
  });

  // Finding 2 (SEC-assistant-env-isolation-2026-09-07): `--allowedTools`/`--disallowedTools` were
  // never wired, which is why `BASH_PROHIBITION_BLOCK` was prompt-only. Verified against installed
  // Claude Code 2.1.263's own `-p --help`: `--disallowedTools, --disallowed-tools <tools...>` /
  // `--allowedTools, --allowed-tools <tools...>`, both "Comma or space-separated list of tool
  // names" — and confirmed live that `--disallowedTools Bash` actually refuses a Bash tool call
  // even under `--permission-mode bypassPermissions` (a prompt-only prohibition would not).
  it('omits --disallowedTools/--allowedTools entirely when neither option is set (default, unchanged behavior)', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], {});
    expect(args).not.toContain('--disallowedTools');
    expect(args).not.toContain('--allowedTools');
  });

  it('emits --disallowedTools with every name when RuntimeBuildOptions.disallowedTools is a non-empty list', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], { disallowedTools: ['Bash', 'Edit', 'Write'] });
    const idx = args.indexOf('--disallowedTools');
    expect(idx).toBeGreaterThan(-1);
    expect(args.slice(idx + 1, idx + 4)).toEqual(['Bash', 'Edit', 'Write']);
  });

  it('emits --allowedTools with every name when RuntimeBuildOptions.allowedTools is a non-empty list', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], { allowedTools: ['Read', 'ToolSearch'] });
    const idx = args.indexOf('--allowedTools');
    expect(idx).toBeGreaterThan(-1);
    expect(args.slice(idx + 1, idx + 3)).toEqual(['Read', 'ToolSearch']);
  });

  it('omits --disallowedTools for an empty array (explicit no-op, not an accidental deny-everything)', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], { disallowedTools: [] });
    expect(args).not.toContain('--disallowedTools');
  });

  it('can emit both --disallowedTools and --allowedTools in the same call', () => {
    const args = claudeAgentDef.buildArgs('hi', [], [], { disallowedTools: ['Bash'], allowedTools: ['Read'] });
    expect(args).toContain('--disallowedTools');
    expect(args).toContain('--allowedTools');
  });
});

describe('claudeAgentDef.fetchModels', () => {
  let dir: string;
  const originalHome = process.env.HOME;

  // Default: the credential-free CLI step finds nothing (no real `claude` is ever spawned, no real
  // ~/.claude.json read). Individual cases install their own fake.
  const silentIo: ClaudeCodeModelIo = { runInitialize: async () => null, readConfigFile: async () => null };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-claude-fetchmodels-test-'));
    setClaudeCodeModelIoForTesting(silentIo);
    resetAnthropicLiveModelCacheForTesting();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    setClaudeCodeModelIoForTesting(null);
    resetAnthropicLiveModelCacheForTesting();
    vi.restoreAllMocks();
  });

  /** A fake CLI whose `initialize` answer lists `models` (the 2.1.280 shape, trimmed). */
  function cliAnswering(models: Array<{ value: string; resolvedModel?: string; displayName?: string }>): ClaudeCodeModelIo {
    const line = JSON.stringify({ type: 'control_response', response: { subtype: 'success', response: { models } } });
    return { runInitialize: async () => `${line}\n`, readConfigFile: async () => null };
  }

  const noRoutes = () => ({ HOME: dir, MMD_MODEL_ROUTES_FILE: path.join(dir, 'no-routes.json') });

  it('unions the CLI picker catalog into the static list with NO credential (subscription-only install)', async () => {
    setClaudeCodeModelIoForTesting(cliAnswering([
      { value: 'opus[1m]', resolvedModel: 'claude-opus-5-5[1m]', displayName: 'Opus (1M context)' },
      { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet' },
    ]));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('no network call should have been attempted');
    });
    const result = await claudeAgentDef.fetchModels!('claude', noRoutes());
    const ids = result!.map((m) => m.id);
    // Static list fully present, first, in its own order — never shrunk, never reordered.
    expect(ids.slice(0, claudeAgentDef.fallbackModels.length)).toEqual(claudeAgentDef.fallbackModels.map((m) => m.id));
    expect(ids).toContain('claude-opus-5-5');
    expect(new Set(ids).size).toBe(ids.length);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to ~/.claude.json\'s picker cache when the CLI probe gives nothing', async () => {
    writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify({ additionalModelOptionsCache: [{ value: 'claude-fable-6[1m]', label: 'Fable 6' }] }),
      'utf8',
    );
    // Real file read against the temp HOME; only the CLI spawn is faked.
    setClaudeCodeModelIoForTesting({
      runInitialize: async () => null,
      readConfigFile: async (p) => (await import('node:fs/promises')).readFile(p, 'utf8').catch(() => null),
    });
    const result = await claudeAgentDef.fetchModels!('claude', noRoutes());
    expect(result!.map((m) => m.id)).toEqual([...claudeAgentDef.fallbackModels.map((m) => m.id), 'claude-fable-6']);
  });

  it('returns null (static list renders) when the CLI and a malformed ~/.claude.json both give nothing', async () => {
    writeFileSync(path.join(dir, '.claude.json'), '{not json', 'utf8');
    setClaudeCodeModelIoForTesting({
      runInitialize: async () => 'error: unknown option\n',
      readConfigFile: async (p) => (await import('node:fs/promises')).readFile(p, 'utf8').catch(() => null),
    });
    await expect(claudeAgentDef.fetchModels!('claude', noRoutes())).resolves.toBeNull();
  });

  it('keeps the BYOK path when the CLI step finds nothing, and unions both when both answer', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      JSON.stringify({ data: [{ id: 'claude-api-only-1', display_name: 'API only', type: 'model' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ) as unknown as Response);
    const byokOnly = await claudeAgentDef.fetchModels!('claude', { ...noRoutes(), ANTHROPIC_API_KEY: 'sk-a' });
    expect(byokOnly!.map((m) => m.id)).toEqual([...claudeAgentDef.fallbackModels.map((m) => m.id), 'claude-api-only-1']);

    resetAnthropicLiveModelCacheForTesting();
    setClaudeCodeModelIoForTesting(cliAnswering([{ value: 'claude-opus-5-5' }]));
    const both = await claudeAgentDef.fetchModels!('claude', { ...noRoutes(), ANTHROPIC_API_KEY: 'sk-a' });
    expect(both!.map((m) => m.id)).toEqual([
      ...claudeAgentDef.fallbackModels.map((m) => m.id), 'claude-opus-5-5', 'claude-api-only-1',
    ]);
  });

  it('falls back to null when no mmd routes file is resolvable (no HOME, no override)', async () => {
    const result = await claudeAgentDef.fetchModels!('claude', {});
    // With an empty env (no HOME, no MMD_MODEL_ROUTES_FILE), resolveMmdRoutesFile
    // falls back to the real OS homedir(), which normally exists on this dev
    // machine and won't have a mms/model-routes.json file, so this resolves to
    // null (file not found) rather than throwing.
    expect(result).toBeNull();
  });

  it('merges live mmd route ids with the static fallback models when a valid routes file exists', async () => {
    const routesFile = path.join(dir, 'model-routes.json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      routesFile,
      JSON.stringify({
        routes: {
          'my-routed-model': { primary: { anthropic_base_url: 'https://example.com', api_key: 'k' } },
        },
      }),
      'utf8',
    );
    const result = await claudeAgentDef.fetchModels!('claude', { MMD_MODEL_ROUTES_FILE: routesFile });
    expect(result).not.toBeNull();
    expect(result!.some((m) => m.id === 'my-routed-model')).toBe(true);
    // Static fallback models still present alongside the routed id.
    expect(result!.some((m) => m.id === 'sonnet')).toBe(true);
  });

  it('returns null when the configured routes file does not exist', async () => {
    const result = await claudeAgentDef.fetchModels!('claude', {
      MMD_MODEL_ROUTES_FILE: path.join(dir, 'does-not-exist.json'),
    });
    expect(result).toBeNull();
  });
});


/**
 * The reported symptom, pinned. The Local-CLI picker renders `fallbackModels` verbatim whenever no
 * live source answers, which is the ordinary case for a subscription-authenticated `claude` with no
 * mmd routes file and no API key — so an id absent from this list is an id the operator cannot pick.
 */
describe('claudeAgentDef.fallbackModels — the list the picker actually renders', () => {
  it('offers the current Fable models and the `fable` CLI alias', () => {
    const ids = claudeAgentDef.fallbackModels.map((m) => m.id);
    expect(ids).toContain('claude-fable-5-1');
    expect(ids).toContain('claude-fable-5');
    expect(ids).toContain('fable');
  });

  it('never drops the CLI aliases or the default sentinel while gaining new ids', () => {
    const ids = claudeAgentDef.fallbackModels.map((m) => m.id);
    expect(ids.slice(0, 5)).toEqual(['default', 'fable', 'sonnet', 'opus', 'haiku']);
  });

  it('carries no bracketed long-context suffix, which `sanitizeCustomModel` would reject', () => {
    // `~/.claude.json`'s server-fetched cache spells Fable `claude-fable-5-1[1m]`. Copying that
    // verbatim would put an id in the picker that the chat path then refuses.
    for (const model of claudeAgentDef.fallbackModels) {
      expect(sanitizeCustomModel(model.id)).toBe(model.id);
    }
  });
});
