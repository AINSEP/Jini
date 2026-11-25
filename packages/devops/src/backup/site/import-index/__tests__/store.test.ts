import { describe, expect, it, vi } from 'vitest';
import type { ImportHistoryPolicy, SiteImportRecord } from '@jini-ai/core/contracts/site/site-import-history';
import type { SqliteSyncClient } from '@jini-ai/core/contracts/storage';
import { createImportIndexStore } from '../store.js';

const policy: ImportHistoryPolicy = { cutoverPolicy: 'rollback', historyVisibleMs: 2_592_000_000, replayFenceMs: 31_536_000_000, legacyRetireMs: 2_592_000_000, sweepOnClockRollback: false };

describe('indexed maintenance', () => {
  it('recovery issues one indexed active-row query', () => {
    const all = vi.fn(() => []);
    const prepare = vi.fn((_sql: string) => ({ all }));
    const db = { prepare } as unknown as SqliteSyncClient;
    expect(createImportIndexStore({ db, clock: { nowMs: () => 1 }, policy }).activeRows({})).toEqual([]);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]![0]).toMatch(/WHERE status IN \('verifying','creating'\)/);
    expect(all).toHaveBeenCalledTimes(1);
  });

  it('needs-owner past deadline fails with "Owner setup expired" and its stage is removed', () => {
    const row: SiteImportRecord = { importId: '11111111-1111-1111-1111-111111111111', principalId: 'one', status: 'needs-owner', source: { uploadId: '22222222-2222-2222-2222-222222222222' }, displayName: 'Site', createdAt: new Date(0).toISOString(), expiresAt: 100, newSiteId: null, newSiteName: null };
    let stored = row;
    const run = vi.fn((_sql: string, args: unknown[]) => { if (_sql.startsWith('INSERT INTO imports')) stored = JSON.parse((args[0] as { rowJson: string }).rowJson) as SiteImportRecord; });
    const prepare = vi.fn((sql: string) => ({
      all: (now: number) => (sql.includes('expires_ms < ?') ? row.expiresAt < now : row.expiresAt <= now) ? [{ row_json: JSON.stringify(stored) }] : [],
      get: () => ({ row_json: JSON.stringify(stored), settled_ms: null }), run: (...args: unknown[]) => run(sql, args),
    }));
    const db = { prepare, transaction: (body: () => void) => ({ immediate: body }) } as unknown as SqliteSyncClient;
    const store = createImportIndexStore({ db, clock: { nowMs: () => 101 }, policy });
    expect(store.dueOwnerSetups({ now: 100 })).toEqual([]);
    expect(store.dueOwnerSetups({ now: 101 })).toEqual([row]);
    const beforeWrite = vi.fn();
    store.put({ row: { ...row, status: 'failed', error: 'Owner setup expired' }, beforeWrite });
    expect(stored.status).toBe('failed'); expect(stored.error).toBe('Owner setup expired');
    expect(beforeWrite).toHaveBeenCalledTimes(1);
  });
});
