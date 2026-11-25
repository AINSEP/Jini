import { describe, expect, it, vi } from 'vitest';
import type { ImportHistoryPolicy, MinimalImportOutcome, SiteImportRecord } from '@jini-ai/core/contracts/site/site-import-history';
import type { SqliteSyncClient } from '@jini-ai/core/contracts/storage';
import { admitImport, lookupFence } from '../admission.js';
import { listPage } from '../paging.js';

const policy: ImportHistoryPolicy = { cutoverPolicy: 'rollback', historyVisibleMs: 2_592_000_000, replayFenceMs: 31_536_000_000, legacyRetireMs: 2_592_000_000, sweepOnClockRollback: false };
const id = '11111111-1111-1111-1111-111111111111';
const source = { uploadId: id };
const row: SiteImportRecord = { importId: id, principalId: 'one', requestId: 'key', source, status: 'verifying', createdAt: new Date(0).toISOString(), expiresAt: 3_600_000, displayName: 'Site', newSiteId: null, newSiteName: null };
const outcome: MinimalImportOutcome = { importId: id, source, status: 'ready', createdAt: row.createdAt, displayName: 'Site', newSiteId: 'site', newSiteName: 'site' };

function fixture(accepted: number | undefined, failInsert = false) {
  let fences = accepted === undefined ? [] : [{ principal_id: 'one', request_id: 'key', fence_kind: 'upload', fence_value: id, import_id: id, accepted_ms: accepted, outcome_json: JSON.stringify(outcome) }];
  const get = vi.fn((sql: string, args: unknown[]) => {
    if (sql.includes('FROM replay')) return fences.find(fence => fence.principal_id === args[0] && fence.request_id === args[1] && (sql.includes('accepted_ms > ?') ? fence.accepted_ms > Number(args[2]) : fence.accepted_ms >= Number(args[2])));
    return undefined;
  });
  const run = vi.fn((sql: string, args: unknown[]) => {
    if (sql.startsWith('INSERT INTO replay')) {
      const p = args[0] as Record<string, unknown>;
      fences.push({ principal_id: String(p.principalId), request_id: String(p.requestId), fence_kind: String(p.fenceKind), fence_value: String(p.fenceValue), import_id: String(p.importId), accepted_ms: Number(p.acceptedMs), outcome_json: String(p.outcomeJson) });
    }
    if (sql.startsWith('DELETE FROM replay')) fences = fences.filter(fence => !(fence.principal_id === args[0] && fence.request_id === args[1]));
    if (sql.startsWith('INSERT INTO imports') && failInsert) throw new Error('insert failed');
    return { changes: 1, lastInsertRowid: 0 };
  });
  const immediate = vi.fn((body: () => unknown) => {
    const snapshot = [...fences];
    try { return body(); } catch (error) { fences = snapshot; throw error; }
  });
  const db = { prepare: (sql: string) => ({
    get: (...args: unknown[]) => get(sql, args), run: (...args: unknown[]) => run(sql, args),
    all: (principal: string, cutoff: number) => principal === row.principalId && 0 > cutoff ? [{ row_json: JSON.stringify({ ...row, ...outcome }) }] : [],
  }), transaction: (body: () => unknown) => ({ immediate: () => immediate(body) }) } as unknown as SqliteSyncClient;
  const requireBudget = vi.fn(); const beforeWrite = vi.fn(); const makeRow = vi.fn(() => row);
  const call = (now: number, inputSource = source) => admitImport({ db, clock: { nowMs: () => now }, policy, principalId: 'one', requestId: 'key', source: inputSource, digestSource: () => undefined, requireBudget, makeRow, beforeWrite });
  return { db, call, fences: () => fences, requireBudget, beforeWrite, makeRow, run, immediate };
}

describe('import admission', () => {
  it('day 365 + 1 ms frees the key', () => {
    const f = fixture(0);
    expect(lookupFence({ db: f.db, policy, principalId: 'one', requestId: 'key', now: policy.replayFenceMs })).toBeUndefined();
    expect(f.call(policy.replayFenceMs + 1)).toEqual({ kind: 'admitted', row });
    expect(f.fences()).toHaveLength(1);
    expect(f.fences()[0]!.accepted_ms).toBe(policy.replayFenceMs + 1);
  });

  it('fence still conflicts at 365d − 1 ms', () => {
    const f = fixture(0);
    expect(() => f.call(policy.replayFenceMs - 1, { uploadId: '22222222-2222-2222-2222-222222222222' })).toThrow(expect.objectContaining({ code: 'REQUEST_CONFLICT' }));
    expect(f.run).not.toHaveBeenCalled();
  });

  it('replay at day 200 returns the stored outcome but the row is not listed', () => {
    const f = fixture(0);
    expect(f.call(200 * 86_400_000)).toEqual({ kind: 'replay', outcome });
    expect(listPage({ db: f.db, clock: { nowMs: () => 200 * 86_400_000 }, policy, principalId: 'one' })).toEqual({ imports: [] });
    expect(f.run).not.toHaveBeenCalled();
    expect(f.requireBudget).not.toHaveBeenCalled();
    expect(f.makeRow).not.toHaveBeenCalled();
  });

  it('REQUEST_CONFLICT leaves the upload unconsumed and makes no HTTP call', () => {
    const f = fixture(0); const consume = vi.fn(); const http = vi.fn();
    const start = () => { const admitted = f.call(1, { uploadId: '22222222-2222-2222-2222-222222222222' }); consume(); http(); return admitted; };
    expect(start).toThrow(expect.objectContaining({ code: 'REQUEST_CONFLICT', message: 'requestId already belongs to another source.' }));
    expect(consume).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
    expect(f.requireBudget).not.toHaveBeenCalled(); expect(f.makeRow).not.toHaveBeenCalled(); expect(f.beforeWrite).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
  });

  it('admission insert failure leaves no fence', () => {
    const f = fixture(undefined, true);
    expect(() => f.call(1)).toThrow('insert failed');
    expect(f.fences()).toEqual([]);
    expect(f.immediate).toHaveBeenCalledTimes(1);
  });
});
