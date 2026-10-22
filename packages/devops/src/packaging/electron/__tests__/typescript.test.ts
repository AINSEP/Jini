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
