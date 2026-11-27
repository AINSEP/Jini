import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { projectLimits } from '../paths.js';
import { createProjectPaths, createProjectStore } from './filesystem.js';

// A physical lstat I/O fault is hard to reproduce without permissions or filesystem assumptions.
// Leave the real containment checks, reads and all other filesystem operations in place.
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

test('a native metadata I/O failure refuses a working-file read instead of treating the path as absent', async () => {
  const temporary = await fs.mkdtemp(join(tmpdir(), 'vibe-lstat-error-'));
  const lstat = vi.mocked(fs.lstat);
  try {
    const base = await fs.realpath(temporary);
    const root = join(base, 'app'), stateDir = join(base, 'state');
    const file = join(root, 'index.txt');
    await fs.mkdir(root);
    await fs.writeFile(file, 'original');
    const limits = projectLimits({});
    const paths = createProjectPaths({ root, limits, policy: { allows: () => true } });
    const store = createProjectStore({ root, stateDir, paths, limits });
    const fault = Object.assign(new Error('lstat: I/O error'), { code: 'EIO', syscall: 'lstat', path: file });
    const text = new TextDecoder();
    expect(text.decode(await store.readWorkingFile({ relativePath: 'index.txt' }))).toBe('original');
    lstat.mockRejectedValueOnce(fault);
    await expect(store.readWorkingFile({ relativePath: 'index.txt' })).rejects.toBe(fault);
    expect(lstat).toHaveBeenLastCalledWith(file);
    expect(text.decode(await store.readWorkingFile({ relativePath: 'index.txt' }))).toBe('original');
    expect(await fs.readFile(file, 'utf8')).toBe('original');
  } finally {
    lstat.mockReset();
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
