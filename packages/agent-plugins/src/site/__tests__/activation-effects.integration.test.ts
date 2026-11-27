import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { ACTIVATIONS_FILENAME } from '../../lifecycle/index.js';
import { createAgentPluginEnabledReader } from '../activation-effects.js';

test('activation point reads are cached per revision and observe an atomic OFF replacement', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jini-enable-reader-'));
  const filename = path.join(root, ACTIVATIONS_FILENAME);
  const resolveAgentPluginActivation = vi.fn(async ({ workspaceRoot, pluginId }: { workspaceRoot: string; pluginId: string }) => {
    if (workspaceRoot !== root || pluginId !== 'relay') throw new Error('wrong activation key');
    try { return { verdict: await readFile(filename, 'utf8') }; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { verdict: 'active' };
    }
  });
  const reader = createAgentPluginEnabledReader({ workspaceRoot: root, resolveAgentPluginActivation });
  try {
    await expect(reader('relay')).resolves.toBe(true);
    await expect(reader('relay')).resolves.toBe(true);
    await writeFile(filename, 'active');
    await expect(reader('relay')).resolves.toBe(true);
    await writeFile(filename + '.next', 'off');
    await rename(filename + '.next', filename);
    await expect(reader('relay')).resolves.toBe(false);
    await expect(reader('relay')).resolves.toBe(false);
    expect(resolveAgentPluginActivation.mock.calls).toEqual(Array.from({ length: 3 }, () => [{ workspaceRoot: root, pluginId: 'relay' }]));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a filesystem fault other than a missing activation file is not treated as a default', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jini-enable-reader-'));
  const notADir = path.join(root, 'a-file');
  const resolveAgentPluginActivation = vi.fn(async () => ({ verdict: 'active' }));
  try {
    await writeFile(notADir, 'not a directory');
    const reader = createAgentPluginEnabledReader({ workspaceRoot: notADir, resolveAgentPluginActivation });
    await expect(reader('relay')).rejects.toMatchObject({ code: 'ENOTDIR' });
    expect(resolveAgentPluginActivation.mock.calls).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
