import { describe, expect, it, vi } from 'vitest';
import { buildCapabilityScopedSdk, CapabilityDeniedError } from '../../capability-sdk.js';
import { createPluginContributionCapture, createPluginContributionRegistry } from '../../contributions.js';
import { createPluginProviderHost } from '../../provider-host.js';
import { validateManifest } from '../../manifest.js';
import { pluginClaimsFromManifest } from '../../plugin-claims.js';
import { loadPlugin, type LoadPluginRequired } from '../../node/loader.js';
import type { PluginManifest } from '../../manifest-types.js';
import type { PluginSdk } from '../../ports.js';
import type { PluginProviderContribution, PluginProviderResource } from '../../provider-contributions.js';
import { manifestHost, pluginSdkBinding, tierPolicy } from '../support/fixture-bindings.js';

const digest = `sha256-${'a'.repeat(64)}`;
const declaration = { contract: 'fixture', id: 'fixture', contractVersion: 1 } as const;
const manifest: PluginManifest = {
  id: 'fixture-provider', name: 'Fixture', version: '1.0.0', sdkRange: '^0.1.0 || ^1.0.0', engine: 1, tier: 'tier-3',
  extensions: { tovu: { id: 'jini/fixture-provider' } },
  capabilities: ['providers.register'], contributes: { providers: [declaration] }, hooks: [], fields: [], integrity: { 'server/index.mjs': digest },
};
const coreDeps = { getCurrentEntry: () => ({ workspaceId: 'w', ext: {} }), writeExtField: () => {}, attachFilter: () => {} };
const sdk = buildCapabilityScopedSdk({ pluginSdkBinding, pluginId: manifest.id, capabilities: [], coreDeps });
const contract = { contract: 'fixture', validate: ({ provider }: { provider: unknown }) => typeof provider === 'string' ? undefined : 'expected string' };
function publish(required: { registry: ReturnType<typeof createPluginContributionRegistry>; factory: PluginProviderContribution['factory']; id?: string }) {
  const capture = createPluginContributionCapture({ manifest: { ...manifest, id: required.id ?? manifest.id } });
  capture.providers.register({ ...declaration, factory: required.factory });
  const snapshot = capture.seal({ sdk });
  required.registry.replace({ contributions: snapshot });
  return { snapshot, capture };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function load(required: { registry: ReturnType<typeof createPluginContributionRegistry>; setup: (sdk: PluginSdk) => void | Promise<void> }, optional: Partial<LoadPluginRequired> = {}) {
  return loadPlugin({ pluginSdkBinding, manifest, record: { id: manifest.id, name: manifest.name, version: manifest.version, source: 'site', status: 'valid', errors: [] },
    entryPath: '/plugins/fixture-provider/1.0.0/server/index.mjs', coreDeps, tierPolicy, verifyDigest: async () => digest,
    importModule: async () => ({ exported: { definition: { setup: required.setup } } }),
    providerContributions: { registry: required.registry, isSelected: () => true }, ...optional,
  });
}

describe('provider contributions on the existing plugin pipeline', () => {
  it('validates declarations, contract version, duplicate identity, capability and tier', () => {
    const validate = (value: PluginManifest) => validateManifest({ ...manifestHost, capabilityVocabulary: ['providers.register'], manifest: value, folderName: value.id, builtInIds: [] }).errors;
    expect(validate(manifest)).toEqual([]);
    for (const providers of [[{ ...declaration, contractVersion: 2 }], [declaration, declaration], [{ ...declaration, id: 'with-hyphen' }], ['fixture']]) {
      expect(validate({ ...manifest, contributes: { providers } } as unknown as PluginManifest).some(error => error.code === 'PROVIDERS_INVALID')).toBe(true);
    }
    expect(validate({ ...manifest, capabilities: [] }).some(error => error.code === 'PROVIDERS_INVALID')).toBe(true);
    expect(validate({ ...manifest, tier: 'tier-1' }).some(error => error.code === 'PROVIDERS_INVALID')).toBe(true);
    expect(pluginClaimsFromManifest({ ...manifestHost, manifest })).toEqual([{ kind: 'provider', key: 'fixture:fixture', mode: 'exclusive' }]);
  });
  it('keeps the SDK denial callable and refuses granted registration without host backing', () => {
    const provider = { ...declaration, factory: vi.fn(() => ({ port: 'ok', dispose() {} })) };
    expect(() => sdk.providers.register(provider)).toThrow(CapabilityDeniedError);
    const granted = buildCapabilityScopedSdk({ pluginSdkBinding, pluginId: manifest.id, capabilities: ['providers.register'], coreDeps });
    expect(() => granted.providers.register(provider)).toThrow('not bound');
    expect(provider.factory).not.toHaveBeenCalled();
  });
  it('rejects undeclared, duplicate and late factories without executing them', () => {
    const capture = createPluginContributionCapture({ manifest });
    const factory = vi.fn(() => ({ port: 'ok', dispose() {} }));
    expect(() => capture.providers.register({ ...declaration, id: 'other', factory })).toThrow('undeclared');
    capture.providers.register({ ...declaration, factory });
    expect(() => capture.providers.register({ ...declaration, factory })).toThrow('duplicate');
    capture.seal({ sdk });
    expect(() => capture.providers.register({ ...declaration, factory })).toThrow('sealed');
    expect(factory).not.toHaveBeenCalled();
  });
  it('publishes only after successful setup and seals captures after failure', async () => {
    const registry = createPluginContributionRegistry({});
    let retained!: PluginSdk;
    const factory = vi.fn(() => ({ port: 'ok', dispose() {} }));
    expect(await load({ registry, setup(value) { retained = value; value.providers.register({ ...declaration, factory }); expect(registry.list({})).toEqual([]); throw new Error('boot failed'); } })).toEqual({ loaded: false, reason: 'PLUGIN_SETUP_FAILED' });
    expect(registry.list({})).toEqual([]);
    expect(() => retained.providers.register({ ...declaration, factory })).toThrow('sealed');
    expect(await load({ registry, setup(value) { value.providers.register({ ...declaration, factory }); expect(registry.list({})).toEqual([]); } })).toEqual({ loaded: true });
    expect(registry.list({})[0]!.providers![0]!.factory).toBe(factory);
    expect(factory).not.toHaveBeenCalled();
  });
  it('unselected providers import nothing and revocation during setup publishes nothing', async () => {
    const registry = createPluginContributionRegistry({});
    const importModule = vi.fn();
    expect(await load({ registry, setup() {} }, { importModule, providerContributions: { registry, isSelected: () => false } })).toEqual({ loaded: false, reason: 'PROVIDER_NOT_SELECTED' });
    expect(importModule).not.toHaveBeenCalled();
    let selected = true;
    expect(await load({ registry, setup(value) { value.providers.register({ ...declaration, factory: () => ({ port: 'ok', dispose() {} }) }); selected = false; } }, { providerContributions: { registry, isSelected: () => selected } })).toEqual({ loaded: false, reason: 'PROVIDER_NOT_SELECTED' });
    expect(registry.list({})).toEqual([]);
  });
  it('refuses colliding load admission atomically without running either factory', async () => {
    const registry = createPluginContributionRegistry({});
    const factory = vi.fn(() => ({ port: 'ok', dispose() {} }));
    const previous = publish({ registry, factory, id: 'existing' }).snapshot;
    expect(await load({ registry, setup(value) { value.providers.register({ ...declaration, factory }); } })).toEqual({ loaded: false, reason: 'PROVIDER_ADMISSION_FAILED' });
    expect(registry.list({})).toEqual([previous]); expect(factory).not.toHaveBeenCalled();
  });
  it('refuses a duplicate provider identity and frees it when a generation detaches', () => {
    const registry = createPluginContributionRegistry({});
    const factory = () => ({ port: 'ok', dispose() {} });
    publish({ registry, factory });
    expect(() => publish({ registry, factory, id: 'second' })).toThrow('plugin contribution collision');
    expect(registry.list({}).map(row => row.pluginId)).toEqual([manifest.id]);
    registry.detach({ pluginId: manifest.id });
    publish({ registry, factory, id: 'second' });
    expect(registry.list({}).map(row => row.pluginId)).toEqual(['second']);
  });
});

describe('generation retirement and provider resources', () => {
  it('passes both factory objects and validates returned ports through the domain owner', async () => {
    const registry = createPluginContributionRegistry({});
    const dispose = vi.fn();
    const factory = vi.fn(() => ({ port: 'ok', dispose }));
    publish({ registry, factory });
    const host = createPluginProviderHost({ contributions: registry, contracts: [contract] });
    const input = { credential: 'explicit' }, factoryOptions = { borrowed: true };
    const lease = await host.initialize({ ...declaration, input }, { factoryOptions });
    expect(factory).toHaveBeenCalledWith(input, factoryOptions);
    expect(lease?.port).toBe('ok');
    await lease!.dispose({}); await lease!.dispose({}); await host.dispose({});
    expect(lease!.isCurrent({})).toBe(false); expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('disposes a rejected port, including when the injected validator throws', async () => {
    for (const validate of [contract.validate, () => { throw new Error('validator failed'); }]) {
      const registry = createPluginContributionRegistry({}), dispose = vi.fn();
      publish({ registry, factory: () => ({ port: 42, dispose }) });
      const host = createPluginProviderHost({ contributions: registry, contracts: [{ ...contract, validate }] });
      await expect(host.initialize({ ...declaration, input: {} })).rejects.toThrow(/invalid|could not be validated/);
      expect(dispose).toHaveBeenCalledTimes(1); await host.dispose({});
    }
  });
  it('disposes initialization completing after detach, replacement or failed-boot shutdown', async () => {
    for (const retire of ['detach', 'replace', 'shutdown'] as const) {
      const registry = createPluginContributionRegistry({}), dispose = vi.fn(), pending = deferred<PluginProviderResource>();
      publish({ registry, factory: () => pending.promise });
      const host = createPluginProviderHost({ contributions: registry, contracts: [contract] });
      const initialization = host.initialize({ ...declaration, input: {} });
      if (retire === 'detach') registry.detach({ pluginId: manifest.id });
      if (retire === 'replace') publish({ registry, factory: () => ({ port: 'new', dispose() {} }) });
      if (retire === 'shutdown') await host.dispose({});
      // Retirement settles initialization without waiting for the factory.
      expect(await initialization).toBeUndefined(); expect(dispose).not.toHaveBeenCalled();
      pending.resolve({ port: 'late', dispose });
      await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
      await host.dispose({}); expect(dispose).toHaveBeenCalledTimes(1);
    }
  });
  it('a never-settling factory cannot hang boot: detach and shutdown settle it, the deadline rejects it', async () => {
    for (const retire of ['detach', 'shutdown'] as const) {
      const registry = createPluginContributionRegistry({});
      publish({ registry, factory: () => new Promise<PluginProviderResource>(() => {}) });
      const host = createPluginProviderHost({ contributions: registry, contracts: [contract] }, { initializeTimeoutMs: 60_000 });
      const initialization = host.initialize({ ...declaration, input: {} });
      if (retire === 'detach') registry.detach({ pluginId: manifest.id });
      const shutdown = host.dispose({});
      expect(await initialization).toBeUndefined(); await shutdown;
    }
    const registry = createPluginContributionRegistry({}), dispose = vi.fn(), pending = deferred<PluginProviderResource>();
    publish({ registry, factory: () => pending.promise });
    const host = createPluginProviderHost({ contributions: registry, contracts: [contract] }, { initializeTimeoutMs: 5 });
    await expect(host.initialize({ ...declaration, input: {} })).rejects.toMatchObject({ name: 'PluginProviderError', message: 'provider initialization timed out' });
    // The generation is still current, but nobody holds a lease for the late result: release it.
    pending.resolve({ port: 'ok', dispose });
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
    await host.dispose({}); expect(dispose).toHaveBeenCalledTimes(1);
    for (const initializeTimeoutMs of [0, -1, 1.5, Number.NaN]) {
      expect(() => createPluginProviderHost({ contributions: registry, contracts: [contract] }, { initializeTimeoutMs })).toThrow('invalid provider initialization timeout');
    }
  });
  it('settles at once when the factory itself triggers shutdown before returning a never-settling promise', async () => {
    const registry = createPluginContributionRegistry({});
    let host!: ReturnType<typeof createPluginProviderHost>, shutdown!: Promise<void>;
    publish({ registry, factory: () => { shutdown = host.dispose({}); return new Promise<PluginProviderResource>(() => {}); } });
    host = createPluginProviderHost({ contributions: registry, contracts: [contract] }, { initializeTimeoutMs: 60_000 });
    const initialization = host.initialize({ ...declaration, input: {} });
    // Retirement happened before the waker existed; settling must not wait for the deadline.
    const outcome = await Promise.race([initialization, new Promise(resolve => setTimeout(resolve, 50, 'pending'))]);
    expect(outcome).toBeUndefined(); await shutdown;
  });
  it('reads the port once after cleanup exists: a throwing getter is disposed, a changing getter leases the validated value', async () => {
    const registry = createPluginContributionRegistry({}), dispose = vi.fn();
    const throwing = { dispose, get port(): unknown { throw new Error('port getter failed'); } };
    let reads = 0;
    const changing = { dispose, get port(): unknown { reads++; return reads === 1 ? 'ok' : 42; } };
    const resources: PluginProviderResource[] = [throwing, changing];
    publish({ registry, factory: () => resources.shift()! });
    const host = createPluginProviderHost({ contributions: registry, contracts: [contract] });
    await expect(host.initialize({ ...declaration, input: {} })).rejects.toThrow('port getter failed');
    expect(dispose).toHaveBeenCalledTimes(1);
    const lease = (await host.initialize({ ...declaration, input: {} }))!;
    expect(lease.port).toBe('ok'); expect(lease.port).toBe('ok'); expect(reads).toBe(1);
    await host.dispose({}); expect(dispose).toHaveBeenCalledTimes(2);
  });
  it('shutdown waits for a direct lease disposal that is still in flight', async () => {
    const registry = createPluginContributionRegistry({}), release = deferred<void>();
    publish({ registry, factory: () => ({ port: 'ok', dispose: () => release.promise }) });
    const host = createPluginProviderHost({ contributions: registry, contracts: [contract] }, { disposeTimeoutMs: 60_000 });
    const lease = (await host.initialize({ ...declaration, input: {} }))!;
    void lease.dispose({});
    let closed = false;
    const shutdown = host.dispose({}).then(() => { closed = true; });
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(closed).toBe(false);
    release.resolve(); await shutdown; expect(closed).toBe(true);
  });
  it('retires acquired leases on replacement and disable, with idempotent cleanup', async () => {
    const registry = createPluginContributionRegistry({}), dispose = vi.fn();
    publish({ registry, factory: () => ({ port: 'old', dispose }) });
    const host = createPluginProviderHost({ contributions: registry, contracts: [contract] });
    const old = (await host.initialize({ ...declaration, input: {} }))!;
    publish({ registry, factory: () => ({ port: 'new', dispose }) });
    expect(old.isCurrent({})).toBe(false);
    const next = (await host.initialize({ ...declaration, input: {} }))!;
    expect(next.port).toBe('new');
    registry.detach({ pluginId: manifest.id });
    expect(next.isCurrent({})).toBe(false);
    await host.dispose({}); await host.dispose({});
    expect(dispose).toHaveBeenCalledTimes(2);
  });
  it('does not release the old resource when another listener rejects and rolls back publication', async () => {
    const registry = createPluginContributionRegistry({}), dispose = vi.fn();
    const original = publish({ registry, factory: () => ({ port: 'old', dispose }) }).snapshot;
    const host = createPluginProviderHost({ contributions: registry, contracts: [contract] });
    const lease = (await host.initialize({ ...declaration, input: {} }))!;
    const unsubscribe = registry.subscribe({ onChanged() { if (registry.list({})[0] !== original) throw new Error('refused'); } });
    expect(() => publish({ registry, factory: () => ({ port: 'new', dispose() {} }) })).toThrow('refused');
    await Promise.resolve();
    expect(lease.isCurrent({})).toBe(true); expect(dispose).not.toHaveBeenCalled();
    unsubscribe(); await host.dispose({}); expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('bounds hung cleanup and isolates throwing/rejected disposal and diagnostics', async () => {
    const registry = createPluginContributionRegistry({});
    let call = 0;
    const good = vi.fn();
    const disposers = [() => { throw new Error('sync'); }, () => Promise.reject(new Error('async')), () => new Promise<void>(() => {}), good];
    publish({ registry, factory: () => ({ port: 'ok', dispose: disposers[call++]! }) });
    const phases: string[] = [];
    const host = createPluginProviderHost({ contributions: registry, contracts: [contract] }, {
      disposeTimeoutMs: 1, onError: async ({ phase }) => { phases.push(phase); throw new Error('reporting failed'); },
    });
    for (let index = 0; index < 4; index++) await host.initialize({ ...declaration, input: {} });
    await host.dispose({}); await host.dispose({});
    expect(good).toHaveBeenCalledTimes(1); expect(phases.sort()).toEqual(['dispose', 'dispose', 'dispose_timeout']);
  });
});
