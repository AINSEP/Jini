/** Q2 (owner answer 2026-11-15) froze the `sqlite` and `infra` compatibility forwarders and excused their five
 * package edges. The owner's retire order (2026-11-22) deleted both forwarders (RT-1, RT-2), so the gate excuses
 * nothing. An exception for a deleted forwarder must not come back to excuse a re-added one, and the shims' own
 * edges must surface again if anyone restores them. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkPackageLayers } from '../check-package-layers.js';
import { loadDebt, loadExceptions } from '../lib/injection-debt.js';
import { REPO_ROOT } from '../lib/walk-imports.js';

const COPIED = ['core', 'protocol', 'db', 'infra'];
const L5 = 'L5-injected-edge';
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jini-q2-exceptions-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'injection-exceptions.json'), JSON.stringify({ exceptions: [] }));
  for (const name of COPIED) {
    mkdirSync(join(root, 'packages', name), { recursive: true });
    cpSync(join(REPO_ROOT, 'packages', name, 'package.json'), join(root, 'packages', name, 'package.json'));
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('Q2 forwarders retired from scripts/injection-exceptions.json', () => {
  it('lists no exception at all, and keeps the rule that one is never added to silence the gate', () => {
    expect(loadExceptions({ root: REPO_ROOT })).toEqual([]);
    const text = readFileSync(join(REPO_ROOT, 'scripts', 'injection-exceptions.json'), 'utf8');
    expect(text).toContain('never add one to silence the gate');
  });

  it('keeps no sqlite or infra allowance in the debt baseline', () => {
    expect(loadDebt({ root: REPO_ROOT }).filter(entry => /^packages\/(sqlite|infra)\//.test(entry.file))).toEqual([]);
  });

  it('leaves no workspace, shim source or surface baseline for either retired forwarder', () => {
    expect(existsSync(join(REPO_ROOT, 'packages', 'sqlite'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'api-baseline', 'jini-ai__sqlite.json'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'packages', 'infra', 'src', 'db'))).toBe(false);
  });

  it('surfaces a re-added infra db shim as an L5 edge now that no exception excuses it', () => {
    const shim = join(root, 'packages', 'infra', 'src', 'db', 'sqlite', 'index.ts');
    mkdirSync(dirname(shim), { recursive: true });
    writeFileSync(shim, "export { openSqliteConnection } from '@jini-ai/db/sqlite';\n");
    const manifest = JSON.parse(readFileSync(join(root, 'packages', 'infra', 'package.json'), 'utf8'));
    manifest.peerDependencies = { '@jini-ai/db': '^0.7.0' };
    writeFileSync(join(root, 'packages', 'infra', 'package.json'), JSON.stringify(manifest));
    const found = checkPackageLayers({ repoRoot: root }, { warn: () => undefined, debtBase: () => null })
      .filter(violation => violation.rule === L5 && violation.file.startsWith('packages/infra/'));
    expect(found.length).toBeGreaterThan(0);
  });
});
