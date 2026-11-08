import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { checkNoCrossPackage } from '../check-no-cross-package.js';

const checker = fileURLToPath(new URL('../check-no-cross-package.ts', import.meta.url));
const loader = createRequire(import.meta.url).resolve('tsx');
const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture({ source = 'export interface Existing {}', declaration = source } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'jini-s3-checker-'));
  temporary.push(directory);
  const root = join(directory, 'repo'), baselineDir = join(directory, 'snapshot');
  function write(file: string, text: string) {
    const target = join(root, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text);
  }
  function git(...args: string[]) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
  write('.gitignore', '**/build/\n');
  for (const name of ['core', 'platform', 'ui']) {
    write(`packages/${name}/package.json`, JSON.stringify({ name: `@jini-ai/${name}`, scripts: { build: 'tsc -p tsconfig.types.json' } }));
    write(`packages/${name}/tsconfig.types.json`, JSON.stringify({ compilerOptions: { declaration: true, rootDir: 'src', outDir: 'build/types', module: 'ESNext' }, include: ['src'] }));
    write(`packages/${name}/src/index.ts`, name === 'platform' ? source : 'export interface Existing {}');
    write(`packages/${name}/build/types/index.d.ts`, name === 'platform' ? declaration : 'export interface Existing {}');
  }
  git('init', '--quiet'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test');
  git('add', '--', '.gitignore', 'packages'); git('commit', '--quiet', '-m', 'original pin');
  const base = git('rev-parse', 'HEAD');
  const cli = (destination = baselineDir, pinnedBase = base) => spawnSync(process.execPath,
    ['--import', loader, checker, '--base', pinnedBase, '--write-baseline', destination],
    { cwd: root, encoding: 'utf8', env: { ...process.env, JINI_DECLARATION_BASELINE_DIR: '' } });
  const check = () => checkNoCrossPackage({ root, base, baselineDir });
  return { directory, root, baselineDir, base, write, git, cli, check };
}

test('F1 CLI writes a reproducible original-pin manifest with the actual nonstandard build mapping', () => {
  const f = fixture(); const result = f.cli();
  expect(result.status, result.stderr).toBe(0);
  const manifest = JSON.parse(readFileSync(join(f.baselineDir, 'manifest.json'), 'utf8'));
  expect(manifest.base).toBe(f.base);
  expect(Object.keys(manifest.outputs).sort()).toEqual(['packages/core/src/index.ts', 'packages/platform/src/index.ts', 'packages/ui/src/index.ts']);
  expect(manifest.outputs['packages/platform/src/index.ts']).toEqual(['packages/platform/build/types/index.d.ts']);
  expect(readFileSync(join(f.baselineDir, 'packages/platform/build/types/index.d.ts'), 'utf8')).toBe('export interface Existing {}');
});

test('F1 roundtrip preserves unchanged old declaration edges and rejects a newly emitted forbidden edge', () => {
  const old = "export type Old = import('@jini-ai/ui').Old;";
  const f = fixture({ declaration: old });
  expect(f.cli().status).toBe(0);
  f.write('packages/platform/src/index.ts', 'export interface Changed {}');
  expect(f.check()).toEqual([]);
  f.write('packages/platform/build/types/index.d.ts', old + "\nexport type New = import('@jini-ai/ui/new').New;");
  expect(f.check()).toEqual([{ rule: 'XP3', file: 'packages/platform/src/index.ts', specifier: '@jini-ai/ui/new' }]);
});

test('F1 writer refuses HEAD different from the requested provenance', () => {
  const f = fixture(); f.write('README.md', 'different head'); f.git('add', '--', 'README.md'); f.git('commit', '--quiet', '-m', 'later head');
  expect(f.cli().status).not.toBe(0);
});

test('F1 writer refuses dirty tracked source', () => {
  const f = fixture(); f.write('packages/platform/src/index.ts', 'export interface Dirty {}');
  expect(f.cli().status).not.toBe(0);
});

test('F1 writer refuses a missing emitted declaration', () => {
  const f = fixture(); rmSync(join(f.root, 'packages/platform/build/types/index.d.ts'));
  expect(f.cli().status).not.toBe(0);
});

test.each(['source', 'ancestor', 'relative', 'symlink'])('F1 writer refuses unsafe %s destination', kind => {
  const f = fixture();
  const destinations: Record<string, string> = { source: join(f.root, 'snapshot'), ancestor: f.directory, relative: '../relative' };
  symlinkSync(f.root, join(f.directory, 'alias'), 'dir');
  destinations.symlink = join(f.directory, 'alias', 'snapshot');
  expect(f.cli(destinations[kind]!).status).not.toBe(0);
});

test('F1 writer refuses to overwrite an immutable snapshot', () => {
  const f = fixture(); expect(f.cli().status).toBe(0);
  const manifest = readFileSync(join(f.baselineDir, 'manifest.json'), 'utf8');
  expect(f.cli().status).not.toBe(0);
  expect(readFileSync(join(f.baselineDir, 'manifest.json'), 'utf8')).toBe(manifest);
});
