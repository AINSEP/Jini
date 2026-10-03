import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeJsonFile } from '../json-file.js';

// The shared writer uses named filesystem exports; intercept those bindings
// while retaining real file I/O and real handles for durability assertions.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: vi.fn(actual.open),
    rename: vi.fn(actual.rename),
  };
});

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function destination(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sidecar-atomic-'));
  roots.push(root);
  return path.join(root, 'state.json');
}

describe('runtime JSON durability through the platform writer', () => {
  // REGRESSION: fails if writeJsonFile restores its unsynced writeFile + rename implementation.
  it('syncs file bytes before replacement and the directory afterward, preserving JSON bytes', async () => {
    const filePath = await destination();
    const order: string[] = [];
    const open = fs.open.bind(fs);
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (target, flags, mode) => {
      const handle = await open(target, flags, mode);
      const sync = handle.sync.bind(handle);
      vi.spyOn(handle, 'sync').mockImplementation(async () => {
        order.push(String(target) === path.dirname(filePath) ? 'directory-sync' : 'file-sync');
        await sync();
      });
      return handle;
    });
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      order.push('rename');
      await rename(from, to);
    });
    await writeJsonFile({ filePath, payload: { runId: 'run-1' } });
    expect(order).toEqual(['file-sync', 'rename', 'directory-sync']);
    expect(await fs.readFile(filePath, 'utf8')).toBe('{\n  "runId": "run-1"\n}\n');
  });

  // REGRESSION: fails if writeJsonFile restores its old new-temp default mode on replacement.
  it.skipIf(process.platform === 'win32')('preserves existing POSIX permissions', async () => {
    const filePath = await destination();
    await fs.writeFile(filePath, '{}\n');
    const mode = (0o666 & ~process.umask()) ^ 0o040;
    await fs.chmod(filePath, mode);
    await writeJsonFile({ filePath, payload: { value: 2 } });
    expect((await fs.stat(filePath)).mode & 0o777).toBe(mode);
  });

  // REGRESSION: fails if writeJsonFile restores its unsynced writeFile + rename implementation.
  it('rejects a file sync failure, retains the old state and removes its owned temporary file', async () => {
    const filePath = await destination();
    await fs.writeFile(filePath, 'old\n');
    const failure = new Error('file sync failed');
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (target, flags, mode) => {
      const handle = await open(target, flags, mode);
      if (flags === 'wx') vi.spyOn(handle, 'sync').mockRejectedValue(failure);
      return handle;
    });
    await expect(writeJsonFile({ filePath, payload: { value: 3 } })).rejects.toBe(failure);
    expect(await fs.readFile(filePath, 'utf8')).toBe('old\n');
    expect(await fs.readdir(path.dirname(filePath))).toEqual(['state.json']);
  });

  // REGRESSION: fails if writeJsonFile restores JSON.stringify(undefined) plus a newline.
  it('rejects unserializable payloads before replacing the destination', async () => {
    const filePath = await destination();
    await fs.writeFile(filePath, 'old\n');
    await expect(writeJsonFile({ filePath, payload: undefined })).rejects.toBeInstanceOf(TypeError);
    expect(await fs.readFile(filePath, 'utf8')).toBe('old\n');
  });

  // REGRESSION: fails if writeJsonFile restores its unsynced writeFile + rename implementation.
  it('reports directory sync failure after the replacement has become visible', async () => {
    const filePath = await destination();
    await fs.writeFile(filePath, 'old\n');
    const failure = new Error('directory sync failed');
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (target, flags, mode) => {
      const handle = await open(target, flags, mode);
      if (String(target) === path.dirname(filePath)) vi.spyOn(handle, 'sync').mockRejectedValue(failure);
      return handle;
    });
    await expect(writeJsonFile({ filePath, payload: { value: 4 } })).rejects.toBe(failure);
    expect(await fs.readFile(filePath, 'utf8')).toBe('{\n  "value": 4\n}\n');
    expect(await fs.readdir(path.dirname(filePath))).toEqual(['state.json']);
  });
});
