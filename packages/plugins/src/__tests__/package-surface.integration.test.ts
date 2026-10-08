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
