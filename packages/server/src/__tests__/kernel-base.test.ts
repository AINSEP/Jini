import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as SqliteModule from '@jini-ai/sqlite';

import { createJiniKernelBase } from '../kernel-base.js';

/**
 * Acquisition/cleanup tests for the kernel base itself. `compose-jini-kernel.test.ts` covers the
 * happy path through the composition; this file exists for the failure paths *between* two opened
 * handles, which cannot be reached from there without controlling exactly which `createSqliteEventLog`
 * call fails.
 *
 * `createSqliteEventLog` is spied on (not replaced) for the same reason the daemon suite gives:
 * reopening the same sqlite file afterward succeeds regardless of whether the original handle was
 * released (`better-sqlite3` in WAL mode permits two concurrently open handles on one file within
 * a single process), so only observing `close()` proves anything.
 */

const tempDirs: string[] = [];
function makeTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jini-kernel-base-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  }
});

/**
 * Wraps the real factory so every log it hands back reports its own `close()`, and makes the log
 * for `failingFile` throw at open time — the "corrupt file, or a directory where a database was
 * expected" case.
 */
function spyOnEventLogs(failingFile: string | null) {
  const original = SqliteModule.createSqliteEventLog;
  const closes = new Map<string, ReturnType<typeof vi.fn>>();
  const spy = vi
    .spyOn(SqliteModule, 'createSqliteEventLog')
    .mockImplementation((...args: Parameters<typeof original>) => {
      const [dbPath] = args;
      if (failingFile !== null && dbPath.endsWith(failingFile)) {
        throw new Error(`SqliteError: unable to open database file (${dbPath})`);
      }
      const real = original(...args);
      const close = vi.fn(real.close);
      closes.set(dbPath.endsWith('journal.db') ? 'journal.db' : 'events.db', close);
      return { ...real, close };
    });
  return { spy, closes };
}

describe('createJiniKernelBase — one acquisition block, one cleanup path', () => {
  it("closes the already-open events.db log when the journal.db log fails to open", async () => {
    const dataDir = makeTempDataDir();
    const { spy, closes } = spyOnEventLogs('journal.db');
    try {
      await expect(createJiniKernelBase({ storage: { kind: 'sqlite', dataDir } })).rejects.toThrow(
        /unable to open database file/,
      );

      // `events.db` opened successfully a moment earlier. If its handle is not released here the
      // process keeps a sqlite file handle for a kernel that never came into existence.
      expect(closes.get('events.db')).toBeDefined();
      expect(closes.get('events.db')).toHaveBeenCalledTimes(1);
      expect(closes.has('journal.db')).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('closes both logs when the very first one fails, leaving nothing open', async () => {
    const dataDir = makeTempDataDir();
    const { spy, closes } = spyOnEventLogs('events.db');
    try {
      await expect(createJiniKernelBase({ storage: { kind: 'sqlite', dataDir } })).rejects.toThrow(
        /unable to open database file/,
      );
      expect(closes.size).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('opens both logs and the borrowed connection on the happy path, and closes all three exactly once', async () => {
    const dataDir = makeTempDataDir();
    const { spy, closes } = spyOnEventLogs(null);
    try {
      const base = await createJiniKernelBase({ storage: { kind: 'sqlite', dataDir } });
      expect(base.sqlite).not.toBeNull();
      expect(base.sqlite!.connection.open).toBe(true);

      await base.close();
      await base.close();

      expect(closes.get('events.db')).toHaveBeenCalledTimes(1);
      expect(closes.get('journal.db')).toHaveBeenCalledTimes(1);
      expect(base.sqlite!.connection.open).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('opens no sqlite handle at all under memory storage', async () => {
    const { spy } = spyOnEventLogs(null);
    try {
      const base = await createJiniKernelBase({ storage: { kind: 'memory' } });
      expect(base.sqlite).toBeNull();
      expect(spy).not.toHaveBeenCalled();
      await base.close();
    } finally {
      spy.mockRestore();
    }
  });
});
