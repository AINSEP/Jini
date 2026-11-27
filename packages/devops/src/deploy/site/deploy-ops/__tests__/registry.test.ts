import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { LoadedDeployOps } from '../../../index.js';
import { loadDeployOpsRegistry, loadBundledDeployOpsRegistry, readBundledDeployOpsDescriptors } from '../registry.js';

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

const descriptor = { id: 'cloud', label: 'Cloud', module: 'ops.mjs', hosts: ['api.example.com'] };
const alternate = { id: 'other', label: 'Other', module: 'other.mjs', hosts: ['other.example.com'] };
const manifest = (...platforms: typeof descriptor[]) => JSON.stringify({ schemaVersion: 1, platforms });
const plugins = ['one', 'two', 'bad', 'unreadable'].map(pluginId => ({ pluginId, packageRoot: '/bundled/' + pluginId }));
const bundledContributionSources: Parameters<typeof loadBundledDeployOpsRegistry>[0]['bundledContributionSources'] = input => {
  assert.deepEqual(input, { sourceRoot: '/bundled', filename: 'jini-deploy-ops.json' });
  return plugins;
};

test('bundled execution rejects a duplicated platform but keeps peers and source refusals', async () => {
  const module: LoadedDeployOps['module'] = {
    status: async () => { throw new Error('discovery must not call status'); },
    logs: async () => { throw new Error('discovery must not call logs'); },
  };
  const registry = await loadBundledDeployOpsRegistry({ sourceRoot: '/bundled', bundledContributionSources,
    loadPluginContributionsFromSource: async ({ plugin, definition, onReadError, importRefusalReason, importErrorReason }) => {
      const { pluginId } = plugin;
      assert.equal(definition.filename, 'jini-deploy-ops.json');
      assert.deepEqual([importRefusalReason, importErrorReason], ['module could not be imported', 'module could not be read or imported']);
      if (pluginId === 'unreadable') return { items: [], refusals: onReadError({ plugin }) };
      if (pluginId === 'bad') {
        const reason = definition.validate({ exported: {} });
        if (typeof reason !== 'string') assert.fail('missing operations should be rejected');
        return { items: [], refusals: [definition.refusal({ descriptor: { ...descriptor, id: 'broken' }, reason })] };
      }
      const parsed = definition.parse({ raw: manifest(...(pluginId === 'one' ? [descriptor, alternate] : [descriptor])) });
      if (!parsed.ok) assert.fail(parsed.reason);
      assert.equal(definition.modulePath({ descriptor: alternate }), 'other.mjs');
      assert.equal(definition.validate({ exported: module }), module);
      return { items: parsed.descriptors.map(descriptor => ({ pluginId, descriptor, module })), refusals: [] };
    },
  });
  assert.deepEqual(registry.list(), [{ descriptor: alternate, pluginId: 'one', module }]);
  assert.equal(registry.get('cloud'), undefined);
  assert.equal(registry.get('other')?.module, module);
  assert.deepEqual(registry.refusals, [
    "deploy ops platform 'broken' was not loaded: module must export status() and logs()",
    "deploy ops from 'unreadable' were not loaded: jini-deploy-ops.json could not be read",
    "deploy ops platform 'cloud' was not loaded: declared more than once",
  ]);
});

test('data-only discovery isolates malformed and unreadable files and omits ambiguous platform ids', () => {
  const readFileSync = ((file: string, encoding: string) => {
    assert.equal(encoding, 'utf8');
    switch (file) {
      case '/bundled/one/jini-deploy-ops.json': return manifest(descriptor, alternate);
      case '/bundled/two/jini-deploy-ops.json': return manifest(descriptor);
      case '/bundled/bad/jini-deploy-ops.json': return '{';
      case '/bundled/unreadable/jini-deploy-ops.json': throw new Error('no such file');
      default: return assert.fail(`unexpected path ${file}`);
    }
  }) as Parameters<typeof readBundledDeployOpsDescriptors>[0]['readFileSync'];
  assert.deepEqual(readBundledDeployOpsDescriptors({ sourceRoot: '/bundled', bundledContributionSources, readFileSync }), [alternate]);
});

test('an installed discovery failure warns and refuses instead of serving bundled modules', async () => {
  const error = new Error('installed directory not readable');
  const warnings: unknown[] = [];
  const registry = await loadDeployOpsRegistry({ workspaceId: 'ws-b', sourceRoot: '/bundled', bundledContributionSources,
    readTrustedPluginFile: async () => assert.fail('must not read a package after discovery fails'),
    loadContributions: async ({ workspaceId, onReadError }, options) => {
      assert.equal(workspaceId, 'ws-b');
      assert.equal(options.packageRefusal({ plugin: { pluginId: 'one', packageRoot: '/installed/one' } }), undefined);
      const outsider = { pluginId: 'third-party', packageRoot: '/installed/outsider' };
      assert.equal(options.packageRefusal({ plugin: outsider }), "deploy ops from 'third-party' were not loaded: only bundled plugins shipping jini-deploy-ops.json may contribute");
      assert.deepEqual(onReadError({ plugin: outsider }), ["deploy ops from 'third-party' were not loaded: jini-deploy-ops.json could not be read"]);
      throw error;
    },
    warn: failure => { warnings.push(failure); },
  });
  assert.deepEqual(warnings, [error]);
  assert.deepEqual(registry.list(), []);
  assert.deepEqual(registry.refusals, ['deploy ops were not loaded: installed plugin packages could not be read']);
});
