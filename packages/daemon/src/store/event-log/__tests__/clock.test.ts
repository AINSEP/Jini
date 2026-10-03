import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';
import type { Clock } from '@jini-ai/core/primitives';
import { createSqliteEventLog, openSqliteEventLog } from '../sqlite.js';

// REGRESSION: fails if bindSqliteEventLog reads options.now instead of options.clock.nowMs().
it('borrows and opens logs using the same stateful core Clock, preserving dedupe timestamps', async () => {
  const db = new Database(':memory:');
  const clock: Clock & { time: number } = { time: 4102444800123, nowMs() { return this.time; } };
  const borrowed = createSqliteEventLog({ db }, { clock });
  const owned = openSqliteEventLog({ file: ':memory:', open: (file, options) => new Database(file, options) }, { clock });
  try {
    const first = await borrowed.append({ runId: 'r', event: 'probe', data: 1 }, { dedupeKey: 'same' });
    expect(first.recordedAt).toBe(clock.time);
    clock.time += 1;
    expect(await borrowed.append({ runId: 'r', event: 'probe', data: 2 }, { dedupeKey: 'same' })).toEqual(first);
    expect((await owned.append({ runId: 'r', event: 'probe', data: 2 })).recordedAt).toBe(clock.time);
    await borrowed.close({});
    expect(db.prepare('SELECT 1 AS n').get()).toEqual({ n: 1 });
  } finally { await owned.close({}); db.close(); }
});
// PARITY
it('keeps system timestamps and retention when no Clock is supplied', async () => {
  const db = new Database(':memory:');
  const now = vi.spyOn(Date, 'now').mockReturnValue(4102444800123);
  try {
    const log = createSqliteEventLog({ db }, { maxEntriesPerRun: 1 });
    await log.append({ runId: 'r', event: 'first', data: null });
    const last = await log.append({ runId: 'r', event: 'last', data: null });
    expect(last.recordedAt).toBe(4102444800123);
    expect(await log.replay({ runId: 'r', afterCursor: null })).toEqual({ kind: 'ok', entries: [last], truncated: true });
  } finally { now.mockRestore(); db.close(); }
});
