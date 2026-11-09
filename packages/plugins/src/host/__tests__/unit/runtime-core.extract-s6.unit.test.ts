/** EXTRACT-S6 L1c part 2: the plugin runtime core wired by a SECOND host through the public
 * `./host/node` entry only, with its own wording, source policy, Tier-2 runner, SDK hook id,
 * telemetry projection, lookup/admission and importer. Proves each required input is the one the
 * runtime uses (none is defaulted inside Jini) and the moved error class keeps its identity. */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPluginInvocationBinding,
  createPluginRuntimeCore,
  PluginUninstallPathError,
  type PluginRuntimeHostBinding,
  type PluginRuntimeLookup,
  type PluginRuntimeSource,
  type PluginRuntimeText,
} from '../../node/index.js';
import type { PluginManifest } from '../../manifest.js';
import type { PluginSourcePolicyPort } from '../../source-policy.js';
import type { PluginSdkBinding } from '../../ports.js';
import { InMemoryPluginActivationRepo } from '../../repo.memory.js';
import { manifestHost, pluginSdkBinding as baseBinding } from '../support/fixture-bindings.js';

const HOOK = 'record.preCommit';
const sdkBinding: PluginSdkBinding = {
  ...baseBinding, hookIds: [HOOK], beforeSaveHook: HOOK, hookSemantics: { [HOOK]: 'shared' },
};
const hostBinding: PluginRuntimeHostBinding = {
  capabilityVocabulary: ['content.read', 'content.extend', 'hooks.attach'],
  declarativeContentTypes: manifestHost.declarativeContentTypes,
  coreOwnerName: 'Acme core',
  identityNamespace: 'acme',
  localInstallDisabledMessage: 'Acme: local install is off.',
  tierPolicy: { execution: 'in-process', allowLoad: () => true, siteErrors: () => [], checkInstall: () => {} },
  archiveReader: async () => { throw new Error('archive reads are outside this test'); },
  verifyDigest: async () => 'sha256-acme',
  createInvocationCoreDeps: ({ pluginId, declaredHooks }) =>
    createPluginInvocationBinding({ pluginId, declaredHooks, beforeSaveHook: HOOK }, {}),
};
const text: PluginRuntimeText = {
  scaffoldEntry: '// acme scaffold\nexport default {};\n',
  reloadApprovalRequired: ({ added }) => `ACME_APPROVAL ${added.join('+')}`,
  restoreFailedReason: 'acme restore failed',
};
const manifest: PluginManifest = {
  id: 'acme-stamp', name: 'Acme Stamp', version: '1.0.0', sdkRange: '>=0.0.0', engine: 1, tier: 'tier-3',
  capabilities: ['content.read', 'hooks.attach'], hooks: [HOOK], fields: [], integrity: {},
};

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

function secondHost(setup: (sdk: Record<string, unknown>) => void) {
  const repo = new InMemoryPluginActivationRepo({ initialRows: [
    { pluginId: 'acme-stamp', workspaceId: 'acme-ws' as never, version: '1.0.0', enabled: true, updatedAt: '2026-11-09T00:00:00.000Z' },
  ] });
  const importModule = vi.fn(async () => ({ default: { definition: { setup } } }));
  const sources: PluginRuntimeSource[] = [{ source: 'built-in', manifest, entryPath: 'acme:stamp', importModule }];
  const createModuleImporter = vi.fn((required: { manifest: PluginManifest; source: 'built-in' | 'site' }, optional: { importModule?: (entryPath: string) => Promise<unknown> } = {}) =>
    async ({ modulePath }: { modulePath: string }) => {
      expect(required.manifest.id).toBe('acme-stamp');
      const moduleValue = await optional.importModule!(modulePath) as { default: unknown };
      return { exported: moduleValue.default };
    });
  const tier2CallRunner = vi.fn(async () => { throw new Error('no tier-2 plugin here'); });
  const policy: PluginSourcePolicyPort = { localInstallEnabled: () => false, confirmEnable: () => false };
  const capture = vi.fn();
  const getPlugin = vi.fn(async () => null);
  const lookup: PluginRuntimeLookup = {
    getPlugin, findProviders: async () => [],
    withInstallIdentity: ({ run }) => run(),
  };
  const required = {
    workspaceId: 'acme-ws', clock: { nowMs: () => Date.parse('2026-11-09T00:00:00Z') } as never, activationRepo: repo, sources,
    pluginSourcePolicy: policy, tier2CallRunner: tier2CallRunner as never, pluginSdkBinding: sdkBinding, hostBinding,
    createModuleImporter: createModuleImporter as never, text,
    quarantineTelemetry: ({ pluginId }: { pluginId: string }) => ({ event: { kind: 'acme.quarantine', pluginId }, options: { channel: 'ops' } }),
  };
  return { repo, importModule, createModuleImporter, tier2CallRunner, policy, capture, getPlugin, lookup, required };
}

describe('createPluginRuntimeCore (second host via @jini-ai/plugins/host/node)', () => {
  it('loads through the host importer, SDK hook id and lookup, and projects quarantine telemetry', async () => {
    let sdkSeen: Record<string, unknown> | undefined;
    const host = secondHost((sdk) => {
      sdkSeen = sdk;
      (sdk.addFilter as (hook: string, filter: () => never) => void)(HOOK, () => { throw new Error('acme filter failed'); });
    });
    const runtime = createPluginRuntimeCore(host.required, { tracker: () => ({ capture: host.capture }), lookup: () => host.lookup, failureThreshold: 1 });
    expect(runtime.pluginSourcePolicy).toBe(host.policy);

    await runtime.onPluginEnabled('acme-stamp');
    expect(host.createModuleImporter).toHaveBeenCalledWith(
      { manifest, source: 'built-in' }, expect.objectContaining({ importModule: host.importModule }),
    );
    expect(host.importModule).toHaveBeenCalledWith('acme:stamp');
    expect(host.tier2CallRunner).not.toHaveBeenCalled();
    expect(runtime.pluginLoadedVersion({ id: 'acme-stamp' })).toBe('1.0.0');
    // The host lookup reaches the plugin SDK through the core facade.
    await (sdkSeen!.plugins as { getPlugin: (q: { id: string }) => Promise<unknown> }).getPlugin({ id: 'other' });
    expect(host.getPlugin).toHaveBeenCalledTimes(1);

    const entry = { workspaceId: 'acme-ws', sku: 'A-1', ext: {} };
    // Preview writes and counts nothing; the save path then quarantines at threshold 1.
    await runtime.previewPluginBeforeSave('acme-stamp', entry as never).catch(() => undefined);
    expect(host.capture).not.toHaveBeenCalled();
    await runtime.beforeSaveHook(entry as never).catch(() => undefined);
    await vi.waitFor(() => expect(host.capture).toHaveBeenCalledTimes(1));
    expect(host.capture).toHaveBeenCalledWith({ kind: 'acme.quarantine', pluginId: 'acme-stamp' }, { channel: 'ops' });
    const row = (await host.repo.listAll()).find((candidate) => candidate.pluginId === 'acme-stamp');
    expect(row).toMatchObject({ workspaceId: 'acme-ws', enabled: false, quarantineFailureCount: 1 });
    expect(runtime.pluginLoadedVersion({ id: 'acme-stamp' })).toBeUndefined();
    await runtime.dispose({}, {});
  });

  it('uses the host scaffold text and install layout, and keeps the uninstall-path error identity', async () => {
    const installDir = await mkdtemp(path.join(os.tmpdir(), 'acme-plugins-'));
    dirs.push(installDir, `${installDir}-runtime`);
    const host = secondHost(() => {});
    const runtime = createPluginRuntimeCore(host.required, { installDir });
    expect(runtime.pluginInstaller).toBeDefined();
    await runtime.pluginSource!.create({ id: 'acme-draft', name: 'Acme Draft', description: 'second host' }, {});
    const { content } = await runtime.pluginSource!.read({ id: 'acme-draft', path: 'server/index.mjs' }, {});
    expect(content).toBe(text.scaffoldEntry);

    const located = await runtime.locatePluginPackageDirs('acme-draft');
    expect(located.liveParent).toBe(path.resolve(installDir));
    expect(located.parkedDir).toBe(path.resolve(`${path.resolve(installDir)}-trash`, 'acme-draft'));
    const refused = await runtime.locatePluginPackageDirs('../escape').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(PluginUninstallPathError);
    expect((refused as Error).name).toBe('PluginUninstallPathError');
    await runtime.dispose({}, {});
  });
});
