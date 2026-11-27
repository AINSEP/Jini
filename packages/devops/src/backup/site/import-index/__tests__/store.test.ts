import Database from "better-sqlite3";
import { migrateImportIndex } from "../schema.js";
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

const indexedRow: SiteImportRecord = {
  importId: '11111111-1111-1111-1111-111111111111', principalId: 'owner', requestId: 'request-1',
  source: { url: 'https://share.example/archive?signature=fixture' }, sourceDigest: 'a'.repeat(64),
  displayName: 'Example', status: 'verifying', createdAt: '2026-11-09T00:00:00.000Z', expiresAt: 120,
  newSiteId: null, newSiteName: null,
};

function withStore(work: (store: ReturnType<typeof createImportIndexStore>, native: Database.Database) => void) {
  const native = new Database(':memory:');
  try {
    const db = native as unknown as SqliteSyncClient;
    const clock = { nowMs: () => 100 };
    migrateImportIndex({ db, clock });
    work(createImportIndexStore({ db, clock, policy }), native);
  } finally { native.close(); }
}

it('scopes detail to the owner, exposes status by id and selects active work by state', () => {
  withStore(store => {
    const active = { ...indexedRow, status: 'creating' as const };
    const waiting = { ...indexedRow, importId: '22222222-2222-2222-2222-222222222222', requestId: 'request-2' };
    const completed = { ...indexedRow, importId: '33333333-3333-3333-3333-333333333333', requestId: 'request-3' };
    const write = (row: SiteImportRecord) => store.put({ row, beforeWrite: () => {} });
    for (const row of [indexedRow, waiting, completed, { ...indexedRow, status: 'needs-owner' }, active, { ...waiting, status: 'needs-owner' }, { ...completed, status: 'failed' }]) write(row);
    expect(store.get({ importId: active.importId, principalId: 'owner' })).toEqual(active);
    expect(store.get({ importId: active.importId, principalId: 'another-owner' })).toBeUndefined();
    expect(store.statusOf({ importId: waiting.importId })).toBe('needs-owner');
    expect(store.statusOf({ importId: 'absent' })).toBeUndefined();
    expect(store.activeRows({})).toEqual([active]);
  });
});

it('redacts terminal link details in both history and replay while allowing only start results to change', () => {
  withStore((store, native) => {
    const put = (row: SiteImportRecord) => store.put({ row, beforeWrite: () => {} });
    native.prepare('INSERT INTO replay VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      indexedRow.principalId, indexedRow.requestId, 'sha256', indexedRow.sourceDigest, indexedRow.importId, 50, '{}',
    );
    put(indexedRow);
    const ready: SiteImportRecord = { ...indexedRow, status: 'ready', newSiteId: 'site-1', newSiteName: 'example', hasEncryptedKeys: true };
    put({ ...indexedRow, status: 'needs-owner' });
    put({ ...indexedRow, status: 'creating' });
    put(ready);
    const result = { ...ready, adminUrl: 'https://site.example/admin', error: 'start delayed' };
    put(result);
    expect(store.get({ importId: ready.importId, principalId: 'owner' })).toEqual({
      ...result, source: { url: 'https://share.example' },
    });
    expect(native.prepare('SELECT outcome_json FROM replay WHERE request_id = ?').get('request-1')).toEqual({
      outcome_json: JSON.stringify({
        importId: ready.importId, status: 'ready', newSiteId: 'site-1', newSiteName: 'example', displayName: 'Example',
        createdAt: '2026-11-09T00:00:00.000Z', source: { url: 'https://share.example' },
        adminUrl: 'https://site.example/admin', error: 'start delayed', hasEncryptedKeys: true,
      }),
    });
    expect(() => put({ ...result, displayName: 'Changed' })).toThrow(expect.objectContaining({
      code: 'INVALID_INPUT', message: 'Only import start results can change.',
    }));
    expect(() => put({ ...result, sourceDigest: 'b'.repeat(64) })).toThrow(expect.objectContaining({
      code: 'INVALID_INPUT', message: 'Import identity cannot change.',
    }));
    expect(() => put({ ...result, source: { url: 'https://elsewhere.example/archive' } })).toThrow(expect.objectContaining({
      code: 'INVALID_INPUT', message: 'Import identity cannot change.',
    }));
    expect(store.get({ importId: ready.importId, principalId: 'owner' })).toEqual({ ...result, source: { url: 'https://share.example' } });
  });
});

it('does not accept a non-verifying first state or reopen a failed record', () => {
  withStore(store => {
    const failed = { ...indexedRow, status: 'failed' as const };
    const beforeWrite = vi.fn();
    expect(() => store.put({ row: failed, beforeWrite })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', message: 'Invalid import transition.' }));
    expect(store.statusOf({ importId: failed.importId })).toBeUndefined();
    store.put({ row: indexedRow, beforeWrite });
    store.put({ row: failed, beforeWrite });
    expect(() => store.put({ row: indexedRow, beforeWrite })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', message: 'Invalid import transition.' }));
    expect(store.statusOf({ importId: failed.importId })).toBe('failed');
    expect(beforeWrite.mock.calls).toEqual([[{}, {}], [{}, {}]]);
  });
});
