/** Q2 (owner answer 2026-11-15) froze the `sqlite` and `infra` compatibility forwarders; the owner's retire
 * order (2026-11-22, RT-1) deleted `sqlite`, so the gate now excuses only infra's one edge. Each remaining exception
 * must be load-bearing, and an exception for a deleted forwarder must not come back to excuse a re-added one. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkPackageLayers } from '../check-package-layers.js';
import { loadDebt, loadExceptions, type InjectionException } from '../lib/injection-debt.js';
import { REPO_ROOT } from '../lib/walk-imports.js';

const Q2_EDGES = [
  { owner: 'infra', target: 'db', specGlob: '@jini-ai/db' },
];
const COPIED = ['core', 'protocol', 'chat', 'daemon', 'db', 'registry', 'infra'];
const L5 = 'L5-injected-edge';
let root: string;

const edgeKey = (item: { owner: string; target: string; specGlob: string }): string => `${item.owner}>${item.target}:${item.specGlob}`;
const l5Files = (): string[] => checkPackageLayers({ repoRoot: root }, { warn: () => undefined, debtBase: () => null })
  .filter(violation => violation.rule === L5 && /^packages\/(sqlite|infra)\//.test(violation.file)).map(violation => violation.file).sort();
const writeExceptions = (items: readonly InjectionException[]): void =>
  writeFileSync(join(root, 'scripts', 'injection-exceptions.json'), JSON.stringify({ exceptions: items }));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jini-q2-exceptions-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const name of COPIED) {
    mkdirSync(join(root, 'packages', name), { recursive: true });
    cpSync(join(REPO_ROOT, 'packages', name, 'package.json'), join(root, 'packages', name, 'package.json'));
  }
  for (const file of ['packages/infra/src/db/driver/index.ts', 'packages/infra/src/db/sqlite/index.ts']) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(join(REPO_ROOT, file), join(root, file));
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('Q2 frozen forwarders in scripts/injection-exceptions.json', () => {
  const real = loadExceptions({ root: REPO_ROOT });

  it('lists exactly the infra package edge, each with the owner question, approval date and removal note', () => {
    expect(real.map(edgeKey).sort()).toEqual(Q2_EDGES.map(edgeKey).sort());
    for (const item of real) {
      expect(item.ownerQuestion).toBe('Q2');
      expect(item.approved).toBe('2026-11-15');
      expect(item.note).toMatch(/next major/);
    }
  });

  it('keeps no sqlite or infra allowance in the debt baseline (the exceptions cover them; a stale allowance fails the gate)', () => {
    const leftover = loadDebt({ root: REPO_ROOT }).filter(entry => /^packages\/(sqlite|infra)\//.test(entry.file));
    expect(leftover).toEqual([]);
  });

  it('keeps no exception, workspace or surface baseline for the deleted sqlite forwarder', () => {
    expect(real.filter(item => item.owner === 'sqlite')).toEqual([]);
    expect(existsSync(join(REPO_ROOT, 'packages', 'sqlite'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'api-baseline', 'jini-ai__sqlite.json'))).toBe(false);
  });

  it('excuses every infra edge of the real manifests and sources when its exception is present', () => {
    writeExceptions(real);
    expect(l5Files()).toEqual([]);
  });

  it.each(Q2_EDGES.map(edge => [edgeKey(edge), edge] as const))('%s is load-bearing: removing it surfaces the edge', (_name, edge) => {
    writeExceptions(real.filter(item => edgeKey(item) !== edgeKey(edge)));
    const found = l5Files();
    expect(found.length).toBeGreaterThan(0);
    expect(found.every(file => file.startsWith(`packages/${edge.owner}/`))).toBe(true);
  });

  it('keeps the rule that an exception is never added to silence the gate, and no longer says the forwarders are deleted', () => {
    const text = readFileSync(join(REPO_ROOT, 'scripts', 'injection-exceptions.json'), 'utf8');
    expect(text).toContain('never add one to silence the gate');
    expect(text).not.toMatch(/deleted in lane R13/);
  });
});
