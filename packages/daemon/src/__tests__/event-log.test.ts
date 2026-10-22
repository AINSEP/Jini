import { describe, expect, it } from 'vitest';
import { createInMemoryEventLog } from '../event-log.js';

describe('createInMemoryEventLog — ordered append + replay', () => {
  it('assigns strictly increasing string cursors in append order', async () => {
    const log = createInMemoryEventLog({});
    const a = await log.append({ runId: 'r1', event: 'start', data: { n: 1 } });
    const b = await log.append({ runId: 'r1', event: 'agent', data: { n: 2 } });
    const c = await log.append({ runId: 'r1', event: 'end', data: { n: 3 } });

    expect(Number(a.id)).toBeLessThan(Number(b.id));
    expect(Number(b.id)).toBeLessThan(Number(c.id));

    const replay = await log.replay({ runId: 'r1', afterCursor: null });
    expect(replay).toEqual({ kind: 'ok', entries: [a, b, c] });
  });

  it('replay(afterCursor) returns only entries strictly after the given cursor', async () => {
    const log = createInMemoryEventLog({});
    const a = await log.append({ runId: 'r1', event: 'start', data: 1 });
    const b = await log.append({ runId: 'r1', event: 'agent', data: 2 });
    const c = await log.append({ runId: 'r1', event: 'end', data: 3 });

    const replay = await log.replay({ runId: 'r1', afterCursor: a.id });
    expect(replay).toEqual({ kind: 'ok', entries: [b, c] });
  });

  it('replay(null) on a run with no events returns an empty ok result, not unknown-run, once appended at least once then dropped is unknown', async () => {
    const log = createInMemoryEventLog({});
    const replay = await log.replay({ runId: 'never-seen', afterCursor: null });
    expect(replay).toEqual({ kind: 'unknown-run' });
  });

  it('replay with a non-numeric cursor returns invalid-cursor', async () => {
    const log = createInMemoryEventLog({});
    await log.append({ runId: 'r1', event: 'start', data: 1 });
    const replay = await log.replay({ runId: 'r1', afterCursor: 'not-a-number' });
    expect(replay).toEqual({ kind: 'invalid-cursor', requestedCursor: 'not-a-number' });
  });

  it('drop() removes all state for a run; a subsequent replay reports unknown-run', async () => {
    const log = createInMemoryEventLog({});
    await log.append({ runId: 'r1', event: 'start', data: 1 });
    await log.drop({ runId: 'r1' });
    const replay = await log.replay({ runId: 'r1', afterCursor: null });
    expect(replay).toEqual({ kind: 'unknown-run' });
  });

  it('lists known run ids in stable order and removes a dropped run from that index', async () => {
    const log = createInMemoryEventLog({});
    await log.append({ runId: 'run-b', event: 'start', data: {} });
    await log.append({ runId: 'run-a', event: 'start', data: {} });

    expect(await log.listRunIds({  })).toEqual(['run-a', 'run-b']);

    await log.drop({ runId: 'run-a' });
    expect(await log.listRunIds({  })).toEqual(['run-b']);
  });
});

describe('createInMemoryEventLog — idempotency-key dedup', () => {
  it('a duplicate append with the same dedupeKey returns the original entry and does not create a second one', async () => {
    const log = createInMemoryEventLog({});
    const first = await log.append({ runId: 'r1', event: 'agent', data: { attempt: 1 } }, { dedupeKey: 'retry-1' });
    const second = await log.append({ runId: 'r1', event: 'agent', data: { attempt: 2 } }, { dedupeKey: 'retry-1' });

    expect(second).toBe(first);
    expect(second.data).toEqual({ attempt: 1 });

    const replay = await log.replay({ runId: 'r1', afterCursor: null });
    expect(replay.kind).toBe('ok');
    if (replay.kind === 'ok') {
      expect(replay.entries).toHaveLength(1);
    }
  });

  it('different dedupeKeys (or no dedupeKey) are recorded as distinct entries', async () => {
    const log = createInMemoryEventLog({});
    await log.append({ runId: 'r1', event: 'agent', data: 1 }, { dedupeKey: 'k1' });
    await log.append({ runId: 'r1', event: 'agent', data: 2 }, { dedupeKey: 'k2' });
    await log.append({ runId: 'r1', event: 'agent', data: 3 });
    await log.append({ runId: 'r1', event: 'agent', data: 4 });

    const replay = await log.replay({ runId: 'r1', afterCursor: null });
    expect(replay.kind).toBe('ok');
    if (replay.kind === 'ok') {
      expect(replay.entries).toHaveLength(4);
    }
  });
});

describe('createInMemoryEventLog — eviction + replay-gap adversarial cases', () => {
  it('evicts oldest entries once maxEntriesPerRun is exceeded, and flags the null-cursor replay as truncated', async () => {
    const log = createInMemoryEventLog({}, { maxEntriesPerRun: 3 });
    for (let i = 0; i < 5; i += 1) {
      await log.append({ runId: 'r1', event: 'agent', data: i });
    }
    const replay = await log.replay({ runId: 'r1', afterCursor: null });
    expect(replay.kind).toBe('ok');
    if (replay.kind === 'ok') {
      // ids 1..5 assigned; ids 1,2 evicted; 3,4,5 retained.
      expect(replay.entries.map((e) => e.id)).toEqual(['3', '4', '5']);
      expect(replay.truncated).toBe(true);
    }
  });

  it('does not cap retention when maxEntriesPerRun is omitted (eviction is opt-in, not a silent default)', async () => {
    const log = createInMemoryEventLog({});
    for (let i = 0; i < 2500; i += 1) {
      await log.append({ runId: 'r1', event: 'agent', data: i });
    }
    const replay = await log.replay({ runId: 'r1', afterCursor: null });
    expect(replay.kind).toBe('ok');
    if (replay.kind === 'ok') {
      expect(replay.entries).toHaveLength(2500);
      expect(replay.truncated).toBeUndefined();
    }
  });

  it('returns a distinguishable replay-gap when the requested cursor falls before the oldest retained entry', async () => {
    const log = createInMemoryEventLog({}, { maxEntriesPerRun: 3 });
    for (let i = 0; i < 5; i += 1) {
      await log.append({ runId: 'r1', event: 'agent', data: i });
    }
    // ids 3,4,5 retained; a client whose last-seen cursor is '1' has a real
    // hole (missed id '2') rather than simply being caught up.
    const replay = await log.replay({ runId: 'r1', afterCursor: '1' });
    expect(replay).toEqual({ kind: 'replay-gap', requestedCursor: '1', oldestAvailableCursor: '3' });
  });

  it('does NOT report a gap when the requested cursor is contiguous with (or ahead of) the oldest retained entry', async () => {
    const log = createInMemoryEventLog({}, { maxEntriesPerRun: 3 });
    for (let i = 0; i < 5; i += 1) {
      await log.append({ runId: 'r1', event: 'agent', data: i });
    }
    // oldest retained id is '3'; a cursor of '2' is exactly contiguous (no hole).
    const contiguous = await log.replay({ runId: 'r1', afterCursor: '2' });
    expect(contiguous.kind).toBe('ok');
    if (contiguous.kind === 'ok') {
      expect(contiguous.entries.map((e) => e.id)).toEqual(['3', '4', '5']);
    }

    // a cursor already caught up to the newest entry returns an empty ok result.
    const caughtUp = await log.replay({ runId: 'r1', afterCursor: '5' });
    expect(caughtUp).toEqual({ kind: 'ok', entries: [] });
  });

  it('reports a gap with a null oldestAvailableCursor when maxEntriesPerRun is 0 (every entry evicted immediately)', async () => {
    const log = createInMemoryEventLog({}, { maxEntriesPerRun: 0 });
    await log.append({ runId: 'r1', event: 'agent', data: 'evicted-on-arrival' });
    // runLog exists (append created it) but retains zero entries, so
    // `oldestRetained` is undefined — exercises the "empty retained log"
    // fallback branches (oldestRetainedId falls back to runLog.nextId, and
    // oldestAvailableCursor reports null instead of a real id).
    const replay = await log.replay({ runId: 'r1', afterCursor: '0' });
    expect(replay).toEqual({ kind: 'replay-gap', requestedCursor: '0', oldestAvailableCursor: null });
  });

  it('a first-time replay(null) after eviction is not treated as a gap (nothing was ever promised to a caller that never asked), but IS flagged truncated', async () => {
    const log = createInMemoryEventLog({}, { maxEntriesPerRun: 2 });
    for (let i = 0; i < 10; i += 1) {
      await log.append({ runId: 'r1', event: 'agent', data: i });
    }
    const replay = await log.replay({ runId: 'r1', afterCursor: null });
    expect(replay.kind).toBe('ok');
    if (replay.kind === 'ok') {
      expect(replay.entries).toHaveLength(2);
      expect(replay.truncated).toBe(true);
    }
  });
});

// The injected clock changes the seam, never the retained-record/dedupe contract.
it('uses the host clock and retains dedupe evidence beyond the FIFO window', async () => {
  const log = createInMemoryEventLog({}, { maxEntriesPerRun: 1, now: () => 123 });
  const first = await log.append({ runId: 'r-clock', event: 'delta', data: 'first' }, { dedupeKey: 'first' });
  await log.append({ runId: 'r-clock', event: 'delta', data: 'second' });
  const duplicate = await log.append({ runId: 'r-clock', event: 'delta', data: 'retry' }, { dedupeKey: 'first' });
  expect([first.id, first.recordedAt, duplicate]).toEqual(['1', 123, first]);
  const replay = await log.replay({ runId: 'r-clock', afterCursor: null });
  expect(replay).toMatchObject({ kind: 'ok', truncated: true, entries: [{ id: '2', recordedAt: 123, data: 'second' }] });
});
