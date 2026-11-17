/**
 * @file Behaviour tests for the provider-plugin paths of `createPluginRuntimeCore`: listing,
 * boot-only loading, boot re-attach skipping, and the deadline. Ported from the unmerged coverage
 * branch's `runtime-core.coverage.unit.test.ts` "provider plugins" block (its fixture used hyphenated
 * provider ids, which the provider-id pattern `[a-z][a-z0-9_]*` rightly rejects). Every host
 * dependency is an injected fake.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginInvocationBinding, createPluginRuntimeCore, type PluginRuntimeSource } from '../../node/index.js';
import type { PluginManifest } from '../../manifest.js';
import { InMemoryPluginActivationRepo } from '../../repo.memory.js';
import type { PluginActivationRecord } from '../../activation.js';
import { manifestHost, pluginSdkBinding as baseBinding } from '../support/fixture-bindings.js';

const HOOK = 'record.preCommit';
const WS = 'ws';
afterEach(() => { vi.restoreAllMocks(); });

const builtIn = (over: Partial<PluginManifest> = {}): PluginManifest => ({
  id: 'core-a', name: 'Core A', version: '1.0.0', sdkRange: '>=0.0.0', engine: 1, tier: 'tier-3', capabilities: [], hooks: [], fields: [], integrity: {}, ...over,
});
const row = (pluginId: string): PluginActivationRecord => ({
  pluginId, workspaceId: WS as never, version: '1.0.0', enabled: true, updatedAt: '2030-01-01T00:00:00.000Z',
});
const source = (manifest: PluginManifest): PluginRuntimeSource =>
  ({ source: 'built-in', manifest, entryPath: `builtin:${manifest.id}`, importModule: async () => ({}) });
const providerManifest = (id: string): PluginManifest => builtIn({
  id, name: id, capabilities: ['providers.register'],
  contributes: { providers: [{ contract: 'search', id: `${id.replace(/-/g, '_')}_engine`, contractVersion: 1 }] } as never,
});

interface HostOptions {
  sources: PluginRuntimeSource[];
  rows: PluginActivationRecord[];
  importer?: (required: { manifest: PluginManifest }) => unknown;
}

function host({ sources, rows, importer }: HostOptions) {
  const setups: string[] = [];
  const createModuleImporter = vi.fn(importer ?? ((required: { manifest: PluginManifest }) => async () => ({ exported: { definition: { setup: () => { setups.push(required.manifest.id); } } } })));
  const runtime = createPluginRuntimeCore({
    workspaceId: WS, clock: { nowMs: () => Date.parse('2030-01-01T00:00:00.000Z') } as never,
    activationRepo: new InMemoryPluginActivationRepo({ initialRows: rows }), sources,
    pluginSourcePolicy: { localInstallEnabled: () => true, confirmEnable: () => true },
    tier2CallRunner: (async () => { throw new Error('tier2 runner'); }) as never,
    pluginSdkBinding: { ...baseBinding, hookIds: [HOOK], beforeSaveHook: HOOK, hookSemantics: { [HOOK]: 'shared' } },
    hostBinding: {
      capabilityVocabulary: ['content.read', 'content.extend', 'hooks.attach', 'tools.register', 'providers.register'], declarativeContentTypes: { ...manifestHost.declarativeContentTypes },
      coreOwnerName: 'Acme core', identityNamespace: 'ns', localInstallDisabledMessage: 'install off',
      tierPolicy: { execution: 'in-process', allowLoad: () => true, siteErrors: () => [], checkInstall: () => {} },
      archiveReader: async () => { throw new Error('no archive'); }, verifyDigest: async () => 'sha256-unused',
      createInvocationCoreDeps: ({ pluginId, declaredHooks }) => createPluginInvocationBinding({ pluginId, declaredHooks, beforeSaveHook: HOOK }, {}),
    },
    createModuleImporter: createModuleImporter as never,
    text: { scaffoldEntry: 'export default {};\n', reloadApprovalRequired: ({ added }) => `NEED_APPROVAL ${added.join('+')}`, restoreFailedReason: 'restore failed' },
    quarantineTelemetry: ({ pluginId }) => ({ event: { pluginId }, options: {} }),
  }, {});
  return { runtime, createModuleImporter, setups };
}

describe('provider plugins', () => {
  it('lists enabled provider plugins with their declarations (manifest only)', async () => {
    const h = host({ sources: [source(providerManifest('prov-a')), source(builtIn())], rows: [row('prov-a'), row('core-a')] });
    expect(await h.runtime.listProviderPlugins({}, {})).toEqual([
      { pluginId: 'prov-a', providers: [{ contract: 'search', id: 'prov_a_engine', contractVersion: 1 }] },
    ]);
  });

  it('loads only the requested, enabled provider plugins and never at enable time', async () => {
    const h = host({ sources: [source(providerManifest('prov-a')), source(providerManifest('prov-off')), source(builtIn())], rows: [row('prov-a'), row('core-a')] });
    expect(await h.runtime.loadProviderPlugins({ pluginIds: [] }, {})).toEqual([]);
    await h.runtime.onPluginEnabled('prov-a');
    expect(h.createModuleImporter).not.toHaveBeenCalled();
    expect(await h.runtime.loadProviderPlugins({ pluginIds: ['prov-a', 'prov-off', 'core-a'] }, {})).toEqual(['prov-a']);
    expect(h.setups).toEqual(['prov-a']);
  });

  it('skips a provider plugin on boot re-attach because loadProviderPlugins owns it', async () => {
    const h = host({ sources: [source(providerManifest('prov-a'))], rows: [row('prov-a')] });
    await h.runtime.attachEnabledPluginsAtBoot();
    expect(h.createModuleImporter).not.toHaveBeenCalled();
  });

  it('logs and skips a provider plugin that fails to load, retiring its selection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = host({ sources: [source(providerManifest('prov-a'))], rows: [row('prov-a')], importer: () => async () => { throw new Error('provider import failed'); } });
    expect(await h.runtime.loadProviderPlugins({ pluginIds: ['prov-a'] }, {})).toEqual([]);
    expect(warn.mock.calls.some(call => String(call[0]).includes("provider plugin 'prov-a' failed to load; its contract stays on the noop"))).toBe(true);
  });

  it('abandons a provider plugin whose load outlasts the deadline, and says it timed out', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = host({ sources: [source(providerManifest('prov-a'))], rows: [row('prov-a')], importer: () => () => new Promise(() => {}) });
    expect(await h.runtime.loadProviderPlugins({ pluginIds: ['prov-a'] }, { timeoutMs: 20 })).toEqual([]);
    expect(warn.mock.calls.some(call => String(call[0]).includes('provider plugin load timed out after 20 ms'))).toBe(true);
  });

  it('starts with an empty browser provider generation', () => {
    expect(host({ sources: [], rows: [] }).runtime.browserProviders({}, {})).toEqual({ generation: 0, providers: [] });
  });
});
