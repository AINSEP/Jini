import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createSqliteEventLog } from '../sqlite.js';
import type { EventLog } from '@jini-ai/protocol';

describe('durable protocol call shape with unchanged SQL retention', () => {
  it('uses producer metadata separately, replays object cursors and drops object run ids', async () => {
    const db = new Database(':memory:');
    try {
      const log: EventLog = createSqliteEventLog({ db }, { clock: { nowMs: () => 42 }, maxEntriesPerRun: 1 });
      const first = await log.append({ runId: 'r', event: 'agent', data: { n: 1 } }, { dedupeKey: 'a' });
      expect(await log.append({ runId: 'r', event: 'other', data: { n: 99 } }, { dedupeKey: 'a' })).toEqual(first);
      expect(await log.listRunIds({})).toEqual(['r']);
      expect(await log.replay({ runId: 'r', afterCursor: null })).toEqual({ kind: 'ok', entries: [first] });
      await log.append({ runId: 'r', event: 'agent', data: { n: 2 } }, { dedupeKey: 'b' });
      // This adapter deliberately forgets dedupe evidence on eviction; no schema behavior changes.
      const retried = await log.append({ runId: 'r', event: 'agent', data: { n: 3 } }, { dedupeKey: 'a' });
      expect(retried).toEqual({ id: '3', event: 'agent', data: { n: 3 }, recordedAt: 42 });
      expect(await log.replay({ runId: 'r', afterCursor: '0' })).toEqual({ kind: 'replay-gap', requestedCursor: '0', oldestAvailableCursor: '3' });
      await log.drop({ runId: 'r' });
      expect(await log.listRunIds({})).toEqual([]);
      expect(await log.replay({ runId: 'r', afterCursor: null })).toEqual({ kind: 'unknown-run' });
    } finally { db.close(); }
  });
  it('requires a borrowed handle instead of implicitly accepting a positional path', () => {
    expect(() => createSqliteEventLog('database.sqlite' as never)).toThrow('createSqliteEventLog: pass a borrowed SqliteDb');
  });
});

it('does not let producer metadata override the required run identity', async () => {
  const db = new Database(':memory:');
  try {
    const log = createSqliteEventLog({ db }, { clock: { nowMs: () => 7 } });
    await log.append({ runId: 'owner', event: 'agent', data: null }, { dedupeKey: 'key', runId: 'other' } as never);
    expect(await log.listRunIds({})).toEqual(['owner']);
  } finally { db.close(); }
});
