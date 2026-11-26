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
