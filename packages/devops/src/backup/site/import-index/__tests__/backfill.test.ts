import { describe, expect, it, vi } from 'vitest';
import type { ImportHistoryPolicy, SiteImportRecord } from '@jini-ai/core/contracts/site/site-import-history';
import type { JsonFileRead } from '@jini-ai/core/contracts/site/fs-durable-json';
import type { SqliteSyncClient } from '@jini-ai/core/contracts/storage';
import { backfillImportIndex } from '../backfill.js';
import { sameFence } from '../admission.js';

const policy: ImportHistoryPolicy = { cutoverPolicy: 'enable', historyVisibleMs: 2_592_000_000, replayFenceMs: 31_536_000_000, legacyRetireMs: 2_592_000_000, sweepOnClockRollback: false };
const id = '11111111-1111-1111-1111-111111111111';
const other = '22222222-2222-2222-2222-222222222222';
const base: SiteImportRecord = { importId: id, principalId: 'one', requestId: 'key', source: { url: 'https://share.example/private?token=secret' }, status: 'ready', createdAt: new Date(0).toISOString(), expiresAt: 3_600_000, displayName: 'Site', newSiteId: 'site', newSiteName: 'site' };

function fixture(records: Record<string, JsonFileRead>, now = 1) {
  let rows = new Map<string, Record<string, unknown>>();
  let fences = new Map<string, Record<string, unknown>>();
  let meta = new Map<string, string>([['schema', 'site-imports-v1']]);
  let interruption: 'rows' | 'commit' | undefined;
  const close = vi.fn();
  const run = vi.fn((sql: string, args: unknown[]) => {
    if (sql.startsWith('INSERT INTO imports')) {
      const params = args[0] as Record<string, unknown>;
      rows.set(String(params.importId), params);
      if (interruption === 'rows') throw new Error('interrupted mid-rows');
    }
    if (sql.startsWith('INSERT INTO replay')) {
      const params = args[0] as Record<string, unknown>;
      const key = JSON.stringify([params.principalId, params.requestId]);
      if (fences.has(key)) throw new Error('duplicate fence');
      fences.set(key, params);
    }
    if (sql.startsWith('INSERT INTO meta')) {
      const key = String(args[0]);
      if (meta.has(key) && !sql.includes('ON CONFLICT(key) DO UPDATE')) throw new Error('duplicate meta');
      meta.set(key, String(args[1]));
    }
  });
  const db = {
    exec: (sql: string) => { if (sql.includes('DELETE FROM imports')) rows.clear(); if (sql.includes('DELETE FROM replay')) fences.clear(); if (sql.includes("key='last_sweep_ms'")) meta.delete('last_sweep_ms'); },
    prepare: (sql: string) => ({ run: (...args: unknown[]) => run(sql, args), get: () => ({ count: rows.size }) }),
    transaction: (body: () => unknown) => ({ immediate: () => {
      const snapshot = { rows: new Map(rows), fences: new Map(fences), meta: new Map(meta) };
      try { const result = body(); if (interruption === 'commit') throw new Error('interrupted before commit'); return result; }
      catch (error) { rows = snapshot.rows; fences = snapshot.fences; meta = snapshot.meta; throw error; }
    } }),
  } as unknown as SqliteSyncClient;
  const openCandidate = vi.fn(() => ({ db, close }));
  const log = vi.fn();
  const fs = { readdir: vi.fn(() => Object.keys(records).map(name => `${name}.json`)) };
  const readJson = vi.fn(({ file }: { file: string }): JsonFileRead => records[file.slice('/history/'.length, -5)] ?? { state: 'missing' });
  const runBackfill = () => backfillImportIndex({ root: '/history', fs, readJson, openCandidate, clock: { nowMs: () => now }, policy, newDbId: () => other, log });
  return { runBackfill, rows: () => rows, fences: () => fences, meta: () => meta, interrupt: (at: typeof interruption) => { interruption = at; }, openCandidate, close, log, records };
}

describe('legacy import backfill', () => {
  it('backfill crash before commit leaves no marker and no rows', () => {
    for (const at of ['rows', 'commit'] as const) {
      const f = fixture({ [id]: { state: 'ok', value: base } });
      f.interrupt(at);
      expect(f.runBackfill).toThrow('interrupted');
      expect(f.rows().size).toBe(0); expect(f.fences().size).toBe(0);
      expect([...f.meta()]).toEqual([['schema', 'site-imports-v1']]);
      expect(f.close).toHaveBeenCalledTimes(1);
    }
  });

  it('interrupt the backfill and restart → exactly one copy of each row and fence', () => {
    const f = fixture({ [id]: { state: 'ok', value: base } });
    f.interrupt('rows'); expect(f.runBackfill).toThrow('interrupted');
    f.interrupt(undefined);
    expect(f.runBackfill()).toEqual({ state: 'cutover', dbId: other, cutoverAt: 1, backfillCount: 1 });
    expect(f.meta().get('db_id')).toBe(other);
    expect(f.runBackfill()).toEqual({ state: 'cutover', dbId: other, cutoverAt: 1, backfillCount: 1 });
    expect(f.rows().size).toBe(1); expect(f.fences().size).toBe(1);
    expect(Object.fromEntries(f.meta())).toEqual({ schema: 'site-imports-v1', db_id: other, cutover_at: '1', backfill_count: '1' });
    expect(f.openCandidate).toHaveBeenCalledTimes(3); expect(f.close).toHaveBeenCalledTimes(3);
  });

  it('origin-only key still fences a different source', () => {
    const f = fixture({ [id]: { state: 'ok', value: base } }, 200 * 86_400_000);
    expect(f.runBackfill()).toMatchObject({ state: 'cutover', backfillCount: 0 });
    const fence = [...f.fences().values()][0]!;
    expect(fence.fenceKind).toBe('origin'); expect(fence.fenceValue).toBe('https://share.example');
    expect(sameFence({ fence: { principal_id: 'one', request_id: 'key', fence_kind: 'origin', fence_value: String(fence.fenceValue), import_id: id, accepted_ms: 0, outcome_json: String(fence.outcomeJson) }, source: { url: 'https://different.example/share' }, digestSource: () => undefined })).toBe(false);
    const outcome = JSON.parse(String(fence.outcomeJson));
    expect(outcome.source).toEqual({ url: 'https://share.example' });
    expect(outcome).not.toHaveProperty('requestId'); expect(outcome).not.toHaveProperty('creation');
  });

  it('unreadable row blocks cutover and keeps its file', () => {
    const records = { [id]: { state: 'unreadable' as const, text: '{not json' }, [other]: { state: 'ok' as const, value: { ...base, importId: other } } };
    const before = JSON.stringify(records);
    const f = fixture(records);
    expect(f.runBackfill()).toEqual({ state: 'blocked' });
    expect(f.openCandidate).not.toHaveBeenCalled(); expect(f.rows().size).toBe(0);
    expect(JSON.stringify(records)).toBe(before);
    expect(f.log).toHaveBeenCalledWith({ message: 'An import record could not be read; imports keep using the old store until it is fixed.', counts: { unreadable: 1, malformed: 0 } }, {});
  });

  it('malformed-but-parseable row blocks cutover', () => {
    const f = fixture({ [id]: { state: 'ok', value: { ...base, importId: other } } });
    expect(f.runBackfill()).toEqual({ state: 'blocked' });
    expect(f.openCandidate).not.toHaveBeenCalled();
    expect(f.records[id]).toEqual({ state: 'ok', value: { ...base, importId: other } });
  });

  it('active verifying/creating recovery keeps its allocation', () => {
    const creation = { siteId: 'allocated', name: 'site', dir: '/sites/site', dbPath: '/sites/site/content.db' };
    const rows = [{ ...base, status: 'verifying' as const }, { ...base, importId: other, status: 'creating' as const, creation }];
    const f = fixture(Object.fromEntries(rows.map(row => [row.importId, { state: 'ok' as const, value: row }])), 400 * 86_400_000);
    expect(f.runBackfill()).toMatchObject({ state: 'cutover', backfillCount: 2 });
    expect([...f.rows().values()].map(params => JSON.parse(String(params.rowJson)))).toEqual(rows);
    expect(f.fences().size).toBe(0);
  });

  it('needs-owner row and its stage survive backfill; owner setup completes after cutover', () => {
    const pending = { ...base, status: 'needs-owner' as const, expiresAt: 40_000_000_000 };
    const f = fixture({ [id]: { state: 'ok', value: pending } }, 400 * 86_400_000);
    expect(f.runBackfill()).toMatchObject({ state: 'cutover', backfillCount: 1 });
    expect(JSON.parse(String(f.rows().get(id)!.rowJson))).toEqual(pending);
    expect(f.records[id]).toEqual({ state: 'ok', value: pending });
  });

  it('two legacy rows with one requestId: newest fences, both histories listed', () => {
    for (const createdMs of [0, 1]) {
      const oldest = { ...base, importId: id };
      const newest = { ...base, importId: other, createdAt: new Date(createdMs).toISOString() };
      const f = fixture({ [other]: { state: 'ok', value: newest }, [id]: { state: 'ok', value: oldest } });
      expect(f.runBackfill()).toMatchObject({ state: 'cutover', backfillCount: 2 });
      expect([...f.rows().keys()].sort()).toEqual([id, other]);
      expect([...f.fences().values()].map(fence => fence.importId)).toEqual([other]);
    }
  });
});
