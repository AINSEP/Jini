import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginDiscoveryRecord } from '../../discovery-types.js';
import type { PluginManifest } from '../../manifest.js';
import type { CapabilityScopedSdkCoreDeps } from '../../capability-sdk.js';
import type { PluginTierPolicy } from '../../ports.js';
import { PluginSnapshotIntegrityError } from '../../node/module-snapshot.js';
import { PluginInstallError } from '../../node/install.js';
import { loadPlugin, PluginLoadError, type LoadPluginRequired } from '../../node/loader.js';
import { pluginSdkBinding } from '../support/fixture-bindings.js';

// Admission is its own unit (browser-provider-assets); the loader only routes its verdict.
const admission = vi.hoisted(() => ({ result: { admitted: true, providers: [] } as unknown, calls: [] as unknown[] }));
vi.mock('../../node/browser-provider-assets.js', () => ({
  admitBrowserProviderAssets: async (required: unknown) => { admission.calls.push(required); return admission.result; },
}));
afterEach(() => { admission.calls.length = 0; admission.result = { admitted: true, providers: [] }; });

const entryPath = '/plugins/demo/1.0.0/server/index.mjs';
const record: PluginDiscoveryRecord = { id: 'demo', name: 'Demo', version: '1.0.0', source: 'built-in', status: 'valid', errors: [] };
const manifest = (overrides: Partial<PluginManifest> = {}): PluginManifest => ({
  id: 'demo', name: 'Demo', version: '1.0.0', sdkRange: '>=0.0.0', engine: 1, tier: 'tier-3',
  capabilities: [], hooks: [], fields: [], integrity: { 'server/index.mjs': 'sha256-ok' }, ...overrides,
});
const coreDeps = {} as CapabilityScopedSdkCoreDeps;
const policy = (overrides: Partial<PluginTierPolicy> = {}): PluginTierPolicy => ({ siteErrors: () => [], checkInstall: () => {}, allowLoad: () => true, execution: 'in-process', ...overrides });
const setup = vi.fn();
function load(overrides: Partial<LoadPluginRequired> = {}) {
  return loadPlugin({
    pluginSdkBinding, record, manifest: manifest(), entryPath, coreDeps, tierPolicy: policy(),
    verifyDigest: async () => 'sha256-ok',
    importModule: async () => ({ exported: { definition: { setup } } }),
    ...overrides,
  } as LoadPluginRequired);
}

it.each(['PLUGIN_PACKAGE_UNSAFE', 'PLUGIN_PACKAGE_TOO_LARGE'] as const)
('maps package snapshot refusal %s to integrity failure', async code => {
  const importModule = vi.fn(async () => { throw new PluginInstallError(code, 'package refused'); });
  await expect(load({ importModule })).resolves.toEqual({ loaded: false, reason: 'INTEGRITY_FAILED' });
  expect(importModule).toHaveBeenCalledExactlyOnceWith({
    plugin: { pluginId: 'demo', packageRoot: '/plugins/demo/1.0.0' }, modulePath: entryPath,
  });
});

describe('loadPlugin pipeline', () => {
  it('loads a verified, compatible, admitted module and runs setup', async () => {
    await expect(load()).resolves.toEqual({ loaded: true });
    expect(setup).toHaveBeenCalledOnce();
  });

  it.each([
    ['a non-relative integrity path', { manifest: manifest({ integrity: { '../escape.mjs': 'sha256-ok' } }) }, 'INTEGRITY_FAILED'],
    ['an unreadable packaged file', { verifyDigest: async (): Promise<string> => { throw new Error('gone'); } }, 'INTEGRITY_FAILED'],
    ['a hash mismatch', { verifyDigest: async (): Promise<string> => 'sha256-other' }, 'INTEGRITY_FAILED'],
    ['a site entry missing from integrity', { record: { ...record, source: 'site' }, manifest: manifest({ integrity: {} }) }, 'INTEGRITY_FAILED'],
    ['an unsatisfied SDK range', { manifest: manifest({ sdkRange: '>=99.0.0' }) }, 'SDK_RANGE_UNSATISFIED'],
    ['tier-2 without a worker', { manifest: manifest({ tier: 'tier-2' }) }, 'CODE_ENTRY_MISSING'],
    ['a tier the host does not admit', { tierPolicy: policy({ allowLoad: () => false }) }, 'CODE_ENTRY_MISSING'],
    ['an importer reporting a missing entry', { importModule: async (): Promise<string> => 'missing' }, 'CODE_ENTRY_MISSING'],
    ['an importer throwing', { importModule: async (): Promise<never> => { throw new Error('boom'); } }, 'CODE_ENTRY_MISSING'],
    ['a snapshot integrity failure', { importModule: async (): Promise<never> => { throw new PluginSnapshotIntegrityError('tampered'); } }, 'INTEGRITY_FAILED'],
    ['a module without definePlugin', { importModule: async () => ({ exported: 42 }) }, 'PLUGIN_EXPORT_INVALID'],
    ['a throwing setup', { importModule: async () => ({ exported: { definition: { setup: () => { throw new Error('no'); } } } }) }, 'PLUGIN_SETUP_FAILED'],
  ] as const)('refuses %s', async (_label, overrides, reason) => {
    await expect(load(overrides as Partial<LoadPluginRequired>)).resolves.toEqual({ loaded: false, reason });
  });

  it('a site entry missing from integrity but absent on disk falls through to the integrity loop', async () => {
    const verifyDigest = vi.fn(async ({ absoluteFilePath }: { absoluteFilePath: string }) => { if (absoluteFilePath === entryPath) throw new Error('missing'); return 'sha256-ok'; });
    await expect(load({ record: { ...record, source: 'site' }, manifest: manifest({ integrity: { 'README.md': 'sha256-ok' } }), verifyDigest })).resolves.toEqual({ loaded: true });
  });

  it('a site entry listed in integrity loads', async () => {
    await expect(load({ record: { ...record, source: 'site' } })).resolves.toEqual({ loaded: true });
  });

  it('tier-2 loads through a worker policy', async () => {
    await expect(load({ manifest: manifest({ tier: 'tier-2' }), tierPolicy: policy({ execution: 'worker' }) })).resolves.toEqual({ loaded: true });
  });
});

describe('browser providers', () => {
  const declared = manifest({ browserProviders: [{}] as unknown as NonNullable<PluginManifest['browserProviders']> });

  it('returns a refused admission verdict before any import', async () => {
    admission.result = { admitted: false, reason: 'BROWSER_PROVIDER_FORBIDDEN' };
    const importModule = vi.fn();
    await expect(load({ manifest: declared, importModule })).resolves.toEqual({ loaded: false, reason: 'BROWSER_PROVIDER_FORBIDDEN' });
    expect(importModule).not.toHaveBeenCalled();
    expect(admission.calls[0]).toMatchObject({ approvals: [] });
  });

  it('carries admitted providers for tier-1 and code plugins; passes host approvals', async () => {
    const providers = [{ id: 'p' }];
    admission.result = { admitted: true, providers };
    const approvals = [{ pluginId: 'demo' }] as unknown as NonNullable<LoadPluginRequired['browserProviderApprovals']>;
    await expect(load({ manifest: { ...declared, tier: 'tier-1' }, browserProviderApprovals: approvals })).resolves.toEqual({ loaded: true, browserProviders: providers });
    expect(admission.calls[0]).toMatchObject({ approvals });
    await expect(load({ manifest: declared })).resolves.toEqual({ loaded: true, browserProviders: providers });
  });

  it('tier-1 without providers never imports', async () => {
    const importModule = vi.fn();
    await expect(load({ manifest: manifest({ tier: 'tier-1', browserProviders: [] }), importModule })).resolves.toEqual({ loaded: true });
    expect(importModule).not.toHaveBeenCalled();
  });
});

describe('PluginLoadError', () => {
  it('names the plugin and reason and keeps the cause', () => {
    const cause = new Error('root');
    const error = new PluginLoadError('demo', 'PLUGIN_HOOK_ATTACH_FAILED', { cause });
    expect(error).toMatchObject({ name: 'PluginLoadError', pluginId: 'demo', reason: 'PLUGIN_HOOK_ATTACH_FAILED', cause, message: "plugin 'demo' failed to load (PLUGIN_HOOK_ATTACH_FAILED)" });
  });
});
