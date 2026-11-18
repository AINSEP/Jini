/** Release-gate hardening: tree fingerprint sampling, isolated packaged-tree copy, payload walk pruning. Second-host names throughout. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, utimesSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { assertPackagedTreeIsolation, fingerprintTree, fingerprintsDiffer, PackagedTreeIsolationError, sampleMovingRoots, walkPayloadFiles, withIsolatedPackagedTree } from '../entry.js';
import { memoryFs } from './memory-fs.js';

const scratch = (prefix: string) => mkdtempSync(path.join(tmpdir(), prefix));

describe('fingerprintTree / sampleMovingRoots', () => {
  test('an absent path fingerprints as not existing and a file as one entry', () => {
    const root = scratch('gate-fp-');
    try {
      expect(fingerprintTree({ path: path.join(root, 'nope') })).toEqual({ exists: false, fileCount: 0, newestMtimeMs: 0 });
      writeFileSync(path.join(root, 'a'), 'a');
      expect(fingerprintTree({ path: path.join(root, 'a') })).toMatchObject({ exists: true, fileCount: 1 });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test('a directory counts nested files and tracks the newest mtime', () => {
    const root = scratch('gate-fp-dir-');
    try {
      mkdirSync(path.join(root, 'n'));
      writeFileSync(path.join(root, 'a'), 'a');
      writeFileSync(path.join(root, 'n', 'b'), 'b');
      utimesSync(path.join(root, 'n', 'b'), 5000, 5000);
      utimesSync(path.join(root, 'a'), 1000, 1000);
      expect(fingerprintTree({ path: root })).toEqual({ exists: true, fileCount: 2, newestMtimeMs: 5_000_000 });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test('fingerprintsDiffer reports existence, count and mtime changes only', () => {
    const base = { exists: true, fileCount: 2, newestMtimeMs: 7 };
    expect(fingerprintsDiffer({ a: base, b: { ...base } })).toBe(false);
    for (const change of [{ exists: false }, { fileCount: 3 }, { newestMtimeMs: 8 }]) expect(fingerprintsDiffer({ a: base, b: { ...base, ...change } })).toBe(true);
  });
  test('sampleMovingRoots fingerprints, pauses once, fingerprints again and names only the roots that changed', () => {
    const order: string[] = [];
    const counts: Record<string, number> = { src: 1, bin: 1 };
    const moving = sampleMovingRoots({ roots: ['src', 'bin'], pause: () => { order.push('pause'); counts.src = 2; },
      fingerprint: ({ path: root }) => { order.push(`fp:${root}`); return { exists: true, fileCount: counts[root]!, newestMtimeMs: 0 }; } });
    expect(moving).toEqual(['src']);
    expect(order).toEqual(['fp:src', 'fp:bin', 'pause', 'fp:src', 'fp:bin']);
  });
  test('sampleMovingRoots with no roots is a configuration error, never a quiet pass', () => {
    expect(() => sampleMovingRoots({ roots: [], pause: () => {}, fingerprint: () => ({ exists: false, fileCount: 0, newestMtimeMs: 0 }) })).toThrow('roots are required');
  });
});

describe('withIsolatedPackagedTree', () => {
  const layout = (root: string) => {
    const checkout = path.join(root, 'checkout');
    const appRoot = path.join(checkout, 'release', 'Acme.app');
    const executablePath = path.join(appRoot, 'Contents', 'MacOS', 'Acme');
    const nodeModulesDir = path.join(appRoot, 'Contents', 'Resources', 'acme', 'node_modules');
    mkdirSync(path.dirname(executablePath), { recursive: true });
    mkdirSync(nodeModulesDir, { recursive: true });
    writeFileSync(executablePath, 'shipped executable');
    writeFileSync(path.join(appRoot, 'app.asar'), 'signed bytes');
    return { checkout, appRoot, targets: { executablePath, nodeModulesDir } };
  };
  test('the ancestor check allows a clean path and refuses node_modules above it, also through a symlink', () => {
    const root = scratch('gate-anc-');
    try {
      const directory = path.join(root, 'checkout', 'nested', 'gate');
      mkdirSync(directory, { recursive: true });
      const alias = path.join(root, 'alias');
      symlinkSync(directory, alias);
      expect(() => assertPackagedTreeIsolation({ directory })).not.toThrow();
      mkdirSync(path.join(root, 'checkout', 'node_modules'));
      expect(() => assertPackagedTreeIsolation({ directory })).toThrow(`Packaged gate isolation refused: ${path.join(realpathSync(root), 'checkout', 'node_modules')} exists above ${directory}`);
      expect(() => assertPackagedTreeIsolation({ directory: alias })).toThrow(PackagedTreeIsolationError);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test('the copy cannot resolve from the source checkout, keeps relative symlinks, uses the host prefix and is removed after the run', async () => {
    const root = scratch('gate-copy-');
    try {
      const { appRoot, targets } = layout(root);
      symlinkSync('app.asar', path.join(appRoot, 'relative-link'));
      let directoryUsed = '';
      await withIsolatedPackagedTree({ targets, resolveCommand: ({ bin }) => bin, run({ targets: copied, directory }) {
        directoryUsed = directory;
        expect(path.basename(directory).startsWith('acme-gate-')).toBe(true);
        expect(copied.executablePath).not.toBe(targets.executablePath);
        expect(readFileSync(copied.executablePath, 'utf8')).toBe('shipped executable');
        expect(existsSync(copied.nodeModulesDir)).toBe(true);
        expect(readlinkSync(path.join(directory, 'Acme.app', 'relative-link'))).toBe('app.asar');
      } }, { tempRoot: root, tempPrefix: 'acme-gate-' });
      expect(existsSync(directoryUsed)).toBe(false);
      expect(readFileSync(targets.executablePath, 'utf8')).toBe('shipped executable');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test('a missing copy command, a contaminated temp root and a failing run never leave a copy behind', async () => {
    const root = scratch('gate-fail-');
    try {
      const { targets } = layout(root);
      await expect(withIsolatedPackagedTree({ targets, resolveCommand: () => null, run: () => { throw new Error('unreachable'); } }, { tempRoot: root })).rejects.toThrow('cp executable is unavailable.');
      expect(readdirSync(root)).toEqual(['checkout']);
      const failure = new Error('gate failed');
      await expect(withIsolatedPackagedTree({ targets, resolveCommand: ({ bin }) => bin, run: () => { throw failure; } }, { tempRoot: root })).rejects.toBe(failure);
      expect(readdirSync(root)).toEqual(['checkout']);
      mkdirSync(path.join(root, 'node_modules'));
      const run = vi.fn();
      await expect(withIsolatedPackagedTree({ targets, resolveCommand: ({ bin }) => bin, run }, { tempRoot: root })).rejects.toThrow(PackagedTreeIsolationError);
      expect(run).not.toHaveBeenCalled();
      expect(readdirSync(root).sort()).toEqual(['checkout', 'node_modules']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test('the win32 copier keeps relative symlinks verbatim whatever host runs it', async () => {
    const root = scratch('gate-win-');
    try {
      const appRoot = path.join(root, 'win-unpacked');
      const targets = { executablePath: path.join(appRoot, 'Acme.exe'), nodeModulesDir: path.join(appRoot, 'resources', 'acme', 'node_modules') };
      mkdirSync(targets.nodeModulesDir, { recursive: true });
      writeFileSync(targets.executablePath, 'shipped executable');
      writeFileSync(path.join(appRoot, 'app.asar'), 'signed bytes');
      symlinkSync('app.asar', path.join(appRoot, 'relative-link'));
      let link = '';
      await withIsolatedPackagedTree({ targets, resolveCommand: () => { throw new Error('win32 never shells out'); }, run: ({ directory }) => { link = readlinkSync(path.join(directory, 'win-unpacked', 'relative-link')); } }, { tempRoot: root, platform: 'win32' });
      expect(link).toBe('app.asar');
      expect(readdirSync(root)).toEqual(['win-unpacked']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('walkPayloadFiles', () => {
  const fs = memoryFs({ files: { '/p/dist/a.js': '', '/p/dist/skills/x/SKILL.md': '', '/p/dist/keep/skills/y.js': '', '/p/dist/keep/z.js': '' } });
  test('lists every file under the root, depth first', () => {
    expect(walkPayloadFiles({ root: '/p/dist', fs }).sort()).toEqual(['/p/dist/a.js', '/p/dist/keep/skills/y.js', '/p/dist/keep/z.js', '/p/dist/skills/x/SKILL.md']);
  });
  test('a directory the host prunes is skipped whole; the root itself is never pruned', () => {
    const skip = vi.fn(({ relative }: { relative: string }) => relative === 'skills' || relative === '');
    expect(walkPayloadFiles({ root: '/p/dist', fs }, { skipDirectory: skip }).sort()).toEqual(['/p/dist/a.js', '/p/dist/keep/skills/y.js', '/p/dist/keep/z.js']);
  });
});
