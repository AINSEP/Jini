/** Fixture tests for the injection rules (L5 base-only edges, L6 base purity, L7 CSS tokens) and the
 * debt ratchet. Each test builds one isolated fixture tree; none touches the real workspace. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkPackageLayers } from '../check-package-layers.js';
import { loadDebt, loadExceptions, specMatches } from '../lib/injection-debt.js';
import { injectedEdgeFindings, type Edge } from '../lib/injection-edges.js';
import { importSites } from '../lib/import-sites.js';
import { REPO_ROOT } from '../lib/walk-imports.js';

let root: string;
const put = (file: string, content: string | object): void => {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
};
const manifest = (name: string, extra: object = {}): void => put(`packages/${name}/package.json`, { name: `@jini-ai/${name}`, ...extra });
let baseEntries: object[] | object | null = null;
/** Files of the trusted base tree, for the approved-runtime check (path -> source). */
let baseFiles: Record<string, string> = {};
const gate = (warnings: string[] = []): string[] => checkPackageLayers({ repoRoot: root }, {
  warn: message => warnings.push(message), debtBase: () => baseEntries as never, baseRead: path => baseFiles[path],
}).map(violation => `${violation.rule} ${violation.file}`).sort();
const debt = (...entries: object[]): void => put('scripts/injection-debt.json', { entries: entries.map(entry => ({ lane: 'T', count: 1, ...entry })) });
const L5 = 'L5-injected-edge';

beforeEach(() => {
  baseEntries = null;
  baseFiles = {};
  root = mkdtempSync(join(tmpdir(), 'jini-injection-test-'));
  manifest('core');
  manifest('protocol');
  manifest('platform');
  manifest('devops');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('integration-tests workspace', () => {
  it('registers the private workspace without a public entry', () => {
    manifest('integration-tests', { private: true, sideEffects: false });
    put('packages/integration-tests/src/.gitkeep', '');
    expect(gate()).toEqual([]);
  });
});

describe('L5-injected-edge', () => {
  beforeEach(() => manifest('daemon', { dependencies: { '@jini-ai/core': '*', '@jini-ai/protocol': '*' } }));

  it('passes imports of core and protocol, value and type alike', () => {
    manifest('core', { exports: { './records': { types: './dist/records.d.ts', import: './dist/records.js' } } });
    put('packages/core/src/records.ts', 'export const x = 1;\nexport interface Records { id: string }\n');
    put('scripts/injection-debt.json', { _comment: 't', metadata: { approvedRuntime: ['@jini-ai/core/records#x'], initialized: [], seedSha: 'seed' }, entries: [] });
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

  it('fails a template-literal dynamic import, a createRequire load and an import = require', () => {
    manifest('daemon', { dependencies: { '@jini-ai/core': '*' } });
    put('packages/daemon/src/a.ts', [
      'export const d = import(`@jini-ai/platform/net`);',
      "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); export const r = load('@jini-ai/platform/fs');",
      "import os = require('@jini-ai/platform/os'); export { os };",
    ].join('\n'));
    expect(gate().filter(line => line.startsWith(L5))).toEqual([`${L5} packages/daemon/src/a.ts`, `${L5} packages/daemon/src/a.ts`, `${L5} packages/daemon/src/a.ts`]);
  });

  it('fails closed on a malformed plugin payload instead of reporting no imports', () => {
    manifest('agent-plugins', { dependencies: { '@jini-ai/core': '*' } });
    put('packages/agent-plugins/foo/bad.mjs', "import { d } from '@jini-ai/devops/deploy'\nexport const = d;");
    expect(() => gate()).toThrow(/Cannot parse .*bad\.mjs: syntax error at line 2/);
  });

  it('resolves package.json imports (#aliases) before classifying the target', () => {
    manifest('daemon', { dependencies: { '@jini-ai/core': '*' }, imports: {
      '#platform': '@jini-ai/platform', '#plat/*': { node: '@jini-ai/platform/*', default: './src/local/*.js' }, '#own': './src/own.js',
    } });
    put('packages/daemon/src/a.ts', "import { a } from '#platform'; export { a };");
    put('packages/daemon/src/b.ts', "import { b } from '#plat/fs'; export { b };");
    put('packages/daemon/src/c.ts', "import { c } from '#own'; export { c };");
    expect(gate().filter(line => line.startsWith(L5))).toEqual([`${L5} packages/daemon/src/a.ts`, `${L5} packages/daemon/src/b.ts`]);
  });

  it('resolves npm: and workspace: dependency aliases in source and manifest', () => {
    manifest('daemon', { dependencies: { '@jini-ai/core': '*', plat: 'npm:@jini-ai/platform@^1', wplat: 'workspace:@jini-ai/platform@*' } });
    put('packages/daemon/src/a.ts', "import { a } from 'plat/fs'; import { b } from 'wplat'; export { a, b };");
    const found = gate().filter(line => line.startsWith(L5));
    expect(found.filter(line => line.endsWith('src/a.ts'))).toHaveLength(2);
    expect(found.filter(line => line.endsWith('package.json'))).toHaveLength(1);
  });

  it('resolves tsconfig paths to the package that owns the target directory', () => {
    manifest('daemon', { dependencies: { '@jini-ai/core': '*' } });
    put('packages/daemon/tsconfig.json', '{ // paths are part of resolution\n "compilerOptions": { "paths": { "~p/*": ["../platform/src/*"], "kysely": ["../platform/node_modules/kysely/index.d.ts"], "@jini-ai/core/x": ["../core/dist/x.d.ts"] } } }');
    put('packages/daemon/src/a.ts', "import { a } from '~p/fs'; import { k } from 'kysely'; import { x } from '@jini-ai/core/x'; export { a, k, x };");
    expect(gate().filter(line => line.startsWith(L5))).toEqual([`${L5} packages/daemon/src/a.ts`]);
  });

  it('fails a manifest peer declaration', () => {
    manifest('daemon', { peerDependencies: { '@jini-ai/platform': '*' } });
    expect(gate()).toEqual([`${L5} packages/daemon/package.json`]);
  });

  it('passes a debt hit, fails a higher count, and fails a stale (too high) allowance', () => {
    manifest('daemon', { dependencies: { '@jini-ai/platform': '*' } });
    put('packages/daemon/src/a.ts', "import { a } from '@jini-ai/platform/fs'; import { b } from '@jini-ai/platform/fs'; export { a, b };");
    const manifestKey = { rule: L5, file: 'packages/daemon/package.json', spec: '@jini-ai/platform', kind: 'manifest-dependencies' };
    const sourceKey = { rule: L5, file: 'packages/daemon/src/a.ts', spec: '@jini-ai/platform/fs', kind: 'import' };
    debt(manifestKey, { ...sourceKey, count: 2 });
    expect(gate()).toEqual([]);
    debt(manifestKey, sourceKey);
    expect(gate()).toEqual([`${L5} packages/daemon/src/a.ts`]);
    debt(manifestKey, { ...sourceKey, count: 3 });
    expect(gate()).toEqual(['injection-debt-stale scripts/injection-debt.json']);
    debt(manifestKey, { ...sourceKey, count: 2 }, { ...sourceKey, file: 'packages/daemon/src/gone.ts' });
    expect(gate()).toEqual(['injection-debt-stale scripts/injection-debt.json']);
  });

  it('rejects debt growth against the trusted base: a new key or a raised count', () => {
    manifest('daemon', { dependencies: { '@jini-ai/platform': '*' } });
    put('packages/daemon/src/a.ts', "import { a } from '@jini-ai/platform/fs'; import { b } from '@jini-ai/platform/fs'; export { a, b };");
    const manifestKey = { rule: L5, file: 'packages/daemon/package.json', spec: '@jini-ai/platform', kind: 'manifest-dependencies', count: 1, lane: 'T' };
    const sourceKey = { rule: L5, file: 'packages/daemon/src/a.ts', spec: '@jini-ai/platform/fs', kind: 'import', count: 2, lane: 'T' };
    debt(manifestKey, sourceKey);
    baseEntries = [manifestKey, sourceKey];
    expect(gate()).toEqual([]);
    baseEntries = [manifestKey];
    expect(gate()).toEqual(['injection-debt-growth scripts/injection-debt.json']);
    baseEntries = [manifestKey, { ...sourceKey, count: 1 }];
    expect(gate()).toEqual(['injection-debt-growth scripts/injection-debt.json']);
  });

  it('reads the trusted base from git by default (HEAD when no base ref is set)', () => {
    manifest('daemon', { dependencies: { '@jini-ai/platform': '*' } });
    const manifestKey = { rule: L5, file: 'packages/daemon/package.json', spec: '@jini-ai/platform', kind: 'manifest-dependencies' };
    debt(manifestKey);
    const git = (...args: string[]): void => { execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, stdio: 'ignore' }); };
    git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'base');
    const run = (): string[] => checkPackageLayers({ repoRoot: root }, { warn: () => undefined })
      .map(violation => `${violation.rule} ${violation.file}`);
    expect(run()).toEqual([]);
    put('packages/daemon/src/a.ts', "import { a } from '@jini-ai/platform/fs'; export { a };");
    debt(manifestKey, { rule: L5, file: 'packages/daemon/src/a.ts', spec: '@jini-ai/platform/fs', kind: 'import' });
    expect(run()).toEqual(['injection-debt-growth scripts/injection-debt.json']);
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
    manifest('server', { dependencies: { '@jini-ai/daemon': '*' }, jini: { kind: 'host-preset' } });
    put('packages/server/src/a.ts', "import { d } from '@jini-ai/daemon'; export { d };");
    expect(gate()).toEqual([]);
    manifest('daemon', { dependencies: { '@jini-ai/core': '*', '@jini-ai/server': '*' } });
    put('packages/daemon/src/b.ts', "import { s } from '@jini-ai/server'; export { s };");
    expect(gate()).toContain(`${L5} packages/daemon/src/b.ts`);
  });

  describe('runtime-adapter packages (owner decision OD-3)', () => {
    const adapterMessage = 'only a host or a host preset may import a runtime-adapter package';
    const edge = (owner: string, target: string, kind: string): Edge => ({ owner, target, spec: `@jini-ai/${target}/x`, kind, file: `packages/${owner}/src/a.ts` });
    const reasons = (edges: Edge[]): string[] => injectedEdgeFindings({
      edges, exceptions: [], presets: new Set(['server']), adapters: new Set(['node-adapters']),
    }).map(finding => finding.reason);

    beforeEach(() => {
      manifest('node-adapters', { dependencies: { '@jini-ai/core': '*', '@jini-ai/platform': '*' }, jini: { kind: 'runtime-adapter' } });
      manifest('daemon', { dependencies: { '@jini-ai/core': '*' } });
    });

    it('lets an adapter import platform as a value', () => {
      put('packages/node-adapters/src/a.ts', "import { run } from '@jini-ai/platform/fs'; export { run };");
      expect(gate()).toEqual([]);
    });

    it.each(['type-import', 'import-type', 'jsdoc-import'])('lets an adapter name a domain port type (%s)', kind => {
      expect(reasons([edge('node-adapters', 'daemon', kind)])).toEqual([]);
    });

    it('lets an adapter name a domain port type, written as a source import type and declared as a peer', () => {
      manifest('node-adapters', { dependencies: { '@jini-ai/core': '*' }, peerDependencies: { '@jini-ai/daemon': '*' }, jini: { kind: 'runtime-adapter' } });
      put('packages/node-adapters/src/a.ts', "import type { P } from '@jini-ai/daemon'; export type Q = P;");
      expect(gate()).toEqual([]);
    });

    it('fails an adapter that imports a domain package as a value, or declares it as a dependency', () => {
      manifest('node-adapters', { dependencies: { '@jini-ai/core': '*', '@jini-ai/daemon': '*' }, jini: { kind: 'runtime-adapter' } });
      put('packages/node-adapters/src/a.ts', "import { run } from '@jini-ai/daemon'; export { run };");
      expect(gate()).toEqual([`${L5} packages/node-adapters/package.json`, `${L5} packages/node-adapters/src/a.ts`]);
      expect(reasons([edge('node-adapters', 'daemon', 'import')])).toEqual([expect.stringContaining('only @jini-ai/core and @jini-ai/protocol may be imported')]);
    });

    it('lets an adapter declare a domain package as a peer', () => {
      expect(reasons([edge('node-adapters', 'daemon', 'manifest-peer')])).toEqual([]);
    });

    it('fails a domain package that imports an adapter, with the adapter reason', () => {
      put('packages/daemon/src/a.ts', "import { fs } from '@jini-ai/node-adapters/fs'; export { fs };");
      expect(gate()).toContain(`${L5} packages/daemon/src/a.ts`);
      expect(reasons([edge('daemon', 'node-adapters', 'import')])).toEqual([expect.stringContaining(adapterMessage)]);
    });

    it('lets a host preset import an adapter', () => {
      manifest('server', { dependencies: { '@jini-ai/node-adapters': '*' }, jini: { kind: 'host-preset' } });
      put('packages/server/src/a.ts', "import { fs } from '@jini-ai/node-adapters/fs'; export { fs };");
      expect(gate()).toEqual([]);
    });

    it('fails an adapter that imports a host preset', () => {
      expect(reasons([edge('node-adapters', 'server', 'import')])).toEqual([expect.stringContaining('nothing may import a host-preset package')]);
    });
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

  it('passes injected ports named fetch, setTimeout or process: a lexical binding is not the global', () => {
    put('packages/core/src/a.ts', [
      'export function create({ fetch }: { fetch: (url: string) => Promise<unknown> }) { return { run: (url: string) => fetch(url) }; }',
      'export function later(setTimeout: (cb: () => void) => void): void { setTimeout(() => undefined); }',
      'export function home(process: { env: Record<string, string> }): string | undefined { return process.env.HOME; }',
      'export function retry([setInterval]: [(cb: () => void) => void]): void { { setInterval(() => undefined); } }',
    ].join('\n'));
    expect(gate()).toEqual([]);
  });

  it('still fails the global behind a same-named local alias and outside the binding scope', () => {
    put('packages/core/src/a.ts', 'const fetch = globalThis.fetch; export const get = () => fetch("/x");');
    put('packages/core/src/b.ts', 'export function f({ fetch }: { fetch: () => void }) { fetch(); } export const g = () => fetch("/y");');
    const L6 = 'L6-base-purity';
    expect(gate()).toEqual([`${L6} packages/core/src/a.ts`, `${L6} packages/core/src/a.ts`, `${L6} packages/core/src/b.ts`]);
    // Exactly one global fetch site in b.ts: the injected one inside f() is not counted.
    debt({ rule: L6, file: 'packages/core/src/a.ts', spec: 'globalThis', kind: 'global' },
      { rule: L6, file: 'packages/core/src/a.ts', spec: 'fetch', kind: 'effect-call' },
      { rule: L6, file: 'packages/core/src/b.ts', spec: 'fetch', kind: 'effect-call' });
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

describe('L5-resolved: Core and Protocol public entries, approved runtime, new coverage (Gate C1)', () => {
  const LR = 'L5-resolved';
  const meta = (approvedRuntime: string[], extra: object = {}): object => ({ approvedRuntime, initialized: ['L5-resolved', 'XP4-runtime'], seedSha: 'seed', ...extra });
  const debtFile = (metadata: object, entries: object[] = []): void => put('scripts/injection-debt.json', { _comment: 't', metadata, entries: entries.map(entry => ({ lane: 'T', count: 1, ...entry })) });
  const RECORDS = "export const x = 1;\nexport function y(): number { return 2; }\nexport interface Records { id: string }\nexport type Alias = string;\n";
  beforeEach(() => {
    manifest('core', { exports: { '.': { import: './dist/index.js' }, './records': { types: './dist/records.d.ts', import: './dist/records.js' } } });
    put('packages/core/src/index.ts', "export { x } from './records.js';\n");
    put('packages/core/src/records.ts', RECORDS);
    manifest('daemon', { dependencies: { '@jini-ai/core': '*' } });
    debtFile(meta(['@jini-ai/core#x', '@jini-ai/core/records#x', '@jini-ai/core/records#y']));
  });

  it('passes public type-only imports and approved named values, renamed locally or not', () => {
    put('packages/daemon/src/a.ts', "import type { Records } from '@jini-ai/core/records';\nimport { x as renamed, y } from '@jini-ai/core/records';\nimport { x } from '@jini-ai/core';\nexport const z: Records | number = renamed + y() + x;\n");
    expect(gate()).toEqual([]);
  });

  it('C-same-specifier-value: a Core type import passes; the same specifier used as a value is a finding', () => {
    put('packages/daemon/src/a.ts', "import type { Alias } from '@jini-ai/core/records';\nexport const v: Alias = 'a';\n");
    expect(gate()).toEqual([]);
  });

  it('fails an unapproved value in a mixed import, a namespace load and a bare side-effect load', () => {
    put('packages/daemon/src/a.ts', "import { type Records, Alias } from '@jini-ai/core/records';\nexport type R = Records;\nexport { Alias };\n");
    put('packages/daemon/src/b.ts', "import * as core from '@jini-ai/core/records';\nexport const n = core.x;\n");
    put('packages/daemon/src/c.ts', "import '@jini-ai/core/records';\n");
    expect(gate()).toEqual([`${LR} packages/daemon/src/a.ts`, `${LR} packages/daemon/src/b.ts`, `${LR} packages/daemon/src/c.ts`]);
  });

  it('fails an inline type list that still emits a module load under verbatimModuleSyntax', () => {
    put('packages/daemon/src/a.ts', "import { type Records } from '@jini-ai/core/records';\nexport type R = Records;\n");
    expect(gate()).toEqual([`${LR} packages/daemon/src/a.ts`]);
  });

  it('fails a private Core entry even for a type import, and an opaque dynamic load', () => {
    put('packages/daemon/src/a.ts', "import type { Records } from '@jini-ai/core/src/records';\nexport type R = Records;\n");
    put('packages/daemon/src/b.ts', "export const load = () => import('@jini-ai/core/records');\n");
    expect(gate()).toEqual([`${LR} packages/daemon/src/a.ts`, `${LR} packages/daemon/src/b.ts`]);
  });

  it('resolves a sibling-relative .js import back to its owning package and reports it once', () => {
    put('packages/platform/src/fs.ts', 'export const run = 1;\n');
    put('packages/daemon/src/a.ts', "import { run } from '../../platform/src/fs.js';\nexport { run };\n");
    expect(gate()).toEqual([`${LR} packages/daemon/src/a.ts`]);
  });

  it('fails an aliased optionalDependencies entry as its own manifest kind', () => {
    manifest('daemon', { dependencies: { '@jini-ai/core': '*' }, optionalDependencies: { plat: 'npm:@jini-ai/platform@1' } });
    expect(gate()).toEqual([`${LR} packages/daemon/package.json`]);
  });

  it('runtime approval: an approval-only addition fails against the trusted base', () => {
    baseEntries = { _comment: 't', metadata: meta(['@jini-ai/core#x', '@jini-ai/core/records#x']), entries: [] };
    baseFiles = { 'packages/core/package.json': JSON.stringify({ name: '@jini-ai/core', exports: { '.': { import: './dist/index.js' }, './records': { import: './dist/records.js' } } }), 'packages/core/src/index.ts': "export { x } from './records.js';\n", 'packages/core/src/records.ts': RECORDS };
    expect(gate()).toEqual(['injection-approval-growth scripts/injection-debt.json']);
  });

  it('runtime approval: a new public runtime export added with its approval passes', () => {
    baseEntries = { _comment: 't', metadata: meta(['@jini-ai/core#x', '@jini-ai/core/records#x']), entries: [] };
    baseFiles = { 'packages/core/package.json': JSON.stringify({ name: '@jini-ai/core', exports: { '.': { import: './dist/index.js' }, './records': { import: './dist/records.js' } } }), 'packages/core/src/index.ts': "export { x } from './records.js';\n", 'packages/core/src/records.ts': 'export const x = 1;\n' };
    expect(gate()).toEqual([]);
  });

  it('runtime approval: a type-only export cannot authorize a value', () => {
    debtFile(meta(['@jini-ai/core#x', '@jini-ai/core/records#Records', '@jini-ai/core/records#x', '@jini-ai/core/records#y']));
    expect(gate()).toEqual(['injection-debt-invalid scripts/injection-debt.json']);
  });

  it('runtime approval: dropping an approval whose export is still public is a narrowing failure', () => {
    baseEntries = { _comment: 't', metadata: meta(['@jini-ai/core#x', '@jini-ai/core/records#x', '@jini-ai/core/records#y']), entries: [] };
    baseFiles = { 'packages/core/package.json': JSON.stringify({ name: '@jini-ai/core', exports: { '.': { import: './dist/index.js' }, './records': { import: './dist/records.js' } } }), 'packages/core/src/index.ts': "export { x } from './records.js';\n", 'packages/core/src/records.ts': RECORDS };
    debtFile(meta(['@jini-ai/core#x', '@jini-ai/core/records#x']));
    expect(gate()).toEqual(['injection-approval-narrowed scripts/injection-debt.json']);
  });

  it('trusted debt: rejects unknown keys, unsorted approvals, duplicate keys and non-positive counts', () => {
    put('scripts/injection-debt.json', { _comment: 't', extra: 1, metadata: { ...meta(['@jini-ai/core/records#y', '@jini-ai/core/records#x']), more: 1 }, entries: [{ rule: L5, file: 'f', spec: 's', kind: 'import', count: 0, lane: 'T' }, { rule: L5, file: 'f', spec: 's', kind: 'import', count: 1, lane: 'T' }] });
    const found = gate();
    expect(found.filter(line => line.startsWith('injection-debt-invalid'))).toEqual(['injection-debt-invalid scripts/injection-debt.json']);
  });

  it('trusted debt: first capture of a designated new rule passes with an exact seed', () => {
    baseEntries = { _comment: 't', metadata: { ...meta(['@jini-ai/core#x', '@jini-ai/core/records#x', '@jini-ai/core/records#y']), initialized: [] }, entries: [] };
    baseFiles = { 'packages/core/package.json': JSON.stringify({ name: '@jini-ai/core', exports: { '.': { import: './dist/index.js' }, './records': { import: './dist/records.js' } } }), 'packages/core/src/index.ts': "export { x } from './records.js';\n", 'packages/core/src/records.ts': RECORDS };
    put('packages/daemon/src/c.ts', "import '@jini-ai/core/records';\n");
    debtFile(meta(['@jini-ai/core#x', '@jini-ai/core/records#x', '@jini-ai/core/records#y']), [{ rule: LR, file: 'packages/daemon/src/c.ts', spec: '@jini-ai/core/records', kind: 'opaque-side-effect' }]);
    expect(gate()).toEqual([]);
  });

  it('trusted debt: seeding a rule again after its debt reached zero fails (the marker persists)', () => {
    baseEntries = { _comment: 't', metadata: meta(['@jini-ai/core#x', '@jini-ai/core/records#x', '@jini-ai/core/records#y']), entries: [] };
    baseFiles = { 'packages/core/package.json': JSON.stringify({ name: '@jini-ai/core', exports: { '.': { import: './dist/index.js' }, './records': { import: './dist/records.js' } } }), 'packages/core/src/index.ts': "export { x } from './records.js';\n", 'packages/core/src/records.ts': RECORDS };
    put('packages/daemon/src/c.ts', "import '@jini-ai/core/records';\n");
    debtFile(meta(['@jini-ai/core#x', '@jini-ai/core/records#x', '@jini-ai/core/records#y']), [{ rule: LR, file: 'packages/daemon/src/c.ts', spec: '@jini-ai/core/records', kind: 'opaque-side-effect' }]);
    expect(gate()).toEqual(['injection-debt-growth scripts/injection-debt.json']);
  });

  it('trusted debt: dropping an initialized marker fails', () => {
    baseEntries = { _comment: 't', metadata: meta(['@jini-ai/core#x', '@jini-ai/core/records#x', '@jini-ai/core/records#y']), entries: [] };
    baseFiles = { 'packages/core/package.json': JSON.stringify({ name: '@jini-ai/core', exports: { '.': { import: './dist/index.js' }, './records': { import: './dist/records.js' } } }), 'packages/core/src/index.ts': "export { x } from './records.js';\n", 'packages/core/src/records.ts': RECORDS };
    debtFile({ ...meta(['@jini-ai/core#x', '@jini-ai/core/records#x', '@jini-ai/core/records#y']), initialized: ['XP4-runtime'] });
    expect(gate()).toEqual(['injection-debt-invalid scripts/injection-debt.json']);
  });

  it('trusted debt: a cut prints update baseline; the exact shrink passes', () => {
    debtFile(meta(['@jini-ai/core#x', '@jini-ai/core/records#x', '@jini-ai/core/records#y']), [{ rule: LR, file: 'packages/daemon/src/c.ts', spec: '@jini-ai/core/records', kind: 'opaque-side-effect' }]);
    const violations = checkPackageLayers({ repoRoot: root }, { warn: () => undefined, debtBase: () => null, baseRead: () => undefined });
    expect(violations.map(violation => violation.reason).join('\n')).toContain('update baseline');
    debtFile(meta(['@jini-ai/core#x', '@jini-ai/core/records#x', '@jini-ai/core/records#y']));
    expect(gate()).toEqual([]);
  });

  describe('XP4-runtime: Core src/contracts holds types only', () => {
    const XP = 'XP4-runtime';
    it('freezes existing runtime syntax at its recorded count and passes a new types-only module', () => {
      put('packages/core/src/contracts/server.ts', 'export interface Route { path: string }\nexport function define(): number { return 1; }\n');
      put('packages/core/src/contracts/types-only.ts', "import type { Route } from './server.js';\nexport type Routes = Route[];\n");
      debtFile(meta(['@jini-ai/core#x', '@jini-ai/core/records#x', '@jini-ai/core/records#y']), [{ rule: XP, file: 'packages/core/src/contracts/server.ts', spec: 'FunctionDeclaration:define', kind: 'FunctionDeclaration' }]);
      expect(gate()).toEqual([]);
    });

    it('fails runtime syntax added to an existing contract file and a new runtime contract file', () => {
      put('packages/core/src/contracts/server.ts', 'export interface Route { path: string }\nexport function define(): number { return 1; }\nexport const extra = 2;\n');
      put('packages/core/src/contracts/fresh.ts', 'export class Fresh {}\n');
      put('packages/core/src/contracts/__tests__/fixture.ts', 'export const ignored = 1;\n');
      debtFile(meta(['@jini-ai/core#x', '@jini-ai/core/records#x', '@jini-ai/core/records#y']), [{ rule: XP, file: 'packages/core/src/contracts/server.ts', spec: 'FunctionDeclaration:define', kind: 'FunctionDeclaration' }]);
      expect(gate()).toEqual([`${XP} packages/core/src/contracts/fresh.ts`, `${XP} packages/core/src/contracts/server.ts`]);
    });
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

  it('reads template-literal imports, createRequire bindings and import = require', () => {
    const kinds = importSites({ file: 'a.ts', source: [
      'const a = import(`x8`);',
      "import { createRequire as cr } from 'node:module'; const load = cr(import.meta.url); load('x9');",
      "import x10 = require('x10');",
      "function local(require: (id: string) => unknown) { return require('not-a-module'); }",
    ].join('\n') }).map(site => `${site.spec}:${site.kind}`).sort();
    expect(kinds).toEqual(['node:module:import', 'x10:require', 'x8:dynamic', 'x9:require']);
  });

  it('fails closed on a file it cannot parse', () => {
    expect(() => importSites({ file: 'bad.ts', source: "import { a } from '@jini-ai/platform';\nexport const = ;" }))
      .toThrow(/Cannot parse bad\.ts: syntax error at line 2/);
  });
});

describe('the real workspace baseline', () => {
  it('ships a parsable debt file, no exceptions (pinned in injection-exceptions.q2.test.ts), and passes the gate', () => {
    const entries = loadDebt({ root: REPO_ROOT });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(entry => entry.count > 0 && entry.lane.length > 0)).toBe(true);
    expect(loadExceptions({ root: REPO_ROOT })).toEqual([]);
    expect(checkPackageLayers({ repoRoot: REPO_ROOT }, { warn: () => undefined })).toEqual([]);
  }, 180_000);
});
