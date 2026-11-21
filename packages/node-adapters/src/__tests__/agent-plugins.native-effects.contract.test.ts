import { expect, test, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// Nothing here freezes a package tree, so a plain forced recursive rm cleans up.
const forceRemove = (root: string) => fs.rm(root, { recursive: true, force: true });
import { createNodeAgentPluginEffects } from '../agent-plugins.js';

// REGRESSION: fails if createNodeAgentPluginEffects wraps the injected native filesystem.
test('native effects keep the filesystem ABI and share core clock and ID getters', () => {
  const effects = createNodeAgentPluginEffects({}, { filesystem: fs });
  expect(effects.filesystem).toBe(fs);
  expect(Number.isFinite(effects.clock.nowMs())).toBe(true);
  expect(Number.isFinite(effects.clock.monotonicMs())).toBe(true);
  expect(effects.ids.newId()).toMatch(/^[0-9a-f-]{36}$/);
  expect(effects.ids.random()).toBeGreaterThanOrEqual(0);
});

// REGRESSION: fails if the native liveness adapter treats any non-EPERM failure as dead.
test('only an ESRCH probe authorizes reclaiming a local process lock', () => {
  const effects = createNodeAgentPluginEffects({});
  const probe = vi.spyOn(process, 'kill');
  try {
    for (const code of ['EPERM', 'EACCES', 'UNKNOWN']) {
      probe.mockImplementationOnce(() => { throw Object.assign(new Error('probe failed'), { code }); });
      expect(effects.process.isAlive({ pid: process.pid })).toBe(true);
    }
    probe.mockImplementationOnce(() => { throw Object.assign(new Error('missing process'), { code: 'ESRCH' }); });
    expect(effects.process.isAlive({ pid: process.pid })).toBe(false);
  } finally { probe.mockRestore(); }
});

// REGRESSION: fails if the bound writer ignores `fs` (the writer's name for the filesystem) or the mode.
test('the bound atomic writer writes the journal owner-only from creation, through the injected filesystem', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-effects-writer-'));
  try {
    const filePath = path.join(root, 'plugin', 'update-journal.json');
    const rename = vi.fn(fs.rename);
    await createNodeAgentPluginEffects({}).atomicWriter.writeJson({ filePath, data: { state: 'pending' } }, { fs: { ...fs, rename }, createParent: true, mode: 0o600 });
    expect(rename).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await fs.readFile(filePath, 'utf8'))).toEqual({ state: 'pending' });
    if (process.platform !== 'win32') expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
  } finally { await forceRemove(root); }
});

// REGRESSION: fails if the bound lock ignores `filesystem` (the lock's name for it) or leaves the lock behind.
test('the bound file lock runs the section under the injected filesystem and releases the lock', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-effects-lock-'));
  try {
    const lockPath = path.join(root, 'state', 'activations.json.lock');
    const open = vi.fn(fs.open);
    const filesystem = { ...fs, open };
    const result = await createNodeAgentPluginEffects({}).fileLock.withFileLock({ lockPath, run: async () => 'ran' }, { filesystem, createParent: true, timeoutMs: 1000 });
    expect(result).toBe('ran');
    expect(open).toHaveBeenCalled();
    await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await forceRemove(root); }
});
