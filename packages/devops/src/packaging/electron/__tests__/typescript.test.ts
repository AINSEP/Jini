import assert from 'node:assert/strict';
import { test } from 'vitest';
import ts from 'typescript';
import { createTypeScriptImportReader } from '../typescript.js';
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
