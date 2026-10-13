/** Coupling audit finding 2: policy works with host effects and probes, without native defaults. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAgentModelDiscovery, modelDiscoveryForDef, resolveModelForLaunch } from '../model-discovery.js';
import { ModelProbeError } from '../model-discovery-shared.js';
import { createAgentModelDiscovery as createNativeDiscovery } from '../model-discovery-native.js';
import { createAgentModelDiscovery as createRootDiscovery, modelDiscoveryForDef as rootDiscoveryForDef,
  resolveModelForLaunch as rootResolveModelForLaunch } from '../index.js';
import { modelDiscoveryForDef as nativeDiscoveryForDef, resolveModelForLaunch as nativeResolveModelForLaunch } from '../model-discovery-native.js';
import type { ModelDiscoveryContext, ModelDiscoveryDeps, ModelDiscoveryProbes, ModelProbeResult } from '../model-discovery-types.js';

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
