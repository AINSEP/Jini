import Database from "better-sqlite3";
import { migrateImportIndex } from "../schema.js";
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ImportHistoryPolicy } from '@jini-ai/core/contracts/site/site-import-history';
import type { SqliteSyncClient } from '@jini-ai/core/contracts/storage';
import { IMPORT_INDEX_V1_DDL } from '../migrations/site-imports-v1.js';
import { IMPORT_INDEX_MIGRATION_CHECKSUMS } from '../migrations/checksums.js';
import { createImportIndexIntegrityMemo, openImportIndex } from '../open.js';

const policy: ImportHistoryPolicy = { cutoverPolicy: 'rollback', historyVisibleMs: 2_592_000_000, replayFenceMs: 31_536_000_000, legacyRetireMs: 2_592_000_000, sweepOnClockRollback: false };

describe('import index schema', () => {
  it('site-imports-v1 DDL checksum and applied ledger are pinned', () => {
    const digest = createHash('sha256').update(IMPORT_INDEX_V1_DDL, 'utf8').digest('hex');
    expect(digest).toBe('483c2b21e3343c4b834bc499ca5136c1b7cb664a99fbd4cca6286460619549fb');
    expect(IMPORT_INDEX_MIGRATION_CHECKSUMS['site-imports-v1']).toBe(digest);
    const ledger: { id: string; checksum: string }[] = [{ id: 'site-imports-v1', checksum: IMPORT_INDEX_MIGRATION_CHECKSUMS['site-imports-v1'] }];
    const close = vi.fn(); const pragmas: string[] = [];
    const db = { pragma: (sql: string) => { pragmas.push(sql); return sql === 'user_version' ? 1 : undefined; }, prepare: (sql: string) => ({ all: () => ledger, get: () => sql.includes('schema') ? { value: 'site-imports-v1' } : undefined }), close } as unknown as SqliteSyncClient;
    const open = vi.fn((_file: string, _options: { readonly?: boolean; fileMustExist?: boolean }) => db); const checkIntegrity = vi.fn();
    const required = { file: '/workspace/site-imports.db', open, clock: { nowMs: () => 1 }, policy, checkIntegrity, integrityMemo: createImportIndexIntegrityMemo({}) };
    openImportIndex(required).close({});
    expect(pragmas.slice(0, 4)).toEqual(['journal_mode = WAL', 'synchronous = FULL', 'busy_timeout = 5000', 'foreign_keys = ON']);
    const writerCalls = pragmas.length;
    openImportIndex(required, { readonly: true }).close({});
    expect(pragmas.slice(writerCalls).filter(sql => sql !== 'user_version')).toEqual(['busy_timeout = 5000', 'foreign_keys = ON']);
    expect(open.mock.calls[1]![1]).toEqual({ readonly: true, fileMustExist: true });
    expect(checkIntegrity).toHaveBeenCalledTimes(1);
    ledger.push({ id: 'unknown', checksum: 'unknown' });
    expect(() => openImportIndex(required)).toThrow(expect.objectContaining({ code: 'IMPORT_HISTORY_DAMAGED' }));
    expect(close).toHaveBeenCalledTimes(3);
  });
});

describe('import index integrity memo', () => {
  const makeDb = (dbId: string | undefined) => ({
    pragma: (sql: string) => sql === 'user_version' ? 1 : undefined,
    prepare: (sql: string) => ({ all: () => [{ id: 'site-imports-v1', checksum: IMPORT_INDEX_MIGRATION_CHECKSUMS['site-imports-v1'] }], get: () => sql.includes("key='db_id'") ? (dbId === undefined ? undefined : { value: dbId }) : { value: 'site-imports-v1' } }),
    close: () => {},
  }) as unknown as SqliteSyncClient;
  const openTwice = (integrityMemo: ReturnType<typeof createImportIndexIntegrityMemo>, checkIntegrity: () => void, dbId: string | undefined) => {
    const base = { file: '/workspace/site-imports.db', open: () => makeDb(dbId), clock: { nowMs: () => 1 }, policy, checkIntegrity, integrityMemo };
    openImportIndex(base, { readonly: true }).close({});
    openImportIndex(base, { readonly: true }).close({});
  };

  it('runs the integrity check once per opener memo, so two openers with separate memos each check once', () => {
    const checkA = vi.fn(); const checkB = vi.fn();
    openTwice(createImportIndexIntegrityMemo({}), checkA, 'db-1');
    openTwice(createImportIndexIntegrityMemo({}), checkB, 'db-1');
    expect(checkA).toHaveBeenCalledTimes(1);
    expect(checkB).toHaveBeenCalledTimes(1);
  });

  it('shares nothing between memos for the same file and db_id', () => {
    const shared = createImportIndexIntegrityMemo({}); const check = vi.fn();
    openTwice(shared, check, 'db-1');
    openTwice(createImportIndexIntegrityMemo({}), check, 'db-1');
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('re-checks when the same file holds a different db_id', () => {
    const memo = createImportIndexIntegrityMemo({}); const check = vi.fn();
    openTwice(memo, check, 'db-1');
    openTwice(memo, check, 'db-2');
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('memoizes per handle when the DB has no db_id yet', () => {
    const memo = createImportIndexIntegrityMemo({}); const check = vi.fn();
    const db = makeDb(undefined);
    const base = { file: '/workspace/site-imports.db', open: () => db, clock: { nowMs: () => 1 }, policy, checkIntegrity: check, integrityMemo: memo };
    openImportIndex(base, { readonly: true }).close({});
    openImportIndex(base, { readonly: true }).close({});
    expect(check).toHaveBeenCalledTimes(1);
  });
});

it('migrates a fresh database once and leaves the applied timestamp intact on reopen', () => {
  const native = new Database(':memory:');
  const db = native as unknown as SqliteSyncClient;
  try {
    migrateImportIndex({ db, clock: { nowMs: () => 7_654 } });
    migrateImportIndex({ db, clock: { nowMs: () => 9_999 } });
    expect(native.pragma('user_version', { simple: true })).toBe(1);
    expect(native.prepare('SELECT id, checksum, applied_at FROM site_import_migrations').all()).toEqual([{
      id: 'site-imports-v1', checksum: '483c2b21e3343c4b834bc499ca5136c1b7cb664a99fbd4cca6286460619549fb', applied_at: 7_654,
    }]);
    expect(native.prepare('SELECT key, value FROM meta').all()).toEqual([{ key: 'schema', value: 'site-imports-v1' }]);
  } finally {
    native.close();
  }
});

it.each([
  { version: 0, code: 'IMPORT_HISTORY_DAMAGED', message: 'Import history could not be read. Imports are paused and nothing was changed. Contact support with this error ID.' },
  { version: 2, code: 'IMPORT_HISTORY_NEWER', message: 'Import history was written by a newer version of the app. Update the app to continue.' },
])('rejects unsupported read-only user_version $version and closes the failed handle', ({ version, code, message }) => {
  const native = new Database(':memory:');
  native.pragma(`user_version = ${version}`);
  const checkIntegrity = vi.fn();
  try {
    expect(() => openImportIndex({
      file: ':memory:', open: () => native as unknown as SqliteSyncClient,
      clock: { nowMs: () => 5 }, policy, checkIntegrity, integrityMemo: createImportIndexIntegrityMemo({}),
    }, { readonly: true })).toThrow(expect.objectContaining({ code, status: 503, message }));
    expect(native.open).toBe(false);
    expect(checkIntegrity).not.toHaveBeenCalled();
  } finally {
    if (native.open) native.close();
  }
});

it('rejects a read-only database with a modified migration checksum', () => {
  const native = new Database(':memory:');
  const db = native as unknown as SqliteSyncClient;
  try {
    migrateImportIndex({ db, clock: { nowMs: () => 5 } });
    native.prepare('UPDATE site_import_migrations SET checksum = ? WHERE id = ?').run('modified', 'site-imports-v1');
    const checkIntegrity = vi.fn();
    expect(() => openImportIndex({
      file: ':memory:', open: () => db, clock: { nowMs: () => 6 }, policy, checkIntegrity, integrityMemo: createImportIndexIntegrityMemo({}),
    }, { readonly: true })).toThrow(expect.objectContaining({
      code: 'IMPORT_HISTORY_DAMAGED', status: 503,
      message: 'Import history could not be read. Imports are paused and nothing was changed. Contact support with this error ID.',
    }));
    expect(native.open).toBe(false);
    expect(checkIntegrity).not.toHaveBeenCalled();
  } finally {
    if (native.open) native.close();
  }
});

it('will not initialize an empty database when opening an existing writer', () => {
  const native = new Database(':memory:');
  const db = native as unknown as SqliteSyncClient;
  const open = vi.fn((_file: string, _options: { readonly?: boolean; fileMustExist?: boolean }) => db);
  const checkIntegrity = vi.fn();
  try {
    expect(() => openImportIndex({
      file: '/history/site-imports.db', open, clock: { nowMs: () => 5 }, policy,
      checkIntegrity, integrityMemo: createImportIndexIntegrityMemo({}),
    }, { mustExist: true })).toThrow(expect.objectContaining({
      name: 'ImportHistoryUnavailable', code: 'IMPORT_HISTORY_DAMAGED', status: 503,
      message: 'Import history could not be read. Imports are paused and nothing was changed. Contact support with this error ID.',
    }));
    expect(open).toHaveBeenCalledExactlyOnceWith('/history/site-imports.db', { readonly: false, fileMustExist: true });
    expect(checkIntegrity).not.toHaveBeenCalled();
    expect(native.open).toBe(false);
  } finally {
    if (native.open) native.close();
  }
});

it('accepts a migration that completed before the writer acquired its lock', () => {
  const native = new Database(':memory:');
  const db = native as unknown as SqliteSyncClient;
  try {
    const interrupted = new Proxy(db, {
      get(target, property, receiver) {
        // Simulate another writer committing after the first user_version read.
        if (property === 'transaction') return (body: () => void) => {
          migrateImportIndex({ db, clock: { nowMs: () => 4_000 } });
          return db.transaction(body);
        };
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    migrateImportIndex({ db: interrupted, clock: { nowMs: () => 5_000 } });
    expect(native.pragma('user_version', { simple: true })).toBe(1);
    expect(native.prepare('SELECT id, applied_at FROM site_import_migrations').all()).toEqual([
      { id: 'site-imports-v1', applied_at: 4_000 },
    ]);
  } finally {
    native.close();
  }
});
