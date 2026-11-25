import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ImportHistoryPolicy } from '@jini-ai/core/contracts/site/site-import-history';
import type { SqliteSyncClient } from '@jini-ai/core/contracts/storage';
import { IMPORT_INDEX_V1_DDL } from '../migrations/site-imports-v1.js';
import { IMPORT_INDEX_MIGRATION_CHECKSUMS } from '../migrations/checksums.js';
import { openImportIndex } from '../open.js';

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
    const required = { file: '/workspace/site-imports.db', open, clock: { nowMs: () => 1 }, policy, checkIntegrity };
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
