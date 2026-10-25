/**
 * F1 fix wave (Stryker L8 §5): once the sandbox alias anomaly was fixed, `sqlite.ts` scored 90.2 %
 * with 11 survivors. These pin the non-equivalent ones: borrowed-connection validation, the WAL
 * pragma on owned connections, the fresh-dedupe-key path, and replay-from-start parity with the
 * in-memory reference when the per-run cap evicts everything.
 */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryEventLog } from '../../../event-log.js';
import { createSqliteEventLog, openSqliteEventLog } from '../sqlite.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jini-sqlite-f1-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('createSqliteEventLog — borrowed connection validation', () => {
  it.each([
    ['undefined input', undefined],
    ['null input', null],
    ['string input', 'events.db'],
    ['object without db', {}],
    ['db: null', { db: null }],
  ])('%s → "pass a borrowed SqliteDb"', (_l, input) => {
    expect(() => createSqliteEventLog(input as never)).toThrow(new Error('createSqliteEventLog: pass a borrowed SqliteDb'));
  });

  it('a borrowed connection works and closing the adapter leaves the host handle open', async () => {
    const db = new Database(':memory:');
    const log = createSqliteEventLog({ db: db as never });
    await log.append({ runId: 'r', event: 'start', data: 1 });
    await log.close({});
    expect(db.open).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM jini_event_log_entries').get()).toEqual({ n: 1 });
    db.close();
  });
});

describe('openSqliteEventLog — owned connection', () => {
  it('opens the file in WAL journal mode', async () => {
    let opened: Database.Database | undefined;
    const log = openSqliteEventLog({ file: join(dir, 'e.db'), open: (file, settings) => (opened = new Database(file, settings)) as never });
    expect(opened!.pragma('journal_mode', { simple: true })).toBe('wal');
    await log.close({});
    expect(opened!.open).toBe(false);
    await log.close({}); // idempotent
  });
});

describe('append — dedupe keys', () => {
  it('a fresh key appends; the same key returns the original entry; a different key appends again', async () => {
    const log = openSqliteEventLog({ file: join(dir, 'd.db'), open: (file, settings) => new Database(file, settings) as never });
    const first = await log.append({ runId: 'r', event: 'agent', data: { n: 1 } }, { dedupeKey: 'k1' });
    expect(first).toMatchObject({ id: '1', event: 'agent', data: { n: 1 } });
    const replayed = await log.append({ runId: 'r', event: 'agent', data: { n: 999 } }, { dedupeKey: 'k1' });
    expect(replayed).toEqual(first);
    const second = await log.append({ runId: 'r', event: 'agent', data: { n: 2 } }, { dedupeKey: 'k2' });
    expect(second.id).toBe('2');
    expect(await log.replay({ runId: 'r', afterCursor: null })).toEqual({ kind: 'ok', entries: [first, second] });
    await log.close({});
  });
});

describe('replay from the start — parity with the in-memory reference', () => {
  it.each([0, 1, 2])('maxEntriesPerRun=%d after 3 appends: same replay shape as createInMemoryEventLog', async (maxEntriesPerRun) => {
    const clock = { nowMs: () => 1_000 };
    const sqlite = openSqliteEventLog({ file: join(dir, `p${maxEntriesPerRun}.db`), open: (file, settings) => new Database(file, settings) as never }, { maxEntriesPerRun, clock });
    const memory = createInMemoryEventLog({}, { maxEntriesPerRun, now: clock.nowMs });
    for (const log of [sqlite, memory]) {
      for (const n of [1, 2, 3]) await log.append({ runId: 'r', event: 'agent', data: { n } });
    }
    const fromSqlite = await sqlite.replay({ runId: 'r', afterCursor: null });
    expect(fromSqlite).toEqual(await memory.replay({ runId: 'r', afterCursor: null }));
    expect(fromSqlite.kind).toBe('ok');
    await sqlite.close({});
  });
});
