import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import { parseAgentPluginManifest } from '../../lifecycle/manifest.js';
import { readInstalledAgentPluginIdentity } from '../../lifecycle/host-tools/index.js';
import { AgentPluginUpdateError } from '../../lifecycle/index.js';
import { createAgentPluginSiteLayout } from '../../lifecycle/layout.js';
import { installUploadedAgentPlugin, type InstallUploadedAgentPluginOptional } from '../install-upload.js';

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
