/** G08 pin: the reload rollback of the plugin runtime core, held constant while `runtime-core` is split
 * into per-phase modules. A sealed update that fails to load re-enters the same loader for the restored
 * row (so the previously approved bytes keep running) and surfaces the original load error; if that
 * restore load also fails the plugin is quarantined with the host's `restoreFailedReason`. */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginInvocationBinding, createPluginRuntimeCore, type PluginRuntimeHostBinding, type PluginRuntimeText } from '../../node/index.js';
import { pluginCapabilitySet } from '../../source-policy.js';
import type { PluginSdkBinding } from '../../ports.js';
import { InMemoryPluginActivationRepo } from '../../repo.memory.js';
import { manifestHost, pluginSdkBinding as baseBinding } from '../support/fixture-bindings.js';

const HOOK = 'record.preCommit';
const WS = 'ws';
const ID = 'acme-draft';
const sdkBinding: PluginSdkBinding = { ...baseBinding, hookIds: [HOOK], beforeSaveHook: HOOK, hookSemantics: { [HOOK]: 'shared' } };
const hostBinding: PluginRuntimeHostBinding = {
  capabilityVocabulary: ['content.read', 'content.extend', 'hooks.attach'],
  declarativeContentTypes: manifestHost.declarativeContentTypes,
  coreOwnerName: 'Acme core', identityNamespace: 'acme', localInstallDisabledMessage: 'off',
  tierPolicy: { execution: 'in-process', allowLoad: () => true, siteErrors: () => [], checkInstall: () => {} },
  archiveReader: async () => { throw new Error('unused'); },
  verifyDigest: async ({ absoluteFilePath }: { absoluteFilePath: string }) => `sha256-${createHash('sha256').update(await readFile(absoluteFilePath)).digest('hex')}`,
  createInvocationCoreDeps: ({ pluginId, declaredHooks }) => createPluginInvocationBinding({ pluginId, declaredHooks, beforeSaveHook: HOOK }, {}),
  fileLock: { withFileLock: async ({ run }: { run: () => unknown }) => run() } as never,
};
const text: PluginRuntimeText = { scaffoldEntry: 'export default {};\n', reloadApprovalRequired: () => 'approval', restoreFailedReason: 'acme restore failed' };

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

/** A site plugin sealed twice (0.1.0 then 0.1.1) with the first version enabled and loaded. `failOn` names
 * the versions whose load throws from the injected importer once the first load has succeeded. */
async function sealedTwiceHost(failOn: (version: string) => boolean) {
  const installDir = await mkdtemp(path.join(os.tmpdir(), 'acme-reload-'));
  dirs.push(installDir, `${installDir}-runtime`, `${installDir}-trash`);
  const repo = new InMemoryPluginActivationRepo({ initialRows: [] });
  const loads: string[] = [];
  let armed = false;
  const required = {
    workspaceId: WS, clock: { nowMs: () => Date.parse('2026-11-09T00:00:00Z') } as never, activationRepo: repo, sources: [],
    pluginSourcePolicy: { localInstallEnabled: () => true, confirmEnable: () => true },
    tier2CallRunner: (async () => { throw new Error('none'); }) as never, pluginSdkBinding: sdkBinding, hostBinding,
    createModuleImporter: (() => async ({ modulePath }: { modulePath: string }) => {
      const version = /\/(\d+\.\d+\.\d+)\//.exec(modulePath.replace(/\\/g, '/'))?.[1] ?? 'unknown';
      const failing = armed && failOn(version);
      loads.push(version);
      return { exported: { definition: { setup: () => { if (failing) throw new Error(`setup boom ${version}`); } } } };
    }) as never,
    text,
    quarantineTelemetry: () => ({ event: {}, options: {} }),
  };
  const runtime = createPluginRuntimeCore(required, { installDir });
  const source = runtime.pluginSource!;
  await source.create({ id: ID, name: 'Acme Draft', description: 'reload pin' }, {});
  expect(await source.seal({ id: ID }, {})).toMatchObject({ installed: true, reloaded: false });
  await repo.save({ pluginId: ID, workspaceId: WS as never, version: '0.1.0', enabled: true, updatedAt: '2026-11-09T00:00:00.000Z' });
  await runtime.onPluginEnabled(ID);
  expect(runtime.pluginLoadedVersion({ id: ID })).toBe('0.1.0');
  loads.length = 0;
  armed = true;
  await source.recordApproval({ id: ID, capabilities: pluginCapabilitySet({ manifest: (await runtime.discoverPlugins()).find((r) => r.id === ID)!.manifest! }) }, {});
  await source.write({ id: ID, path: 'README.md', content: 'second version\n' }, {});
  return { runtime, source, repo, loads };
}

describe('plugin reload rollback pin', () => {
  it('a sealed update whose load fails restores the old row, re-loads the previous version and surfaces the same error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { runtime, source, repo, loads } = await sealedTwiceHost((version) => version === '0.1.1');
    const sealed = await source.seal({ id: ID }, {});
    expect(sealed).toMatchObject({ installed: true, reloaded: false });
    expect(sealed.reloadError).toMatch(/setup boom 0\.1\.1|PLUGIN_SETUP_FAILED/);
    expect(loads).toEqual(['0.1.1', '0.1.0']); // the new bytes fail, then the same loader re-enters for the restored row
    expect(runtime.pluginLoadedVersion({ id: ID })).toBe('0.1.0');
    const row = await repo.getActivation({ workspaceId: WS as never, pluginId: ID });
    expect(row).toMatchObject({ version: '0.1.0', enabled: true });
    expect(row?.quarantinedAt).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    await runtime.dispose({}, {});
    warn.mockRestore();
  });

  it('when the restore load also fails the plugin is quarantined with the host restoreFailedReason and unloaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { runtime, source, repo, loads } = await sealedTwiceHost(() => true);
    const sealed = await source.seal({ id: ID }, {});
    expect(sealed).toMatchObject({ installed: true, reloaded: false });
    expect(sealed.reloadError).toMatch(/setup boom 0\.1\.1|PLUGIN_SETUP_FAILED/);
    expect(loads).toEqual(['0.1.1', '0.1.0']);
    expect(runtime.pluginLoadedVersion({ id: ID })).toBeUndefined();
    const row = await repo.getActivation({ workspaceId: WS as never, pluginId: ID });
    expect(row).toMatchObject({ version: '0.1.0', enabled: false, quarantineReason: 'acme restore failed', quarantineFailureCount: 0 });
    expect(row?.quarantinedAt).toBeDefined();
    expect(warn).toHaveBeenCalledWith(`[plugin-runtime] Plugin '${ID}' restored-version reload failed`, expect.anything());
    await runtime.dispose({}, {});
    warn.mockRestore();
  });
  it('reloads this workspace first, so a failed local load leaves another workspace on the approved version', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { runtime, source, repo } = await sealedTwiceHost((version) => version === '0.1.1');
    // List the other workspace's row ahead of this one, so only the this-workspace-first order protects it.
    const here = (await repo.getActivation({ workspaceId: WS as never, pluginId: ID }))!;
    await repo.deleteActivation({ workspaceId: WS as never, pluginId: ID });
    await repo.save({ pluginId: ID, workspaceId: 'ws-b' as never, version: '0.1.0', enabled: true, updatedAt: '2026-11-09T00:00:00.000Z' });
    await repo.save(here);
    expect((await repo.listAll()).map((row) => row.workspaceId)).toEqual(['ws-b', WS]);
    const sealed = await source.seal({ id: ID }, {});
    expect(sealed).toMatchObject({ installed: true, reloaded: false });
    expect(await repo.getActivation({ workspaceId: 'ws-b' as never, pluginId: ID })).toMatchObject({ version: '0.1.0', enabled: true });
    expect(runtime.pluginLoadedVersion({ id: ID })).toBe('0.1.0');
    await runtime.dispose({}, {});
    warn.mockRestore();
  });

  it('a successful reload moves every enabled workspace to the new version and reports the local reload', async () => {
    const { runtime, source, repo } = await sealedTwiceHost(() => false);
    await repo.save({ pluginId: ID, workspaceId: 'ws-b' as never, version: '0.1.0', enabled: true, updatedAt: '2026-11-09T00:00:00.000Z' });
    expect(await source.seal({ id: ID }, {})).toMatchObject({ installed: true, reloaded: true });
    expect(await repo.getActivation({ workspaceId: 'ws-b' as never, pluginId: ID })).toMatchObject({ version: '0.1.1', enabled: true });
    expect(await repo.getActivation({ workspaceId: WS as never, pluginId: ID })).toMatchObject({ version: '0.1.1', enabled: true });
    expect(runtime.pluginLoadedVersion({ id: ID })).toBe('0.1.1');
    await runtime.dispose({}, {});
  });
});
