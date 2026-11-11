import { describe, expect, it } from 'vitest';
import { createInMemoryEventLog } from '../event-log.js';

// F1 fix wave (Stryker L8 §4 event-log.ts:178,192,195,213).
describe('createInMemoryEventLog — F1 retention + dedupe + copies', () => {
  it.each([[2, 2, ['1', '2'], false], [2, 3, ['2', '3'], true], [3, 3, ['1', '2', '3'], false]])(
    'cap %d after %d appends keeps %j (truncated=%s) — exact boundary', async (maxEntriesPerRun, appends, ids, truncated) => {
      const log = createInMemoryEventLog({}, { maxEntriesPerRun });
      for (let n = 1; n <= appends; n++) await log.append({ runId: 'r', event: 'agent', data: n });
      const replay = await log.replay({ runId: 'r', afterCursor: null });
      expect(replay.kind).toBe('ok');
      if (replay.kind !== 'ok') return;
      expect(replay.entries.map((e) => e.id)).toEqual(ids);
      expect(replay.truncated === true).toBe(truncated);
    });

  it('the same dedupeKey returns the original entry and does not append; a new key does', async () => {
    const log = createInMemoryEventLog({});
    const a = await log.append({ runId: 'r', event: 'agent', data: 'a' }, { dedupeKey: 'k' });
    const again = await log.append({ runId: 'r', event: 'agent', data: 'DIFFERENT' }, { dedupeKey: 'k' });
    const b = await log.append({ runId: 'r', event: 'agent', data: 'b' }, { dedupeKey: 'k2' });
    const plain = await log.append({ runId: 'r', event: 'agent', data: 'c' });
    expect(again).toBe(a);
    expect([a.id, b.id, plain.id]).toEqual(['1', '2', '3']);
    const replay = await log.replay({ runId: 'r', afterCursor: null });
    expect(replay.kind === 'ok' && replay.entries.map((e) => e.data)).toEqual(['a', 'b', 'c']);
  });

  it('dedupe keys are per run', async () => {
    const log = createInMemoryEventLog({});
    const r1 = await log.append({ runId: 'r1', event: 'agent', data: 1 }, { dedupeKey: 'k' });
    const r2 = await log.append({ runId: 'r2', event: 'agent', data: 2 }, { dedupeKey: 'k' });
    expect(r2).not.toBe(r1);
    expect(r2.data).toBe(2);
  });

  it('replay returns a defensive copy: mutating it does not change the log', async () => {
    const log = createInMemoryEventLog({});
    await log.append({ runId: 'r', event: 'agent', data: 1 });
    const first = await log.replay({ runId: 'r', afterCursor: null });
    if (first.kind === 'ok') (first.entries as unknown[]).length = 0;
    const second = await log.replay({ runId: 'r', afterCursor: null });
    expect(second.kind === 'ok' && second.entries.length).toBe(1);
  });

  it('a non-numeric replay cursor is reported as invalid-cursor', async () => {
    const log = createInMemoryEventLog({});
    await log.append({ runId: 'r', event: 'agent', data: 1 });
    expect(await log.replay({ runId: 'r', afterCursor: 'abc' })).toEqual({ kind: 'invalid-cursor', requestedCursor: 'abc' });
  });

  it('a cursor just before the oldest retained entry is ok; one further back is a replay-gap naming the oldest', async () => {
    const log = createInMemoryEventLog({}, { maxEntriesPerRun: 2 });
    for (let n = 1; n <= 4; n++) await log.append({ runId: 'r', event: 'agent', data: n });
    const ok = await log.replay({ runId: 'r', afterCursor: '2' });
    expect(ok.kind === 'ok' && ok.entries.map((e) => e.id)).toEqual(['3', '4']);
    expect(await log.replay({ runId: 'r', afterCursor: '1' })).toEqual({ kind: 'replay-gap', requestedCursor: '1', oldestAvailableCursor: '3' });
  });
});

describe('createInMemoryEventLog — F1 re-score kills', () => {
  it('two appends WITHOUT a dedupe key are two distinct entries (undefined is not a key)', async () => {
    const log = createInMemoryEventLog({});
    const a = await log.append({ runId: 'r', event: 'agent', data: 1 });
    const b = await log.append({ runId: 'r', event: 'agent', data: 2 });
    expect([a.id, b.id]).toEqual(['1', '2']);
    expect(b.data).toBe(2);
  });
});
