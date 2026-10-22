import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import * as glue from '../glue/index.js';

test('the universal glue entry exposes all extracted attachment and dispatch APIs', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.exports['./glue'], {
    types: './dist/glue/index.d.ts', import: './dist/glue/index.js', default: './dist/glue/index.js',
  });
  assert.equal(manifest.jini.entries['./glue'], 'universal');
  for (const name of ['validateGlueManifest', 'resolveCallSiteDispatch', 'dispatchGlueAttachment', 'buildGlueCapabilityGate', 'attachGlueContentLifecycle', 'subscribeGlueEvent', 'mergeGlueToolRegistrations']) {
    assert.equal(typeof Reflect.get(glue, name), 'function', name);
  }
});



test('host entries publish independent runtime surfaces with optional host peers', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.private, undefined);
  assert.deepEqual(manifest.publishConfig, { access: 'public', registry: 'https://registry.npmjs.org' });
  for (const [entry, runtime] of [['./host', 'universal'], ['./host/node', 'node'], ['./host/worker', 'node'], ['./host/sql', 'node']]) {
    assert.deepEqual(manifest.exports[entry!], {
      types: `./dist/${entry!.slice(2)}/index.d.ts`, import: `./dist/${entry!.slice(2)}/index.js`, default: `./dist/${entry!.slice(2)}/index.js`,
    });
    assert.equal(manifest.jini.entries[entry!], runtime);
  }
  // Host activation and quarantine call core's shared clock; adapter peers remain host choices.
  assert.deepEqual(manifest.dependencies, { '@jini-ai/core': 'workspace:^' });
  assert.equal(Object.hasOwn(manifest.peerDependencies, '@jini-ai/core'), false);
  assert.equal(Object.hasOwn(manifest.peerDependenciesMeta, '@jini-ai/core'), false);
  for (const peer of ['semver', 'kysely', '@jini-ai/db']) assert.equal(manifest.peerDependenciesMeta[peer].optional, true);
});

test('each host entry barrel re-exports the runtime APIs its package.json entry promises', async () => {
  const host = await import('../host/index.js');
  for (const name of ['validateManifest', 'createHookRegistry', 'resolvePluginConflicts', 'uninstallPlugin', 'previewUninstallPlugin', 'canonicalizePluginManifest', 'pluginCapabilitySet', 'InMemoryPluginActivationRepo', 'PluginHookFailedError']) {
    assert.equal(typeof Reflect.get(host, name), 'function', `./host ${name}`);
  }
  assert.equal(host.PLUGIN_MANIFEST_FILENAME, 'jini.plugin.json');
  const node = await import('../host/node/index.js');
  for (const name of ['discoverPlugins', 'loadPlugin', 'installSitePlugin', 'snapshotSitePluginPackage', 'snapshotPluginModuleGraph', 'createPluginSourceService', 'admitBrowserProviderAssets', 'readPluginPackageFiles']) {
    assert.equal(typeof Reflect.get(node, name), 'function', `./host/node ${name}`);
  }
  assert.equal(Reflect.has(node, 'readNoFollowFlags'), false, 'the open-flag helper stays internal to the node tier');
  const worker = await import('../host/worker/index.js');
  for (const name of ['createTier2ImportSeam', 'decodeTier2Reply', 'runTier2Call']) assert.equal(typeof Reflect.get(worker, name), 'function', `./host/worker ${name}`);
  const sqlEntry = await import('../host/sql/index.js');
  for (const name of ['SqlPluginActivationRepo', 'pluginActivationRepoFor', 'toActivationRecord', 'toActivationRow']) {
    assert.equal(typeof Reflect.get(sqlEntry, name), 'function', `./host/sql ${name}`);
  }
});
