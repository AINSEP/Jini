import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { sqliteKernel } from '@jini-ai/db/kernel/sqlite';
import type { SqliteDb } from '@jini-ai/db/sqlite';
import {
  createSqliteEventLog, createKernelSqliteEventLog, openSqliteEventLog, SQLITE_EVENT_LOG_SCHEMA,
  type SqliteEventLogDatabase,
} from '../sqlite.js';

it('skips all DDL for an injected pre-migrated borrowed DB in host mode; default ensure stays idempotent', async () => {
  const db = new Database(':memory:');
  db.exec(SQLITE_EVENT_LOG_SCHEMA);
  const exec = vi.spyOn(db, 'exec');
  const pragma = vi.spyOn(db, 'pragma');
  try {
    const log = createSqliteEventLog({ db }, { schemaSetup: 'host' });
    expect(exec).not.toHaveBeenCalled();
    await log.append({ runId: 'r', event: 'e', data: 1 });
    const kernelLog = await createKernelSqliteEventLog({ kernel: sqliteKernel<SqliteEventLogDatabase>(db) }, { schemaSetup: 'host' });
    expect(exec).not.toHaveBeenCalled();
    expect(await kernelLog.listRunIds({})).toEqual(['r']);
    expect(pragma).not.toHaveBeenCalled();
    createSqliteEventLog({ db }); createSqliteEventLog({ db });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(db.prepare('SELECT next_cursor FROM jini_event_log_runs').get()).toEqual({ next_cursor: 2 });
  } finally { db.close(); }
});

it.each(['missing', 'incompatible'])('host schema mode rejects %s tables and preserves borrowed ownership', async kind => {
  const db = new Database(':memory:');
  if (kind === 'incompatible') db.exec('CREATE TABLE jini_event_log_runs (run_id TEXT PRIMARY KEY); CREATE TABLE jini_event_log_entries (run_id TEXT);');
  const exec = vi.spyOn(db, 'exec');
  try {
    expect(() => createSqliteEventLog({ db }, { schemaSetup: 'host' })).toThrow(/no such/);
    await expect(createKernelSqliteEventLog({ kernel: sqliteKernel<SqliteEventLogDatabase>(db) }, { schemaSetup: 'host' })).rejects.toThrow(/no such/);
    expect(exec).not.toHaveBeenCalled();
    expect(db.open).toBe(true);
  } finally { db.close(); }
});

it('owned host-mode prepare failure closes once and preserves the failure if cleanup throws', () => {
  const failure = new Error('prepare failed');
  const db = new Database(':memory:');
  const prepare = vi.spyOn(db, 'prepare').mockImplementation(() => { throw failure; });
  const close = vi.spyOn(db, 'close').mockImplementation(() => { throw new Error('cleanup failed'); });
  try {
    expect(() => openSqliteEventLog({ file: ':memory:', open: () => db }, { schemaSetup: 'host' })).toThrow(failure);
    expect(close).toHaveBeenCalledTimes(1);
  } finally { prepare.mockRestore(); close.mockRestore(); db.close(); }
});

// The injected DB changes only one statement effect; SQLite itself must undo preceding writes.
describe.each(['sync', 'kernel'] as const)('%s statement failures', mode => {
  it.each(['insert', 'counter', 'eviction'] as const)('%s failure rolls back rows, dedupe state and cursor allocation', async stage => {
    const db = new Database(':memory:');
    const failure = new Error(`${stage} failed`);
    const prefix = { insert: 'INSERT INTO jini_event_log_entries', counter: 'UPDATE jini_event_log_runs', eviction: 'DELETE FROM jini_event_log_entries' }[stage];
    let fault = false;
    const injected = new Proxy(db, {
      get(target, property) {
        if (property === 'prepare') return (source: string) => {
          const statement = target.prepare(source);
          if (!source.trim().replaceAll('"', '').toUpperCase().startsWith(prefix.toUpperCase())) return statement;
          return new Proxy(statement, {
            get(stmt, key) {
              if (key === 'run') return (...args: unknown[]) => {
                if (fault) throw failure;
                return stmt.run(...args);
              };
              const value = Reflect.get(stmt, key, stmt);
              return typeof value === 'function' ? value.bind(stmt) : value;
            },
          });
        };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as unknown as SqliteDb;
    try {
      const log = mode === 'sync'
        ? createSqliteEventLog({ db: injected }, { maxEntriesPerRun: 1 })
        : await createKernelSqliteEventLog({ kernel: sqliteKernel<SqliteEventLogDatabase>(injected) }, { maxEntriesPerRun: 1 });
      await log.append({ runId: 'r', event: 'e', data: 1 }, { dedupeKey: 'first' });
      const rows = db.prepare('SELECT * FROM jini_event_log_entries').all();
      fault = true;
      await expect(log.appendWithResult({ runId: 'r', event: 'e', data: 2 }, { dedupeKey: 'retry' })).rejects.toBe(failure);
      expect(db.prepare('SELECT * FROM jini_event_log_entries').all()).toEqual(rows);
      expect(db.prepare('SELECT next_cursor FROM jini_event_log_runs').get()).toEqual({ next_cursor: 2 });
      fault = false;
      expect(await log.appendWithResult({ runId: 'r', event: 'e', data: 2 }, { dedupeKey: 'retry' }))
        .toMatchObject({ kind: 'inserted', entry: { id: '2' } });
    } finally { db.close(); }
  });
});

it('serialization failure rolls back a newly created run under either transaction mechanism', async () => {
  const db = new Database(':memory:');
  try {
    const logs = [createSqliteEventLog({ db }), await createKernelSqliteEventLog({ kernel: sqliteKernel<SqliteEventLogDatabase>(db) })];
    const data: { self?: unknown } = {}; data.self = data;
    for (const log of logs) {
      await expect(log.append({ runId: 'r', event: 'e', data })).rejects.toThrow(/circular/i);
      expect(await log.listRunIds({})).toEqual([]);
      expect(db.prepare('SELECT * FROM jini_event_log_entries').all()).toEqual([]);
    }
  } finally { db.close(); }
});
