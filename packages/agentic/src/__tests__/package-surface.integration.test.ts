import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import * as install from '../skills/install/index.js';
import { createNodeSkillFilesystem } from '../skills/install/node-filesystem.js';

test('skill policy and filesystem entries expose their intended barrels and Node runtimes', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  for (const [entry, target] of [
    ['./skills/install', './dist/skills/install/index'],
    ['./skills/install/node', './dist/skills/install/node-filesystem'],
  ] as const) {
    assert.deepEqual(manifest.exports[entry], { types: `${target}.d.ts`, import: `${target}.js`, default: `${target}.js` });
    assert.equal(manifest.jini.entries[entry], 'node');
  }
  for (const name of ['createSkillLayout', 'createSkillInstaller', 'createLiveSkillRegistration', 'createSkillRefresher', 'createSkillRefreshMiddleware', 'createSkillFetchAdapter']) {
    assert.equal(typeof Reflect.get(install, name), 'function', name);
  }
  assert.equal(typeof createNodeSkillFilesystem({}).readFile, 'function');
  assert.equal(install.createNodeSkillFilesystem, createNodeSkillFilesystem);
});


