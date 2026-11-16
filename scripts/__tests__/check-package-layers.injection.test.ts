/** Fixture tests for the injection rules (L5 base-only edges, L6 base purity, L7 CSS tokens) and the
 * debt ratchet. Each test builds one isolated fixture tree; none touches the real workspace. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkPackageLayers } from '../check-package-layers.js';
import { loadDebt, loadExceptions, specMatches } from '../lib/injection-debt.js';
import { importSites } from '../lib/import-sites.js';
import { REPO_ROOT } from '../lib/walk-imports.js';

let root: string;
const put = (file: string, content: string | object): void => {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
};
const manifest = (name: string, extra: object = {}): void => put(`packages/${name}/package.json`, { name: `@jini-ai/${name}`, ...extra });
const gate = (warnings: string[] = []): string[] => checkPackageLayers({ repoRoot: root }, { warn: message => warnings.push(message) })
  .map(violation => `${violation.rule} ${violation.file}`).sort();
const debt = (...entries: object[]): void => put('scripts/injection-debt.json', { entries: entries.map(entry => ({ lane: 'T', count: 1, ...entry })) });
const L5 = 'L5-injected-edge';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jini-injection-test-'));
  manifest('core');
  manifest('protocol');
  manifest('platform');
  manifest('devops');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('L5-injected-edge', () => {
  beforeEach(() => manifest('daemon', { dependencies: { '@jini-ai/core': '*', '@jini-ai/protocol': '*' } }));

  it('passes imports of core and protocol, value and type alike', () => {
    put('packages/daemon/src/a.ts', "import { x } from '@jini-ai/core/records'; import type { Y } from '@jini-ai/protocol'; export { x };");
    expect(gate()).toEqual([]);
  });

  it('fails a value import of another package', () => {
    manifest('daemon', { dependencies: { '@jini-ai/core': '*', '@jini-ai/platform': '*' } });
    put('packages/daemon/src/a.ts', "import { run } from '@jini-ai/platform/fs'; export { run };");
    expect(gate()).toEqual([`${L5} packages/daemon/package.json`, `${L5} packages/daemon/src/a.ts`]);
  });

  it('fails a type-only import, a re-export, a dynamic import, a require and an import() type', () => {
    manifest('daemon', { dependencies: { '@jini-ai/platform': '*' } });
    put('packages/daemon/src/a.ts', [
      "import type { T } from '@jini-ai/platform/fs';", "export { U } from '@jini-ai/platform/fs';",
      "const d = import('@jini-ai/platform/fs');", "const r = require('@jini-ai/platform/fs');",
      "type V = import('@jini-ai/platform/fs').V;",
    ].join('\n'));
    const found = gate().filter(line => line.endsWith('a.ts'));
    expect(found).toHaveLength(5);
  });

  it('fails a manifest peer declaration', () => {
    manifest('daemon', { peerDependencies: { '@jini-ai/platform': '*' } });
    expect(gate()).toEqual([`${L5} packages/daemon/package.json`]);
  });

  it('passes a debt hit, fails a higher count, and warns on a lower count', () => {
    manifest('daemon', { dependencies: { '@jini-ai/platform': '*' } });
    put('packages/daemon/src/a.ts', "import { a } from '@jini-ai/platform/fs'; import { b } from '@jini-ai/platform/fs'; export { a, b };");
    const manifestKey = { rule: L5, file: 'packages/daemon/package.json', spec: '@jini-ai/platform', kind: 'manifest-dependencies' };
    const sourceKey = { rule: L5, file: 'packages/daemon/src/a.ts', spec: '@jini-ai/platform/fs', kind: 'import' };
    debt(manifestKey, { ...sourceKey, count: 2 });
    expect(gate()).toEqual([]);
    debt(manifestKey, sourceKey);
    expect(gate()).toEqual([`${L5} packages/daemon/src/a.ts`]);
    debt(manifestKey, { ...sourceKey, count: 3 });
    const warnings: string[] = [];
    expect(gate(warnings)).toEqual([]);
    expect(warnings.join('\n')).toContain('stale');
  });

  it('keys debt by file, specifier and kind, not by line', () => {
    manifest('daemon', { dependencies: { '@jini-ai/platform': '*' } });
    put('packages/daemon/src/a.ts', "\n\n\nimport { a } from '@jini-ai/platform/fs'; export { a };");
    debt({ rule: L5, file: 'packages/daemon/package.json', spec: '@jini-ai/platform', kind: 'manifest-dependencies' },
      { rule: L5, file: 'packages/daemon/src/a.ts', spec: '@jini-ai/platform/fs', kind: 'import' });
    expect(gate()).toEqual([]);
  });

  it('passes an edge named in injection-exceptions.json', () => {
    manifest('daemon', { dependencies: { '@jini-ai/platform': '*' } });
    put('packages/daemon/src/a.ts', "import { a } from '@jini-ai/platform/fs'; export { a };");
    put('scripts/injection-exceptions.json', { exceptions: [{ owner: 'daemon', target: 'platform', specGlob: '@jini-ai/platform', ownerQuestion: 'Q0', approved: '2026-11-15', note: 'fixture' }] });
    expect(gate()).toEqual([]);
  });

  it('fails a plugin payload .mjs, a .d.ts and a JSDoc import()', () => {
    manifest('agent-plugins', { dependencies: { '@jini-ai/core': '*' } });
    put('packages/agent-plugins/foo/x.mjs', "import { d } from '@jini-ai/devops/deploy';\n/** @type {import('@jini-ai/devops/deploy').T} */\nexport const t = d;");
    put('packages/agent-plugins/foo/x.d.ts', "export type { T } from '@jini-ai/devops/deploy';");
    expect(gate().sort()).toEqual([`${L5} packages/agent-plugins/foo/x.d.ts`, `${L5} packages/agent-plugins/foo/x.mjs`, `${L5} packages/agent-plugins/foo/x.mjs`]);
  });

  it('lets a host preset import anything but lets nothing import a host preset', () => {
    manifest('server', { dependencies: { '@jini-ai/daemon': '*' } });
    put('packages/server/src/a.ts', "import { d } from '@jini-ai/daemon'; export { d };");
    expect(gate()).toEqual([]);
    manifest('daemon', { dependencies: { '@jini-ai/core': '*', '@jini-ai/server': '*' } });
    put('packages/daemon/src/b.ts', "import { s } from '@jini-ai/server'; export { s };");
    expect(gate()).toContain(`${L5} packages/daemon/src/b.ts`);
  });

  it('reports test-only cross-package imports as advisory, never failing; /testing and /conformance are allowed', () => {
    manifest('daemon', { dependencies: { '@jini-ai/core': '*' }, devDependencies: { '@jini-ai/platform': '*' } });
    put('packages/daemon/src/__tests__/a.test.ts', "import { f } from '@jini-ai/platform/fs'; import { g } from '@jini-ai/platform/testing'; import { h } from '@jini-ai/devops/conformance'; export { f, g, h };");
    const warnings: string[] = [];
    expect(gate(warnings)).toEqual([]);
    expect(warnings).toEqual(['injection advisory: 1 test-only cross-package imports in 1 files (not failing)']);
  });
});

describe('L6-base-purity', () => {
  it.each([
    ['a Node built-in', "import { readFileSync } from 'node:fs'; export { readFileSync };"],
    ['a bare Node built-in', "import path from 'path'; export { path };"],
    ['a runtime dependency import', "import z from 'express'; export { z };"],
    ['a process read', 'export const home = process.env.HOME;'],
    ['a window read', 'export const href = window.location.href;'],
    ['a module-scope let', 'export let counter = 0;'],
    ['a module Map that is written later', 'const cache = new Map<string, number>(); export function put(k: string): void { cache.set(k, 1); }'],
    ['a direct timer call', 'export function later(): void { setTimeout(() => undefined, 1); }'],
    ['a direct fetch call', 'export const get = () => fetch("/x");'],
  ])('fails core with %s', (_name, source) => {
    put('packages/core/src/a.ts', source);
    expect(gate()).toEqual(['L6-base-purity packages/core/src/a.ts']);
  });

  it('passes pure core: factory state, injected timer with a default, read-only module Map', () => {
    put('packages/core/src/a.ts', [
      'export const NAMES = new Map<string, number>([["a", 1]]);',
      'export function create(schedule: (cb: () => void) => void = queueMicrotask): { count: number } { const state = { count: 0 }; schedule(() => { state.count += 1; }); return state; }',
      'export const note = { process: 1 }.process;',
    ].join('\n'));
    expect(gate()).toEqual([]);
  });

  it('fails core dependencies and any protocol dependency but zod', () => {
    manifest('core', { dependencies: { zod: '*' } });
    manifest('protocol', { dependencies: { zod: '*', express: '*' } });
    expect(gate()).toEqual(['L6-base-purity packages/core/package.json', 'L6-base-purity packages/protocol/package.json']);
  });

  it('applies the debt baseline to a purity finding', () => {
    put('packages/core/src/a.ts', 'export let counter = 0;');
    debt({ rule: 'L6-base-purity', file: 'packages/core/src/a.ts', spec: 'let counter', kind: 'module-state' });
    expect(gate()).toEqual([]);
  });
});

describe('L7-css-tokens', () => {
  beforeEach(() => manifest('ui', { dependencies: { '@jini-ai/core': '*' } }));

  it('fails an unlisted var and a cross-package @import; passes tokens and the own namespace', () => {
    put('scripts/injection-css-tokens.json', { tokens: ['--jini-text'] });
    put('packages/ui/src/a.css', '.a { color: var(--jini-text); border: var(--jini-ui-edge, 1px); } /* var(--prose) */');
    expect(gate()).toEqual([]);
    put('packages/ui/src/b.css', '.b { color: var(--text-sm); }');
    put('packages/ui/src/c.css', '@import "@jini-ai/admin/themes/default.css";');
    expect(gate()).toEqual(['L7-css-tokens packages/ui/src/b.css', 'L7-css-tokens packages/ui/src/c.css']);
  });
});

describe('helpers', () => {
  it('matches a spec glob against a package, its subpaths and star patterns', () => {
    expect(specMatches({ glob: '@jini-ai/db', spec: '@jini-ai/db' })).toBe(true);
    expect(specMatches({ glob: '@jini-ai/db', spec: '@jini-ai/db/kernel' })).toBe(true);
    expect(specMatches({ glob: '@jini-ai/db', spec: '@jini-ai/dbx' })).toBe(false);
    expect(specMatches({ glob: '@jini-ai/db/*', spec: '@jini-ai/db' })).toBe(false);
  });

  it('tells the six syntaxes apart', () => {
    const kinds = importSites({ file: 'a.ts', source: [
      "import a from 'x1'; import type { B } from 'x2'; export { c } from 'x3'; export type { D } from 'x4';",
      "import('x5'); require('x6'); type E = import('x7').E;",
    ].join('\n') }).map(site => `${site.spec}:${site.kind}`);
    expect(kinds).toEqual(['x1:import', 'x2:type-import', 'x3:export-from', 'x4:type-import', 'x5:dynamic', 'x6:require', 'x7:import-type']);
  });
});

describe('the real workspace baseline', () => {
  it('ships a parsable debt file, the frozen sqlite/infra forwarder exceptions, and passes the gate', () => {
    const entries = loadDebt({ root: REPO_ROOT });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(entry => entry.count > 0 && entry.lane.length > 0)).toBe(true);
    const owners = new Set(loadExceptions({ root: REPO_ROOT }).map(item => `${item.owner}:${item.ownerQuestion}:${item.approved}`));
    expect([...owners].sort()).toEqual(['infra:Q2:2026-11-15', 'sqlite:Q2:2026-11-15']);
    expect(checkPackageLayers({ repoRoot: REPO_ROOT }, { warn: () => undefined })).toEqual([]);
  }, 180_000);
});
