import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { assertDistImportsDeclared, undeclaredDistImports } from '../imports.js';
import type { ImportAliasPort, ImportReaderPort } from '../ports.js';
import { memoryFs } from './memory-fs.js';

/** Each fake file's body is its own path, and `graph` maps that path to its import specifiers. */
function input(graph: Record<string, readonly string[]>, optional: { declared?: readonly string[]; aliases?: Record<string, string>; missing?: readonly string[] } = {}) {
  const files = Object.fromEntries(Object.keys(graph).filter(file => !optional.missing?.includes(file)).map(file => [file, file]));
  const fs = memoryFs({ files });
  const imports: ImportReaderPort = { imports: ({ file, source }) => { assert.equal(source, file); return graph[file] ?? []; } };
  const aliasCalls: Parameters<ImportAliasPort['resolve']>[0][] = [];
  const aliases: ImportAliasPort = { resolve: request => { aliasCalls.push(request); return optional.aliases?.[request.specifier]; } };
  return { required: { distDir: '/dist', entry: '/dist/main.js', declared: new Set(optional.declared ?? []), fs, imports, aliases }, fs, aliasCalls };
}

describe('undeclaredDistImports', () => {
  test('a missing entry file is reported and nothing is read', () => {
    const { required, fs } = input({ '/dist/main.js': [] }, { missing: ['/dist/main.js'] });
    assert.deepEqual(undeclaredDistImports(required), ['main.js (entry file not found)']);
    assert.deepEqual(fs.calls, []);
  });
  test('a relative entry is resolved against the working directory before walking', () => {
    const { required } = input({ [`${process.cwd()}/rel.js`]: ['undeclared'] });
    assert.deepEqual(undeclaredDistImports({ ...required, distDir: process.cwd(), entry: 'rel.js' }), ['undeclared (rel.js)']);
  });
  test('builtins, node: specifiers, builtin subpaths and declared packages pass', () => {
    const { required } = input({ '/dist/main.js': ['fs', 'node:test', 'fs/promises', 'declared', 'declared/sub', '@scope/pkg/deep/file.js'] }, { declared: ['declared', '@scope/pkg'] });
    assert.deepEqual(undeclaredDistImports(required), []);
  });
  test('an undeclared bare import is reported by package name with the importing file', () => {
    const { required } = input({ '/dist/main.js': ['left-pad/index.js', '@scope/pkg/x', '@scope'] });
    assert.deepEqual(undeclaredDistImports(required), ['left-pad (main.js)', '@scope/pkg (main.js)', '@scope (main.js)']);
  });
  test('a declared scope alone does not declare its packages', () => {
    const { required } = input({ '/dist/main.js': ['@scope/pkg'] }, { declared: ['@scope'] });
    assert.deepEqual(undeclaredDistImports(required), ['@scope/pkg (main.js)']);
  });
  test('relative and absolute imports are followed and their own imports checked', () => {
    const { required } = input({ '/dist/main.js': ['./lib/a.js', '/dist/b.js'], '/dist/lib/a.js': ['from-a'], '/dist/b.js': ['from-b'] });
    assert.deepEqual(undeclaredDistImports(required), ['from-a (lib/a.js)', 'from-b (b.js)']);
  });
  test('a missing relative target is reported once even when imported twice', () => {
    const { required } = input({ '/dist/main.js': ['./gone.js', './sub.js'], '/dist/sub.js': ['./gone.js'] });
    assert.deepEqual(undeclaredDistImports(required), ['./gone.js (main.js: file not found)']);
  });
  test('a cycle back to the entry is not walked twice', () => {
    const { required, fs } = input({ '/dist/main.js': ['./sub.js'], '/dist/sub.js': ['./main.js'] });
    assert.deepEqual(undeclaredDistImports(required), []);
    assert.deepEqual(fs.calls, [{ op: 'read', path: '/dist/main.js' }, { op: 'read', path: '/dist/sub.js' }]);
  });
  test('the alias port is asked first with the importing file and dist root, and its target wins', () => {
    const { required, aliasCalls } = input({ '/dist/main.js': ['#internal', './x.js'], '/dist/alias.js': ['from-alias'] }, { aliases: { '#internal': '/dist/alias.js', './x.js': '/dist/alias.js' } });
    assert.deepEqual(undeclaredDistImports(required), ['from-alias (alias.js)']);
    assert.deepEqual(aliasCalls[0], { specifier: '#internal', fromFile: '/dist/main.js', distDir: '/dist' });
  });
  test('a missing alias target is reported with the alias specifier', () => {
    const { required } = input({ '/dist/main.js': ['#gone'] }, { aliases: { '#gone': '/dist/none.js' } });
    assert.deepEqual(undeclaredDistImports(required), ['#gone (main.js: file not found)']);
  });
  test('relative imports that leave distDir are followed and read (reported, not fixed)', () => {
    // Containment weakness: nothing keeps the walk inside distDir, so `../` imports and absolute
    // specifiers read files outside the built tree. Pinned as current behaviour, not endorsed.
    const { required, fs } = input({ '/dist/main.js': ['../outside.js', '/etc/elsewhere.js'], '/outside.js': [], '/etc/elsewhere.js': [] });
    assert.deepEqual(undeclaredDistImports(required), []);
    assert.deepEqual(fs.calls.map(call => call.op === 'read' && call.path), ['/dist/main.js', '/outside.js', '/etc/elsewhere.js']);
  });
});

describe('assertDistImportsDeclared', () => {
  test('a clean walk does not throw', () => {
    const { required } = input({ '/dist/main.js': ['fs'] });
    assert.doesNotThrow(() => assertDistImportsDeclared(required));
  });
  test('problems are listed one per line in the error', () => {
    const { required } = input({ '/dist/main.js': ['a', './gone.js'] });
    assert.throws(() => assertDistImportsDeclared(required), { message: 'built entry imports 2 undeclared packages or missing files:\n  a (main.js)\n  ./gone.js (main.js: file not found)' });
  });
});
