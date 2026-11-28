/** Provider-plugin admission through the runtime core: which plugins load ahead of application work,
 * the bounded wait, failure isolation, and the boot re-attach skip for providers. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withFileLock } from '@jini-ai/platform/fs/file-lock';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPluginInvocationBinding, createPluginRuntimeCore, type PluginRuntimeCoreOptional, type PluginRuntimeSource } from '../../node/index.js';
import type { PluginManifest } from '../../manifest.js';
import { PluginConflictError } from '../../plugin-claims.js';
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

function host(plugins: Array<{ id: string; provides: boolean; enabled: boolean | null; setup?: Setup }>, options: { failListAllCall?: number; runtime?: PluginRuntimeCoreOptional } = {}) {
  const importModule = vi.fn(async (entryPath: string) => {
    const plugin = plugins.find((candidate) => `entry:${candidate.id}` === entryPath)!;
    return { default: { definition: { setup: plugin.setup ?? (() => {}) } } };
  });
  const sources: PluginRuntimeSource[] = plugins.map(({ id, provides }) => ({ source: 'built-in', manifest: manifestFor(id, provides), entryPath: `entry:${id}`, importModule }));
  const repo = new InMemoryPluginActivationRepo({ initialRows: plugins.flatMap(({ id, enabled }) => enabled === null ? [] : [{ pluginId: id, workspaceId: WS as never, version: '1.0.0', enabled, updatedAt: '2026-11-27T00:00:00.000Z' }]) });
  let listAllCalls = 0;
  const listAll = repo.listAll.bind(repo);
  repo.listAll = async (...args: Parameters<typeof repo.listAll>) => {
    listAllCalls += 1;
    if (listAllCalls === options.failListAllCall) throw new Error('activation store offline');
    return listAll(...args);
  };
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
  }, options.runtime ?? {});
  return { runtime, importModule, repo };
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

  it('quarantines one of two enabled plugins that claim the same provider at boot, durably and with a logged reason', async () => {
    const spy = quietWarn();
    const { runtime, repo } = host([
      { id: 'prov-a', provides: true, enabled: true },
      { id: 'prov-b', provides: true, enabled: true },
    ]);
    await runtime.attachEnabledPluginsAtBoot();
    const rows = await repo.listAll();
    const off = rows.filter((row) => !row.enabled).map((row) => row.pluginId);
    expect(off).toHaveLength(1);
    const lines = spy.mock.calls.map((call) => String(call[0]));
    expect(lines.filter((line) => line.startsWith(`[plugin-runtime] '${off[0]}' quarantined at boot: `))).toHaveLength(1);
    await runtime.dispose({}, {});
  });

  it('attaches nothing at boot when the conflict pass cannot finish, and logs why', async () => {
    const spy = quietWarn();
    // Boot reads activations for its own list (call 1), then the conflict pass reads them again (call 2).
    const { runtime, importModule } = host([{ id: 'plain', provides: false, enabled: true }], { failListAllCall: 2 });
    await runtime.attachEnabledPluginsAtBoot();
    expect(importModule).not.toHaveBeenCalled();
    expect(spy.mock.calls.map((call) => String(call[0]))).toContainEqual(expect.stringContaining('[plugin-runtime] boot conflict check failed, no plugin attached'));
    await runtime.dispose({}, {});
  });
  it('enabling a provider plugin after boot imports nothing: providers load only through provider admission', async () => {
    const { runtime, importModule } = host([{ id: 'prov-a', provides: true, enabled: true }]);
    await expect(runtime.onPluginEnabled('prov-a')).resolves.toBeUndefined();
    expect(importModule).not.toHaveBeenCalled();
    expect(runtime.pluginLoadedVersion({ id: 'prov-a' })).toBeUndefined();
    await runtime.dispose({}, {});
  });

  it('leaves a disabled plugin that would clash at boot untouched: only enabled plugins are quarantined', async () => {
    const spy = quietWarn();
    const { runtime, repo } = host([
      { id: 'prov-a', provides: true, enabled: true },
      { id: 'prov-b', provides: true, enabled: false },
    ]);
    await runtime.attachEnabledPluginsAtBoot();
    const rows = await repo.listAll();
    expect(rows.map(({ pluginId, enabled, quarantineReason }) => ({ pluginId, enabled, quarantineReason }))).toEqual([
      { pluginId: 'prov-a', enabled: true, quarantineReason: undefined },
      { pluginId: 'prov-b', enabled: false, quarantineReason: undefined },
    ]);
    expect(spy.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('quarantined at boot'))).toEqual([]);
    await runtime.dispose({}, {});
  });

  it('first boot enables a bundled plugin that has no row, attaches it once, and skips ids that are not bundled', async () => {
    const { runtime, importModule, repo } = host([{ id: 'plain', provides: false, enabled: null }], { runtime: { bundledEnabledIds: ['plain', 'ghost'] } });
    await runtime.attachEnabledPluginsAtBoot();
    expect(await repo.getActivation({ workspaceId: WS as never, pluginId: 'plain' })).toMatchObject({ version: '1.0.0', enabled: true });
    expect(await repo.getActivation({ workspaceId: WS as never, pluginId: 'ghost' })).toBeNull();
    // Enabled by the initializer, so the re-attach loop must not import it a second time.
    expect(importModule.mock.calls).toEqual([['entry:plain']]);
    expect(runtime.pluginLoadedVersion({ id: 'plain' })).toBe('1.0.0');
    await runtime.dispose({}, {});
  });

  it('reports a bundled plugin whose first enable fails by id, leaves it without a row and attaches nothing', async () => {
    const spy = quietWarn();
    const { runtime, repo } = host([{ id: 'plain', provides: false, enabled: null, setup: () => { throw new Error('setup exploded'); } }], { runtime: { bundledEnabledIds: ['plain'] } });
    await runtime.attachEnabledPluginsAtBoot();
    expect(spy.mock.calls.map((call) => call[0])).toContain("[plugin-runtime] bundled initialization failed for 'plain'");
    expect(await repo.getActivation({ workspaceId: WS as never, pluginId: 'plain' })).toBeNull();
    expect(runtime.pluginLoadedVersion({ id: 'plain' })).toBeUndefined();
    await runtime.dispose({}, {});
  });

  it('logs and carries on with no bundled defaults when bundled discovery fails', async () => {
    const spy = quietWarn();
    const root = await mkdtemp(path.join(os.tmpdir(), 'prov-boot-'));
    // A file where the install directory should be: listing it fails with ENOTDIR, not ENOENT.
    const installDir = path.join(root, 'plugins');
    await writeFile(installDir, 'not a directory');
    try {
      const { runtime, importModule, repo } = host([{ id: 'plain', provides: false, enabled: null }], { runtime: { bundledEnabledIds: ['plain'], installDir } });
      await runtime.attachEnabledPluginsAtBoot();
      expect(spy.mock.calls.map((call) => call[0])).toContain('[plugin-runtime] bundled discovery failed; chart providers remain unavailable');
      expect(await repo.getActivation({ workspaceId: WS as never, pluginId: 'plain' })).toBeNull();
      expect(importModule).not.toHaveBeenCalled();
      await runtime.dispose({}, {});
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not re-attach at boot while an install holds the lock, and logs the refusal by id', async () => {
    const spy = quietWarn();
    const root = await mkdtemp(path.join(os.tmpdir(), 'prov-boot-'));
    const installDir = path.join(root, 'plugins');
    await mkdir(`${installDir}-install-lock`, { recursive: true });
    try {
      const { runtime, importModule } = host([{ id: 'plain', provides: false, enabled: true }], { runtime: { installDir } });
      await runtime.attachEnabledPluginsAtBoot();
      expect(importModule).not.toHaveBeenCalled();
      expect(runtime.pluginLoadedVersion({ id: 'plain' })).toBeUndefined();
      expect(spy.mock.calls.map((call) => String(call[0]))).toContain("[plugin-runtime] boot re-attach failed for 'plain'");
      await runtime.dispose({}, {});
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('logs an enabled row whose plugin discovery no longer finds and still attaches the others', async () => {
    const spy = quietWarn();
    const { runtime, importModule, repo } = host([{ id: 'plain', provides: false, enabled: true }]);
    await repo.save({ pluginId: 'gone', workspaceId: WS as never, version: '1.0.0', enabled: true, updatedAt: '2026-11-27T00:00:00.000Z' });
    await runtime.attachEnabledPluginsAtBoot();
    expect(importModule.mock.calls).toEqual([['entry:plain']]);
    expect(runtime.pluginLoadedVersion({ id: 'plain' })).toBe('1.0.0');
    expect(spy.mock.calls.map((call) => String(call[0]))).toContain("[plugin-runtime] boot re-attach failed for 'gone'");
    await runtime.dispose({}, {});
  });
  it('lists what a disabled plugin would clash with, from a fresh discovery', async () => {
    const { runtime } = host([
      { id: 'prov-a', provides: true, enabled: true },
      { id: 'prov-b', provides: true, enabled: false },
    ]);
    const conflicts = await runtime.listPluginConflicts();
    expect([...conflicts.keys()]).toEqual(['prov-b']);
    expect(conflicts.get('prov-b')).toEqual([expect.objectContaining({ heldBy: 'prov-a' })]);
    await runtime.dispose({}, {});
  });

  it('refuses to enable the newer of two clashing plugins before importing it', async () => {
    const { runtime, importModule } = host([
      { id: 'plain-a', provides: false, enabled: true },
      { id: 'prov-a', provides: true, enabled: true },
      { id: 'prov-b', provides: true, enabled: true },
    ]);
    const refused = await runtime.onPluginEnabled('prov-b').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(PluginConflictError);
    expect(refused).toMatchObject({ pluginId: 'prov-b', conflicts: [expect.objectContaining({ heldBy: 'prov-a' })] });
    // The non-clashing plugin still enables through the same gate.
    await runtime.onPluginEnabled('plain-a');
    expect(importModule.mock.calls).toEqual([['entry:plain-a']]);
    await runtime.dispose({}, {});
  });
});
