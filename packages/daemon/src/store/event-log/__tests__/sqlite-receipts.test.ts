import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sqliteKernel } from '@jini-ai/db/kernel/sqlite';
import {
  createSqliteEventLog, createKernelSqliteEventLog, openSqliteEventLog,
  type SqliteEventLogDatabase, type SqliteEventLogOptions,
} from '../sqlite.js';

const factories = {
  sync: async (db: Database.Database, options: SqliteEventLogOptions) => createSqliteEventLog({ db }, options),
  kernel: (db: Database.Database, options: SqliteEventLogOptions) =>
    createKernelSqliteEventLog({ kernel: sqliteKernel<SqliteEventLogDatabase>(db) }, options),
};

// Shared contracts must hold under both the sync driver and kernel transaction mechanisms.
describe.each(Object.entries(factories))('%s opt-in receipts', (_name, create) => {
  it('dedupes before the cap, preserves timestamps, and refuses conflicts without advancing state', async () => {
    const db = new Database(':memory:');
    let now = 100;
    try {
      const log = await create(db, { maxEntriesPerRun: 1, clock: { nowMs: () => now } });
      const input = { runId: 'r', event: 'update', data: { a: 1, b: 2 } };
      const options = { dedupeKey: 'k', detectConflicts: true, retentionPolicy: 'reject' as const };
      const first = await log.appendWithResult(input, options);
      expect(first).toEqual({ kind: 'inserted', entry: { id: '1', event: 'update', data: input.data, recordedAt: 100 } });
      now = 200;
      expect(await log.appendWithResult(input, options)).toEqual({ ...first, kind: 'existing' });
      expect(await log.appendWithResult({ ...input, event: 'other' }, options)).toEqual({ kind: 'conflict' });
      expect(await log.appendWithResult({ ...input, data: { a: 2, b: 2 } }, options)).toEqual({ kind: 'conflict' });
      // Exact JSON text, including key order; no implicit canonicalization.
      expect(await log.appendWithResult({ ...input, data: { b: 2, a: 1 } }, options)).toEqual({ kind: 'conflict' });
      expect(await log.appendWithResult({ ...input, data: 9 }, { retentionPolicy: 'reject' }))
        .toEqual({ kind: 'capacity-exceeded', maxEntriesPerRun: 1 });
      expect(db.prepare('SELECT next_cursor FROM jini_event_log_runs').get()).toEqual({ next_cursor: 2 });
      expect(db.prepare('SELECT cursor, data, recorded_at FROM jini_event_log_entries').all())
        .toEqual([{ cursor: 1, data: '{"a":1,"b":2}', recorded_at: 100 }]);
      // Legacy append still returns the old entry even for a conflicting event/payload.
      expect(await log.append({ ...input, event: 'other', data: 9 }, { dedupeKey: 'k' }))
        .toEqual({ id: '1', event: 'update', data: input.data, recordedAt: 100 });
      expect(await log.appendWithResult({ ...input, runId: 'other' }, options)).toMatchObject({ kind: 'inserted', entry: { id: '1' } });
    } finally { db.close(); }
  });

  it('normalizes undefined to persisted null and keeps legacy retries free of serialization', async () => {
    const db = new Database(':memory:');
    try {
      const log = await create(db, {});
      await log.appendWithResult({ runId: 'r', event: 'e', data: undefined }, { dedupeKey: 'k' });
      expect(await log.appendWithResult({ runId: 'r', event: 'e', data: null }, { dedupeKey: 'k', detectConflicts: true }))
        .toMatchObject({ kind: 'existing', entry: { id: '1', data: null } });
      const circular: { self?: unknown } = {}; circular.self = circular;
      expect(await log.appendWithResult({ runId: 'r', event: 'changed', data: circular }, { dedupeKey: 'k' }))
        .toMatchObject({ kind: 'existing', entry: { data: null } });
    } finally { db.close(); }
  });

  it('serializes final-slot contention and leaves rejected rows and cursors untouched even above a lowered cap', async () => {
    const db = new Database(':memory:');
    try {
      const log = await create(db, { maxEntriesPerRun: 2 });
      await log.appendWithResult({ runId: 'r', event: 'e', data: 0 }, { retentionPolicy: 'reject' });
      const results = await Promise.all([1, 2].map(data => log.appendWithResult(
        { runId: 'r', event: 'e', data }, { retentionPolicy: 'reject' },
      )));
      expect(results.map(result => result.kind).sort()).toEqual(['capacity-exceeded', 'inserted']);
      const rows = db.prepare('SELECT * FROM jini_event_log_entries ORDER BY cursor').all();
      const lowered = await create(db, { maxEntriesPerRun: 1 });
      expect(await lowered.appendWithResult({ runId: 'r', event: 'e', data: 3 }, { retentionPolicy: 'reject' }))
        .toEqual({ kind: 'capacity-exceeded', maxEntriesPerRun: 1 });
      expect(db.prepare('SELECT * FROM jini_event_log_entries ORDER BY cursor').all()).toEqual(rows);
      expect(db.prepare('SELECT next_cursor FROM jini_event_log_runs').get()).toEqual({ next_cursor: 3 });
    } finally { db.close(); }
  });

  it('rejects new runs at zero cap without creating state; default zero retention still allocates cursors', async () => {
    const db = new Database(':memory:');
    try {
      const log = await create(db, { maxEntriesPerRun: 0 });
      expect(await log.appendWithResult({ runId: 'new', event: 'e', data: 1 }, { retentionPolicy: 'reject' }))
        .toEqual({ kind: 'capacity-exceeded', maxEntriesPerRun: 0 });
      expect(await log.listRunIds({})).toEqual([]);
      expect(await log.replay({ runId: 'new', afterCursor: null })).toEqual({ kind: 'unknown-run' });
      expect(await log.appendWithResult({ runId: 'new', event: 'e', data: 1 })).toMatchObject({ kind: 'inserted', entry: { id: '1' } });
      expect(await log.appendWithResult({ runId: 'new', event: 'e', data: 2 })).toMatchObject({ kind: 'inserted', entry: { id: '2' } });
      expect(await log.replay({ runId: 'new', afterCursor: '0' }))
        .toEqual({ kind: 'replay-gap', requestedCursor: '0', oldestAvailableCursor: null });
    } finally { db.close(); }
  });

  it('expires conflict evidence with FIFO eviction and drop while preserving replay gaps and truncation', async () => {
    const db = new Database(':memory:');
    try {
      const log = await create(db, { maxEntriesPerRun: 1, clock: { nowMs: () => 300 } });
      await log.appendWithResult({ runId: 'r', event: 'e', data: 1 }, { dedupeKey: 'old' });
      await log.appendWithResult({ runId: 'r', event: 'e', data: 2 });
      const third = await log.appendWithResult({ runId: 'r', event: 'changed', data: 3 }, { dedupeKey: 'old', detectConflicts: true });
      expect(third).toMatchObject({ kind: 'inserted', entry: { id: '3' } });
      expect(await log.replay({ runId: 'r', afterCursor: null })).toEqual({ kind: 'ok', entries: [{ id: '3', event: 'changed', data: 3, recordedAt: 300 }], truncated: true });
      expect(await log.replay({ runId: 'r', afterCursor: '1' }))
        .toEqual({ kind: 'replay-gap', requestedCursor: '1', oldestAvailableCursor: '3' });
      expect(await log.replay({ runId: 'r', afterCursor: '2' })).toEqual({ kind: 'ok', entries: [{ id: '3', event: 'changed', data: 3, recordedAt: 300 }] });
      await log.drop({ runId: 'r' });
      expect(await log.listRunIds({})).toEqual([]);
      expect(await log.appendWithResult({ runId: 'r', event: 'fresh', data: 4 }, { dedupeKey: 'old', detectConflicts: true }))
        .toMatchObject({ kind: 'inserted', entry: { id: '1' } });
      await expect(log.replay({ runId: 'unknown', afterCursor: '-1' })).rejects.toThrow(/invalid replay cursor/);
    } finally { db.close(); }
  });
});

it('detects conflicting retries after an owned connection is closed and reopened', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jini-receipts-'));
  const input = { file: join(dir, 'events.db'), open: (file: string) => new Database(file) };
  let log = openSqliteEventLog(input, { clock: { nowMs: () => 123 } });
  try {
    const event = { runId: 'r', event: 'e', data: { n: 1 } };
    const first = await log.appendWithResult(event, { dedupeKey: 'k' });
    await log.close({});
    log = openSqliteEventLog(input);
    expect(await log.appendWithResult(event, { dedupeKey: 'k', detectConflicts: true })).toEqual({ ...first, kind: 'existing' });
    expect(await log.appendWithResult({ ...event, data: { n: 2 } }, { dedupeKey: 'k', detectConflicts: true })).toEqual({ kind: 'conflict' });
    expect((await log.append({ ...event, data: { n: 3 } })).id).toBe('2');
  } finally { await log.close({}); rmSync(dir, { recursive: true, force: true }); }
});
