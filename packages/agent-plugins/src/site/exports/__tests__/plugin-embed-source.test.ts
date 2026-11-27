import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseAgentPluginManifest } from '../../../lifecycle/manifest.js';
import { createPluginExportSource } from '../source.js';

test('inactive export metadata is admitted only through the digest gate and active discovery stays separate', async () => {
  const calls: boolean[] = []; const read: string[] = [];
  const source = createPluginExportSource({
    lifecycle: { findTrustedPluginPackages: async input => { calls.push(input.requireActive!); return input.requireActive ? [] : [{ trusted: { pluginId: 'demo', packageRoot: '/demo' } }, { refusal: 'untrusted' }]; },
      readTrustedPluginFile: async ({ plugin }) => { read.push(plugin.pluginId); return JSON.stringify({ '$schema': 'https://agent-plugins.org/schemas/1.1.0/plugin.schema.json', name: 'demo', description: 'Demo', extensions: { jini: { id: 'publisher/demo', exports: {} } } }); },
      assertContainedOnDisk: async () => { throw new Error('no asset read expected'); },
    }, parseAgentPluginManifest, readAssetFile: async () => { throw new Error('no asset read expected'); },
  });
  const packages = await source.list({ workspaceId: 'ws' });
  assert.deepEqual(calls, [false, true]); assert.deepEqual(read, ['demo']);
  assert.equal(packages.length, 1); assert.equal(packages[0]!.id, 'publisher/demo'); assert.equal(packages[0]!.enabled, false);
});

test('isolates manifest faults and reads PNG bytes only through the lifecycle containment gate', async () => {
  const good = { pluginId: 'gallery', packageRoot: '/trusted/gallery' };
  const malformed = { pluginId: 'broken', packageRoot: '/trusted/broken' };
  const anonymous = { pluginId: 'legacy', packageRoot: '/trusted/legacy' };
  const contained = '/canonical/gallery/exports/logo.png';
  const png = Uint8Array.of(137, 80, 78, 71, 255);
  const reads: unknown[] = [];
  const baseManifest = { '$schema': 'https://agent-plugins.org/schemas/1.1.0/plugin.schema.json', description: 'Export demo' };
  const source = createPluginExportSource({
    lifecycle: {
      findTrustedPluginPackages: async ({ workspaceId, requireActive }) => {
        assert.equal(workspaceId, 'site-gallery');
        return (requireActive ? [good] : [malformed, anonymous, good]).map(trusted => ({ trusted }));
      },
      readTrustedPluginFile: async ({ plugin, filename }) => {
        reads.push({ plugin, filename });
        if (filename === 'exports/card.html' && plugin === good) return '<figure>Gallery</figure>';
        assert.equal(filename, 'plugin.json');
        if (plugin === malformed) return '{';
        if (plugin === anonymous) return JSON.stringify({ ...baseManifest, name: 'legacy' });
        return JSON.stringify({ ...baseManifest, name: 'gallery', extensions: { jini: { id: 'acme/gallery', displayName: 'Gallery' } } });
      },
      assertContainedOnDisk: async (input) => {
        reads.push(input);
        return contained;
      },
    },
    parseAgentPluginManifest,
    readAssetFile: async file => {
      reads.push(file);
      return png;
    },
  });
  const packages = await source.list({ workspaceId: 'site-gallery' });
  assert.deepEqual(packages.map(({ id, displayName, enabled, exports }) => ({ id, displayName, enabled, exports })),
    [{ id: 'acme/gallery', displayName: 'Gallery', enabled: true, exports: {} }]);
  assert.equal(await source.readFile({ plugin: good, filename: 'exports/card.html' }), '<figure>Gallery</figure>');
  assert.equal(await source.readAsset({ plugin: good, filename: 'exports/card.html' }), '<figure>Gallery</figure>');
  assert.deepEqual(await source.readAsset({ plugin: good, filename: 'exports/logo.png' }), png);
  assert.deepEqual(reads, [
    { plugin: malformed, filename: 'plugin.json' }, { plugin: anonymous, filename: 'plugin.json' }, { plugin: good, filename: 'plugin.json' },
    { plugin: good, filename: 'exports/card.html' }, { plugin: good, filename: 'exports/card.html' },
    { packageRoot: '/trusted/gallery', entryPath: 'exports/logo.png' }, contained,
  ]);
});
