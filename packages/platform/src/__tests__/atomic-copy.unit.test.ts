import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atomicCopyFile } from '../fs.js';

// Only rename is intercepted for fault injection; contents and cleanup use the real filesystem.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let directory: string;
beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockReset().mockImplementation(actual.rename);
  directory = await mkdtemp(join(tmpdir(), 'engine-atomic-copy-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('atomic copy replacement', () => {
  it('keeps the old destination readable until rename atomically installs the new bytes', async () => {
    const source = join(directory, 'source');
    const destination = join(directory, 'destination');
    await writeFile(source, 'new bytes');
    await writeFile(destination, 'old bytes');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockImplementationOnce(async (from, to) => {
      expect(await readFile(destination, 'utf8')).toBe('old bytes');
      await actual.rename(from, to);
    });
    await expect(atomicCopyFile(source, destination, { overwrite: true })).resolves.toEqual({ bytesCopied: 9, replaced: true });
    expect(await readFile(destination, 'utf8')).toBe('new bytes');
    expect((await readdir(directory)).sort()).toEqual(['destination', 'source']);
  });

  it('preserves the old destination and cleans the temporary copy when rename fails', async () => {
    const source = join(directory, 'source');
    const destination = join(directory, 'destination');
    await writeFile(source, 'new bytes');
    await writeFile(destination, 'old bytes');
    const failure = Object.assign(new Error('rename denied'), { code: 'EACCES' });
    vi.mocked(rename).mockRejectedValueOnce(failure);
    await expect(atomicCopyFile(source, destination, { overwrite: true })).rejects.toBe(failure);
    expect(await readFile(destination, 'utf8')).toBe('old bytes');
    expect((await readdir(directory)).sort()).toEqual(['destination', 'source']);
  });

  it('still refuses to overwrite an existing destination unless explicitly requested', async () => {
    const source = join(directory, 'source');
    const destination = join(directory, 'destination');
    await writeFile(source, 'new bytes');
    await writeFile(destination, 'old bytes');
    await expect(atomicCopyFile(source, destination)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(destination, 'utf8')).toBe('old bytes');
    expect(rename).not.toHaveBeenCalled();
  });
});
