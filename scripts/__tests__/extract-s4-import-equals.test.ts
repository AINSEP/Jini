/**
 * @file EXTRACT-S4 Main F5: `import x = require("@jini-ai/x")` is a package edge like any other
 * import, in sources (XP1/XP2) and in emitted declarations (XP3). Same throwaway-repo harness as
 * check-no-cross-package.test.ts, copied so that frozen suite stays unchanged.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { afterEach, expect, test } from 'vitest';
import { checkNoCrossPackage } from '../check-no-cross-package.js';

const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture(options: { source?: string; declaration?: string } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'jini-import-equals-'));
  temporary.push(directory);
  const root = join(directory, 'repo'), baselineDir = join(directory, 'baseline');
  function write(file: string, text: string) {
    const target = join(root, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text);
  }
  function git(...args: string[]) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
  for (const name of ['core', 'platform', 'ui']) {
    write(`packages/${name}/package.json`, JSON.stringify({ name: `@jini-ai/${name}`, scripts: { build: 'tsc -p tsconfig.json' } }));
    write(`packages/${name}/tsconfig.json`, JSON.stringify({ compilerOptions: { declaration: true, rootDir: 'src', outDir: 'dist', module: 'ESNext' }, include: ['src'] }));
    write(`packages/${name}/src/index.ts`, name === 'platform' ? options.source ?? 'export interface Existing {}' : 'export interface Existing {}');
  }
  const output = 'packages/platform/dist/index.d.ts';
  write(output, options.declaration ?? options.source ?? 'export interface Existing {}');
  git('init', '--quiet'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test');
  git('add', '--', 'packages'); git('commit', '--quiet', '-m', 'pinned fixture');
  const base = git('rev-parse', 'HEAD');
  mkdirSync(dirname(join(baselineDir, output)), { recursive: true });
  copyFileSync(join(root, output), join(baselineDir, output));
  writeFileSync(join(baselineDir, 'manifest.json'), JSON.stringify({ base, outputs: { 'packages/platform/src/index.ts': [output] } }));
  function change(file: string, source: string, declaration = source) {
    write(file, source);
    const emitted = file.replace('/src/', '/dist/').replace(/\.[cm]?tsx?$/, '.d.ts');
    write(emitted, declaration); write(emitted.replace(/\.d\.ts$/, '.js'), 'export {};\n');
    git('add', '--', file);
  }
  return { root, baselineDir, base, write, git, change, check: () => checkNoCrossPackage({ root, baselineDir, base }) };
}

/** What tsc really emits for an exported type reached through import-equals (independent of the checker). */
function emittedDeclaration(source: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'jini-import-equals-emit-'));
  temporary.push(directory);
  const file = join(directory, 'index.ts');
  writeFileSync(file, source);
  let declaration = '';
  ts.createProgram([file], { declaration: true, emitDeclarationOnly: true, module: ts.ModuleKind.CommonJS, noResolve: true, skipLibCheck: true })
    .emit(undefined, (name, text) => { if (name.endsWith('.d.ts')) declaration = text; });
  return declaration;
}

const importEquals = "import ui = require('@jini-ai/ui'); export type X = ui.X;";

test('XP1 and XP3 reject a new source with an import-equals edge', () => {
  const f = fixture(); f.change('packages/platform/src/new.ts', importEquals);
  expect(f.check()).toEqual([
    { rule: 'XP1', file: 'packages/platform/src/new.ts', specifier: '@jini-ai/ui' },
    { rule: 'XP3', file: 'packages/platform/src/new.ts', specifier: '@jini-ai/ui' },
  ]);
});

test('XP1 and XP3 reject an import-equals edge in a moved source and its declaration', () => {
  const f = fixture({ source: importEquals });
  f.git('mv', 'packages/platform/src/index.ts', 'packages/platform/src/renamed.ts');
  f.write('packages/platform/dist/renamed.d.ts', importEquals);
  expect(f.check().map(v => [v.rule, v.specifier])).toEqual([['XP1', '@jini-ai/ui'], ['XP3', '@jini-ai/ui']]);
});

test('XP2 rejects a newly added import-equals specifier and permits the unchanged one', () => {
  const f = fixture({ source: importEquals });
  f.change('packages/platform/src/index.ts', `${importEquals}\n// changed\n`);
  expect(f.check()).toEqual([]);
  f.change('packages/platform/src/index.ts', `${importEquals} import other = require('@jini-ai/ui/other'); export type Y = other.Y;`, importEquals);
  expect(f.check()).toEqual([{ rule: 'XP2', file: 'packages/platform/src/index.ts', specifier: '@jini-ai/ui/other' }]);
});

test('XP3 rejects a declaration-only import-equals edge and permits the unchanged pinned one', () => {
  const f = fixture();
  f.change('packages/platform/src/index.ts', "import type { X } from '@jini-ai/core'; export type Y = X;", importEquals);
  expect(f.check()).toEqual([{ rule: 'XP3', file: 'packages/platform/src/index.ts', specifier: '@jini-ai/ui' }]);
  const pinned = fixture({ source: 'export interface Existing {}', declaration: importEquals });
  pinned.change('packages/platform/src/index.ts', 'export interface Changed {}', importEquals);
  expect(pinned.check()).toEqual([]);
});

test('import-equals of core and of the own package are allowed; core may import no neighbour', () => {
  const f = fixture();
  f.change('packages/platform/src/new.ts', "import core = require('@jini-ai/core'); import self = require('@jini-ai/platform/self'); export type X = core.X | self.Y;");
  expect(f.check()).toEqual([]);
  const coreFixture = fixture();
  coreFixture.change('packages/core/src/new.ts', importEquals);
  expect(coreFixture.check().map(v => [v.rule, v.specifier])).toEqual([['XP1', '@jini-ai/ui'], ['XP3', '@jini-ai/ui']]);
});

test('the declaration tsc actually emits for import-equals is caught by XP3', () => {
  const emitted = emittedDeclaration(importEquals);
  expect(emitted).toContain("import ui = require('@jini-ai/ui');");
  const f = fixture();
  f.change('packages/platform/src/index.ts', 'export interface Changed {}', emitted);
  expect(f.check()).toEqual([{ rule: 'XP3', file: 'packages/platform/src/index.ts', specifier: '@jini-ai/ui' }]);
});
