import assert from 'node:assert/strict';
import { test } from 'vitest';
import ts from 'typescript';
import { createTypeScriptImportReader, runtimeImportReferences } from '../typescript.js';
test('AST adapter recognizes static exports and literal dynamic imports but ignores comments/local require/nonliteral import', () => {
  const imports = createTypeScriptImportReader({ compiler: ts });
  assert.deepEqual(imports.imports({ file: 'built.js', source: [
    'import fs from "node:fs";', 'export * from "./other.js";', 'const a = import("./lazy.js");',
    '// import "commented";', '/* import "block"; */', 'const require = x => x; require("local");',
    'const target = "unknown"; import(target);',
  ].join('\n') }), ['node:fs', './other.js', './lazy.js']);
});
test('AST adapter recognizes every CommonJS form and createRequire aliases', () => {
  const imports = createTypeScriptImportReader({ compiler: ts });
  assert.deepEqual(imports.imports({ file: 'built.ts', source: [
    'import { createRequire as makeRequire } from "node:module";',
    'const load = makeRequire(import.meta.url);', 'load("alias");', 'load.resolve("alias-resolve");',
    'require("commonjs");', 'require.resolve("commonjs-resolve");',
    'makeRequire(import.meta.url)("inline");', 'makeRequire(import.meta.url).resolve("inline-resolve");',
    'import type { Thing } from "erased";', 'export { type Thing } from "also-erased";',
    'import(`literal-template`);', 'const text = "require(\\"fake\\")";',
  ].join('\n') }), ['node:module', 'alias', 'alias-resolve', 'commonjs', 'commonjs-resolve', 'inline', 'inline-resolve', 'literal-template']);
});
test('lexically shadowed require never hides the outer CommonJS boundary', () => {
  const imports = createTypeScriptImportReader({ compiler: ts });
  assert.deepEqual(imports.imports({ file: 'built.js', source: [
    'require("outer");', '{ const require = x => x; require("local"); }',
    'function local(require) { require("parameter"); }',
    'require.resolve("outer-resolve");',
  ].join('\n') }), ['outer', 'outer-resolve']);
});
test('a local function declaration named require is a capability check, not a module require', () => {
  const imports = createTypeScriptImportReader({ compiler: ts });
  // Shape of @jini-ai/db kernel-core: a factory-local `function require(capability)` called from nested functions.
  assert.deepEqual(imports.imports({ file: 'built.js', source: [
    'export function createKernel() {',
    '  function require(capability) { if (!caps[capability]) throw new Error(capability); }',
    '  async function transaction() { require("interactiveTransactions"); }',
    '  return { require, backupTo() { require("backup"); } };',
    '}',
    'require("outer");',
    '{ class require {} require("class-local"); }',
  ].join('\n') }), ['outer']);
});

test('keeps runtime imports distinct from type-only references in a pre-parsed TSX tree', () => {
  const source = [
    'import defaultValue, { type T } from "kept";',
    'import { type S } from "erased";',
    'import type Alias = require("types");',
    'import runtime = require("runtime");',
    'export function render() { return <div>{import("lazy")}</div>; }',
  ].join('\n');
  const file = 'built.tsx';
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.deepEqual(runtimeImportReferences({ compiler: ts, file, source: 'throw new Error("not the parsed file");' }, { tree }), [
    { specifier: 'kept', kind: 'import', syntax: 'import', typeOnly: false, line: 1, deferred: false },
    { specifier: 'erased', kind: 'import', syntax: 'import', typeOnly: true, line: 2, deferred: false },
    { specifier: 'types', kind: 'require', syntax: 'import-equals', typeOnly: true, line: 3, deferred: false },
    { specifier: 'runtime', kind: 'require', syntax: 'import-equals', typeOnly: false, line: 4, deferred: false },
    { specifier: 'lazy', kind: 'import', syntax: 'dynamic', typeOnly: false, line: 5, deferred: true },
  ]);
  assert.deepEqual(createTypeScriptImportReader({ compiler: ts }).imports({ file, source }), ['kept', 'runtime', 'lazy']);
});
