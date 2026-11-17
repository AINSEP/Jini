import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureAntigravityMcpPermission } from '../antigravity/permissions.js';

/**
 * @file R8a step 0 (R11): the order of effects on the user's personal settings file: lock, then
 * backup of the original, then the atomic write, and the lock is gone afterwards on every path.
 * The effects are observed through the real file system (the function's only seam today); when
 * step 4 injects `fileLock` and `writer`, the same order is asserted through recording fakes.
 */

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })));
});

async function settingsFile(raw: string): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'agy-permission-order-'));
  roots.push(root);
  const settingsPath = join(root, 'settings.json');
  await fs.writeFile(settingsPath, raw);
  return settingsPath;
}

const exists = (path: string): Promise<boolean> => fs.access(path).then(() => true, () => false);

describe('ensureAntigravityMcpPermission effect order', () => {
  it('holds the lock while it backs up the untouched original, writes only after that, and leaves no lock', async () => {
    const original = '{"theme":"dark"}';
    const settingsPath = await settingsFile(original);
    const atBackup: Array<{ lockHeld: boolean; settings: string }> = [];
    const realCopy = fs.copyFile.bind(fs);
    vi.spyOn(fs, 'copyFile').mockImplementation(async (...args: Parameters<typeof fs.copyFile>) => {
      atBackup.push({ lockHeld: await exists(`${settingsPath}.jini-lock`), settings: await fs.readFile(settingsPath, 'utf8') });
      return realCopy(...args);
    });

    await ensureAntigravityMcpPermission({ settingsPath, serverName: 'jini' });

    expect(atBackup).toEqual([{ lockHeld: true, settings: original }]);
    expect(await fs.readFile(`${settingsPath}.jini-backup`, 'utf8')).toBe(original);
    expect(JSON.parse(await fs.readFile(settingsPath, 'utf8'))).toEqual({ theme: 'dark', permissions: { allow: ['mcp(jini/*)'] } });
    expect(await exists(`${settingsPath}.jini-lock`)).toBe(false);
  });

  it('a write that fails leaves the backup of the original, the settings untouched, and no lock', async () => {
    const original = '{"theme":"linked"}';
    const target = await settingsFile(original);
    const settingsPath = join(target, '..', 'link.json');
    await fs.symlink(target, settingsPath);

    await expect(ensureAntigravityMcpPermission({ settingsPath, serverName: 'jini' })).rejects.toThrow(/^atomic write refused a symbolic-link/);

    expect(await fs.readFile(`${settingsPath}.jini-backup`, 'utf8')).toBe(original);
    expect(await fs.readFile(target, 'utf8')).toBe(original);
    expect(await exists(`${settingsPath}.jini-lock`)).toBe(false);
  });

  it('a backup that fails leaves the settings unwritten and releases the lock', async () => {
    const settingsPath = await settingsFile('{}');
    const failure = Object.assign(new Error('copy refused'), { code: 'EACCES' });
    vi.spyOn(fs, 'copyFile').mockRejectedValueOnce(failure);

    await expect(ensureAntigravityMcpPermission({ settingsPath, serverName: 'jini' })).rejects.toBe(failure);

    expect(await fs.readFile(settingsPath, 'utf8')).toBe('{}');
    expect(await exists(`${settingsPath}.jini-lock`)).toBe(false);
  });
});
