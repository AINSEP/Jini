/** Coupling audit finding 2: policy works with host effects and probes, without native defaults. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAgentModelDiscovery, MODEL_CATALOG_TTL_MS, MODEL_NEGATIVE_TTL_MS, modelDiscoveryForDef, modelLaunchFingerprint, resolveModelForLaunch } from '../model-discovery.js';
import { ModelProbeError } from '../model-discovery-shared.js';
import { createAgentModelDiscovery as createNativeDiscovery } from '../model-discovery-native.js';
import { createAgentModelDiscovery as createRootDiscovery, modelDiscoveryForDef as rootDiscoveryForDef,
  resolveModelForLaunch as rootResolveModelForLaunch } from '../index.js';
import { modelDiscoveryForDef as nativeDiscoveryForDef, resolveModelForLaunch as nativeResolveModelForLaunch } from '../model-discovery-native.js';
import type { ModelCatalogSnapshot, ModelDiscoveryContext, ModelDiscoveryDeps, ModelDiscoveryProbes, ModelProbeResult } from '../model-discovery-types.js';

const context: ModelDiscoveryContext = { executable: '/host-cli', cwd: '/workspace', env: { HOME: '/fixture' } };
const configuration = { fallbackModels: () => [{ id: 'offline-model', label: 'Offline Model' }] };
const live: ModelProbeResult = { models: [{ id: 'host-model', label: 'Host Model' }], defaultSelectionId: 'host-model', source: 'rpc', coverage: 'account' };

function hostDeps({ now = 0 }: { now?: number } = {}, _optional = {}): ModelDiscoveryDeps {
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected native effect'); };
  return {
    process: { run: unexpected }, fs: { read: async () => null }, http: { list: unexpected },
    credential: { connection: unexpected }, acp: { probe: unexpected }, rpc: { probe: unexpected },
    clock: { now: () => now }, cache: new Map(),
  };
}

function hostProbes({ catalog = async () => live, cliCache = async () => { throw new ModelProbeError('unsupported-version'); }, timeoutMs = 1000 }: {
  catalog?: ModelDiscoveryProbes['catalog']; cliCache?: ModelDiscoveryProbes['cliCache']; timeoutMs?: number;
} = {}, _optional = {}): ModelDiscoveryProbes {
  return { catalog, cliCache, timeoutMs: () => timeoutMs };
}

describe('injected model-discovery policy', () => {
  it('uses bound ports and custom probes, coalesces requests and normalizes duplicate rows', async () => {
    const deps = hostDeps(); let calls = 0;
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps, probes: hostProbes({
      catalog: async ({ deps: active, configuration: configured, signal }) => {
        expect(active).toBe(deps); expect(configured).toBe(configuration); expect(signal.aborted).toBe(false);
        calls++;
        return { ...live, models: [{ id: 'default', label: 'Default' }, ...live.models, ...live.models] };
      },
    }) });
    const [first, second] = await Promise.all([port.discoverModels({ context }), port.discoverModels({ context })]);
    expect(first).toEqual(second);
    expect(first.models).toEqual([{ id: 'host-model', label: 'Host Model', identityKind: 'concrete' }]);
    expect(first.source).toBe('rpc'); expect(first.freshness).toBe('fresh'); expect(calls).toBe(1);
    expect(await port.resolveDefaultModel({ context, catalog: first })).toEqual({
      status: 'resolved', id: 'host-model', selectionId: 'host-model', source: 'rpc',
      resolvedAt: '1970-01-01T00:00:00.000Z', launchFingerprint: first.launchFingerprint,
    });
  });

  it('keeps native compatibility while an alternate probe changes the actual catalog output', async () => {
    const deps = hostDeps();
    deps.process.run = async () => ({ stdout: 'native-model', stderr: '' });
    const cliConfiguration = { ...configuration, args: ['models'], parse: ({ stdout }: { stdout: string }) => [{ id: stdout, label: stdout }] };
    const native = await createNativeDiscovery('host', cliConfiguration).discoverModels({ context }, { deps });
    deps.cache.clear();
    const policy = await createAgentModelDiscovery({ agentId: 'host', configuration: cliConfiguration, deps, probes: hostProbes() }).discoverModels({ context });
    // Only the probe composition changes: policy caching/normalization and effect deps are identical.
    expect(native.models).toEqual([{ id: 'native-model', label: 'native-model', identityKind: 'concrete' }]);
    expect(policy.models).toEqual([{ id: 'host-model', label: 'Host Model', identityKind: 'concrete' }]);
  });

  it('preserves per-call dependency overrides without sharing the bound host cache', async () => {
    const bound = hostDeps(); const override = hostDeps({ now: 1000 });
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps: bound, probes: hostProbes() });
    const catalog = await port.discoverModels({ context }, { deps: override });
    expect(catalog.fetchedAt).toBe('1970-01-01T00:00:01.000Z');
    expect(bound.cache.size).toBe(0); expect(override.cache.size).toBe(1);
    const resolved = await port.resolveDefaultModel({ context, catalog }, { deps: override });
    expect(resolved.status === 'resolved' && resolved.resolvedAt).toBe('1970-01-01T00:00:01.000Z');
  });

  it('uses the supplied disk probe and retains stale provenance while refreshing', async () => {
    const deps = hostDeps(); let diskCalls = 0;
    let finish!: (value: ModelProbeResult) => void;
    const pending = new Promise<ModelProbeResult>(resolve => { finish = resolve; });
    const port = createAgentModelDiscovery({ agentId: 'codex', configuration, deps, probes: hostProbes({
      catalog: () => pending,
      cliCache: async () => { diskCalls++; return { ...live, models: [{ id: 'disk-model', label: 'Disk Model' }], source: 'cli-cache', coverage: 'observed' }; },
    }) });
    const first = await port.discoverModels({ context }, { staleWhileRevalidate: true });
    expect(first.models).toEqual([{ id: 'disk-model', label: 'Disk Model', identityKind: 'concrete' }]);
    expect(first.source).toBe('cli-cache'); expect(first.freshness).toBe('stale'); expect(diskCalls).toBe(1);
    const refresh = [...deps.cache.values()][0]!.pending!;
    finish(live);
    expect((await refresh).models).toEqual([{ id: 'host-model', label: 'Host Model', identityKind: 'concrete' }]);
  });

  it('cancels before probing and diagnoses a shared probe error without exposing its message', async () => {
    let calls = 0; const controller = new AbortController(); controller.abort();
    const deps = hostDeps();
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps, probes: hostProbes({
      catalog: async () => { calls++; throw new ModelProbeError('auth-missing'); },
    }) });
    const cancelled = await port.discoverModels({ context }, { signal: controller.signal });
    expect(cancelled.diagnostics).toEqual([{ code: 'timeout', message: 'Model discovery timed out or was cancelled.' }]);
    expect(calls).toBe(0);
    const failed = await port.discoverModels({ context });
    expect(failed.models).toEqual([{ id: 'offline-model', label: 'Offline Model', identityKind: 'concrete' }]);
    expect(failed.diagnostics).toEqual([{ code: 'auth-missing', message: 'CLI credentials are unavailable.' }]);
    expect(calls).toBe(1);
  });

  it('uses the supplied timeout budget and aborts its probe signal', async () => {
    let aborted = false;
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps: hostDeps(), probes: hostProbes({
      timeoutMs: 1,
      catalog: ({ signal }) => new Promise<never>(() => { signal.addEventListener('abort', () => { aborted = true; }); }),
    }) });
    const catalog = await port.discoverModels({ context });
    expect(aborted).toBe(true); expect(catalog.freshness).toBe('offline-fallback');
    expect(catalog.diagnostics).toEqual([{ code: 'timeout', message: 'Model discovery timed out or was cancelled.' }]);
  });

  it('binds supplied dependencies for static definitions and launch resolution', async () => {
    const deps = hostDeps({ now: 2000 });
    const def = { fallbackModels: live.models };
    const discovery = modelDiscoveryForDef({ def, deps });
    const catalog = await discovery.discoverModels({ context });
    expect(catalog.fetchedAt).toBe('1970-01-01T00:00:02.000Z');
    const launch = await resolveModelForLaunch({ def, context, deps });
    expect(launch.model).toBe('host-model');
    expect(launch.resolution.status === 'resolved' && launch.resolution.resolvedAt).toBe('1970-01-01T00:00:02.000Z');
  });
});

describe('discovery public entry contracts', () => {
  it('retains the root compatibility functions and publishes the policy subpath', () => {
    expect(createRootDiscovery).toBe(createNativeDiscovery);
    expect(rootDiscoveryForDef).toBe(nativeDiscoveryForDef);
    expect(rootResolveModelForLaunch).toBe(nativeResolveModelForLaunch);
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(manifest.exports['./model-discovery']).toEqual({
      types: './dist/model-discovery.d.ts', import: './dist/model-discovery.js', default: './dist/model-discovery.js',
    });
    expect(manifest.jini.entries['./model-discovery']).toBe('node');
    expect(manifest.typesVersions['*']['model-discovery']).toEqual(['./dist/model-discovery.d.ts']);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const offlineRows = [{ id: 'offline-model', label: 'Offline Model', identityKind: 'concrete' }];

describe('createAgentModelDiscovery default selection', () => {
  const withoutDefault: ModelProbeResult = { models: live.models, source: 'rpc', coverage: 'account' };
  async function selectionFor(agentId: string, result: ModelProbeResult, env: Record<string, string> = {}, model?: string) {
    const scope = { ...context, env: { ...context.env, ...env }, ...(model ? { model } : {}) };
    const port = createAgentModelDiscovery({ agentId, configuration, deps: hostDeps(), probes: hostProbes({ catalog: async () => result }) });
    return (await port.discoverModels({ context: scope })).defaultSelectionId;
  }

  it('prefers the native rpc default over a config selection for most agents', async () => {
    expect(await selectionFor('amr', { ...live, defaultSelectionId: 'native' }, { VELA_DEFAULT_MODEL: 'cfg' })).toBe('native');
  });

  it('falls back to the config selection when the rpc result has no default', async () => {
    expect(await selectionFor('amr', withoutDefault, { VELA_DEFAULT_MODEL: 'cfg' })).toBe('cfg');
  });

  it('prefers the config selection over a non-rpc native default', async () => {
    expect(await selectionFor('amr', { ...live, source: 'cli', defaultSelectionId: 'native' }, { VELA_DEFAULT_MODEL: 'cfg' })).toBe('cfg');
  });

  it('uses a non-rpc native default when there is no config selection', async () => {
    expect(await selectionFor('amr', { ...live, source: 'cli', defaultSelectionId: 'native' })).toBe('native');
  });

  it('prefers the config selection over a Claude rpc default', async () => {
    expect(await selectionFor('claude', { ...live, defaultSelectionId: 'native' }, { ANTHROPIC_MODEL: 'cfg' })).toBe('cfg');
  });

  it('always lets grok-build native metadata win over its config file', async () => {
    const deps = hostDeps();
    deps.fs.read = async (path) => (path === '/fixture/.grok/config.toml' ? '[models]\nmodel = "cfg"\n' : null);
    const probe = (result: ModelProbeResult) => createAgentModelDiscovery({ agentId: 'grok-build', configuration, deps, probes: hostProbes({ catalog: async () => result }) });
    expect((await probe(withoutDefault).discoverModels({ context })).defaultSelectionId).toBe('cfg');
    expect((await probe({ ...live, source: 'cli', defaultSelectionId: 'native' }).discoverModels({ context }, { force: true })).defaultSelectionId).toBe('native');
  });

  it('lets the launch model outrank every other source', async () => {
    expect(await selectionFor('amr', { ...live, defaultSelectionId: 'native' }, { VELA_DEFAULT_MODEL: 'cfg' }, 'chosen')).toBe('chosen');
  });

  it('omits the default selection when no source names one', async () => {
    expect(await selectionFor('amr', withoutDefault)).toBeUndefined();
  });
});

describe('createAgentModelDiscovery catalog lifecycle', () => {
  it('labels a cli-cache probe result stale with the negative lifetime', async () => {
    const deps = hostDeps({ now: 1000 });
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps, probes: hostProbes({ catalog: async () => ({ ...live, source: 'cli-cache' }) }) });
    const catalog = await port.discoverModels({ context });
    expect(catalog).toMatchObject({ source: 'cli-cache', freshness: 'stale', fetchedAt: '1970-01-01T00:00:01.000Z', expiresAt: new Date(1000 + MODEL_NEGATIVE_TTL_MS).toISOString() });
  });

  it('gives a live probe result the full catalog lifetime', async () => {
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps: hostDeps(), probes: hostProbes() });
    expect((await port.discoverModels({ context })).expiresAt).toBe(new Date(MODEL_CATALOG_TTL_MS).toISOString());
  });

  it('diagnoses a probe with no usable rows as malformed', async () => {
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps: hostDeps(), probes: hostProbes({ catalog: async () => ({ ...live, models: [{ id: 'default', label: 'Default' }] }) }) });
    expect((await port.discoverModels({ context })).diagnostics).toEqual([{ code: 'malformed-response', message: 'Native metadata contained no usable catalog.' }]);
  });

  it('diagnoses an unknown probe error as offline without its text', async () => {
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps: hostDeps(), probes: hostProbes({ catalog: async () => { throw new Error('token=secret'); } }) });
    expect((await port.discoverModels({ context })).diagnostics).toEqual([{ code: 'offline', message: 'Model discovery could not reach its source.' }]);
  });

  it('diagnoses an unsupported native version', async () => {
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps: hostDeps(), probes: hostProbes({ catalog: async () => { throw new ModelProbeError('unsupported-version'); } }) });
    expect((await port.discoverModels({ context })).diagnostics).toEqual([{ code: 'unsupported-version', message: 'Native metadata discovery is unavailable for this version.' }]);
  });

  it('returns an unscoped offline snapshot when the launch configuration cannot be read', async () => {
    const deps = hostDeps({ now: 5 });
    deps.fs.projectRoot = async () => { throw new Error('denied'); };
    const port = createAgentModelDiscovery({ agentId: 'claude', configuration, deps, probes: hostProbes() });
    expect(await port.discoverModels({ context })).toEqual({ models: offlineRows, source: 'offline-fallback', freshness: 'offline-fallback',
      fetchedAt: '1970-01-01T00:00:00.005Z', expiresAt: new Date(5 + MODEL_NEGATIVE_TTL_MS).toISOString(), coverage: 'configured',
      launchFingerprint: modelLaunchFingerprint(context), diagnostics: [{ code: 'offline', message: 'Model discovery could not reach its source.' }] });
  });

  it('serves a fresh cached catalog without probing again', async () => {
    let calls = 0;
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps: hostDeps(), probes: hostProbes({ catalog: async () => { calls++; return live; } }) });
    const first = await port.discoverModels({ context });
    expect(await port.discoverModels({ context })).toBe(first);
    expect(calls).toBe(1);
  });

  it('serves a fresh cached catalog under stale-while-revalidate but still refreshes it', async () => {
    let calls = 0;
    const deps = hostDeps();
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps, probes: hostProbes({ catalog: async () => { calls++; return live; } }) });
    const first = await port.discoverModels({ context });
    const again = await port.discoverModels({ context }, { staleWhileRevalidate: true });
    expect(again).toEqual(first);
    expect(calls).toBe(2);
  });

  it('labels an expired last-good catalog stale under stale-while-revalidate', async () => {
    let now = 0;
    const deps = { ...hostDeps(), clock: { now: () => now } };
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps, probes: hostProbes() });
    await port.discoverModels({ context });
    now = MODEL_CATALOG_TTL_MS + 1;
    expect((await port.discoverModels({ context }, { staleWhileRevalidate: true })).freshness).toBe('stale');
  });

  it('returns the in-flight refresh to a coalesced stale-while-revalidate caller with no last-good catalog', async () => {
    const gate = deferred<ModelProbeResult>();
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps: hostDeps(), probes: hostProbes({ catalog: () => gate.promise }) });
    const first = port.discoverModels({ context });
    await tick();
    const second = port.discoverModels({ context }, { staleWhileRevalidate: true });
    gate.resolve(live);
    expect(await second).toEqual(await first);
  });

  it('returns the last failure to a coalesced stale-while-revalidate caller', async () => {
    const gate = deferred<ModelProbeResult>(); let calls = 0;
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps: hostDeps(), probes: hostProbes({
      catalog: async () => { calls++; if (calls === 1) throw new ModelProbeError('auth-missing'); return gate.promise; },
    }) });
    const failed = await port.discoverModels({ context });
    const refresh = port.discoverModels({ context }, { force: true });
    await tick();
    expect(await port.discoverModels({ context }, { staleWhileRevalidate: true })).toBe(failed);
    gate.resolve(live);
    expect((await refresh).freshness).toBe('fresh');
  });

  it('keeps last-good rows stale on a failed refresh, expiring at the retry time', async () => {
    let now = 0; let calls = 0;
    const deps = { ...hostDeps(), clock: { now: () => now } };
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps, probes: hostProbes({
      catalog: async () => { calls++; if (calls > 1) throw new ModelProbeError('auth-missing'); return live; },
    }) });
    const good = await port.discoverModels({ context });
    now = 100;
    expect(await port.discoverModels({ context }, { force: true })).toEqual({ ...good, freshness: 'stale',
      expiresAt: new Date(100 + MODEL_NEGATIVE_TTL_MS).toISOString(), diagnostics: [{ code: 'auth-missing', message: 'CLI credentials are unavailable.' }] });
  });

  it('re-probes a host-seeded failure that carries no retry time', async () => {
    let calls = 0; const deps = hostDeps();
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps, probes: hostProbes({ catalog: async () => { calls++; return live; } }) });
    const good = await port.discoverModels({ context });
    const entry = [...deps.cache.values()][0]!;
    entry.failed = { ...good, freshness: 'stale' };
    expect((await port.discoverModels({ context })).freshness).toBe('fresh');
    expect(calls).toBe(2);
  });

  it('serves the good catalog when a host-seeded retry time has no failure snapshot', async () => {
    let calls = 0; const deps = hostDeps();
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps, probes: hostProbes({ catalog: async () => { calls++; return live; } }) });
    const good = await port.discoverModels({ context });
    [...deps.cache.values()][0]!.retryAt = 10;
    expect(await port.discoverModels({ context })).toBe(good);
    expect(calls).toBe(1);
  });

  it('clears the failure cooldown once a forced refresh succeeds', async () => {
    let calls = 0;
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps: hostDeps(), probes: hostProbes({
      catalog: async () => { calls++; if (calls === 1) throw new ModelProbeError('auth-missing'); return live; },
    }) });
    await port.discoverModels({ context });
    const recovered = await port.discoverModels({ context }, { force: true });
    expect(await port.discoverModels({ context })).toBe(recovered);
    expect(recovered.freshness).toBe('fresh');
  });

  it('surfaces a throwing fallback provider without wedging the scope in flight', async () => {
    const deps = hostDeps();
    const broken = { fallbackModels: (): never => { throw new Error('fallback list unavailable'); } };
    const port = createAgentModelDiscovery({ agentId: 'host', configuration: broken, deps, probes: hostProbes({
      catalog: async () => { throw new ModelProbeError('auth-missing'); },
    }) });
    await expect(port.discoverModels({ context })).rejects.toThrow('fallback list unavailable');
    expect([...deps.cache.values()][0]!.pending).toBeUndefined();
  });

  it('evicts settled scopes beyond 128 while keeping in-flight ones', async () => {
    const deps = hostDeps(); const gate = deferred<ModelProbeResult>();
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps, probes: hostProbes({
      catalog: async ({ context: scope }) => (scope.cwd === '/pending' ? gate.promise : live),
    }) });
    const pending = port.discoverModels({ context: { ...context, cwd: '/pending' } });
    // A second deps object shares the cache but not the one-probe-per-host pool, so these settle while '/pending' is in flight.
    const sibling = { ...deps };
    for (let index = 0; index < 129; index++) await port.discoverModels({ context: { ...context, cwd: `/scope-${index}` } }, { deps: sibling });
    expect(deps.cache.size).toBe(128);
    expect([...deps.cache.values()][0]!.pending).toBeDefined();
    gate.resolve(live);
    await pending;
  });
});

describe('createAgentModelDiscovery disk catalog', () => {
  const disk: ModelProbeResult = { models: [{ id: 'disk-model', label: 'Disk Model' }], source: 'cli-cache', coverage: 'observed' };

  it('only reads the disk catalog for CLIs that own one', async () => {
    let diskCalls = 0;
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps: hostDeps(), probes: hostProbes({ cliCache: async () => { diskCalls++; return disk; } }) });
    expect((await port.discoverModels({ context }, { staleWhileRevalidate: true })).source).toBe('rpc');
    expect(diskCalls).toBe(0);
  });

  it('ignores an empty disk catalog and waits for the live probe', async () => {
    const port = createAgentModelDiscovery({ agentId: 'codex', configuration, deps: hostDeps(), probes: hostProbes({ cliCache: async () => ({ ...disk, models: [] }) }) });
    expect((await port.discoverModels({ context }, { staleWhileRevalidate: true })).source).toBe('rpc');
  });

  it('carries the config selection onto a disk catalog', async () => {
    const gate = deferred<ModelProbeResult>();
    const port = createAgentModelDiscovery({ agentId: 'claude', configuration, deps: hostDeps(), probes: hostProbes({ catalog: () => gate.promise, cliCache: async () => disk }) });
    const scope = { ...context, env: { ...context.env, ANTHROPIC_MODEL: 'cfg' } };
    expect((await port.discoverModels({ context: scope }, { staleWhileRevalidate: true })).defaultSelectionId).toBe('cfg');
    gate.resolve(live);
  });

  it('joins a refresh another caller started while the disk catalog was read', async () => {
    const diskGate = deferred<ModelProbeResult>(); const liveGate = deferred<ModelProbeResult>();
    const port = createAgentModelDiscovery({ agentId: 'codex', configuration, deps: hostDeps(), probes: hostProbes({ catalog: () => liveGate.promise, cliCache: () => diskGate.promise }) });
    const swr = port.discoverModels({ context }, { staleWhileRevalidate: true });
    await tick();
    const live2 = port.discoverModels({ context });
    await tick();
    diskGate.resolve(disk);
    liveGate.resolve(live);
    expect(await swr).toEqual(await live2);
    expect((await swr).source).toBe('rpc');
  });

  it('returns the disk catalog when a refresh starts during the disk read of a host-seeded empty entry', async () => {
    const diskGate = deferred<ModelProbeResult>(); const liveGate = deferred<ModelProbeResult>(); const deps = hostDeps(); let calls = 0;
    const port = createAgentModelDiscovery({ agentId: 'codex', configuration, deps, probes: hostProbes({
      catalog: async () => { calls++; return calls === 1 ? live : liveGate.promise; },
      cliCache: () => diskGate.promise,
    }) });
    await port.discoverModels({ context });
    const key = [...deps.cache.keys()][0]!;
    deps.cache.set(key, {});
    const swr = port.discoverModels({ context }, { staleWhileRevalidate: true });
    await tick();
    const forced = port.discoverModels({ context }, { force: true });
    await tick();
    diskGate.resolve(disk);
    await tick();
    liveGate.resolve(live);
    expect((await swr).source).toBe('cli-cache');
    expect((await forced).source).toBe('rpc');
  });

  it('returns the prior failure when a forced refresh starts during the disk read', async () => {
    const diskGate = deferred<ModelProbeResult>(); const liveGate = deferred<ModelProbeResult>(); let calls = 0;
    const port = createAgentModelDiscovery({ agentId: 'codex', configuration, deps: hostDeps(), probes: hostProbes({
      catalog: async () => { calls++; if (calls === 1) throw new ModelProbeError('auth-missing'); return liveGate.promise; },
      cliCache: async () => { if (calls === 1) return diskGate.promise; throw new ModelProbeError('unsupported-version'); },
    }) });
    const failed = await port.discoverModels({ context });
    const swr = port.discoverModels({ context }, { force: true, staleWhileRevalidate: true });
    await tick();
    const forced = port.discoverModels({ context }, { force: true });
    await tick();
    diskGate.resolve(disk);
    expect(await swr).toBe(failed);
    liveGate.resolve(live);
    await forced;
  });
});

describe('createAgentModelDiscovery probe pool', () => {
  it('runs one cold probe per host and queues the next scope', async () => {
    const deps = hostDeps(); const gate = deferred<ModelProbeResult>(); const started: string[] = [];
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps, probes: hostProbes({
      catalog: async ({ context: scope }) => { started.push(scope.cwd); return scope.cwd === '/a' ? gate.promise : live; },
    }) });
    const a = port.discoverModels({ context: { ...context, cwd: '/a' } });
    const b = port.discoverModels({ context: { ...context, cwd: '/b' }, }, { signal: new AbortController().signal });
    await tick();
    expect(started).toEqual(['/a']);
    gate.resolve(live);
    await Promise.all([a, b]);
    expect(started).toEqual(['/a', '/b']);
  });

  it('drops a queued probe whose caller cancels while waiting', async () => {
    const deps = hostDeps(); const gate = deferred<ModelProbeResult>(); const started: string[] = [];
    const port = createAgentModelDiscovery({ agentId: 'host', configuration, deps, probes: hostProbes({
      catalog: async ({ context: scope }) => { started.push(scope.cwd); return scope.cwd === '/a' ? gate.promise : live; },
    }) });
    const controller = new AbortController();
    const a = port.discoverModels({ context: { ...context, cwd: '/a' } });
    const b = port.discoverModels({ context: { ...context, cwd: '/b' } }, { signal: controller.signal });
    await tick();
    controller.abort();
    expect((await b).diagnostics).toEqual([{ code: 'timeout', message: 'Model discovery timed out or was cancelled.' }]);
    gate.resolve(live);
    await a;
    expect(started).toEqual(['/a']);
  });

  it('does not start a probe for a caller cancelled during the disk read', async () => {
    const controller = new AbortController(); let calls = 0;
    const port = createAgentModelDiscovery({ agentId: 'codex', configuration, deps: hostDeps(), probes: hostProbes({
      catalog: async () => { calls++; return live; },
      cliCache: async () => { controller.abort(); throw new ModelProbeError('unsupported-version'); },
    }) });
    const catalog = await port.discoverModels({ context }, { staleWhileRevalidate: true, signal: controller.signal });
    expect(catalog.diagnostics).toEqual([{ code: 'timeout', message: 'Model discovery timed out or was cancelled.' }]);
    expect(calls).toBe(0);
  });

  it('cancels immediately when queued with a signal aborted during the disk read', async () => {
    const deps = hostDeps(); const gate = deferred<ModelProbeResult>(); const controller = new AbortController(); const started: string[] = [];
    const port = createAgentModelDiscovery({ agentId: 'codex', configuration, deps, probes: hostProbes({
      catalog: async ({ context: scope }) => { started.push(scope.cwd); return gate.promise; },
      cliCache: async () => { controller.abort(); throw new ModelProbeError('unsupported-version'); },
    }) });
    const a = port.discoverModels({ context: { ...context, cwd: '/a' } });
    await tick();
    const b = await port.discoverModels({ context: { ...context, cwd: '/b' } }, { staleWhileRevalidate: true, signal: controller.signal });
    expect(b.diagnostics).toEqual([{ code: 'timeout', message: 'Model discovery timed out or was cancelled.' }]);
    gate.resolve(live);
    await a;
    expect(started).toEqual(['/a']);
  });
});

describe('createAgentModelDiscovery resolveDefaultModel', () => {
  const port = (agentId = 'host', deps = hostDeps()) => createAgentModelDiscovery({ agentId, configuration, deps, probes: hostProbes() });
  async function catalogFor(scope: ModelDiscoveryContext, agentId = 'host') {
    return port(agentId).discoverModels({ context: scope });
  }

  it('refuses when the launch configuration cannot be read', async () => {
    const deps = hostDeps(); deps.fs.projectRoot = async () => { throw new Error('denied'); };
    const catalog = await catalogFor(context);
    expect(await port('claude', deps).resolveDefaultModel({ context, catalog })).toEqual({ status: 'unresolved', reason: 'Launch configuration could not be read.' });
  });

  it('refuses a catalog from a different launch scope', async () => {
    const catalog = await catalogFor({ ...context, cwd: '/elsewhere' });
    expect(await port().resolveDefaultModel({ context, catalog })).toEqual({ status: 'unresolved', reason: 'Launch configuration changed; refresh the catalog.' });
  });

  it('requires resumed-session metadata for a resume without a model', async () => {
    const scope = { ...context, resumeSessionId: 's' };
    const catalog = await catalogFor(scope);
    expect(await port().resolveDefaultModel({ context: scope, catalog })).toEqual({ status: 'unresolved', reason: 'Resumed session model metadata is required.' });
  });

  it('resolves a resumed session to its recorded model over the catalog default', async () => {
    const scope = { ...context, resumeSessionId: 's', resumedModelId: 'other-model' };
    const base = await catalogFor(scope);
    const catalog = { ...base, models: [...base.models, { id: 'other-model', label: 'Other', identityKind: 'concrete' as const }] };
    expect(await port().resolveDefaultModel({ context: scope, catalog })).toMatchObject({ status: 'resolved', id: 'other-model', selectionId: 'other-model', source: 'rpc' });
  });

  it('refuses an alias row whose own id merely looks concrete', async () => {
    const base = await catalogFor(context);
    const catalog = { ...base, defaultSelectionId: 'team-pick', models: [{ id: 'team-pick', label: 'Team Pick', identityKind: 'alias' as const }] };
    expect(await port().resolveDefaultModel({ context, catalog })).toMatchObject({ status: 'unresolved', selectionId: 'team-pick' });
  });

  it('refuses when nothing names a default', async () => {
    const { defaultSelectionId: _omitted, ...catalog } = await catalogFor(context);
    expect(await port().resolveDefaultModel({ context, catalog })).toEqual({ status: 'unresolved', reason: 'Native metadata did not resolve a default; pick a concrete model.' });
  });

  it('refuses to resolve an offline hint by its display label', async () => {
    const catalog = { ...(await catalogFor(context)), freshness: 'offline-fallback' as const, defaultSelectionId: 'Host Model' };
    expect(await port().resolveDefaultModel({ context, catalog })).toEqual({ status: 'unresolved', selectionId: 'Host Model', reason: 'Offline hints cannot resolve a display name or alias.' });
  });

  it('resolves a live row by its display label', async () => {
    const catalog = { ...(await catalogFor(context)), defaultSelectionId: 'Host Model' };
    expect(await port().resolveDefaultModel({ context, catalog })).toMatchObject({ status: 'resolved', id: 'host-model', selectionId: 'Host Model' });
  });

  it('resolves an offline hint by its id', async () => {
    const catalog = { ...(await catalogFor(context)), freshness: 'offline-fallback' as const };
    expect(await port().resolveDefaultModel({ context, catalog })).toMatchObject({ status: 'resolved', id: 'host-model' });
  });

  it('uses an alias row\'s resolved id', async () => {
    const base = await catalogFor(context);
    const catalog = { ...base, defaultSelectionId: 'sonnet', models: [{ id: 'sonnet', label: 'Sonnet', identityKind: 'alias' as const, resolvedId: 'claude-sonnet-9' }] };
    expect(await port().resolveDefaultModel({ context, catalog })).toMatchObject({ status: 'resolved', id: 'claude-sonnet-9', selectionId: 'sonnet' });
  });

  it('refuses an alias row without a resolved id', async () => {
    const base = await catalogFor(context);
    const catalog = { ...base, defaultSelectionId: 'sonnet', models: [{ id: 'sonnet', label: 'Sonnet', identityKind: 'alias' as const }] };
    expect(await port().resolveDefaultModel({ context, catalog })).toEqual({ status: 'unresolved', selectionId: 'sonnet', reason: 'The configured selection has no concrete model evidence.' });
  });

  it('refuses a resolved id that is itself not concrete', async () => {
    const base = await catalogFor(context);
    const catalog = { ...base, defaultSelectionId: 'x', models: [{ id: 'x', label: 'X', identityKind: 'alias' as const, resolvedId: 'auto' }] };
    expect(await port().resolveDefaultModel({ context, catalog })).toMatchObject({ status: 'unresolved', selectionId: 'x' });
  });

  it('refuses a selection absent from the catalog', async () => {
    const catalog = { ...(await catalogFor(context)), defaultSelectionId: 'missing' };
    expect(await port().resolveDefaultModel({ context, catalog })).toMatchObject({ status: 'unresolved', selectionId: 'missing' });
  });

  it('attributes a selection equal to the config to the config file', async () => {
    const scope = { ...context, env: { ...context.env, VELA_DEFAULT_MODEL: 'host-model' } };
    const catalog = await catalogFor(scope, 'amr');
    expect(await port('amr').resolveDefaultModel({ context: scope, catalog })).toMatchObject({ status: 'resolved', id: 'host-model', source: 'config-file' });
  });
});

describe('modelDiscoveryForDef static ports', () => {
  const rows = [{ id: 'auto', label: 'Auto' }, { id: 'static-a', label: 'Static A' }, { id: 'static-b', label: 'Static B' }];

  it('delegates to a definition\'s own ports, bound to the definition', async () => {
    const own: ModelCatalogSnapshot = { models: [], source: 'cli', freshness: 'fresh', fetchedAt: 'a', expiresAt: 'b', coverage: 'account', launchFingerprint: 'own', diagnostics: [] };
    const def = { catalog: own, async discoverModels(this: { catalog: ModelCatalogSnapshot }) { return this.catalog; },
      async resolveDefaultModel(this: { catalog: ModelCatalogSnapshot }) { return { status: 'unresolved' as const, reason: this.catalog.launchFingerprint }; } };
    const discovery = modelDiscoveryForDef({ def, deps: hostDeps() });
    expect(await discovery.discoverModels({ context })).toBe(own);
    expect(await discovery.resolveDefaultModel({ context, catalog: own })).toEqual({ status: 'unresolved', reason: 'own' });
  });

  it('defaults to the first concrete fallback row', async () => {
    const catalog = await modelDiscoveryForDef({ def: { fallbackModels: rows }, deps: hostDeps() }).discoverModels({ context });
    expect(catalog.defaultSelectionId).toBe('static-a');
    expect(catalog.launchFingerprint).toBe(modelLaunchFingerprint(context));
  });

  it('serves an empty catalog with no default when the definition has no fallbacks', async () => {
    const catalog = await modelDiscoveryForDef({ def: {}, deps: hostDeps() }).discoverModels({ context });
    expect(catalog.models).toEqual([]);
    expect('defaultSelectionId' in catalog).toBe(false);
  });

  it('prefers the declared env default over the fallback rows', async () => {
    const scope = { ...context, env: { ...context.env, STATIC_MODEL: '  static-b  ' } };
    const catalog = await modelDiscoveryForDef({ def: { fallbackModels: rows, defaultModelEnvVar: 'STATIC_MODEL' }, deps: hostDeps() }).discoverModels({ context: scope });
    expect(catalog.defaultSelectionId).toBe('static-b');
  });

  it('prefers the resumed model, then the launch model', async () => {
    const discovery = modelDiscoveryForDef({ def: { fallbackModels: rows }, deps: hostDeps() });
    expect((await discovery.discoverModels({ context: { ...context, resumedModelId: 'resumed' } })).defaultSelectionId).toBe('resumed');
    expect((await discovery.discoverModels({ context: { ...context, resumedModelId: 'resumed', model: 'launch' } })).defaultSelectionId).toBe('launch');
  });

  it('requires resumed-session metadata for a resume without a model', async () => {
    const discovery = modelDiscoveryForDef({ def: { fallbackModels: rows }, deps: hostDeps() });
    const catalog = await discovery.discoverModels({ context });
    expect(await discovery.resolveDefaultModel({ context: { ...context, resumeSessionId: 's' }, catalog })).toEqual({ status: 'unresolved', reason: 'Resumed session model metadata is required.' });
  });

  it('resolves the catalog default against its own source', async () => {
    const deps = hostDeps({ now: 7 });
    const discovery = modelDiscoveryForDef({ def: { fallbackModels: rows }, deps });
    const catalog = await discovery.discoverModels({ context });
    expect(await discovery.resolveDefaultModel({ context, catalog })).toEqual({ status: 'resolved', id: 'static-a', selectionId: 'static-a', source: 'offline-fallback',
      resolvedAt: '1970-01-01T00:00:00.007Z', launchFingerprint: catalog.launchFingerprint });
  });

  it('treats an unlisted env default as authoritative config', async () => {
    const scope = { ...context, env: { ...context.env, STATIC_MODEL: 'env-only' } };
    const discovery = modelDiscoveryForDef({ def: { fallbackModels: rows, defaultModelEnvVar: 'STATIC_MODEL' }, deps: hostDeps() });
    const catalog = await discovery.discoverModels({ context: scope });
    expect(await discovery.resolveDefaultModel({ context: scope, catalog })).toMatchObject({ status: 'resolved', id: 'env-only', selectionId: 'env-only', source: 'config-file' });
  });

  it('uses an alias row\'s resolved id', async () => {
    const discovery = modelDiscoveryForDef({ def: {}, deps: hostDeps() });
    const catalog = { ...(await discovery.discoverModels({ context })), defaultSelectionId: 'Sonnet',
      models: [{ id: 'sonnet', label: 'Sonnet', identityKind: 'alias' as const, resolvedId: 'claude-sonnet-9' }] };
    expect(await discovery.resolveDefaultModel({ context, catalog })).toMatchObject({ status: 'resolved', id: 'claude-sonnet-9', selectionId: 'Sonnet' });
  });

  it('refuses a routing-mode selection, naming it', async () => {
    const discovery = modelDiscoveryForDef({ def: { fallbackModels: rows }, deps: hostDeps() });
    const catalog = await discovery.discoverModels({ context: { ...context, model: 'auto' } });
    expect(await discovery.resolveDefaultModel({ context: { ...context, model: 'auto' }, catalog })).toEqual({ status: 'unresolved', selectionId: 'auto', reason: 'The configured selection has no concrete model evidence.' });
  });

  it('refuses without a selection id when nothing names a default', async () => {
    const discovery = modelDiscoveryForDef({ def: { fallbackModels: [{ id: 'auto', label: 'Auto' }], defaultModelEnvVar: 'STATIC_MODEL' }, deps: hostDeps() });
    const scope = { ...context, env: { ...context.env, STATIC_MODEL: '   ' } };
    const catalog = await discovery.discoverModels({ context: scope });
    expect(await discovery.resolveDefaultModel({ context: scope, catalog })).toEqual({ status: 'unresolved', reason: 'The configured selection has no concrete model evidence.' });
  });
});

describe('resolveModelForLaunch', () => {
  const def = { fallbackModels: [{ id: 'static-a', label: 'Static A' }] };

  it('refuses a CLI that cannot pin a concrete starting model', async () => {
    await expect(resolveModelForLaunch({ def: { ...def, supportsConcreteModelSelection: false }, context, deps: hostDeps() }))
      .rejects.toThrow('This CLI cannot pin a concrete starting model.');
  });

  it('launches an unlisted custom model verbatim', async () => {
    const launch = await resolveModelForLaunch({ def, context: { ...context, model: 'my-model' }, deps: hostDeps({ now: 3 }) });
    expect(launch.model).toBe('my-model');
    expect(launch.resolution).toEqual({ status: 'resolved', id: 'my-model', selectionId: 'my-model', source: 'config-file', resolvedAt: '1970-01-01T00:00:00.003Z', launchFingerprint: launch.catalog.launchFingerprint });
  });

  it('resolves a listed launch model through the catalog', async () => {
    const launch = await resolveModelForLaunch({ def, context: { ...context, model: 'static-a' }, deps: hostDeps() });
    expect(launch.resolution).toMatchObject({ status: 'resolved', id: 'static-a', source: 'offline-fallback' });
  });

  it('rejects with the unresolved reason when custom models are disabled', async () => {
    await expect(resolveModelForLaunch({ def: { ...def, supportsCustomModel: false }, context: { ...context, model: 'auto' }, deps: hostDeps() }))
      .rejects.toThrow('The configured selection has no concrete model evidence.');
  });
});
