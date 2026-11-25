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
