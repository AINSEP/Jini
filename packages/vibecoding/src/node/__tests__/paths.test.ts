import { createProjectPaths } from './filesystem.js';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { assertCandidatePaths, canonicalPath, projectLimits } from '../paths.js';
import { openFileTreeProject } from './filesystem.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
test.each(['../x', '/absolute', 'a/../b', 'C:/x', '\\\\server\\share', 'a\\b', 'a//b',
  'con', 'CON.txt', 'nul.json', 'COM1.js', 'LPT9.log', 'COM¹.txt', 'a:stream', 'a<', 'a>', 'a"', 'a|', 'a?', 'a*', 'a\0', 'a\x1f', 'a.', 'a '])(
  'refuses nonportable path %j', relativePath => {
    expect(() => canonicalPath({ relativePath, maxDepth: 32 })).toThrow();
  },
);
test('enforces path length and depth while preserving Unicode filename spelling', () => {
  expect(canonicalPath({ relativePath: 'a'.repeat(200), maxDepth: 32 })).toBe('a'.repeat(200));
  expect(() => canonicalPath({ relativePath: 'a'.repeat(201), maxDepth: 32 })).toThrow(/200/);
  expect(() => canonicalPath({ relativePath: 'a/b/c', maxDepth: 2 })).toThrow(/depth/);
  expect(canonicalPath({ relativePath: 'e\u0301.ts', maxDepth: 32 })).toBe('e\u0301.ts');
});
test.each([['A.ts', 'a.ts'], ['é.ts', 'e\u0301.ts'], ['Src/a', 'src/b'], ['a', 'a/b']])(
  'refuses candidate collision %j / %j', (left, right) => {
    expect(() => assertCandidatePaths({ paths: [left, right] })).toThrow(/collision/);
  },
);
test('candidate checks permit a case-only rename after the old path is deleted', () => {
  expect(() => assertCandidatePaths({ paths: ['INDEX.ts', 'other.ts'] })).not.toThrow();
});
test('guarded reader and host policy exclude secrets, dependencies and escaped links', async () => {
  const base = await fs.mkdtemp(join(tmpdir(), 'vibe-paths-')); roots.push(base);
  const root = join(base, 'app'); await fs.mkdir(root);
  const paths = createProjectPaths({ root, policy: { allows: ({ relativePath }) => relativePath.endsWith('.ts') }, limits: projectLimits({}) });
  for (const relativePath of ['.git/a.ts', 'node_modules/a.ts', 'dist/a.ts', '.env', '.ENV.local/a.ts', 'readme.md']) {
    expect(() => paths.check({ relativePath })).toThrow();
  }
  await fs.mkdir(join(base, 'outside'));
  await fs.symlink(join(base, 'outside'), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => paths.reader.resolve({ relativePath: 'linked/new.ts' })).toThrow(/outside/);
});
test('stateDir cannot be served under the app root, including a physical alias', async () => {
  const base = await fs.mkdtemp(join(tmpdir(), 'vibe-state-')); roots.push(base);
  const root = join(base, 'app'); await fs.mkdir(root);
  await expect(openFileTreeProject({ root, stateDir: join(root, 'state'), policy: { allows: () => true } })).rejects.toMatchObject({ code: 'INVALID_PATH' });
  await fs.symlink(root, join(base, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(openFileTreeProject({ root, stateDir: join(base, 'alias'), policy: { allows: () => true } })).rejects.toMatchObject({ code: 'INVALID_PATH' });
});
