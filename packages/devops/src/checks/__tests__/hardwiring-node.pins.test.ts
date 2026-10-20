import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { createResolver, displayGraphFile, installedPublicFunctions, runHardwiring, sourceFiles } from '../hardwiring-node.js';
import type { HardwiringViolation } from '../hardwiring.js';

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function tree() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hardwiring-node-pins-')));
  roots.push(root);
  const put = (file: string, text: string) => {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  return { root, put };
}
const pkg = 'node_modules/@jini-ai/fixture/';
const inventory = (root: string) => [...installedPublicFunctions({ root, compiler: ts })].sort();

describe('sourceFiles', () => {
  it('a missing directory yields no files', () => {
    const { root } = tree();
    expect(sourceFiles({ directory: join(root, 'missing') })).toEqual([]);
  });

  it('keeps every JS/TS flavour sorted, and declarations only on request', () => {
    const { root, put } = tree();
    for (const file of ['b.mts', 'a.cjs', 'c.jsx', 'd.tsx', 'e.d.mts', 'f.d.ts', 'g.css', 'h.test.ts', 'build/x.ts', '__measurements__/y.ts']) put(file, '');
    expect(sourceFiles({ directory: root }).map((file) => file.slice(root.length + 1))).toEqual(['a.cjs', 'b.mts', 'c.jsx', 'd.tsx']);
    expect(sourceFiles({ directory: root, declarations: true }).map((file) => file.slice(root.length + 1))).toEqual(['a.cjs', 'b.mts', 'c.jsx', 'd.tsx', 'e.d.mts', 'f.d.ts']);
  });
});

describe('createResolver', () => {
  it('non-code assets resolve to nothing, including query suffixes', () => {
    const { root } = tree();
    const resolve = createResolver({ root, compiler: ts });
    for (const specifier of ['./a.css', './a.svg?raw', './a.json', './font.woff2', 'fs']) expect(resolve(specifier, join(root, 'a.ts'))).toBeUndefined();
  });

  it('a non-runtime resolver prefers the paired .js, then .mjs, then keeps the declaration', () => {
    const { root, put } = tree();
    put('src/entry.ts', '');
    for (const name of ['js', 'mjs', 'bare']) put(`node_modules/${name}/index.d.ts`, 'export declare const v: number;');
    put('node_modules/js/index.js', ''); put('node_modules/js/index.mjs', '');
    put('node_modules/mjs/index.mjs', '');
    const resolve = createResolver({ root, compiler: ts });
    const entry = join(root, 'src/entry.ts');
    expect(resolve('js', entry)).toBe(join(root, 'node_modules/js/index.js'));
    expect(resolve('mjs', entry)).toBe(join(root, 'node_modules/mjs/index.mjs'));
    expect(resolve('bare', entry)).toBe(join(root, 'node_modules/bare/index.d.ts'));
  });

  it('a runtime resolver refuses declaration-only packages without naming the specifier', () => {
    const { root, put } = tree();
    put('src/entry.ts', '');
    put('node_modules/secret-token-name/index.d.ts', 'export declare const v: number;');
    const resolve = createResolver({ root, compiler: ts, runtime: true });
    expect(() => resolve('secret-token-name', join(root, 'src/entry.ts'))).toThrow(/^Unresolved code import in src\/entry\.ts \(specifier omitted\); refusing an incomplete public\/plugin graph\.$/);
  });

  it('applies only the first matching alias', () => {
    const { root, put } = tree();
    put('src/entry.ts', ''); put('one/x.ts', ''); put('two/x.ts', '');
    const resolve = createResolver({ root, compiler: ts, aliases: { '#a/': join(root, 'one'), '#': join(root, 'two') } });
    expect(resolve('#a/x', join(root, 'src/entry.ts'))).toBe(join(root, 'one/x.ts'));
    expect(resolve('#/x', join(root, 'src/entry.ts'))).toBe(join(root, 'two/x.ts'));
  });
});

describe('displayGraphFile', () => {
  it('skips nameless manifests and falls back to the relative path when no named owner exists', () => {
    const { root, put } = tree();
    put('lib/package.json', '{}');
    expect(displayGraphFile({ root, file: join(root, 'lib/src/view.js') })).toBe('lib/src/view.js');
    put('package.json', JSON.stringify({ name: 'outer' }));
    expect(displayGraphFile({ root, file: join(root, 'lib/src/view.js') })).toBe('node_modules/outer');
  });

  it('honours custom authored directories', () => {
    const { root, put } = tree();
    put('site/package.json', JSON.stringify({ name: 'site' }));
    expect(displayGraphFile({ root, file: join(root, 'site/view.tsx'), authoredDirectories: ['site'] })).toBe('site/view.tsx');
    expect(displayGraphFile({ root, file: join(root, 'site/view.tsx') })).toBe('node_modules/site');
  });
});

describe('installedPublicFunctions export targets', () => {
  const fn = 'export declare function owned(): void;';

  it('refuses targets outside the package-relative form', () => {
    const { root, put } = tree();
    put(pkg + 'package.json', JSON.stringify({ name: '@jini-ai/fixture', exports: { '.': 'dist/index.d.ts' } }));
    expect(() => inventory(root)).toThrow(`Invalid public export target in ${join(root, pkg.slice(0, -1))}.`);
  });

  it('refuses a missing non-wildcard entry', () => {
    const { root, put } = tree();
    put(pkg + 'package.json', JSON.stringify({ name: '@jini-ai/fixture', exports: './missing.d.ts' }));
    expect(() => inventory(root)).toThrow(`Missing installed public entry in ${join(root, pkg.slice(0, -1))}.`);
  });

  it('arrays use the first non-null entry; all-null arrays and non-target values add nothing', () => {
    const { root, put } = tree();
    put(pkg + 'package.json', JSON.stringify({ name: '@jini-ai/fixture', exports: { '.': [null, './a.d.ts', './missing.d.ts'], './none': [null], './num': 1, './empty': {}, './false': false } }));
    put(pkg + 'a.d.ts', fn);
    expect(inventory(root)).toEqual(['owned']);
  });

  it('conditions follow types > import > default > node > browser > require', () => {
    const { root, put } = tree();
    put(pkg + 'package.json', JSON.stringify({ name: '@jini-ai/fixture', exports: { require: './r.d.ts', browser: './b.d.ts', node: './n.d.ts' } }));
    put(pkg + 'n.d.ts', 'export declare function fromNode(): void;');
    expect(inventory(root)).toEqual(['fromNode']);
  });

  it('nested conditions inside an entry are selected recursively', () => {
    const { root, put } = tree();
    put(pkg + 'package.json', JSON.stringify({ name: '@jini-ai/fixture', exports: { '.': { import: { types: './t.d.ts', default: './missing.js' } } } }));
    put(pkg + 't.d.ts', fn);
    expect(inventory(root)).toEqual(['owned']);
  });

  it('wildcards require both prefix and suffix to match', () => {
    const { root, put } = tree();
    put(pkg + 'package.json', JSON.stringify({ name: '@jini-ai/fixture', exports: { './tools/*': './dist/tools/*.d.ts' } }));
    put(pkg + 'dist/tools/a.d.ts', 'export declare function a(): void;');
    put(pkg + 'dist/tools/b.js', 'export function b() {}');
    put(pkg + 'dist/toolsx.d.ts', 'export declare function c(): void;');
    expect(inventory(root)).toEqual(['a']);
  });

  it('a wildcard with no suffix matches by prefix', () => {
    const { root, put } = tree();
    put(pkg + 'package.json', JSON.stringify({ name: '@jini-ai/fixture', exports: { './lib/*': './lib/*' } }));
    put(pkg + 'lib/a.d.ts', 'export declare function a(): void;');
    expect(inventory(root)).toEqual(['a']);
  });

  it('a wildcard directly under dist/ finds nothing, because the inventory scan skips dist (reported, not fixed)', () => {
    const { root, put } = tree();
    put(pkg + 'package.json', JSON.stringify({ name: '@jini-ai/fixture', exports: { '.': './index.d.ts', './*': './dist/*' } }));
    put(pkg + 'index.d.ts', 'export declare function owned(): void;');
    put(pkg + 'dist/a.d.ts', 'export declare function a(): void;');
    expect(inventory(root)).toEqual(['owned']);
  });

  it('legacy types/main fields, with or without a ./ prefix, stand in for exports', () => {
    for (const fields of [{ types: 'index.d.ts' }, { types: './index.d.ts' }, { main: 'index.d.ts' }, { types: 'index.d.ts', main: './missing.js' }]) {
      const { root, put } = tree();
      put(pkg + 'package.json', JSON.stringify({ name: '@jini-ai/fixture', ...fields }));
      put(pkg + 'index.d.ts', fn);
      expect(inventory(root)).toEqual(['owned']);
    }
  });

  it('skips directories without a manifest, foreign names and packages with no entry fields', () => {
    const { root, put } = tree();
    put(pkg + 'package.json', JSON.stringify({ name: '@jini-ai/fixture', exports: './index.d.ts' }));
    put(pkg + 'index.d.ts', fn);
    put('node_modules/@jini-ai/no-manifest/index.d.ts', 'export declare function hidden(): void;');
    put('node_modules/@jini-ai/foreign/package.json', JSON.stringify({ name: 'foreign', exports: './index.d.ts' }));
    put('node_modules/@jini-ai/foreign/index.d.ts', 'export declare function foreign(): void;');
    put('node_modules/@jini-ai/nameless/package.json', JSON.stringify({ exports: './index.d.ts' }));
    put('node_modules/@jini-ai/nameless/index.d.ts', 'export declare function nameless(): void;');
    put('node_modules/@jini-ai/bare/package.json', JSON.stringify({ name: '@jini-ai/bare' }));
    expect(inventory(root)).toEqual(['owned']);
  });

  it('script (non-module) entries and value exports without call signatures contribute nothing', () => {
    const { root, put } = tree();
    put(pkg + 'package.json', JSON.stringify({ name: '@jini-ai/fixture', exports: { '.': './index.d.ts', './script': './script.d.ts', './builtin': './builtin.d.ts' } }));
    put(pkg + 'index.d.ts', 'export declare function owned(): void; export declare const n: number; export declare class K {} export declare namespace NS { const v: number; }');
    put(pkg + 'script.d.ts', 'declare function globalOnly(): void;');
    // A built-in value alias has no value declaration; it is resolved but not callable.
    put(pkg + 'builtin.d.ts', 'export { globalThis as g };');
    expect(inventory(root)).toEqual(['owned']);
  });

  it('a syntax error in a transitively loaded declaration fails closed at its line', () => {
    const { root, put } = tree();
    put(pkg + 'package.json', JSON.stringify({ name: '@jini-ai/fixture', exports: './index.d.ts' }));
    put(pkg + 'index.d.ts', 'export * from "./inner.js";');
    put(pkg + 'inner.d.ts', '\nexport declare function broken(;');
    expect(() => inventory(root)).toThrow(`Cannot parse ${join(root, pkg, 'inner.d.ts')}: syntax error at line 2.`);
  });
});

describe('runHardwiring', () => {
  const violation = (rule: string, file: string): HardwiringViolation => ({ rule, file, line: 3, reason: 'fixture reason', fingerprint: file });

  it('logs stale debt and each new occurrence, without rewriting the baseline', async () => {
    const { root } = tree();
    const debtPath = join(root, 'debt.json');
    const stale = violation('HW1-env-default', 'stale.ts');
    writeFileSync(debtPath, JSON.stringify({ violations: [stale] }));
    const logs: string[] = []; const errors: string[] = [];
    const fresh = violation('HW8-provider-url', 'new.ts');
    const added = await runHardwiring({ debtPath, baselineComment: 'unused', collect: async () => [fresh], logger: { log: (line) => { logs.push(line); }, error: (line) => { errors.push(line); } } });
    expect(added).toEqual([fresh]);
    expect(logs).toContain(`[hardwiring] 1 stale debt occurrences; remove them from ${debtPath}.`);
    expect(logs).toContain('[hardwiring] HW8-provider-url: 1 total; 1 new');
    expect(logs).toHaveLength(10);
    expect(errors).toEqual(['[hardwiring] HW8-provider-url new.ts:3: fixture reason']);
    expect(JSON.parse(readFileSync(debtPath, 'utf8'))).toEqual({ violations: [stale] });
  });

  it('defaults to the console logger', async () => {
    const { root } = tree();
    const debtPath = join(root, 'debt.json');
    writeFileSync(debtPath, JSON.stringify({ violations: [] }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await runHardwiring({ debtPath, baselineComment: 'unused', collect: () => [] })).toEqual([]);
    expect(log).toHaveBeenCalledTimes(9);
  });

  it('a missing debt file is an error, not an empty baseline', async () => {
    const { root } = tree();
    await expect(runHardwiring({ debtPath: join(root, 'missing.json'), baselineComment: 'x', collect: () => [], logger: { log: () => {}, error: () => {} } })).rejects.toThrow(/ENOENT/);
  });
});
