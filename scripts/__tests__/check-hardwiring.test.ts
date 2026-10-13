import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectHardwiring } from '../check-hardwiring.js';
import ts from 'typescript';
import { createHardwiringInspector, diffHardwiringDebt, type HardwiringViolation } from '../../packages/devops/src/checks/hardwiring.js';

test('boot identity waiver retains exact file, fingerprint and occurrence count', () => {
  const file = 'packages/platform/src/fs/boot-identity.ts';
  const baseline = (JSON.parse(readFileSync(new URL('../hardwiring-debt.json', import.meta.url), 'utf8')) as {
    violations: HardwiringViolation[];
  }).violations.filter(v => v.file === file);
  assert.deepEqual(baseline, [{
    rule: 'HW3-module-state', file, line: 5,
    fingerprint: '3673014e72b67383be302485694555a57ad393afdebaed6ded110a775bd0556d',
    reason: 'Process-lifetime kernel boot identity; no tenant state; injected override retained.',
  }]);
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  const inspector = createHardwiringInspector({ compiler: ts });
  const current = inspector.inspect({ file, source, mode: 'jini', server: true });
  assert.equal(current.length, 1);
  assert.deepEqual(diffHardwiringDebt({ baseline, current }).added, []);
  // Moving/renaming the state or adding another occurrence must never inherit this approval.
  const moved = inspector.inspect({ file: 'packages/platform/src/fs/other.ts', source, mode: 'jini', server: true });
  assert.deepEqual(diffHardwiringDebt({ baseline, current: moved }).added, moved);
  const renamed = inspector.inspect({ file, source: source.replaceAll('cached', 'tenantCache'), mode: 'jini', server: true });
  assert.equal(renamed.length, 1);
  assert.deepEqual(diffHardwiringDebt({ baseline, current: renamed }).added, renamed);
  assert.deepEqual(diffHardwiringDebt({ baseline, current: [...current, ...current] }).added, current);
  const expanded = inspector.inspect({ file, source: `${source}\nlet tenantCache;`, mode: 'jini', server: true });
  assert.equal(expanded.length, 2);
  assert.deepEqual(diffHardwiringDebt({ baseline, current: expanded }).added, [expanded[1]]);
});

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
