import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { LoadedDeployOps } from '../../../index.js';
import { loadDeployOpsRegistry } from '../registry.js';

test('duplicate operation IDs drop all claimants and inactive metadata is not executable', async () => {
  const loaded = ['one', 'two'].map(pluginId => ({ pluginId, descriptor: { id: 'shared' }, module: {} })) as unknown as LoadedDeployOps[];
  const registry = await loadDeployOpsRegistry({ workspaceId: 'ws', sourceRoot: '/bundled',
    bundledContributionSources: () => [{ pluginId: 'one', packageRoot: '/one' }, { pluginId: 'two', packageRoot: '/two' }],
    readTrustedPluginFile: async () => JSON.stringify({ schemaVersion: 1, platforms: [{ id: 'off-host', label: 'Off host', module: 'ops.mjs', hosts: ['api.example.com'] }] }),
    loadContributions: async (_input, options) => { await options.onInactive({ plugin: { pluginId: 'off', packageRoot: '/off' } }); return { items: loaded, refusals: [] }; },
    warn: error => { throw error; },
  });
  assert.equal(registry.get('shared'), undefined); assert.deepEqual(registry.list(), []);
  assert.deepEqual(registry.refusals, ["deploy ops platform 'shared' was not loaded: declared more than once"]);
  assert.equal(registry.get('off-host'), undefined);
  assert.equal(registry.switchedOff?.get('off-host'), 'off');
});
