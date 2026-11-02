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

test('renderers can resolve handle helpers without the core barrel', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.exports['./core/handle'], {
    types: './dist/core/handle.d.ts', import: './dist/core/handle.js', default: './dist/core/handle.js',
  });
  assert.equal(manifest.jini.entries['./core/handle'], 'universal');
  // Exercise the consumer's package boundary, rather than a relative source import.
  const entry = '@jini-ai/agentic/core/handle';
  const { agentHandleSegment, agentHandle } = await import(entry);
  assert.equal(agentHandleSegment({ value: 'a:b' }), 'h-e661911904a01160');
  assert.deepEqual(agentHandle({ handle: 'menu-home' }), { 'data-agent-element': 'menu-home' });
});


