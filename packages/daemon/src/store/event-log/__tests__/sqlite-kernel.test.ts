import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';
import type { StorageKernel } from '@jini-ai/db/kernel';
import { sqliteKernel } from '@jini-ai/db/kernel/sqlite';
import {
  createKernelSqliteEventLog, SQLITE_EVENT_LOG_SCHEMA,
  type SqliteEventLogDatabase,
} from '../sqlite.js';

interface HostDatabase extends SqliteEventLogDatabase {
  projection: { id: string; value: number };
}

it('awaits readiness, routes through the injected kernel, and never closes it', async () => {
  const db = new Database(':memory:');
  const real = sqliteKernel<HostDatabase>(db);
  let release!: () => void;
  const run = vi.spyOn(real, 'run');
  const transaction = vi.spyOn(real, 'transaction');
  const close = vi.fn(async () => {});
  const kernel: StorageKernel<HostDatabase> = {
    ...real, ready: new Promise<void>(resolve => { release = resolve; }), close,
  };
  try {
    const pending = createKernelSqliteEventLog({ kernel }, { clock: { nowMs: () => 987 } });
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
    release();
    const log = await pending;
    run.mockClear();
    expect(await log.appendWithResult({ runId: 'r', event: 'e', data: { n: 1 } }))
      .toEqual({ kind: 'inserted', entry: { id: '1', event: 'e', data: { n: 1 }, recordedAt: 987 } });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(await log.replay({ runId: 'r', afterCursor: null })).toEqual({
      kind: 'ok', entries: [{ id: '1', event: 'e', data: { n: 1 }, recordedAt: 987 }],
    });
    await log.listRunIds({});
    await log.drop({ runId: 'r' });
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenCalledTimes(4);
    expect(db.prepare('SELECT * FROM jini_event_log_runs').all()).toEqual([]);
    await log.close({}); await log.close({});
    expect(close).not.toHaveBeenCalled();
    expect(db.open).toBe(true);
  } finally { release(); db.close(); }
});

it('commits event and projection together and rolls back both on projection failure or host refusal', async () => {
  const db = new Database(':memory:');
  db.exec(`${SQLITE_EVENT_LOG_SCHEMA} CREATE TABLE projection (id TEXT PRIMARY KEY, value INTEGER NOT NULL);`);
  const kernel = sqliteKernel<HostDatabase>(db);
  try {
    const log = await createKernelSqliteEventLog({ kernel }, { schemaSetup: 'host' });
    const event = { runId: 'r', event: 'e', data: 1 };
    await kernel.transaction(async () => {
      await log.append(event);
      await kernel.run(tx => tx.insertInto('projection').values({ id: 'p', value: 1 }).execute());
    });
    expect(db.prepare('SELECT id, value FROM projection').all()).toEqual([{ id: 'p', value: 1 }]);
    expect(db.prepare('SELECT cursor FROM jini_event_log_entries').all()).toEqual([{ cursor: 1 }]);
    await expect(kernel.transaction(async () => {
      await log.append({ ...event, data: 2 });
      await kernel.run(tx => tx.insertInto('projection').values({ id: 'p', value: 2 }).execute());
    })).rejects.toThrow(/UNIQUE/);
    // A refusal is a value; the host chooses to abort using its existing exception path.
    const denied = new Error('host rejected capacity receipt');
    const full = await createKernelSqliteEventLog({ kernel }, { maxEntriesPerRun: 1, schemaSetup: 'host' });
    await expect(kernel.transaction(async () => {
      await kernel.run(tx => tx.updateTable('projection').set({ value: 3 }).where('id', '=', 'p').execute());
      const result = await full.appendWithResult(event, { retentionPolicy: 'reject' });
      expect(result).toEqual({ kind: 'capacity-exceeded', maxEntriesPerRun: 1 });
      throw denied;
    })).rejects.toBe(denied);
    expect(db.prepare('SELECT id, value FROM projection').all()).toEqual([{ id: 'p', value: 1 }]);
    expect(db.prepare('SELECT cursor, data FROM jini_event_log_entries').all()).toEqual([{ cursor: 1, data: '1' }]);
    expect((await log.append({ ...event, data: 3 })).id).toBe('2');
    // Drop participates in the same outer transaction too.
    await expect(kernel.transaction(async () => { await log.drop({ runId: 'r' }); throw denied; })).rejects.toBe(denied);
    expect(await log.listRunIds({})).toEqual(['r']);
  } finally { db.close(); }
});

it('blocks concurrent callers until an outer transaction completes, then allocates contiguous cursors', async () => {
  const db = new Database(':memory:');
  const kernel = sqliteKernel<SqliteEventLogDatabase>(db);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const inside = new Promise<void>(resolve => { entered = resolve; });
  try {
    const log = await createKernelSqliteEventLog({ kernel });
    const outer = kernel.transaction(async () => {
      const first = await log.append({ runId: 'r', event: 'e', data: 1 });
      entered();
      await gate;
      const second = await log.append({ runId: 'r', event: 'e', data: 2 });
      return [first.id, second.id];
    });
    await inside;
    const concurrent = log.append({ runId: 'r', event: 'e', data: 3 });
    release();
    expect(await outer).toEqual(['1', '2']);
    expect((await concurrent).id).toBe('3');
    const rest = await Promise.all(Array.from({ length: 8 }, (_, n) => log.append({ runId: 'r', event: 'e', data: n + 4 })));
    expect(rest.map(entry => entry.id)).toEqual(['4', '5', '6', '7', '8', '9', '10', '11']);
  } finally { release(); db.close(); }
});

it('replay reads one snapshot: another connection cannot evict between the gap check and the entry read', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jini-event-log-'));
  const db = new Database(join(dir, 'log.db'));
  // A second connection stands in for another process; timeout 0 so a held lock refuses at once.
  const other = new Database(join(dir, 'log.db'), { timeout: 0 });
  try {
    const log = await createKernelSqliteEventLog({ kernel: sqliteKernel<SqliteEventLogDatabase>(db) }, { maxEntriesPerRun: 3 });
    for (const n of [1, 2, 3]) await log.append({ runId: 'r', event: 'e', data: n });
    const prepare = db.prepare.bind(db);
    let statements = 0;
    let interleaved: unknown;
    db.prepare = ((source: string) => {
      // Before replay's third read, the other connection appends 4 and 5 and evicts 1 and 2.
      if (++statements === 3) {
        try {
          other.exec(`INSERT INTO jini_event_log_entries (run_id, cursor, event, data, recorded_at)
            VALUES ('r', 4, 'e', '4', 0), ('r', 5, 'e', '5', 0);
            DELETE FROM jini_event_log_entries WHERE run_id = 'r' AND cursor <= 2;
            UPDATE jini_event_log_runs SET next_cursor = 6 WHERE run_id = 'r'`);
        } catch (error) { interleaved = error; }
      }
      return prepare(source);
    }) as typeof db.prepare;
    const result = await log.replay({ runId: 'r', afterCursor: '1' });
    expect(result.kind === 'ok' ? result.entries.map(entry => entry.data) : result).toEqual([2, 3]);
    expect(interleaved).toMatchObject({ code: 'SQLITE_BUSY' });
  } finally { other.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('rejects non-SQLite kernels and propagates readiness failures without querying or closing', async () => {
  const db = new Database(':memory:');
  const real = sqliteKernel<SqliteEventLogDatabase>(db);
  const run = vi.spyOn(real, 'run');
  const close = vi.fn(async () => {});
  try {
    await expect(createKernelSqliteEventLog({ kernel: { ...real, dialect: 'postgres', close } }))
      .rejects.toThrow(/SQLite better-sqlite3 kernel/);
    await expect(createKernelSqliteEventLog({ kernel: { ...real, transport: 'pglite', close } }))
      .rejects.toThrow(/SQLite better-sqlite3 kernel/);
    const failure = new Error('migration failed');
    await expect(createKernelSqliteEventLog({ kernel: { ...real, ready: Promise.reject(failure), close } }))
      .rejects.toBe(failure);
    expect(run).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  } finally { db.close(); }
});
