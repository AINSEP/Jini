/**
 * @file Each lexical rule and each arm of the filesystem-resolved containment check in
 * `package-paths.ts`, alone, pinned by its own error message. Closes Stryker run-2 survivors at
 * package-paths.ts:48,53,54,58,59,113,129 (the `relative !== ".."` containment arm and the
 * deepest-existing-ancestor walk under a symlinked directory). Real temp directories, cleaned up.
 */
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { PackagePathViolation } from '../../package-paths.js';
import { assertContainedOnDisk, normalizePackageEntryPath } from '../test-support.js';

const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

describe('normalizePackageEntryPath: each lexical rule alone', () => {
  test('NUL byte -> its own message', () => {
    expect(() => normalizePackageEntryPath('a\0b')).toThrow(new PackagePathViolation({ message: "package entry path contains a NUL byte: 'a\0b'" }));
  });

  test.each(['/abs', '\\abs', 'C:rel', 'z:/x', 'C:\\x'])('%j -> must be relative', (raw) => {
    expect(() => normalizePackageEntryPath(raw)).toThrow(`package entry path must be relative: '${raw}'`);
  });

  test.each(['..', '../x', 'a/../..', 'a/../../b', '.', 'a/..', '', 'a\\..\\..'])('%j -> escapes the package root', (raw) => {
    expect(() => normalizePackageEntryPath(raw)).toThrow(`package entry path escapes the package root: '${raw}'`);
  });

  test.each([
    ['foo/C:x', 'foo/C:x'], ['a/./b', 'a/b'], ['a/b/../c', 'a/c'], ['..a', '..a'], ['a..', 'a..'], ['./a', 'a'],
  ])('%j is accepted as %j (a drive-like or dot-like segment that is not leading is just a name)', (raw, normalized) => {
    expect(normalizePackageEntryPath(raw)).toBe(normalized);
  });

  // Observation (not changed here): './' and 'a/../' normalize to './', not '.', so they pass this rule
  // and resolve to the root itself; containment still holds (see the root-self test below).
  test("'./' is not refused lexically and stays at the root", () => {
    expect(normalizePackageEntryPath('./')).toBe('./');
  });

  test('the error is a PackagePathViolation', () => {
    expect(() => normalizePackageEntryPath('..')).toThrow(PackagePathViolation);
  });
});

describe('assertContainedOnDisk: filesystem-resolved containment', () => {
  test('a symlink resolving to EXACTLY the parent of the root is refused (relative === "..")', async () => {
    const parent = await tempDir('pp-parent-');
    const root = path.join(parent, 'root');
    await mkdir(root);
    await symlink(parent, path.join(root, 'up'));
    await expect(assertContainedOnDisk(root, 'up')).rejects.toThrow("package entry resolves outside the package root via a symlink: 'up'");
  });

  test('a symlink to a sibling directory is refused (relative starts with "../")', async () => {
    const parent = await tempDir('pp-sibling-');
    const root = path.join(parent, 'root');
    await mkdir(root);
    await mkdir(path.join(parent, 'rootling'));
    await symlink(path.join(parent, 'rootling'), path.join(root, 'side'));
    await expect(assertContainedOnDisk(root, 'side/f.txt')).rejects.toThrow(PackagePathViolation);
  });

  test('a not-yet-created path SEVERAL levels under an escaping symlinked directory is refused', async () => {
    const root = await tempDir('pp-root-');
    const outside = await tempDir('pp-outside-');
    await symlink(outside, path.join(root, 'link'));
    await expect(assertContainedOnDisk(root, 'link/missing-1/missing-2/f.txt')).rejects.toThrow("package entry resolves outside the package root via a symlink: 'link/missing-1/missing-2/f.txt'");
  });

  test('a symlink that stays inside the root, and a missing deep path, are accepted', async () => {
    const root = await tempDir('pp-inside-');
    const realRoot = await realpath(root);
    await mkdir(path.join(root, 'real'));
    await symlink(path.join(root, 'real'), path.join(root, 'alias'));
    await expect(assertContainedOnDisk(root, 'alias/new/f.txt')).resolves.toBe(path.join(realRoot, 'alias', 'new', 'f.txt'));
    await expect(assertContainedOnDisk(root, 'a/b/c/d.txt')).resolves.toBe(path.join(realRoot, 'a', 'b', 'c', 'd.txt'));
  });

  test('a symlink pointing at the root itself is inside (relative === "")', async () => {
    const root = await tempDir('pp-self-');
    await symlink(root, path.join(root, 'self'));
    await expect(assertContainedOnDisk(root, 'self')).resolves.toBe(path.join(await realpath(root), 'self'));
  });
});
