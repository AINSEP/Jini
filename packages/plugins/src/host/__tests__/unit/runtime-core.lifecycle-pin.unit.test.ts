/** G08 pin: the plugin runtime core's activation, unavailable-plugin and disposal behaviour, held
 * constant while `createPluginRuntimeCore` is split into per-phase helpers. The core owns no
 * multi-plugin unwind list: a failed attach publishes nothing for that plugin, and disposal flips
 * the closed gate, drains in-flight attachments, then releases the snapshots. */
import { describe, expect, it } from 'vitest';
import { createPluginInvocationBinding, createPluginRuntimeCore, type PluginRuntimeHostBinding, type PluginRuntimeSource, type PluginRuntimeText } from '../../node/index.js';
import { PluginLoadError } from '../../node/loader.js';
import { PluginSnapshotLifecycleError } from '../../node/module-snapshot.js';
import type { PluginManifest } from '../../manifest.js';
import type { PluginSdkBinding } from '../../ports.js';
import { InMemoryPluginActivationRepo } from '../../repo.memory.js';
import { manifestHost, pluginSdkBinding as baseBinding } from '../support/fixture-bindings.js';

const HOOK = 'record.preCommit';
const sdkBinding: PluginSdkBinding = { ...baseBinding, hookIds: [HOOK], beforeSaveHook: HOOK, hookSemantics: { [HOOK]: 'shared' } };
const hostBinding: PluginRuntimeHostBinding = {
  capabilityVocabulary: ['content.read', 'content.extend', 'hooks.attach'],
  declarativeContentTypes: manifestHost.declarativeContentTypes,
  coreOwnerName: 'Acme core', identityNamespace: 'acme', localInstallDisabledMessage: 'off',
  tierPolicy: { execution: 'in-process', allowLoad: () => true, siteErrors: () => [], checkInstall: () => {} },
  archiveReader: async () => { throw new Error('unused'); },
  verifyDigest: async () => 'sha256-acme',
  createInvocationCoreDeps: ({ pluginId, declaredHooks }) => createPluginInvocationBinding({ pluginId, declaredHooks, beforeSaveHook: HOOK }, {}),
  fileLock: { withFileLock: async ({ run }: { run: () => unknown }) => run() } as never,
};
const text: PluginRuntimeText = { scaffoldEntry: '', reloadApprovalRequired: () => 'approval', restoreFailedReason: 'restore failed' };
const manifestOf = (id: string): PluginManifest => ({
  id, name: id, version: '1.0.0', sdkRange: '>=0.0.0', engine: 1, tier: 'tier-3', capabilities: ['content.read'], hooks: [], fields: [], integrity: {},
});

const hookedManifest = (id: string): PluginManifest => ({ ...manifestOf(id), capabilities: ['content.read', 'hooks.attach'], hooks: [HOOK] });

function host(ids: readonly string[], setupFor: (id: string) => (sdk: Record<string, unknown>) => unknown | Promise<unknown>, manifestFor: (id: string) => PluginManifest = manifestOf) {
  const repo = new InMemoryPluginActivationRepo({ initialRows: ids.map((pluginId) => (
    { pluginId, workspaceId: 'ws' as never, version: '1.0.0', enabled: true, updatedAt: '2026-11-09T00:00:00.000Z' })) });
  const sources: PluginRuntimeSource[] = ids.map((id) => ({
    source: 'built-in' as const, manifest: manifestFor(id), entryPath: `acme:${id}`,
    importModule: async () => ({ default: { definition: { setup: setupFor(id) } } }),
  }));
  const required = {
    workspaceId: 'ws', clock: { nowMs: () => 0 } as never, activationRepo: repo, sources,
    pluginSourcePolicy: { localInstallEnabled: () => false, confirmEnable: () => false },
    tier2CallRunner: (async () => { throw new Error('none'); }) as never, pluginSdkBinding: sdkBinding, hostBinding,
    createModuleImporter: ((_r: unknown, o: { importModule?: (p: string) => Promise<unknown> } = {}) =>
      async ({ modulePath }: { modulePath: string }) => ({ exported: ((await o.importModule!(modulePath)) as { default: unknown }).default })) as never,
    text,
    quarantineTelemetry: () => ({ event: {}, options: {} }),
  };
  return createPluginRuntimeCore(required, {});
}

describe('createPluginRuntimeCore lifecycle pin', () => {
  it('rejects an enable for a plugin discovery cannot see, with the same load error and nothing published', async () => {
    const runtime = host(['a'], () => () => {});
    const refused = await runtime.onPluginEnabled('ghost').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(PluginLoadError);
    expect(refused).toMatchObject({ pluginId: 'ghost', reason: 'PLUGIN_EXPORT_INVALID' });
    expect(runtime.pluginLoadedVersion({ id: 'ghost' })).toBeUndefined();
    await runtime.dispose({}, {});
  });

  it('a failed setup surfaces the load error and leaves that plugin unpublished while others stay loaded', async () => {
    const runtime = host(['a', 'b'], (id) => () => { if (id === 'b') throw new Error('setup boom'); });
    await runtime.onPluginEnabled('a');
    const failed = await runtime.onPluginEnabled('b').catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(PluginLoadError);
    expect(failed).toMatchObject({ pluginId: 'b', reason: 'PLUGIN_SETUP_FAILED' });
    expect(runtime.pluginLoadedVersion({ id: 'a' })).toBe('1.0.0');
    expect(runtime.pluginLoadedVersion({ id: 'b' })).toBeUndefined();
    await runtime.dispose({}, {});
  });

  it('disabling retires the loaded version, and a re-enable loads it again', async () => {
    const runtime = host(['a'], () => () => {});
    await runtime.onPluginEnabled('a');
    expect(runtime.pluginLoadedVersion({ id: 'a' })).toBe('1.0.0');
    runtime.onPluginDisabled('a');
    expect(runtime.pluginLoadedVersion({ id: 'a' })).toBeUndefined();
    await runtime.onPluginEnabled('a');
    expect(runtime.pluginLoadedVersion({ id: 'a' })).toBe('1.0.0');
    await runtime.dispose({}, {});
  });

  it('dispose drains an in-flight attachment first, then refuses new ones with the closed-snapshots error', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runtime = host(['a', 'b'], (id) => () => (id === 'a' ? gate : undefined));
    const attaching = runtime.onPluginEnabled('a');
    await tick();
    let disposed = false;
    const disposing = runtime.dispose({}, {}).then(() => { disposed = true; });
    await tick();
    expect(disposed).toBe(false); // still waiting on the pending attachment
    release();
    await attaching;
    await disposing;
    expect(disposed).toBe(true);
    const late = await runtime.onPluginEnabled('b').catch((error: unknown) => error);
    expect(late).toBeInstanceOf(PluginSnapshotLifecycleError);
    expect(late).toMatchObject({ code: 'SNAPSHOTS_CLOSED' });
    expect(runtime.pluginLoadedVersion({ id: 'b' })).toBeUndefined();
  });

  it('a plugin declaring the before-save hook but attaching no filter is refused and not published', async () => {
    const runtime = host(['h'], () => () => {}, hookedManifest);
    const refused = await runtime.onPluginEnabled('h').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(PluginLoadError);
    expect(refused).toMatchObject({ pluginId: 'h', reason: 'PLUGIN_HOOK_NOT_ATTACHED' });
    expect(runtime.pluginLoadedVersion({ id: 'h' })).toBeUndefined();
    await runtime.dispose({}, {});
  });

  it('a failed publish detaches the just-attached filter and surfaces the attach error with its cause', async () => {
    const ran: string[] = [];
    const runtime = host(['h'], (id) => (sdk) => {
      (sdk.addFilter as (hook: string, filter: () => unknown) => void)(HOOK, () => { ran.push(id); return {}; });
    }, hookedManifest);
    const cause = new Error('subscriber failed');
    const unsubscribe = runtime.pluginContributions.subscribe({ onChanged: () => { throw cause; } });
    const failed = await runtime.onPluginEnabled('h').catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(PluginLoadError);
    expect(failed).toMatchObject({ pluginId: 'h', reason: 'PLUGIN_HOOK_ATTACH_FAILED' });
    expect((failed as Error).cause).toBe(cause);
    expect(runtime.pluginLoadedVersion({ id: 'h' })).toBeUndefined();
    await runtime.beforeSaveHook({ workspaceId: 'ws', ext: {} } as never);
    expect(ran).toEqual([]); // the filter was detached, so a save no longer runs it
    unsubscribe();
    await runtime.onPluginEnabled('h');
    await runtime.beforeSaveHook({ workspaceId: 'ws', ext: {} } as never);
    expect(ran).toEqual(['h']);
    await runtime.dispose({}, {});
  });
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
