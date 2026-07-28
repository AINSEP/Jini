/**
 * Conformance suite for `createSqliteEventLog`. Covers the same shape as
 * `@injini/daemon`'s `event-log.test.ts` (ordering, replay cursor, idempotency dedup,
 * eviction/replay-gap) against the sqlite adapter instead of the in-memory reference,
 * proving behavioral parity — plus a durability-across-restart section with no in-memory
 * equivalent (opens a fresh connection to the same file and confirms data survived).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteEventLog, type SqliteEventLog } from '../event-log.js';

let dir: string;
let dbPath: string;
let log: SqliteEventLog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jini-sqlite-event-log-'));
  dbPath = join(dir, 'events.db');
  log = createSqliteEventLog(dbPath);
});

afterEach(async () => {
  await log.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('createSqliteEventLog — ordered append + replay', () => {
  it('assigns strictly increasing string cursors in append order', async () => {
    const a = await log.append({ runId: 'r1', event: 'start', data: { n: 1 } });
    const b = await log.append({ runId: 'r1', event: 'agent', data: { n: 2 } });
    const c = await log.append({ runId: 'r1', event: 'end', data: { n: 3 } });

    expect(Number(a.id)).toBeLessThan(Number(b.id));
    expect(Number(b.id)).toBeLessThan(Number(c.id));

    const replay = await log.replay('r1', null);
    expect(replay).toEqual({ kind: 'ok', entries: [a, b, c] });
  });

  it('replay(afterCursor) returns only entries strictly after the given cursor', async () => {
    const a = await log.append({ runId: 'r1', event: 'start', data: 1 });
    const b = await log.append({ runId: 'r1', event: 'agent', data: 2 });
    const c = await log.append({ runId: 'r1', event: 'end', data: 3 });

    const replay = await log.replay('r1', a.id);
    expect(replay).toEqual({ kind: 'ok', entries: [b, c] });
  });

  it('replay(null) on a never-seen run returns unknown-run', async () => {
    const replay = await log.replay('never-seen', null);
    expect(replay).toEqual({ kind: 'unknown-run' });
  });

  it('replay rejects a non-numeric cursor (throws instead of returning invalid-cursor)', async () => {
    await log.append({ runId: 'r1', event: 'start', data: 1 });
    await expect(log.replay('r1', 'not-a-number')).rejects.toThrow(/invalid replay cursor/);
  });

  it('replay rejects a negative cursor', async () => {
    await log.append({ runId: 'r1', event: 'start', data: 1 });
    await expect(log.replay('r1', '-1')).rejects.toThrow(/invalid replay cursor/);
  });

  it('replay rejects a fractional cursor', async () => {
    await log.append({ runId: 'r1', event: 'start', data: 1 });
    await expect(log.replay('r1', '1.5')).rejects.toThrow(/invalid replay cursor/);
  });

  it('replay rejects a NaN-shaped cursor', async () => {
    await log.append({ runId: 'r1', event: 'start', data: 1 });
    await expect(log.replay('r1', 'NaN')).rejects.toThrow(/invalid replay cursor/);
  });

  it('replay rejects an Infinity-shaped cursor', async () => {
    await log.append({ runId: 'r1', event: 'start', data: 1 });
    await expect(log.replay('r1', 'Infinity')).rejects.toThrow(/invalid replay cursor/);
  });

  it('cursor validation runs even when the run is unknown (throws, not unknown-run)', async () => {
    await expect(log.replay('never-seen', '-1')).rejects.toThrow(/invalid replay cursor/);
  });

  it('drop() removes all state for a run; a subsequent replay reports unknown-run', async () => {
    await log.append({ runId: 'r1', event: 'start', data: 1 });
    await log.drop('r1');
    const replay = await log.replay('r1', null);
    expect(replay).toEqual({ kind: 'unknown-run' });
  });

  it('keeps independent runs separately ordered', async () => {
    const a1 = await log.append({ runId: 'r1', event: 'start', data: 1 });
    const b1 = await log.append({ runId: 'r2', event: 'start', data: 1 });
    const a2 = await log.append({ runId: 'r1', event: 'end', data: 2 });

    expect(await log.replay('r1', null)).toEqual({ kind: 'ok', entries: [a1, a2] });
    expect(await log.replay('r2', null)).toEqual({ kind: 'ok', entries: [b1] });
  });

  it('stores undefined data as JSON null and replays it back as null', async () => {
    const entry = await log.append({ runId: 'r1', event: 'ping', data: undefined });
    expect(entry.data).toBeUndefined();

    const replay = await log.replay('r1', null);
    expect(replay.kind).toBe('ok');
    if (replay.kind === 'ok') {
      expect(replay.entries[0]?.data).toBeNull();
    }
  });
});

describe('createSqliteEventLog — idempotency-key dedup', () => {
  it('a duplicate append with the same dedupeKey returns the original entry and does not create a second one', async () => {
    const first = await log.append({
      runId: 'r1',
      event: 'agent',
      data: { attempt: 1 },
      dedupeKey: 'retry-1',
    });
    const second = await log.append({
      runId: 'r1',
      event: 'agent',
      data: { attempt: 2 },
      dedupeKey: 'retry-1',
    });

    expect(second).toEqual(first);
    expect(second.data).toEqual({ attempt: 1 });

    const replay = await log.replay('r1', null);
    expect(replay.kind).toBe('ok');
    if (replay.kind === 'ok') {
      expect(replay.entries).toHaveLength(1);
    }
  });

  it('different dedupeKeys (or no dedupeKey) are recorded as distinct entries', async () => {
    await log.append({ runId: 'r1', event: 'agent', data: 1, dedupeKey: 'k1' });
    await log.append({ runId: 'r1', event: 'agent', data: 2, dedupeKey: 'k2' });
    await log.append({ runId: 'r1', event: 'agent', data: 3 });
    await log.append({ runId: 'r1', event: 'agent', data: 4 });

    const replay = await log.replay('r1', null);
    expect(replay.kind).toBe('ok');
    if (replay.kind === 'ok') {
      expect(replay.entries).toHaveLength(4);
    }
  });
});

describe('createSqliteEventLog — eviction + replay-gap adversarial cases', () => {
  it('evicts oldest entries once maxEntriesPerRun is exceeded, and flags the null-cursor replay as truncated', async () => {
    const capped = createSqliteEventLog(':memory:', { maxEntriesPerRun: 3 });
    for (let i = 0; i < 5; i += 1) {
      await capped.append({ runId: 'r1', event: 'agent', data: i });
    }
    const replay = await capped.replay('r1', null);
    expect(replay.kind).toBe('ok');
    if (replay.kind === 'ok') {
      expect(replay.entries.map((e) => e.id)).toEqual(['3', '4', '5']);
      expect(replay.truncated).toBe(true);
    }
    await capped.close();
  });

  it('caps retention at the documented default of 2000 when maxEntriesPerRun is omitted', async () => {
    const defaulted = createSqliteEventLog(':memory:');
    for (let i = 0; i < 2500; i += 1) {
      await defaulted.append({ runId: 'r1', event: 'agent', data: i });
    }
    const replay = await defaulted.replay('r1', null);
    expect(replay.kind).toBe('ok');
    if (replay.kind === 'ok') {
      expect(replay.entries).toHaveLength(2000);
      expect(replay.entries[0]?.id).toBe('501'); // oldest 500 of 2500 evicted (2500 - 2000 cap)
      expect(replay.entries[replay.entries.length - 1]?.id).toBe('2500');
      expect(replay.truncated).toBe(true);
    }
    await defaulted.close();
  });

  it('honors an explicit maxEntriesPerRun larger than the default, overriding it in either direction', async () => {
    const generous = createSqliteEventLog(':memory:', { maxEntriesPerRun: 3000 });
    for (let i = 0; i < 2500; i += 1) {
      await generous.append({ runId: 'r1', event: 'agent', data: i });
    }
    const replay = await generous.replay('r1', null);
    expect(replay.kind).toBe('ok');
    if (replay.kind === 'ok') {
      expect(replay.entries).toHaveLength(2500);
      expect(replay.truncated).toBeUndefined();
    }
    await generous.close();
  });

  it('throws at construction when maxEntriesPerRun is negative, fractional, or non-finite', () => {
    expect(() => createSqliteEventLog(':memory:', { maxEntriesPerRun: -1 })).toThrow(/maxEntriesPerRun/);
    expect(() => createSqliteEventLog(':memory:', { maxEntriesPerRun: 1.5 })).toThrow(/maxEntriesPerRun/);
    expect(() => createSqliteEventLog(':memory:', { maxEntriesPerRun: Number.NaN })).toThrow(/maxEntriesPerRun/);
    expect(() =>
      createSqliteEventLog(':memory:', { maxEntriesPerRun: Number.POSITIVE_INFINITY }),
    ).toThrow(/maxEntriesPerRun/);
  });

  it('returns a distinguishable replay-gap when the requested cursor falls before the oldest retained entry', async () => {
    const capped = createSqliteEventLog(':memory:', { maxEntriesPerRun: 3 });
    for (let i = 0; i < 5; i += 1) {
      await capped.append({ runId: 'r1', event: 'agent', data: i });
    }
    const replay = await capped.replay('r1', '1');
    expect(replay).toEqual({ kind: 'replay-gap', requestedCursor: '1', oldestAvailableCursor: '3' });
    await capped.close();
  });

  it('does NOT report a gap when the requested cursor is contiguous with (or ahead of) the oldest retained entry', async () => {
    const capped = createSqliteEventLog(':memory:', { maxEntriesPerRun: 3 });
    for (let i = 0; i < 5; i += 1) {
      await capped.append({ runId: 'r1', event: 'agent', data: i });
    }
    const contiguous = await capped.replay('r1', '2');
    expect(contiguous.kind).toBe('ok');
    if (contiguous.kind === 'ok') {
      expect(contiguous.entries.map((e) => e.id)).toEqual(['3', '4', '5']);
    }

    const caughtUp = await capped.replay('r1', '5');
    expect(caughtUp).toEqual({ kind: 'ok', entries: [] });
    await capped.close();
  });

  it('a first-time replay(null) after eviction is not treated as a gap, but IS flagged truncated', async () => {
    const capped = createSqliteEventLog(':memory:', { maxEntriesPerRun: 2 });
    for (let i = 0; i < 10; i += 1) {
      await capped.append({ runId: 'r1', event: 'agent', data: i });
    }
    const replay = await capped.replay('r1', null);
    expect(replay.kind).toBe('ok');
    if (replay.kind === 'ok') {
      expect(replay.entries).toHaveLength(2);
      expect(replay.truncated).toBe(true);
    }
    await capped.close();
  });

  it('reports oldestAvailableCursor:null when every entry for the run has been evicted (maxEntriesPerRun: 0)', async () => {
    const capped = createSqliteEventLog(':memory:', { maxEntriesPerRun: 0 });
    await capped.append({ runId: 'r1', event: 'agent', data: 1 });

    const replay = await capped.replay('r1', '0');
    expect(replay).toEqual({ kind: 'replay-gap', requestedCursor: '0', oldestAvailableCursor: null });
    await capped.close();
  });
});

describe('createSqliteEventLog — durability across a restart', () => {
  it('data appended before close() is visible from a fresh connection to the same file', async () => {
    const a = await log.append({ runId: 'r1', event: 'start', data: { n: 1 } });
    const b = await log.append({ runId: 'r1', event: 'agent', data: { n: 2 } });
    await log.close();

    const reopened = createSqliteEventLog(dbPath);
    try {
      const replay = await reopened.replay('r1', null);
      expect(replay).toEqual({ kind: 'ok', entries: [a, b] });
    } finally {
      await reopened.close();
    }
  });

  it('keeps the known-run index across a restart', async () => {
    await log.append({ runId: 'run-b', event: 'start', data: {} });
    await log.append({ runId: 'run-a', event: 'start', data: {} });
    await log.close();

    const reopened = createSqliteEventLog(dbPath);
    try {
      expect(await reopened.listRunIds()).toEqual(['run-a', 'run-b']);
      await reopened.drop('run-a');
      expect(await reopened.listRunIds()).toEqual(['run-b']);
    } finally {
      await reopened.close();
    }
  });

  it('the next-cursor counter survives a restart (no cursor reuse across a reopen)', async () => {
    await log.append({ runId: 'r1', event: 'start', data: 1 });
    await log.close();

    const reopened = createSqliteEventLog(dbPath);
    try {
      const next = await reopened.append({ runId: 'r1', event: 'agent', data: 2 });
      expect(Number(next.id)).toBe(2);
    } finally {
      await reopened.close();
    }
  });

  it('dedupe state survives a restart (a retried append after reopen still dedupes)', async () => {
    const first = await log.append({
      runId: 'r1',
      event: 'agent',
      data: { attempt: 1 },
      dedupeKey: 'retry-1',
    });
    await log.close();

    const reopened = createSqliteEventLog(dbPath);
    try {
      const retried = await reopened.append({
        runId: 'r1',
        event: 'agent',
        data: { attempt: 2 },
        dedupeKey: 'retry-1',
      });
      expect(retried).toEqual(first);

      const replay = await reopened.replay('r1', null);
      expect(replay.kind).toBe('ok');
      if (replay.kind === 'ok') {
        expect(replay.entries).toHaveLength(1);
      }
    } finally {
      await reopened.close();
    }
  });

  it('drop() durably removes a run — a fresh connection also reports unknown-run', async () => {
    await log.append({ runId: 'r1', event: 'start', data: 1 });
    await log.drop('r1');
    await log.close();

    const reopened = createSqliteEventLog(dbPath);
    try {
      expect(await reopened.replay('r1', null)).toEqual({ kind: 'unknown-run' });
    } finally {
      await reopened.close();
    }
  });
});
