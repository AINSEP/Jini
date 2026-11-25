import { describe, expect, it, vi } from 'vitest';
import type { ImportHistoryPolicy, SiteImportRecord } from '@jini-ai/core/contracts/site/site-import-history';
import type { SqliteSyncClient } from '@jini-ai/core/contracts/storage';
import { decodeCursor, encodeCursor, listAll, listPage } from '../paging.js';

const policy: ImportHistoryPolicy = { cutoverPolicy: 'rollback', historyVisibleMs: 2_592_000_000, replayFenceMs: 31_536_000_000, legacyRetireMs: 2_592_000_000, sweepOnClockRollback: false };

function fixture(rows: { row: SiteImportRecord; settled: number | null }[]) {
  const all = vi.fn((sql: string, principal: string, cutoff: number, ...tail: unknown[]) => {
    let result = rows.filter(({ row, settled }) => row.principalId === principal && (settled === null || (sql.includes('settled_ms > ?') ? settled > cutoff : settled >= cutoff)));
    if (sql.includes('created_ms, import_id) <')) {
      const [ms, id] = tail as [number, string];
      result = result.filter(({ row }) => Date.parse(row.createdAt) < ms || (Date.parse(row.createdAt) === ms && row.importId < id));
    } else if (sql.includes('created_ms <')) result = result.filter(({ row }) => Date.parse(row.createdAt) < Number(tail[0]));
    result.sort((a, b) => Date.parse(b.row.createdAt) - Date.parse(a.row.createdAt) || (sql.includes('import_id DESC') ? (a.row.importId < b.row.importId ? 1 : -1) : 0));
    return result.slice(0, Number(tail.at(-1))).map(({ row }) => ({ row_json: JSON.stringify(row) }));
  });
  const db = { prepare: (sql: string) => ({ all: (...args: unknown[]) => all(sql, ...(args as [string, number, ...unknown[]])) }) } as unknown as SqliteSyncClient;
  return { db, all };
}

describe('import history paging', () => {
  it('history boundary: listed at 30d − 1 ms, hidden at exactly 30d', () => {
    const row: SiteImportRecord = { importId: '00000000-0000-0000-0000-000000000001', principalId: 'one', source: { uploadId: '00000000-0000-0000-0000-000000000002' }, status: 'ready', createdAt: new Date(0).toISOString(), expiresAt: 0, displayName: 'Site', newSiteId: 'site', newSiteName: 'site' };
    const { db } = fixture([{ row, settled: 0 }]);
    expect(listPage({ db, clock: { nowMs: () => policy.historyVisibleMs - 1 }, policy, principalId: 'one' }).imports).toEqual([row]);
    expect(listPage({ db, clock: { nowMs: () => policy.historyVisibleMs }, policy, principalId: 'one' }).imports).toEqual([]);
  });

  it('tied timestamps page with no duplicates, skips or cross-principal rows', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ row: { importId: `00000000-0000-0000-0000-${i.toString(16).padStart(12, '0')}`, principalId: i < 80 ? 'one' : i < 100 ? 'two' : 'three', source: { uploadId: '00000000-0000-0000-0000-000000000999' }, status: 'verifying' as const, createdAt: new Date((i % 7) * 1000).toISOString(), expiresAt: 100_000, displayName: 'Site', newSiteId: null, newSiteName: null }, settled: null }));
    const { db, all } = fixture(rows);
    const clock = { nowMs: vi.fn(() => 7000) };
    const first = listPage({ db, clock, policy, principalId: 'one', limit: 50 });
    expect(first.imports).toHaveLength(50);
    expect(first.nextCursor).toBe(encodeCursor({ createdMs: Date.parse(first.imports[49]!.createdAt), importId: first.imports[49]!.importId }));
    const second = listPage({ db, clock, policy, principalId: 'one', cursor: first.nextCursor!, limit: 50 });
    expect(second.imports).toHaveLength(30);
    expect(second.nextCursor).toBeUndefined();
    const expected = rows.filter(({ row }) => row.principalId === 'one').map(({ row }) => row).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.importId < b.importId ? 1 : -1));
    expect([...first.imports, ...second.imports]).toEqual(expected);
    expect(new Set([...first.imports, ...second.imports].map(row => row.importId)).size).toBe(80);
    expect(clock.nowMs).toHaveBeenCalledTimes(2);
    expect(all).toHaveBeenCalledTimes(2);
    expect(listAll({ readPage: (input) => listPage({ db, clock, policy, principalId: 'one', ...input }) })).toEqual(expected);
  });

  it('invalid cursor (bad base64, v2, unsafe int, non-uuid) → INVALID_CURSOR', () => {
    const ascii = (value: string) => Buffer.from(value, 'ascii').toString('base64url');
    const { db } = fixture([]);
    for (const cursor of ['***', ascii('v2.1.00000000-0000-0000-0000-000000000001'), ascii('v1.9007199254740992.00000000-0000-0000-0000-000000000001'), ascii('v1.1.not-a-uuid')]) {
      expect(() => decodeCursor({ cursor })).toThrow(expect.objectContaining({ code: 'INVALID_CURSOR' }));
      expect(() => listPage({ db, clock: { nowMs: () => 1 }, policy, principalId: 'one', cursor })).toThrow(expect.objectContaining({ code: 'INVALID_CURSOR' }));
    }
  });
});
