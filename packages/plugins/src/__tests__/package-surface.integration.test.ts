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


