import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { LoadedDeployTarget } from '../types.js';
import { loadDeployTargetRegistry, loadInstalledDeployTargets, loadBundledDeployTargetRegistry, loadDeployTargetRegistryFromSource } from '../registry.js';

test('disabled metadata is discoverable without executable registry admission', async () => {
  const descriptor = { id: 'host', label: 'Host' } as LoadedDeployTarget['descriptor'];
  const inventory = await loadInstalledDeployTargets({ workspaceId: 'ws', readEnabled: async () => false,
    loadContributions: async ({ definition }, options) => {
      assert.deepEqual(options, { requireActive: false, orderByPluginId: true });
      return { items: [await definition.load({ plugin: { pluginId: 'off', packageRoot: '/off' }, descriptor })], refusals: [] };
    },
  });
  assert.deepEqual(inventory.items, [{ descriptor, pluginId: 'off', enabled: false }]);
  const executable = await loadDeployTargetRegistry({ workspaceId: 'ws', loadContributions: async (_input, options) => {
    assert.deepEqual(options, { orderByPluginId: true }); return { items: [], refusals: ['off'] };
  } });
  assert.deepEqual(executable.list(), []); assert.deepEqual(executable.refusals, ['off']);
});

test('duplicate target IDs drop every claimant', async () => {
  const loaded = ['first', 'second'].map(pluginId => ({ pluginId, descriptor: { id: 'shared' }, module: {} })) as LoadedDeployTarget[];
  const registry = await loadDeployTargetRegistry({ workspaceId: 'ws', loadContributions: async () => ({ items: loaded, refusals: [] }) });
  assert.deepEqual(registry.list(), []); assert.equal(registry.get('shared'), undefined);
  assert.deepEqual(registry.refusals, ["deploy target 'shared' was not loaded: more than one plugin declares it ('first', 'second')"]);
});

test('bundled target loading passes the trusted contribution definition', async () => {
  const registry = await loadBundledDeployTargetRegistry({ sourceRoot: '/bundled',
    bundledContributionSources: () => [{ pluginId: 'hosting', packageRoot: '/bundled/hosting' }],
    loadPluginContributionsFromSource: async ({ plugin, definition }) => {
      assert.equal(plugin.pluginId, 'hosting');
      assert.equal(definition.filename, 'jini-deploy-targets.json');
      assert.equal(typeof definition.parse, 'function');
      assert.equal(typeof definition.validate, 'function');
      return { items: [], refusals: [] };
    },
  });
  assert.deepEqual(registry.list(), []);
});

test('source loading keeps valid targets and phrases an invalid module refusal with its owner', async () => {
  const plugin = { pluginId: 'publisher', packageRoot: '/fixtures/publisher' };
  const descriptor = { id: 'docs-host', label: 'Docs Host', module: 'deploy.mjs', configFields: [] };
  const registry = await loadDeployTargetRegistryFromSource({
    plugin,
    loadPluginContributionsFromSource: async input => {
      assert.deepEqual(input.plugin, plugin);
      const { definition } = input;
      assert.deepEqual(definition.parse({ raw: JSON.stringify({ schemaVersion: 1, targets: [descriptor] }) }),
        { ok: true, descriptors: [descriptor] });
      assert.equal(definition.modulePath({ descriptor }), 'deploy.mjs');
      const rejected = { ...descriptor, id: 'broken-host', module: 'broken.mjs' };
      const reason = definition.validate({ exported: {} });
      if (typeof reason !== 'string') assert.fail('a module without create was admitted');
      const module: LoadedDeployTarget['module'] = { create: () => { throw new Error('discovery must not deploy'); } };
      assert.equal(definition.validate({ exported: module }), module);
      return { items: [{ pluginId: plugin.pluginId, descriptor, module }], refusals: [definition.refusal({ plugin, descriptor: rejected, reason })] };
    },
  });
  assert.deepEqual(registry.list().map(item => item.descriptor), [descriptor]);
  assert.equal(registry.get('docs-host')?.pluginId, 'publisher');
  assert.deepEqual(registry.refusals, ["deploy target 'broken-host' from 'publisher' was not loaded: its module has no create() function"]);
});
