/** Provider-plugin admission through the runtime core: which plugins load ahead of application work,
 * the bounded wait, failure isolation, and the boot re-attach skip for providers. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withFileLock } from '@jini-ai/platform/fs/file-lock';
import { createPluginInvocationBinding, createPluginRuntimeCore, type PluginRuntimeSource } from '../../node/index.js';
import type { PluginManifest } from '../../manifest.js';
import { InMemoryPluginActivationRepo } from '../../repo.memory.js';
import { manifestHost, pluginSdkBinding } from '../support/fixture-bindings.js';

const HOOK = 'record.preCommit';
const WS = 'prov-ws';
const providerDecl = { contract: 'fixture', id: 'fixture', contractVersion: 1 as const };
const manifestFor = (id: string, provides: boolean): PluginManifest => ({
  id, name: id, version: '1.0.0', sdkRange: '>=0.0.0', engine: 1, tier: 'tier-3',
  capabilities: provides ? ['providers.register'] : ['content.read'], hooks: [], fields: [], integrity: {},
  ...(provides ? { contributes: { providers: [providerDecl] } } : {}),
});
type Setup = () => void | Promise<void>;

function host(plugins: Array<{ id: string; provides: boolean; enabled: boolean; setup?: Setup }>) {
  const importModule = vi.fn(async (entryPath: string) => {
    const plugin = plugins.find((candidate) => `entry:${candidate.id}` === entryPath)!;
    return { default: { definition: { setup: plugin.setup ?? (() => {}) } } };
  });
  const sources: PluginRuntimeSource[] = plugins.map(({ id, provides }) => ({ source: 'built-in', manifest: manifestFor(id, provides), entryPath: `entry:${id}`, importModule }));
  const repo = new InMemoryPluginActivationRepo({ initialRows: plugins.map(({ id, enabled }) => ({ pluginId: id, workspaceId: WS as never, version: '1.0.0', enabled, updatedAt: '2026-11-27T00:00:00.000Z' })) });
  const runtime = createPluginRuntimeCore({
    workspaceId: WS, clock: { nowMs: () => 0 } as never, activationRepo: repo, sources,
    pluginSourcePolicy: { localInstallEnabled: () => false, confirmEnable: () => false },
    tier2CallRunner: (async () => { throw new Error('no tier-2 here'); }) as never,
    pluginSdkBinding: { ...pluginSdkBinding, hookIds: [HOOK], beforeSaveHook: HOOK, hookSemantics: { [HOOK]: 'shared' } },
    hostBinding: {
      capabilityVocabulary: ['content.read', 'providers.register'], declarativeContentTypes: manifestHost.declarativeContentTypes,
      coreOwnerName: 'Prov core', identityNamespace: 'prov', localInstallDisabledMessage: 'off',
      tierPolicy: { execution: 'in-process', allowLoad: () => true, siteErrors: () => [], checkInstall: () => {} },
      archiveReader: async () => { throw new Error('no archives'); }, verifyDigest: async () => 'sha256-x',
      createInvocationCoreDeps: ({ pluginId, declaredHooks }) => createPluginInvocationBinding({ pluginId, declaredHooks, beforeSaveHook: HOOK }, {}),
      fileLock: { withFileLock },
    },
    createModuleImporter: ((_required: unknown, optional: { importModule: (entryPath: string) => Promise<{ default: unknown }> }) =>
      async ({ modulePath }: { modulePath: string }) => ({ exported: (await optional.importModule(modulePath)).default })) as never,
    text: { scaffoldEntry: 'export default {};\n', reloadApprovalRequired: () => 'approve', restoreFailedReason: 'restore failed' },
    quarantineTelemetry: ({ pluginId }: { pluginId: string }) => ({ event: { kind: 'q', pluginId }, options: {} }),
  }, {});
  return { runtime, importModule };
}

let warn: ReturnType<typeof vi.spyOn>;
afterEach(() => { warn?.mockRestore(); });
const quietWarn = () => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); return warn; };

describe('provider plugin admission', () => {
  it('loads nothing and reads nothing for an empty request', async () => {
    const { runtime, importModule } = host([{ id: 'prov-a', provides: true, enabled: true }]);
    expect(await runtime.loadProviderPlugins({ pluginIds: [] }, {})).toEqual([]);
    expect(importModule).not.toHaveBeenCalled();
    await runtime.dispose({}, {});
  });

  it('loads only requested, enabled, provider-declaring plugins and lists the enabled providers', async () => {
    const { runtime, importModule } = host([
      { id: 'prov-a', provides: true, enabled: true },
      { id: 'prov-off', provides: true, enabled: false },
      { id: 'plain', provides: false, enabled: true },
      { id: 'prov-unasked', provides: true, enabled: true },
    ]);
    expect(await runtime.listProviderPlugins({}, {})).toEqual([
      { pluginId: 'prov-a', providers: [providerDecl] },
      { pluginId: 'prov-unasked', providers: [providerDecl] },
    ]);
    expect(await runtime.loadProviderPlugins({ pluginIds: ['prov-a', 'prov-off', 'plain'] }, {})).toEqual(['prov-a']);
    expect(importModule.mock.calls).toEqual([['entry:prov-a']]);
    expect(runtime.pluginLoadedVersion({ id: 'prov-a' })).toBe('1.0.0');
    await runtime.dispose({}, {});
  });

  it('isolates a provider whose setup throws: not loaded, revoked, warned with its id', async () => {
    const spy = quietWarn();
    const { runtime } = host([
      { id: 'prov-bad', provides: true, enabled: true, setup: () => { throw new Error('setup exploded'); } },
      { id: 'prov-good', provides: true, enabled: true },
    ]);
    expect(await runtime.loadProviderPlugins({ pluginIds: ['prov-bad', 'prov-good'] }, {})).toEqual(['prov-good']);
    expect(runtime.pluginLoadedVersion({ id: 'prov-bad' })).toBeUndefined();
    expect(spy.mock.calls).toContainEqual(["[plugin-runtime] provider plugin 'prov-bad' failed to load; its contract stays on the noop: Error"]);
    await runtime.dispose({}, {});
  });

  it('stops waiting on a stalled provider at the deadline and revokes it so a late setup cannot publish', async () => {
    const spy = quietWarn();
    let finish!: () => void;
    const { runtime } = host([{ id: 'prov-slow', provides: true, enabled: true, setup: () => new Promise<void>((resolve) => { finish = resolve; }) }]);
    expect(await runtime.loadProviderPlugins({ pluginIds: ['prov-slow'] }, { timeoutMs: 20 })).toEqual([]);
    // Resolving while setup is still pending proves the deadline won; the log names the class only.
    expect(spy.mock.calls).toContainEqual(["[plugin-runtime] provider plugin 'prov-slow' failed to load; its contract stays on the noop: Error"]);
    finish();
    await runtime.dispose({}, {});
    expect(runtime.pluginLoadedVersion({ id: 'prov-slow' })).toBeUndefined();
  });

  it('boot re-attach leaves provider plugins to provider admission and attaches the rest', async () => {
    const { runtime, importModule } = host([
      { id: 'prov-a', provides: true, enabled: true },
      { id: 'plain', provides: false, enabled: true },
    ]);
    await runtime.attachEnabledPluginsAtBoot();
    expect(importModule.mock.calls).toEqual([['entry:plain']]);
    expect(runtime.pluginLoadedVersion({ id: 'prov-a' })).toBeUndefined();
    await runtime.dispose({}, {});
  });
});
