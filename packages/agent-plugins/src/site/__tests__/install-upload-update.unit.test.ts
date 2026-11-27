import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import { parseAgentPluginManifest } from '../../lifecycle/manifest.js';
import { readInstalledAgentPluginIdentity } from '../../lifecycle/host-tools/index.js';
import { AgentPluginUpdateError } from '../../core/update-error.js';
import { createAgentPluginSiteLayout } from '../../lifecycle/layout.js';
import { createAgentPluginUpload, installUploadedAgentPlugin, type InstallUploadedAgentPluginOptional } from '../install-upload.js';

function fixture(oldInstalled = false) {
  const archive = Buffer.from('archive'); const expectedSha256 = createHash('sha256').update(archive).digest('hex');
  const order: string[] = []; const previous = { pluginId: 'demo', archiveDigest: 'old', packageRoot: '/old', version: '1.0.0' };
  let installed = oldInstalled ? [previous] : [];
  const candidate = { ...previous, archiveDigest: expectedSha256, version: '1.1.0', packageRoot: '/new' };
  const layout = createAgentPluginSiteLayout({ siteDir: '/site', rootOverride: '/plugins', diagnostics: { rootOverride: () => new Error('root'), workspaceId: () => new Error('workspace'), pluginId: () => new Error('plugin'), pluginDataId: () => new Error('data'), memoryKind: () => new Error('memory') } });
  const optional = { layout, parseManifest: parseAgentPluginManifest, readInstallIdentity: readInstalledAgentPluginIdentity, sha256: (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'), archiveReader: { async *entries() { const manifest = Buffer.from(JSON.stringify({ '$schema': 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'demo', description: 'Demo' }));
    yield { kind: 'file', entryPath: 'plugin.json', declaredBytes: manifest.length, openReadStream: async function* () { yield manifest; } }; } },
    lifecycle: { installAgentPlugin: async (_input: unknown, options: { publishGuard(input: { plugin: unknown; publish(): Promise<unknown> }): Promise<unknown> }) => options.publishGuard({ plugin: candidate, publish: async () => { order.push('publish'); installed = [candidate]; return candidate; } }),
      listInstalledPlugins: async () => installed, setAgentPluginActivation: async () => { order.push('off'); },
    },
    createLifecycle: () => ({ updateAgentPlugin: async () => { throw new AgentPluginUpdateError({ code: 'PLUGIN_DOWNGRADE_REFUSED', message: 'Rejected update' }); } }),
    maxAgentPluginInstallArchiveBytes: () => 1000000, contain: async () => '/contained', assertOwnedPluginPath: async () => '/contained',
    snapshotSettings: async () => ({}), lstat: async () => { throw new Error('not reached'); }, warnCleanup: () => {},
  } as unknown as InstallUploadedAgentPluginOptional;
  return { required: { archive, expectedSha256, workspaceId: 'ws', actor: 'owner' }, optional, previous, order };
}

test('a rejected update preserves the old revision and never publishes', async () => {
  const f = fixture(true);
  await assert.rejects(installUploadedAgentPlugin({ ...f.required, update: { pluginId: 'demo', expectedOldDigest: 'old' } }, f.optional), { message: 'Rejected update' });
  assert.deepEqual(await f.optional.lifecycle.listInstalledPlugins({ workspaceRoot: '/plugins/ws/ws' }), [{ pluginId: 'demo', archiveDigest: 'old', packageRoot: '/old', version: '1.0.0' }]);
  assert.deepEqual(f.order, []);
});
test('a new upload records OFF before publishing the package', async () => {
  const f = fixture();
  await installUploadedAgentPlugin(f.required, f.optional);
  assert.deepEqual(f.order, ['off', 'publish']);
});

test('bound update refuses a missing settings snapshot before constructing lifecycle', async () => {
  const { bindAgentPluginUpload } = await import('../install-upload.js');
  const f = fixture();
  let constructions = 0;
  const { layout, archiveReader, ...effects } = f.optional;
  delete effects.snapshotSettings;
  const bound = bindAgentPluginUpload({ ...effects, path: { join: (...parts: string[]) => parts.join('/'), relative: () => '' }, archiveReader: () => archiveReader,
    createLifecycle: () => { constructions++; return f.optional.createLifecycle({ layout }, {}); },
  });
  await assert.rejects(bound.installUploadedAgentPlugin({ ...f.required, update: { pluginId: 'demo', expectedOldDigest: 'old' } }, { layout }), /settings snapshot owner/);
  assert.equal(constructions, 0);
});

test('publication waits for publisher identity admission and persists nothing when another family holds the id', async () => {
  const f = fixture();
  const candidateReads: string[] = [];
  const admissions: unknown[] = [];
  const refused = new Error("Duplicate plugin id 'publisher/demo'.");
  let admitted = false;
  const optional: InstallUploadedAgentPluginOptional = {
    ...f.optional,
    readInstallIdentity: async ({ plugin }) => {
      candidateReads.push(plugin.packageRoot);
      return { id: 'publisher/demo', keywords: [], provides: [], warnings: [] };
    },
    lifecycle: {
      ...f.optional.lifecycle,
      setAgentPluginActivation: async (...args) => {
        assert.equal(admitted, true, 'activation write must be inside identity admission');
        return f.optional.lifecycle.setAgentPluginActivation(...args);
      },
    },
    pluginHost: {
      getPlugin: async () => null, findProviders: async () => [], getHostCapability: () => undefined,
      withInstallIdentity: async ({ candidate, run }) => {
        admissions.push(candidate);
        if (admissions.length === 1) throw refused;
        admitted = true;
        try { return await run(); } finally { admitted = false; }
      },
    },
  };
  await assert.rejects(installUploadedAgentPlugin(f.required, optional), error => error === refused);
  assert.deepEqual(f.order, []);
  assert.deepEqual(await f.optional.lifecycle.listInstalledPlugins({ workspaceRoot: '/plugins/ws/ws' }), []);
  const result = await installUploadedAgentPlugin(f.required, optional);
  assert.equal(result.plugin.archiveDigest, f.required.expectedSha256);
  assert.deepEqual(candidateReads, ['/new', '/new']);
  assert.deepEqual(admissions, Array.from({ length: 2 }, () => ({ id: 'publisher/demo', localId: 'demo', family: 'agent-plugin' })));
  assert.deepEqual(f.order, ['off', 'publish']);
  assert.deepEqual(await f.optional.lifecycle.listInstalledPlugins({ workspaceRoot: '/plugins/ws/ws' }), [result.plugin]);
});

test('after a replacement publishes, a quarantined cleanup fault warns without undoing the new revision', async () => {
  const f = fixture(true);
  const cleanup = new Error('old package is busy');
  const calls: unknown[] = [];
  const optional: InstallUploadedAgentPluginOptional = {
    ...f.optional,
    lifecycle: {
      ...f.optional.lifecycle,
      isAgentPluginRecordedAsBundled: async () => false,
      resolveAgentPluginActivation: async () => ({ verdict: 'inactive' }),
      stageForRemoval: async ({ packagesDir, packageRoot }) => {
        calls.push({ packagesDir, packageRoot });
        return { original: packageRoot, quarantined: '/quarantined/old', originalMode: 0o555 };
      },
      restoreStagedTrees: async () => { throw new Error('a published replacement must not restore the old package'); },
      removeFrozenPackageTree: async input => { calls.push(input); throw cleanup; },
    },
    warnCleanup: input => { calls.push(input); },
  };
  const upload = createAgentPluginUpload(optional);
  const result = await upload.installUploadedAgentPlugin({ ...f.required, replace: true });
  assert.deepEqual(result.upgradeFrom, ['1.0.0']);
  assert.equal(result.plugin.archiveDigest, f.required.expectedSha256);
  assert.deepEqual(f.order, ['publish'], 'replacement keeps the previous OFF decision');
  assert.deepEqual(calls, [
    { packagesDir: '/plugins/ws/ws/demo/package/sha256', packageRoot: '/old' },
    { root: '/quarantined/old' }, { pluginId: 'demo', error: cleanup },
  ]);
  assert.deepEqual(await f.optional.lifecycle.listInstalledPlugins({ workspaceRoot: '/plugins/ws/ws' }), [result.plugin]);
});
