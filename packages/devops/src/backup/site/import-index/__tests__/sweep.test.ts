import { describe, expect, it, vi } from 'vitest';
import type { ImportHistoryPolicy } from '@jini-ai/core/contracts/site/site-import-history';
import type { SqliteSyncClient } from '@jini-ai/core/contracts/storage';
import { sweepExpired } from '../sweep.js';

const policy: ImportHistoryPolicy = { cutoverPolicy: 'rollback', historyVisibleMs: 2_592_000_000, replayFenceMs: 31_536_000_000, legacyRetireMs: 2_592_000_000, sweepOnClockRollback: false };

describe('physical retention', () => {
  it('history boundary: listed at 30d − 1 ms, hidden at exactly 30d', () => {
    let history = ['one']; let replay = [{ principal_id: 'one', request_id: 'key' }]; let highWater = 0;
    const run = vi.fn((sql: string, args: unknown[]) => {
      if (sql.startsWith('DELETE FROM imports')) history = [];
      if (sql.startsWith('DELETE FROM replay')) { expect(sql).not.toContain('rowid'); expect(args).toEqual(['one', 'key']); replay = []; }
      if (sql.startsWith('INSERT INTO meta')) highWater = Number(args[0]);
    });
    const db = { prepare: (sql: string) => ({
      get: () => ({ value: String(highWater) }),
      all: (cutoff: number) => sql.includes('FROM imports') ? (cutoff >= 0 ? history.map(import_id => ({ import_id })) : []) : (cutoff >= 0 ? replay : []),
      run: (...args: unknown[]) => run(sql, args),
    }), transaction: (body: () => void) => ({ immediate: body }) } as unknown as SqliteSyncClient;
    sweepExpired({ db, clock: { nowMs: () => policy.historyVisibleMs - 1 }, policy });
    expect(history).toEqual(['one']);
    sweepExpired({ db, clock: { nowMs: () => policy.historyVisibleMs }, policy });
    expect(history).toEqual([]);
    sweepExpired({ db, clock: { nowMs: () => policy.replayFenceMs }, policy });
    expect(replay).toEqual([]);
    const calls = run.mock.calls.length;
    sweepExpired({ db, clock: { nowMs: () => 1 }, policy });
    expect(run).toHaveBeenCalledTimes(calls);
  });
});
