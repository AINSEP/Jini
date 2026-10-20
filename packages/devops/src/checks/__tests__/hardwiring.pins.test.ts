import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { createHardwiringInspector } from '../hardwiring.js';
import type { HardwiringSource } from '../hardwiring.js';

const inspector = createHardwiringInspector({ compiler: ts });
const scan = (source: string, options: Partial<HardwiringSource> = {}) => inspector.inspect({ file: 'packages/daemon/src/service.ts', source, mode: 'jini', server: true, ...options });
const rules = (source: string, options: Partial<HardwiringSource> = {}) => scan(source, options).map((v) => v.rule);
const specifiers = (source: string, includeTypeOnly = false, file = 'entry.ts') =>
  inspector.imports({ tree: inspector.parse({ file, source }), includeTypeOnly }).map((ref) => ref.specifier);
const exported = (source: string, file = 'entry.ts') => inspector.exportedFunctions({ tree: inspector.parse({ file, source }) }).map((item) => item.name);
const graph = (sources: Record<string, string>, entries = ['entry.ts']) => inspector.inspectPublicGraph({
  entries, readSource: (file) => sources[file]!, resolveImport: (specifier) => specifier.startsWith('./') ? specifier.slice(2) + '.ts' : undefined, displayFile: (file) => file,
});

describe('parse', () => {
  it('parses .js/.cjs/.mjs as JavaScript (angle brackets open JSX), .ts as a type assertion', () => {
    for (const file of ['a.js', 'a.cjs', 'a.mjs']) expect(() => inspector.parse({ file, source: 'const a = <number>b;' })).toThrow(`Cannot parse ${file}: syntax error at line 1.`);
    expect(inspector.parse({ file: 'a.ts', source: 'const a = <number>b;' }).fileName).toBe('a.ts');
  });

  it('parses .jsx and .tsx as JSX', () => {
    for (const file of ['a.jsx', 'a.tsx']) expect(inspector.parse({ file, source: 'const v = <div />;' }).fileName).toBe(file);
    expect(() => inspector.parse({ file: 'a.ts', source: 'const v = <div />;' })).toThrow('Cannot parse a.ts: syntax error at line 1.');
  });

  it('reports the line of the first syntax error only', () => {
    expect(() => inspector.parse({ file: 'a.ts', source: 'const ok = 1;\n\nconst broken = ;\nconst also = ;' })).toThrow('Cannot parse a.ts: syntax error at line 3.');
  });

  it('a diagnostic with no start position reports line 1', () => {
    const compiler: typeof ts = { ...ts, createSourceFile: (...args: Parameters<typeof ts.createSourceFile>) => {
      const tree = ts.createSourceFile(...args);
      const diagnostic: ts.Diagnostic = { category: ts.DiagnosticCategory.Error, code: 1, file: tree, start: undefined, length: undefined, messageText: 'synthetic' };
      return Object.assign(tree, { parseDiagnostics: [diagnostic] });
    } };
    expect(() => createHardwiringInspector({ compiler }).parse({ file: 'a.ts', source: '\n\nconst ok = 1;' })).toThrow('Cannot parse a.ts: syntax error at line 1.');
  });

  it('never quotes the offending source in the error', () => {
    expect(() => inspector.parse({ file: 'a.ts', source: 'const secret = "value-in-error" +;' })).toThrow(/^Cannot parse a\.ts: syntax error at line 1\.$/);
  });
});

describe('imports', () => {
  it('skips erased import/export declarations unless type-only edges are requested', () => {
    const source = 'import type { A } from "a"; export type { B } from "b"; import { type C } from "c"; import type D = require("d");';
    expect(specifiers(source)).toEqual(['c']);
    expect(specifiers(source, true)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('collects static, re-export, dynamic, require and import-equals loads in order', () => {
    expect(specifiers('import "a"; export * from "b"; export { x } from "c"; import("d"); require("e"); import f = require("f");')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('ignores non-literal loads, local exports, namespace aliases and ordinary calls', () => {
    expect(specifiers('import(name); require(name); require(); const x = 1; export { x }; import N = Outer.Inner; load("g"); obj.require("h");', true)).toEqual([]);
  });

  it('accepts a template literal without substitutions as a specifier', () => {
    expect(specifiers('require(`a`); import(`b${c}`);')).toEqual(['a']);
  });
});

describe('exportedFunctions', () => {
  it('ignores destructured, non-function and type-only exports', () => {
    expect(exported('export const { a } = obj; export const b = 1; export let c: number; function d() {} export { type d };')).toEqual([]);
  });

  it('collects unaliased local exports, function expressions and declared function types', () => {
    expect(exported('function a() {} export { a }; export const b = function () {}; export declare const c: () => void; export default function () {}')).toEqual(['b', 'c', 'a']);
  });

  it('ignores re-exports from another module, type-only export lists and unknown locals', () => {
    expect(exported('function a() {} export { a as b } from "x"; export type { a as c }; export { missing };')).toEqual([]);
  });

  it('an export declaration with neither clause nor specifier contributes nothing', () => {
    const tree = inspector.parse({ file: 'entry.ts', source: 'function a() {}' });
    const bare = ts.factory.createExportDeclaration(undefined, false, undefined, undefined);
    expect(inspector.exportedFunctions({ tree: ts.factory.updateSourceFile(tree, [...tree.statements, bare]) })).toEqual([]);
  });
});

describe('envKey', () => {
  const key = (expression: string) => {
    const tree = inspector.parse({ file: 'entry.ts', source: expression + ';' });
    return inspector.envKey({ node: (tree.statements[0] as ts.ExpressionStatement).expression });
  };
  it('reads property and string-element keys of process.env only', () => {
    expect(key('process.env.KEY')).toBe('KEY');
    expect(key('process["env"]["KEY"]')).toBe('KEY');
    expect(key('process.env[name]')).toBeUndefined();
    expect(key('other.env.KEY')).toBeUndefined();
    expect(key('process.other.KEY')).toBeUndefined();
    expect(key('process.env')).toBeUndefined();
    expect(key('env.KEY')).toBeUndefined();
  });
});

describe('HW1 env default', () => {
  it('reports a dynamic env key under the generic identity', () => {
    const [first] = scan('export const v = process.env[name];');
    expect(first?.rule).toBe('HW1-env-default');
    expect(first?.fingerprint).toBe(scan('export const v = process.env;')[0]?.fingerprint);
  });

  it('a left-hand ?? operand, a non-?? operator and testing/bin files', () => {
    expect(rules('const v = process.env ?? fallback;')).toEqual(['HW1-env-default']);
    expect(rules('const v = input.env || process.env;')).toEqual(['HW1-env-default']);
    expect(rules('const v = process.env.KEY;', { file: 'packages/x/src/testing/env.ts' })).toEqual([]);
    expect(rules('const v = process.env.KEY;', { file: 'packages/x/bin.ts' })).toEqual([]);
  });

  it('consumer mode never applies jini-only rules', () => {
    expect(rules('let s = 0; const k = process.env.KEY; fetch(url);', { mode: 'consumer' })).toEqual([]);
  });
});

describe('HW3 module state', () => {
  it('const collections other than Map/Set, non-new initializers and computed constructors pass', () => {
    expect(rules('const a = new WeakMap(); const b = new Array(); const c = Map; const d = new ns.Map(); const e;')).toEqual([]);
  });

  it('const ReadonlySet annotations pass while plain Set annotations fail', () => {
    expect(rules('const a: ReadonlySet<string> = new Set();')).toEqual([]);
    expect(rules('const a: Set<string> = new Set();')).toEqual(['HW3-module-state']);
  });

  it('class members, namespaces and for-loop heads are not module state', () => {
    expect(rules('class A { m() { let x = 0; } } namespace N { let y = 0; }')).toEqual([]);
    expect(rules('for (let i = 0; i < 1; i++) {}')).toEqual(['HW3-module-state']);
    expect(rules('try {} catch (e) {}')).toEqual([]);
  });
});

describe('HW4 injected fetch', () => {
  it('a server-only rule', () => {
    expect(rules('fetch(url);', { server: false })).toEqual([]);
  });

  it('local fetch bindings: catch clause, block declaration, function declaration and imports', () => {
    for (const source of [
      'try {} catch (fetch) { fetch(url); }',
      'function load() { const fetch = make(); return fetch(url); }',
      'function fetch() {} fetch(url);',
      'import fetch from "x"; fetch(url);',
      'import { fetch } from "x"; fetch(url);',
      'import { other as fetch } from "x"; fetch(url);',
      'function load([fetch]) { return fetch(url); }',
      'function load({ inner: { fetch } }) { return fetch(url); }',
    ]) expect(rules(source)).toEqual([]);
  });

  it('non-binding local names stay global calls', () => {
    for (const source of [
      'try {} catch { fetch(url); }',
      'try {} catch (error) { fetch(url); }',
      'function load([, other]) { return fetch(url); }',
      'function load({ fetch: renamed }) { return fetch(url); }',
      'import "x"; fetch(url);',
      'import * as fetch from "x"; fetch(url);',
      'import other from "x"; fetch(url);',
      'import { fetch as other } from "x"; fetch(url);',
      'const fetch = globalThis["fetch"]; fetch(url);',
      'function other() {} fetch(url);',
      'const { other } = input; fetch(url);',
    ]) expect(rules(source)).toEqual(['HW4-injected-fetch']);
  });

  it('a local fetch rebound from another object counts as injected', () => {
    expect(rules('const fetch = window.fetch; fetch(url);')).toEqual([]);
  });

  it('member calls: only globalThis.fetch is global', () => {
    expect(rules('globalThis["fetch"](url);')).toEqual(['HW4-injected-fetch']);
    expect(rules('ports.fetch(url); this.fetch(url); a.b.fetch(url); call(url); f()(url);')).toEqual([]);
  });
});

describe('HW6 boot default', () => {
  it('non-?? defaults, non-insecure identifiers and uncovered non-env sides', () => {
    expect(rules('const v = process.env.KEY || "dev-only-insecure-x";', { mode: 'consumer' })).toEqual([]);
    expect(rules('const v = input.x ?? DEFAULT_OWNER_TOKEN;', { mode: 'consumer' })).toEqual([]);
    expect(rules('const v = process.env.KEY ?? "dev-only-insecure-x";', { mode: 'consumer' })).toEqual(['HW6-boot-default']);
  });

  it('identity is the env key when present, else the left-hand text', () => {
    const fromEnv = scan('const v = process.env.KEY ?? "dev-only-insecure-a";', { mode: 'consumer' })[0];
    const sameKey = scan('const w = process.env.KEY ?? DEFAULT_ADMIN_PASSWORD;', { mode: 'consumer' })[0];
    expect(fromEnv?.fingerprint).toBe(sameKey?.fingerprint);
    const fromText = scan('const v = input.secret ?? "dev-only-insecure-a";', { mode: 'consumer' })[0];
    expect(fromText?.fingerprint).not.toBe(fromEnv?.fingerprint);
  });
});

describe('HW8 provider url', () => {
  it('template middle/tail spans and case-insensitive hosts', () => {
    expect(rules('const u = `${a}x${b}https://api.v/${c}`;')).toEqual(['HW8-provider-url']);
    expect(rules('const u = `${a}https://API.v`;')).toEqual(['HW8-provider-url']);
    expect(rules('const u = `${a}http://api.v`;')).toEqual([]);
  });

  it('adapter file names: .adapter.<ext>, kernel/ and provider. prefixes own URLs', () => {
    for (const file of ['src/x.adapter.ts', 'src/kernel/x.ts', 'src/provider.ts', 'catalog.ts', 'adapter/x.ts']) expect(rules('const u = "https://api.v";', { file })).toEqual([]);
    expect(rules('const u = "https://api.v";', { file: 'src/myadapters/x.ts' })).toEqual(['HW8-provider-url']);
  });
});

describe('HW2 vendor and HW9 plugin imports', () => {
  it('vendor patterns: scoped families, *-sdk names and exact names only', () => {
    for (const specifier of ['@aws-sdk/client-s3', '@e2b/code-interpreter', 'foo-sdk', '@acme/sdk', '@acme/thing-sdk/sub', 'puppeteer-core', 'node-pty', 'stripe/lib', '@google/genai']) expect(rules(`import "${specifier}";`)).toEqual(['HW2-vendor-adapter']);
    for (const specifier of ['stripey', 'pgx', '@acme/sdkish', 'my-sdk-tools', '@google/other', 'sharpen']) expect(rules(`import "${specifier}";`)).toEqual([]);
  });

  it('HW9 requires both identities: no host identity, no resolution, unresolved and same-plugin edges pass', () => {
    const base: Partial<HardwiringSource> = { mode: 'consumer', file: 'site.ts', resolveImport: (specifier) => specifier === 'none' ? undefined : specifier + '.ts' };
    const plugin = (file: string) => file.startsWith('site') ? 'site' : file.startsWith('agent') ? 'agent' : undefined;
    expect(rules('import "agent";', base)).toEqual([]);
    expect(rules('import "agent";', { ...base, pluginIdentity: plugin, resolveImport: undefined })).toEqual([]);
    expect(rules('import "none";', { ...base, pluginIdentity: plugin })).toEqual([]);
    expect(rules('import "agent";', { ...base, file: 'host.ts', pluginIdentity: plugin })).toEqual([]);
    const [hit] = scan('import "agent";', { ...base, pluginIdentity: plugin });
    expect(hit?.reason).toBe('Import crosses site → agent; plugins must communicate through host ports.');
  });
});

describe('HW5 jini export', () => {
  it('skips files that import a @jini-ai owner, and reports nothing without an inventory', () => {
    expect(rules('import "@jini-ai/x"; export function f() {}', { mode: 'consumer', jiniExports: new Set(['f']) })).toEqual([]);
    expect(rules('export function f() {}', { mode: 'consumer' })).toEqual([]);
    expect(rules('export function f() {}', { mode: 'jini', jiniExports: new Set(['f']) })).toEqual([]);
  });
});

describe('violation shape', () => {
  it('records 1-based line and the file name, hashing the identity', () => {
    const [v] = scan('\n\nlet cache = 0;');
    expect(v).toMatchObject({ rule: 'HW3-module-state', file: 'packages/daemon/src/service.ts', line: 3 });
    expect(v?.reason).toBe('Module state must be instance-owned; readonly collections or explicitly reviewed path-keyed locks may be retained.');
  });
});

describe('inspectPublicGraph', () => {
  it('scans an entry listed twice once and follows only resolved edges', () => {
    expect(graph({ 'entry.ts': 'import "./a"; import "pkg";', 'a.ts': 'import "react";' }, ['entry.ts', 'entry.ts'])).toHaveLength(1);
  });

  it('node_modules/react paths count as React edges', () => {
    expect(graph({ 'entry.ts': 'import "../node_modules/react-dom/index.js";' }).map((v) => v.reason)).toEqual(['Public-site runtime graph must not load React or React DOM.']);
    expect(graph({ 'entry.ts': 'import "reactive"; import "preact";' })).toEqual([]);
  });

  it('JSX inside installed node_modules files is not an authored implicit React edge', () => {
    expect(graph({ '/root/node_modules/x/view.jsx': 'export const v = <div />;' }, ['/root/node_modules/x/view.jsx'])).toEqual([]);
  });

  it('implicit JSX reports one violation at the first element: fragments and self-closing elements too', () => {
    for (const source of ['export const v = <></>;', 'export const v = <a><b /></a>;', 'export const v = 1;\nexport const w = <br />;']) {
      const found = graph({ 'entry.tsx': source }, ['entry.tsx']);
      expect(found.map((v) => [v.rule, v.reason])).toEqual([['HW7-public-react', 'Automatic JSX runtime imports React into the public-site bundle.']]);
    }
    expect(graph({ 'entry.tsx': 'export const v = 1;\nexport const w = <br />;' }, ['entry.tsx'])[0]?.line).toBe(2);
  });

  it('node_modules display files collapse to one line-1 package violation keyed by the package', () => {
    const found = inspector.inspectPublicGraph({ entries: ['a.tsx'], readSource: () => 'import "react"; export const v = <div />;', resolveImport: () => undefined, displayFile: () => 'node_modules/pkg' });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ file: 'node_modules/pkg', line: 1, reason: 'Public-site dependency package loads React or React DOM.' });
  });

  it('an authored file reports every React edge and its implicit JSX separately', () => {
    expect(graph({ 'entry.tsx': 'import "react"; import "react-dom"; export const v = <div />;' }, ['entry.tsx'])).toHaveLength(3);
  });
});
