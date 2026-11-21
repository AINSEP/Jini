import { describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileLockPort } from '@jini-ai/core/contracts/runtime';
import { ensureAntigravityMcpPermission } from '../antigravity/permissions.js';
import { fakeAtomicWriter, fakeFileLock, type EffectLog } from '../../ports/__tests__/fakes/runtime.js';

/**
 * @file R8a step 4: the antigravity grant takes its lock and writer as ports. Order and failure
 * behaviour are asserted through recording fakes (the real-file-system order is pinned by
 * antigravity-permissions.order.test.ts): lock -> backup of the original -> atomic write -> unlock.
 */

const SETTINGS = '/home/u/.gemini/antigravity-cli/settings.json';

/** Settings text the grant reads from disk: the grant still reads through `node:fs` (staging, lane K). */
async function withSettingsFile(raw: string | undefined, use: (settingsPath: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(join(tmpdir(), 'agy-ports-'));
  try {
    const settingsPath = join(root, 'settings.json');
    if (raw !== undefined) await fs.writeFile(settingsPath, raw);
    await use(settingsPath);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

describe('ensureAntigravityMcpPermission through ports', () => {
  it('takes the lock, backs up the original, writes atomically, then releases, in that order', async () => {
    await withSettingsFile('{"theme":"dark"}', async (settingsPath) => {
      const log: EffectLog = [];
      const fileLock = fakeFileLock({ log });
      const writer = fakeAtomicWriter({ log });
      const lock = vi.spyOn(fileLock, 'withFileLock');
      const writeText = vi.spyOn(writer, 'writeText');
      await ensureAntigravityMcpPermission({ settingsPath, serverName: 'jini', fileLock, writer });
      expect(log).toEqual(['lock', `backup:${settingsPath}`, `text:${settingsPath}`, 'unlock']);
      expect(lock.mock.calls[0]![0].lockPath).toBe(`${settingsPath}.jini-lock`);
      expect(lock.mock.calls[0]![1]).toEqual({ createParent: true, timeoutMs: 5000 });
      expect(JSON.parse(writeText.mock.calls[0]![0].content as string)).toEqual({ theme: 'dark', permissions: { allow: ['mcp(jini/*)'] } });
      expect(writeText.mock.calls[0]![1]).toEqual({ refuseSymlink: true });
    });
  });

  it('writes a missing file without a backup, and writes nothing when the rule is already present once', async () => {
    await withSettingsFile(undefined, async (settingsPath) => {
      const log: EffectLog = [];
      await ensureAntigravityMcpPermission({ settingsPath, serverName: 'jini', fileLock: fakeFileLock({ log }), writer: fakeAtomicWriter({ log }) });
      expect(log).toEqual(['lock', `text:${settingsPath}`, 'unlock']);
    });
    await withSettingsFile('{"permissions":{"allow":["mcp(jini/*)"]}}', async (settingsPath) => {
      const log: EffectLog = [];
      await ensureAntigravityMcpPermission({ settingsPath, serverName: 'jini', fileLock: fakeFileLock({ log }), writer: fakeAtomicWriter({ log }) });
      expect(log).toEqual(['lock', 'unlock']);
    });
  });

  it('refuses a bad server name before touching the lock or the writer', async () => {
    const log: EffectLog = [];
    await expect(ensureAntigravityMcpPermission({ settingsPath: SETTINGS, serverName: 'a b', fileLock: fakeFileLock({ log }), writer: fakeAtomicWriter({ log }) }))
      .rejects.toThrow(/^Invalid MCP server name$/);
    expect(log).toEqual([]);
  });

  it('a failing backup rejects with that failure, never writes the settings, and still unlocks', async () => {
    await withSettingsFile('{}', async (settingsPath) => {
      const failure = new Error('backup refused');
      const log: EffectLog = [];
      await expect(ensureAntigravityMcpPermission({ settingsPath, serverName: 'jini', fileLock: fakeFileLock({ log }), writer: fakeAtomicWriter({ log }, { failOn: 'backupOriginalOnce', failure }) }))
        .rejects.toBe(failure);
      expect(log).toEqual(['lock', `backup:${settingsPath}`, 'unlock']);
    });
  });

  it('a failing write rejects with that failure, keeps the backup already taken, and still unlocks', async () => {
    await withSettingsFile('{}', async (settingsPath) => {
      const failure = new Error('write refused');
      const log: EffectLog = [];
      await expect(ensureAntigravityMcpPermission({ settingsPath, serverName: 'jini', fileLock: fakeFileLock({ log }), writer: fakeAtomicWriter({ log }, { failOn: 'writeText', failure }) }))
        .rejects.toBe(failure);
      expect(log).toEqual(['lock', `backup:${settingsPath}`, `text:${settingsPath}`, 'unlock']);
    });
  });

  it.each([
    ['an Error rejection', () => Promise.reject(new Error('lock refused')), new Error('lock refused')],
    ['a non-Error rejection', () => Promise.reject('lock refused'), 'lock refused'],
    ['a synchronous throw', () => { throw new Error('lock refused'); }, new Error('lock refused')],
  ])('a file lock that fails with %s rejects the grant and nothing is written', async (_label, acquire, expected) => {
    await withSettingsFile('{}', async (settingsPath) => {
      const log: EffectLog = [];
      const fileLock: FileLockPort = { withFileLock: acquire as FileLockPort['withFileLock'] };
      await expect(ensureAntigravityMcpPermission({ settingsPath, serverName: 'jini', fileLock, writer: fakeAtomicWriter({ log }) }))
        .rejects.toEqual(expected);
      expect(log).toEqual([]);
    });
  });
});
