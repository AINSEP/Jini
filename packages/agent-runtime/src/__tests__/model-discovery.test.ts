import { describe, expect, it, vi } from 'vitest';
import { AGENT_DEFS } from '../registry.js';
import { createAgentModelDiscovery, MODEL_CATALOG_TTL_MS, MODEL_NEGATIVE_TTL_MS, modelDiscoveryForDef, resolveModelForLaunch, withModelProbeTimeout } from '../model-discovery.js';
import { parseClaudeInitializeMetadata, parsePiRpcMetadata } from '../model-discovery-adapters.js';
import { parseCodexDebugModels } from '../defs/codex.js';
import { parseAgyModels } from '../defs/antigravity.js';
import { parseGrokBuildModels } from '../defs/grok-build.js';
import { parseLineSeparatedModels } from '../defs/shared.js';
import { parsePiModels } from '../pi-models.js';
import type { ModelDiscoveryContext, ModelDiscoveryDeps, ModelProbeResult } from '../model-discovery-types.js';

const context: ModelDiscoveryContext = { executable: '/cli', version: '1', cwd: '/workspace', env: { HOME: '/home/fake' } };
function fakeDeps() {
  let time = 0; let calls = 0;
  let output = 'provider/model-new\n'; let failure: Error | null = null;
  const files = new Map<string, string>();
  const metadata: ModelProbeResult = { models: [{ id: 'model-new', label: 'Model New' }], defaultSelectionId: 'model-new', source: 'rpc', coverage: 'account' };
  const deps: ModelDiscoveryDeps = {
    process: { async run() { calls++; if (failure) throw failure; return { stdout: output, stderr: '' }; } },
    fs: { async read(path) { return files.get(path) ?? null; } },
    http: { async list() { return { ok: true, kind: 'success', latencyMs: 1, models: [{ id: 'model-new', label: 'Model New' }] }; } },
    credential: { async connection() { return { protocol: 'openai', apiKey: 'secret-test-key', baseUrl: 'https://provider.example/v1' }; } },
    acp: { async probe() { calls++; return metadata; } }, rpc: { async probe() { calls++; return metadata; } },
    clock: { now: () => time }, cache: new Map(),
  };
  return { deps, files, metadata, get calls() { return calls; }, advance(ms: number) { time += ms; }, setOutput(value: string) { output = value; }, fail(value: Error | null) { failure = value; } };
}
function cliPort() {
  return createAgentModelDiscovery('test-cli', { args: ['models'], parse: parseLineSeparatedModels, fallbackModels: () => [{ id: 'retired-model', label: 'Retired Model' }] });
}

describe('every registered definition has discovery and default-resolution capabilities', () => {
  for (const def of AGENT_DEFS) {
    it(`${def.id} declares both ports and can consume dynamic metadata`, async () => {
      expect(typeof def.discoverModels).toBe('function');
      expect(typeof def.resolveDefaultModel).toBe('function');
      const fake = fakeDeps();
      fake.files.set('/home/fake/.codebuddy/settings.json', JSON.stringify({ additionalModelOptionsCache: [{ value: 'model-new' }] }));
      if (def.id === 'codex') fake.setOutput(JSON.stringify({ models: [{ slug: 'model-new', display_name: 'Model New' }] }));
      else if (def.id === 'antigravity') fake.setOutput('Fetching available models...\nmodel-new\tModel New\n');
      else if (def.id === 'claude' || def.id === 'codebuddy') fake.setOutput(JSON.stringify({ type: 'control_response', response: { subtype: 'success', response: { models: [{ value: 'default', resolvedModel: 'model-new', displayName: 'Model New' }] } } }));
      else if (def.id === 'amr') fake.setOutput(JSON.stringify({ source: 'remote', data: [{ id: 'claude-model-new' }] }));
      else if (def.id === 'grok-build') fake.setOutput('Default model: model-new\n- model-new\n');
      const catalog = await def.discoverModels!({ context }, { deps: fake.deps });
      expect(catalog.source).not.toBe('offline-fallback');
      expect(catalog.freshness).toBe('fresh');
      expect(catalog.models.some((row) => row.id.includes('model-new'))).toBe(true);
      const resolution = await def.resolveDefaultModel!({ context, catalog }, { deps: fake.deps });
      const selected = catalog.models.find((row) => row.id === catalog.defaultSelectionId);
      if (selected?.identityKind === 'concrete') {
        expect(resolution.status).toBe('resolved');
        expect(resolution.status === 'resolved' && resolution.id).toBe(selected.id);
      } else {
        expect(resolution.status).toBe('unresolved');
        expect(resolution.status === 'unresolved' && resolution.reason.length > 0).toBe(true);
      }
    });
  }
});

describe('shared adapter conformance', () => {
  it('does not start an already cancelled effect', async () => {
    const controller = new AbortController(); controller.abort(); let calls = 0;
    await expect(withModelProbeTimeout(async () => { calls++; }, 1000, controller.signal)).rejects.toThrow('Probe cancelled');
    expect(calls).toBe(0);
  });
  it('aborts the effect port on timeout without retaining its error text', async () => {
    let stopped = false;
    await expect(withModelProbeTimeout((signal) => new Promise<never>(() => {
      signal.addEventListener('abort', () => { stopped = true; });
    }), 1)).rejects.toThrow('Probe timed out');
    expect(stopped).toBe(true);
  });
  it('discovers additions and removals without editing a def or merging static hints', async () => {
    const fake = fakeDeps(); const port = cliPort();
    const first = await port.discoverModels({ context }, { deps: fake.deps });
    expect(first.models.map((row) => row.id)).toEqual(['provider/model-new']);
    fake.setOutput('provider/model-next\n');
    const next = await port.discoverModels({ context }, { deps: fake.deps, force: true });
    expect(next.models.map((row) => row.id)).toEqual(['provider/model-next']);
    expect(next.freshness).toBe('fresh');
  });
  it('coalesces probes, expires at 15 minutes, and bypasses TTL on explicit refresh', async () => {
    const fake = fakeDeps(); const port = cliPort();
    const [a, b] = await Promise.all([port.discoverModels({ context }, { deps: fake.deps }), port.discoverModels({ context }, { deps: fake.deps })]);
    expect(a).toEqual(b); expect(fake.calls).toBe(1);
    await port.discoverModels({ context }, { deps: fake.deps }); expect(fake.calls).toBe(1);
    fake.advance(MODEL_CATALOG_TTL_MS);
    await port.discoverModels({ context }, { deps: fake.deps }); expect(fake.calls).toBe(2);
    await port.discoverModels({ context }, { deps: fake.deps, force: true }); expect(fake.calls).toBe(3);
  });
  it('isolates executable/version, cwd, profile, config and account scopes', async () => {
    const fake = fakeDeps(); const port = cliPort();
    const scopes = [context, { ...context, executable: '/other' }, { ...context, version: '2' }, { ...context, cwd: '/other' }, { ...context, profile: 'work' }, { ...context, configFingerprint: 'new' }, { ...context, accountScope: 'other' }, { ...context, env: { ...context.env, API_KEY: 'different-secret' } }];
    const catalogs = await Promise.all(scopes.map((scope) => port.discoverModels({ context: scope }, { deps: fake.deps })));
    expect(new Set(catalogs.map((row) => row.launchFingerprint)).size).toBe(scopes.length);
    expect(fake.calls).toBe(scopes.length);
  });
  it('negative-caches failure for 30 seconds and labels last good results as stale', async () => {
    const fake = fakeDeps(); const port = cliPort();
    const good = await port.discoverModels({ context }, { deps: fake.deps });
    fake.fail(new Error('offline secret-test-key'));
    const stale = await port.discoverModels({ context }, { deps: fake.deps, force: true });
    expect(stale.freshness).toBe('stale'); expect(stale.fetchedAt).toBe(good.fetchedAt);
    expect(JSON.stringify(stale.diagnostics)).not.toContain('secret-test-key');
    await port.discoverModels({ context }, { deps: fake.deps }); expect(fake.calls).toBe(2);
    fake.advance(MODEL_NEGATIVE_TTL_MS);
    await port.discoverModels({ context }, { deps: fake.deps }); expect(fake.calls).toBe(3);
  });
  it('labels packaged rows as offline fallback and never resolves a routing mode', async () => {
    const fake = fakeDeps(); fake.fail(new Error('secret-test-key'));
    const catalog = await cliPort().discoverModels({ context }, { deps: fake.deps });
    expect(catalog.source).toBe('offline-fallback'); expect(catalog.freshness).toBe('offline-fallback');
    expect(catalog.models.map((row) => row.id)).toEqual(['retired-model']);
    for (const id of ['auto', 'adaptive', 'smart', 'vercel-ai-gateway', 'provider/auto']) {
      const routing = { ...context, model: id };
      const port = cliPort(); fake.fail(null); fake.setOutput(`${id}\n`);
      const live = await port.discoverModels({ context: routing }, { deps: fake.deps });
      const resolution = await port.resolveDefaultModel({ context: routing, catalog: live }, { deps: fake.deps });
      expect(resolution).toEqual({ status: 'unresolved', selectionId: id, reason: 'The configured selection has no concrete model evidence.' });
    }
  });
  it('preserves ACP native current selection and resolves only a concrete row', async () => {
    const def = AGENT_DEFS.find((row) => row.id === 'goose')!;
    const fake = fakeDeps();
    const catalog = await def.discoverModels!({ context }, { deps: fake.deps });
    expect(catalog.defaultSelectionId).toBe('model-new');
    const resolution = await def.resolveDefaultModel!({ context, catalog }, { deps: fake.deps });
    expect(resolution.status === 'resolved' && resolution.id).toBe('model-new');
  });
  it('pins the configured Codex model to the native launch flag', async () => {
    const def = AGENT_DEFS.find((row) => row.id === 'codex')!; const fake = fakeDeps();
    fake.files.set('/home/fake/.codex/config.toml', 'model = "gpt-new"\n');
    fake.setOutput('{"models":[{"slug":"gpt-new","display_name":"GPT New"}]}');
    const pinned = await resolveModelForLaunch({ def, context }, { deps: fake.deps });
    expect(pinned.model).toBe('gpt-new');
    const args = def.buildArgs({ prompt: 'test', imagePaths: [] }, { options: { model: pinned.model } });
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', 'gpt-new']);
  });
  it('maps Antigravity display-name settings to the live slug', async () => {
    const def = AGENT_DEFS.find((row) => row.id === 'antigravity')!; const fake = fakeDeps();
    fake.files.set('/home/fake/.gemini/antigravity-cli/settings.json', '{"model":"Gemini Flash High"}');
    fake.setOutput('gemini-flash-high\tGemini Flash High\n');
    const pinned = await resolveModelForLaunch({ def, context }, { deps: fake.deps });
    expect(pinned.model).toBe('gemini-flash-high');
    expect(def.buildArgs({ prompt: 'test', imagePaths: [] }, { options: { model: pinned.model } }).slice(0, 2)).toEqual(['--model', 'gemini-flash-high']);
  });
  it('refuses an old default snapshot after the config changes, including resumed sessions', async () => {
    const def = AGENT_DEFS.find((row) => row.id === 'codex')!; const fake = fakeDeps();
    fake.files.set('/home/fake/.codex/config.toml', 'model = "gpt-new"');
    fake.setOutput('{"models":[{"slug":"gpt-new"}]}');
    const catalog = await def.discoverModels!({ context }, { deps: fake.deps });
    fake.files.set('/home/fake/.codex/config.toml', 'model = "gpt-other"');
    expect(await def.resolveDefaultModel!({ context, catalog }, { deps: fake.deps })).toEqual({ status: 'unresolved', reason: 'Launch configuration changed; refresh the catalog.' });
    const resumed = { ...context, resumeSessionId: 'session-1' };
    const latest = await def.discoverModels!({ context: resumed }, { deps: fake.deps });
    expect(await def.resolveDefaultModel!({ context: resumed, catalog: latest }, { deps: fake.deps })).toEqual({ status: 'unresolved', reason: 'Resumed session model metadata is required.' });
  });
});


describe('launch compatibility and cache recovery', () => {
  it('passes an explicit unlisted custom model unchanged unless the definition disables custom models', async () => {
    const fake = fakeDeps();
    const def = { ...cliPort(), supportsCustomModel: true };
    const launchContext = { ...context, model: 'private/model-2026' };
    const result = await resolveModelForLaunch({ def, context: launchContext }, { deps: fake.deps });
    expect(result.model).toBe('private/model-2026');
    // RuntimeAgentDef documents omitted supportsCustomModel as allowing custom input.
    expect((await resolveModelForLaunch({ def: cliPort(), context: launchContext }, { deps: fake.deps })).model).toBe('private/model-2026');
    await expect(resolveModelForLaunch({ def: { ...def, supportsCustomModel: false }, context: launchContext }, { deps: fake.deps })).rejects.toThrow('no concrete model evidence');
  });
  it('uses static host models and the configured default when discovery ports are absent', async () => {
    const fake = fakeDeps();
    const def = { id: 'host', fallbackModels: [{ id: 'host-first', label: 'First' }, { id: 'host-second', label: 'Second' }], defaultModelEnvVar: 'HOST_MODEL' };
    expect((await resolveModelForLaunch({ def, context }, { deps: fake.deps })).model).toBe('host-first');
    expect((await resolveModelForLaunch({ def, context: { ...context, env: { HOST_MODEL: 'host-second' } } }, { deps: fake.deps })).model).toBe('host-second');
    expect((await resolveModelForLaunch({ def, context: { ...context, model: 'host-second' } }, { deps: fake.deps })).model).toBe('host-second');
    expect((await resolveModelForLaunch({ def, context: { ...context, env: { HOST_MODEL: 'host-configured-unlisted' } } }, { deps: fake.deps })).model).toBe('host-configured-unlisted');
    expect(fake.calls).toBe(0);
  });
  it('fills either missing discovery port independently and preserves a host-supplied implementation', async () => {
    const fake = fakeDeps();
    const staticDef = { fallbackModels: [{ id: 'host-model', label: 'Host Model' }] };
    const discoveryOnly = { ...staticDef, discoverModels: modelDiscoveryForDef(staticDef).discoverModels };
    expect((await resolveModelForLaunch({ def: discoveryOnly, context }, { deps: fake.deps })).model).toBe('host-model');
    let receivedModels: string[] = [];
    const resolutionOnly = { ...staticDef, async resolveDefaultModel({ catalog }: Parameters<ReturnType<typeof modelDiscoveryForDef>['resolveDefaultModel']>[0]) {
      receivedModels = catalog.models.map(row => row.id);
      return { status: 'resolved' as const, id: 'host-configured', source: 'config-file' as const, resolvedAt: '2026-10-07T00:00:00.000Z', launchFingerprint: catalog.launchFingerprint };
    } };
    expect((await resolveModelForLaunch({ def: resolutionOnly, context }, { deps: fake.deps })).model).toBe('host-configured');
    expect(receivedModels).toEqual(['host-model']);
    expect(fake.calls).toBe(0);
  });
  it('resolves a cached default immediately while one background refresh is pending', async () => {
    const fake = fakeDeps();
    const port = createAgentModelDiscovery('test-cli', { args: ['models'], fallbackModels: () => [],
      parse: ({ stdout }) => parseLineSeparatedModels({ stdout: stdout.replace(/^Default model:.*\n/gm, '') }) });
    // Config-free CLI defaults are carried in native metadata rather than inferred from order.
    fake.setOutput('Default model: provider/model-new\nprovider/model-new\n');
    await port.discoverModels({ context }, { deps: fake.deps });
    fake.advance(MODEL_CATALOG_TTL_MS);
    let finish!: (result: { stdout: string; stderr: string }) => void;
    let refreshes = 0;
    fake.deps.process.run = () => { refreshes++; return new Promise(resolve => { finish = resolve; }); };
    try {
      const results = await Promise.all([1, 2].map(() => resolveModelForLaunch({ def: port, context }, { deps: fake.deps })));
      expect(results.map(row => row.model)).toEqual(['provider/model-new', 'provider/model-new']);
      expect(results[0]!.catalog.freshness).toBe('stale');
      expect(refreshes).toBe(1);
    } finally {
      finish({ stdout: 'Default model: provider/model-next\nprovider/model-next\n', stderr: '' });
      await Promise.all([...fake.deps.cache.values()].map(entry => entry.pending));
    }
    expect((await port.discoverModels({ context }, { deps: fake.deps })).models.map(row => row.id)).toEqual(['provider/model-next']);
  }, 200);
  for (const id of ['codex', 'opencode', 'claude', 'codebuddy']) {
    it(`starts a cold ${id} run from its disk cache while native discovery refreshes`, async () => {
      const fake = fakeDeps(); const def = AGENT_DEFS.find(row => row.id === id)!;
      const model = id === 'opencode' ? 'openai/gpt-cached' : 'gpt-cached';
      const configPath = id === 'codex' ? '/home/fake/.codex/config.toml' : id === 'opencode' ? '/home/fake/.config/opencode/opencode.json' : id === 'claude' ? '/home/fake/.claude/settings.json' : '/home/fake/.codebuddy/settings.json';
      const diskPath = id === 'codex' ? '/home/fake/.codex/models_cache.json' : id === 'opencode' ? '/home/fake/.cache/opencode/models.json' : id === 'claude' ? '/home/fake/.claude.json' : '/home/fake/.codebuddy/settings.json';
      fake.files.set(configPath, id === 'codex' ? 'model = "gpt-cached"' : JSON.stringify({ model }));
      fake.files.set(diskPath, id === 'codex' ? '{"models":[{"slug":"gpt-cached"}]}' : id === 'opencode' ? '{"openai":{"models":{"gpt-cached":{}}}}' : JSON.stringify({ model, additionalModelOptionsCache: [{ value: model }] }));
      let finish!: (result: { stdout: string; stderr: string }) => void;
      fake.deps.process.run = () => new Promise(resolve => { finish = resolve; });
      try {
        const result = await resolveModelForLaunch({ def, context }, { deps: fake.deps });
        expect(result.model).toBe(model);
        expect(result.catalog.source).toBe('cli-cache');
        expect(result.catalog.freshness).toBe('stale');
      } finally {
        const stdout = id === 'codex' ? '{"models":[{"slug":"gpt-cached"}]}' : id === 'opencode' ? `${model}\n` : JSON.stringify({ type: 'control_response', response: { subtype: 'success', response: { models: [{ value: model, resolvedModel: model }] } } });
        finish({ stdout, stderr: '' });
        await Promise.all([...fake.deps.cache.values()].map(entry => entry.pending));
      }
    }, 200);
  }
  it('bounds a cold wait without any cache and aborts its effect', async () => {
    vi.useFakeTimers();
    const fake = fakeDeps(); let aborted = false;
    fake.deps.process.run = ({ signal }) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); });
    try {
      const result = cliPort().discoverModels({ context }, { deps: fake.deps });
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await result).freshness).toBe('offline-fallback');
      expect(aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  for (const id of ['codex', 'opencode']) {
    it(`${id} listing timeout leaves time and a live signal for disk-cache recovery`, async () => {
      vi.useFakeTimers();
      const fake = fakeDeps(); const def = AGENT_DEFS.find(row => row.id === id)!;
      const path = id === 'codex' ? '/home/fake/.codex/models_cache.json' : '/home/fake/.cache/opencode/models.json';
      fake.files.set(path, id === 'codex' ? '{"models":[{"slug":"gpt-cached"}]}' : '{"openai":{"models":{"gpt-cached":{"name":"Cached GPT"}}}}');
      let listingSignal!: AbortSignal; let cacheAborted: boolean | undefined;
      fake.deps.process.run = ({ signal }) => { listingSignal = signal; return new Promise(() => {}); };
      fake.deps.fs.read = async (file, { signal }) => { if (file === path) cacheAborted = signal.aborted; return fake.files.get(file) ?? null; };
      try {
        const result = def.discoverModels!({ context }, { deps: fake.deps, force: true });
        await vi.advanceTimersByTimeAsync(8_000);
        // Do not await a hung result: assert the fallback was reached within the inner budget.
        expect(cacheAborted).toBe(false);
        expect(listingSignal.aborted).toBe(true);
        const catalog = await result;
        expect(catalog.source).toBe('cli-cache');
        expect(catalog.models.map(row => row.id)).toEqual([id === 'codex' ? 'gpt-cached' : 'openai/gpt-cached']);
      } finally { await vi.runAllTimersAsync(); vi.useRealTimers(); }
    });
  }
});

describe('parser fixtures', () => {
  it('retains Codex display names, variants and per-model reasoning', () => {
    expect(parseCodexDebugModels({ stdout: '{"models":[{"slug":"gpt-new","display_name":"GPT New","supported_reasoning_levels":[{"effort":"ultra"}]},{"slug":"hidden","visibility":"hide"}]}' })?.filter((row) => row.id !== 'default')).toEqual([{ id: 'gpt-new', label: 'GPT New', reasoning: [{ id: 'ultra', label: 'Ultra' }] }]);
  });
  it('parses agy and OpenCode output without progress text', () => {
    expect(parseAgyModels({ stdout: 'Fetching available models...\nmodel-new\tModel New\n' })?.filter((row) => row.id !== 'default')).toEqual([{ id: 'model-new', label: 'Model New' }]);
    expect(parseLineSeparatedModels({ stdout: 'provider/model-new\nprovider/model-next\n' }).filter((row) => row.id !== 'default').map((row) => row.id)).toEqual(['provider/model-new', 'provider/model-next']);
  });
  it('parses the Pi stdout table and authoritative RPC state', () => {
    expect(parsePiModels({ stdout: 'provider model name\nopenai gpt-new GPT New\n' })?.map((row) => row.id)).toEqual(['default', 'openai/gpt-new']);
    expect(parsePiRpcMetadata('{"type":"response","command":"get_available_models","success":true,"data":{"models":[{"provider":"openai","id":"gpt-new","name":"GPT New"}]}}\n{"type":"response","command":"get_state","success":true,"data":{"model":{"provider":"openai","id":"gpt-new"}}}\n')).toEqual({ models: [{ id: 'openai/gpt-new', label: 'GPT New', identityKind: 'concrete', provider: 'openai' }], defaultSelectionId: 'openai/gpt-new', source: 'rpc', coverage: 'account' });
  });
  it('keeps Grok gateway rows as routing modes and provider-qualified IDs', () => {
    expect(parseGrokBuildModels({ stdout: 'Default model: vercel-ai-gateway\n- vercel-ai-gateway\n• xai/grok-new\nYou are not authenticated\n' }).filter((row) => row.id !== 'default')).toEqual([{ id: 'vercel-ai-gateway', label: 'vercel-ai-gateway', identityKind: 'routing-mode' }, { id: 'xai/grok-new', label: 'xai/grok-new', identityKind: 'concrete' }]);
  });
  it('retains Claude alias evidence and context-window variants', () => {
    const parsed = parseClaudeInitializeMetadata('{"type":"control_response","response":{"subtype":"success","response":{"models":[{"value":"opus","resolvedModel":"claude-opus-new[1m]","displayName":"Claude Opus New"}]}}}');
    expect(parsed?.models).toEqual([{ id: 'opus', label: 'Claude Opus New', identityKind: 'alias', resolvedId: 'claude-opus-new[1m]' }, { id: 'claude-opus-new[1m]', label: 'Claude Opus New', identityKind: 'concrete' }]);
  });
});
