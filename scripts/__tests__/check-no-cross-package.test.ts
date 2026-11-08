import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { checkNoCrossPackage } from '../check-no-cross-package.js';

const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture(options: { source?: string; declaration?: string; output?: string } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'jini-cross-package-'));
  temporary.push(directory);
  const root = join(directory, 'repo'), baselineDir = join(directory, 'baseline');
  function write(file: string, text: string) {
    const target = join(root, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text);
  }
  function git(...args: string[]) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
  for (const name of ['core', 'platform', 'ui']) {
    write(`packages/${name}/package.json`, JSON.stringify({ name: `@jini-ai/${name}`, scripts: { build: 'tsc -p tsconfig.json' } }));
    write(`packages/${name}/tsconfig.json`, JSON.stringify({ compilerOptions: { declaration: true, rootDir: 'src', outDir: name === 'platform' ? options.output ?? 'dist' : 'dist', module: 'ESNext' }, include: ['src'] }));
    write(`packages/${name}/src/index.ts`, name === 'platform' ? options.source ?? 'export interface Existing {}' : 'export interface Existing {}');
  }
  const output = `packages/platform/${options.output ?? 'dist'}/index.d.ts`;
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

test.each([
  ['type-only import', "import type { X } from '@jini-ai/ui';"],
  ['inline type import', "import { type X } from '@jini-ai/ui';"],
  ['value import', "import { X } from '@jini-ai/ui';"],
  ['type export', "export type { X } from '@jini-ai/ui';"],
  ['value export', "export { X } from '@jini-ai/ui';"],
  ['dynamic import', "void import('@jini-ai/ui');"],
  ['require', "require('@jini-ai/ui');"],
  ['import type node', "export type X = import('@jini-ai/ui').X;"],
])('XP1 rejects a new source with %s', (_name, source) => {
  const f = fixture(); f.change('packages/platform/src/new.ts', source);
  expect(f.check()).toContainEqual({ rule: 'XP1', file: 'packages/platform/src/new.ts', specifier: '@jini-ai/ui' });
  expect(f.check()).toContainEqual({ rule: 'XP3', file: 'packages/platform/src/new.ts', specifier: '@jini-ai/ui' });
});

test('XP1 and XP3 permit core and same-package imports, and ignore tests', () => {
  const f = fixture();
  f.change('packages/platform/src/new.ts', "import type { X } from '@jini-ai/core'; export type Y = import('@jini-ai/platform/self').Y;");
  f.change('packages/platform/src/__tests__/new.test.ts', "import '@jini-ai/ui';");
  expect(f.check()).toEqual([]);
});

test('XP1 and XP3 fully inspect renamed sources and their declarations', () => {
  const source = "export type X = import('@jini-ai/ui').X;";
  const f = fixture({ source });
  f.git('mv', 'packages/platform/src/index.ts', 'packages/platform/src/renamed.ts');
  f.write('packages/platform/dist/renamed.d.ts', source);
  expect(f.check().map(v => v.rule)).toEqual(['XP1', 'XP3']);
});

test('XP2 permits an unchanged pre-existing edge and XP3 permits its unchanged declaration', () => {
  const f = fixture({ source: "export type X = import('@jini-ai/ui').X;" });
  f.change('packages/platform/src/index.ts', "export type X = import('@jini-ai/ui').X;\n// changed\n");
  expect(f.check()).toEqual([]);
});

test('XP2 rejects a newly introduced specifier in a modified source', () => {
  const f = fixture({ source: "import type { X } from '@jini-ai/ui';" });
  f.change('packages/platform/src/index.ts', "import type { X } from '@jini-ai/ui'; import type { Y } from '@jini-ai/ui/other';");
  expect(f.check().filter(v => v.rule === 'XP2')).toEqual([{ rule: 'XP2', file: 'packages/platform/src/index.ts', specifier: '@jini-ai/ui/other' }]);
});

test('XP3 rejects a new declaration edge even when the modified source imports only core', () => {
  const f = fixture();
  f.change('packages/platform/src/index.ts', "import type { X } from '@jini-ai/core';", "export type X = import('@jini-ai/ui').X;");
  expect(f.check()).toEqual([{ rule: 'XP3', file: 'packages/platform/src/index.ts', specifier: '@jini-ai/ui' }]);
});

test('XP3 reads the configured declaration output rather than assuming dist', () => {
  const f = fixture({ output: 'build/types' });
  f.write('packages/platform/src/index.ts', 'export interface Changed {}');
  f.write('packages/platform/build/types/index.d.ts', "export type X = import('@jini-ai/ui').X;");
  expect(f.check()).toEqual([{ rule: 'XP3', file: 'packages/platform/src/index.ts', specifier: '@jini-ai/ui' }]);
});

test.each(['current', 'baseline', 'mapping', 'directory', 'provenance'])('XP3 fails closed on missing or invalid %s declarations', kind => {
  const f = fixture(); f.change('packages/platform/src/index.ts', 'export interface Changed {}');
  if (kind === 'current') rmSync(join(f.root, 'packages/platform/dist/index.d.ts'));
  if (kind === 'baseline') rmSync(join(f.baselineDir, 'packages/platform/dist/index.d.ts'));
  if (kind === 'mapping') writeFileSync(join(f.baselineDir, 'manifest.json'), JSON.stringify({ base: f.base, outputs: {} }));
  if (kind === 'directory') rmSync(f.baselineDir, { recursive: true });
  if (kind === 'provenance') writeFileSync(join(f.baselineDir, 'manifest.json'), JSON.stringify({ base: 'wrong', outputs: {} }));
  expect(f.check()).toHaveLength(1); expect(f.check()[0]?.rule).toBe('XP3');
});

test('XP3 requires current declarations for added sources too', () => {
  const f = fixture(); f.change('packages/platform/src/new.ts', 'export interface New {}');
  rmSync(join(f.root, 'packages/platform/dist/new.d.ts'));
  expect(f.check()).toHaveLength(1); expect(f.check()[0]?.rule).toBe('XP3');
});

test('XP4 permits only contracts with type declarations and relative type imports inside core', () => {
  const f = fixture();
  f.change('packages/core/src/contracts/cards.ts', "import type { Existing } from '../index.js'; export interface Card { x: Existing } export type Alias = Card; export type { Existing } from '../index.js';");
  expect(f.check()).toEqual([]);
});

test.each([
  'export const value = 1;', 'let value = 1;', 'export function value() {}', 'export class Value {}',
  'export enum Value { X }', 'export const enum Value { X }', 'namespace Value {}',
  'console.log(1);', 'export default interface Value {}', 'export = Value;',
  "import { Existing } from '../index.js';", "import type { X } from 'node:fs';", "import type { X } from 'vendor';",
  "import type { X } from '../../../outside.js';", "export type X = import('node:fs').X;",
])('XP4 rejects invalid contract: %s', source => {
  const f = fixture(); f.change('packages/core/src/contracts/invalid.ts', source);
  expect(f.check().some(v => v.rule === 'XP4')).toBe(true);
});

test('XP4 rejects runtime JavaScript even when its source is type-only', () => {
  const f = fixture(); f.change('packages/core/src/contracts/cards.ts', 'export interface Card {}');
  f.write('packages/core/dist/contracts/cards.js', 'export const runtime = 1;');
  expect(f.check()).toEqual([{ rule: 'XP4', file: 'packages/core/src/contracts/cards.ts', specifier: 'Error: contract JavaScript contains runtime statements' }]);
});

test('core cannot import any Jini package', () => {
  const f = fixture(); f.change('packages/core/src/new.ts', "import type { X } from '@jini-ai/core';");
  expect(f.check().map(v => v.rule)).toEqual(['XP1', 'XP3']);
});

test.each(['dependencies', 'peerDependencies'])('XP5 rejects a new %s edge, including optional peers', section => {
  const f = fixture();
  const file = 'packages/platform/package.json';
  const manifest = JSON.parse(readFileSync(join(f.root, file), 'utf8'));
  manifest[section] = { '@jini-ai/ui': '^1' }; manifest.peerDependenciesMeta = { '@jini-ai/ui': { optional: true } };
  f.write(file, JSON.stringify(manifest));
  expect(f.check()).toEqual([{ rule: 'XP5', file, specifier: '@jini-ai/ui' }]);
});

test('XP5 permits added core and unchanged pre-existing dependencies', () => {
  const f = fixture(); const file = 'packages/platform/package.json';
  const manifest = JSON.parse(readFileSync(join(f.root, file), 'utf8'));
  manifest.dependencies = { '@jini-ai/ui': '^1' }; f.write(file, JSON.stringify(manifest));
  f.git('add', '--', file); f.git('commit', '--quiet', '-m', 'existing edge');
  const base = f.git('rev-parse', 'HEAD'); manifest.dependencies['@jini-ai/core'] = '^1';
  f.write(file, JSON.stringify(manifest));
  expect(checkNoCrossPackage({ root: f.root, base, baselineDir: f.baselineDir })).toEqual([]);
});
