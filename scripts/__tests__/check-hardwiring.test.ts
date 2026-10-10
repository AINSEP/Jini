import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectHardwiring } from '../check-hardwiring.js';

test('Jini guard scans nested package source and excludes tests; clean DI does not add debt', () => {
  const root = mkdtempSync(join(tmpdir(), 'jini-hardwiring-'));
  try {
    const dir = join(root, 'packages/family/domain');
    mkdirSync(join(dir, 'src/__tests__'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@jini-ai/fixture', jini: { runtime: 'node' } }));
    const service = join(dir, 'src/service.ts');
    writeFileSync(service, 'export function load() { return fetch(url); }');
    writeFileSync(join(dir, 'src/__tests__/fixture.ts'), 'let cache = 0; process.env.KEY;');
    assert.deepEqual(collectHardwiring({ repoRoot: root }).map((v) => [v.rule, v.file]), [['HW4-injected-fetch', 'packages/family/domain/src/service.ts']]);
    writeFileSync(service, 'export function load({ fetch = globalThis.fetch }, options = {}) { return fetch(url); }');
    assert.deepEqual(collectHardwiring({ repoRoot: root }), []);
    writeFileSync(join(dir, 'src/worker.mjs'), 'export function run() { return fetch(url); }');
    assert.deepEqual(collectHardwiring({ repoRoot: root }).map((v) => [v.rule, v.file]), [['HW4-injected-fetch', 'packages/family/domain/src/worker.mjs']]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Jini package imports cannot connect site and agent plugin owners', () => {
  const root = mkdtempSync(join(tmpdir(), 'jini-plugin-hardwiring-'));
  try {
    const dir = join(root, 'packages/plugins');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@jini-ai/plugins', jini: { runtime: 'node' } }));
    const file = join(dir, 'src/entry.ts');
    writeFileSync(file, 'import type { Manifest } from "@jini-ai/agent-plugins";');
    assert.deepEqual(collectHardwiring({ repoRoot: root }).map((v) => v.rule), ['HW9-plugin-import']);
    writeFileSync(file, 'import type { Port } from "@jini-ai/core";');
    assert.deepEqual(collectHardwiring({ repoRoot: root }), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
