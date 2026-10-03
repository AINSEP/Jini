import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  afterRead: undefined as undefined | ((path: string) => Promise<void>),
  afterRename: undefined as undefined | ((path: string) => Promise<void>),
  writes: [] as string[],
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  const mocked = {
    ...fs,
    async readFile(...args: Parameters<typeof fs.readFile>) {
      const result = await fs.readFile(...args);
      await hooks.afterRead?.(String(args[0]));
      return result;
    },
    async rename(...args: Parameters<typeof fs.rename>) {
      await fs.rename(...args);
      await hooks.afterRename?.(String(args[0]));
    },
    async open(...args: Parameters<typeof fs.open>) {
      if (args[1] === 'wx') hooks.writes.push(String(args[0]));
      return fs.open(...args);
    },
    async writeFile(...args: Parameters<typeof fs.writeFile>) {
      hooks.writes.push(String(args[0]));
      return fs.writeFile(...args);
    },
  };
  return { ...mocked, default: mocked };
});

import { removeDaemonRegistryRecordIfCurrent } from '../daemon-registry.js';
import { writeJsonFile } from '../json-file.js';

const roots: string[] = [];
async function registryPath() {
  const root = await mkdtemp(join(tmpdir(), 'sidecar-file-races-'));
  roots.push(root);
  return join(root, 'daemon.json');
}

afterEach(async () => {
  hooks.afterRead = undefined;
  hooks.afterRename = undefined;
  hooks.writes = [];
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it('uses a distinct temporary file for each concurrent write with the same clock tick', async () => {
  const filePath = await registryPath();
  vi.spyOn(Date, 'now').mockReturnValue(1234);
  const results = await Promise.allSettled(Array.from({ length: 32 }, (_, value) =>
    writeJsonFile({ filePath, payload: { value } }),
  ));
  expect(results.map(result => result.status)).toEqual(Array(32).fill('fulfilled'));
  expect(new Set(hooks.writes).size).toBe(32);
  const final = JSON.parse(await readFile(filePath, 'utf8')) as { value: number };
  expect(Array.from({ length: 32 }, (_, value) => value)).toContain(final.value);
  expect(await readdir(roots[0]!)).toEqual(['daemon.json']);
});

it('rechecks the captured record when a newer owner replaces the file after the initial read', async () => {
  const path = await registryPath();
  await writeFile(path, JSON.stringify({ pid: 11 }));
  hooks.afterRead = async readPath => {
    if (readPath !== path) return;
    hooks.afterRead = undefined;
    await writeJsonFile({ filePath: path, payload: { pid: 22, version: 'new' } });
  };
  await removeDaemonRegistryRecordIfCurrent({ registryPath: path, pid: 11 });
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ pid: 22, version: 'new' });
  expect(await readdir(roots[0]!)).toEqual(['daemon.json']);
});

it('never removes a replacement published after the old record has been detached', async () => {
  const path = await registryPath();
  await writeFile(path, JSON.stringify({ pid: 11 }));
  hooks.afterRename = async from => {
    if (from !== path) return;
    hooks.afterRename = undefined;
    await writeJsonFile({ filePath: path, payload: { pid: 22 } });
  };
  await removeDaemonRegistryRecordIfCurrent({ registryPath: path, pid: 11 });
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ pid: 22 });
  expect(await readdir(roots[0]!)).toEqual(['daemon.json']);
});

it('restores a foreign captured record only when the public path is still empty', async () => {
  const path = await registryPath();
  await writeFile(path, JSON.stringify({ pid: 11 }));
  hooks.afterRead = async readPath => {
    if (readPath !== path) return;
    hooks.afterRead = undefined;
    await writeJsonFile({ filePath: path, payload: { pid: 22 } });
  };
  hooks.afterRename = async from => {
    if (from !== path) return;
    hooks.afterRename = undefined;
    await writeJsonFile({ filePath: path, payload: { pid: 33 } });
  };
  await removeDaemonRegistryRecordIfCurrent({ registryPath: path, pid: 11 });
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ pid: 33 });
  expect(await readdir(roots[0]!)).toEqual(['daemon.json']);
});
