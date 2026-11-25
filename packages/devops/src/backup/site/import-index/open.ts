import type { ImportHistoryPolicy } from '@jini-ai/core/contracts/site/site-import-history';
import type { SqliteSyncClient, SqliteSyncOpener } from '@jini-ai/core/contracts/storage';
import { ImportHistoryUnavailable, mapSqliteError } from './errors.js';
import { migrateImportIndex } from './schema.js';
import { IMPORT_INDEX_MIGRATION_CHECKSUMS } from './migrations/checksums.js';
import { createImportIndexStore } from './store.js';

/** A memo key: `[file, db_id]` text when the DB has an id, else the open handle itself. */
export type ImportIndexIntegrityKey = string | SqliteSyncClient;

/** Remembers which import-index DBs already passed the integrity check. */
export interface ImportIndexIntegrityMemo {
  has(required: { key: ImportIndexIntegrityKey }, optional?: Record<string, never>): boolean;
  add(required: { key: ImportIndexIntegrityKey }, optional?: Record<string, never>): void;
}

/**
 * Creates one integrity memo. Each composed backend owns its own, because the integrity
 * check is slow and re-running it on every open of the same file+db_id is wasted work,
 * while a module-level memo would leak "already checked" across unrelated hosts and tests.
 */
export function createImportIndexIntegrityMemo(_required: Record<string, never>, _optional: Record<string, never> = {}): ImportIndexIntegrityMemo {
  const identities = new Set<string>();
  const handles = new WeakSet<SqliteSyncClient>();
  return {
    has: ({ key }, _optional = {}) => typeof key === 'string' ? identities.has(key) : handles.has(key),
    add: ({ key }, _optional = {}) => { if (typeof key === 'string') identities.add(key); else handles.add(key); },
  };
}

const DAMAGED_MESSAGE = 'Import history could not be read. Imports are paused and nothing was changed. Contact support with this error ID.';

function damaged(_required: Record<string, never>, _optional: Record<string, never> = {}): ImportHistoryUnavailable {
  return new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_DAMAGED', status: 503, message: DAMAGED_MESSAGE });
}

function userVersion({ db }: { db: SqliteSyncClient }, _optional: Record<string, never> = {}): number {
  return Number(db.pragma('user_version', { simple: true }));
}

// A reader never migrates, so it must prove the file is exactly the schema this build understands.
function assertReadableSchema({ db }: { db: SqliteSyncClient }, _optional: Record<string, never> = {}): void {
  const version = userVersion({ db });
  if (version > 1) throw new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_NEWER', status: 503, message: 'Import history was written by a newer version of the app. Update the app to continue.' });
  if (version !== 1) throw damaged({});
  const applied = db.prepare<[], { id: string; checksum: string }>('SELECT id, checksum FROM site_import_migrations ORDER BY id').all();
  const schema = db.prepare<[], { value: string }>("SELECT value FROM meta WHERE key='schema'").get();
  const ledgerMatches = applied.length === 1 && applied[0]!.id === 'site-imports-v1' && applied[0]!.checksum === IMPORT_INDEX_MIGRATION_CHECKSUMS['site-imports-v1'];
  if (!ledgerMatches || schema?.value !== 'site-imports-v1') throw damaged({});
}

function configureConnection({ db, readonly }: { db: SqliteSyncClient; readonly: boolean }, _optional: Record<string, never> = {}): void {
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
  }
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
}

function prepareDatabase({ db, clock, readonly, mustExist }: { db: SqliteSyncClient; clock: { nowMs(): number }; readonly: boolean; mustExist: boolean }, _optional: Record<string, never> = {}): void {
  configureConnection({ db, readonly });
  if ((readonly || mustExist) && userVersion({ db }) === 0) throw damaged({});
  if (readonly) assertReadableSchema({ db });
  else migrateImportIndex({ db, clock });
}

function checkIntegrityOnce({ db, file, checkIntegrity, integrityMemo }: { db: SqliteSyncClient; file: string; checkIntegrity: (required: { db: SqliteSyncClient; file: string }, optional?: Record<string, never>) => void; integrityMemo: ImportIndexIntegrityMemo }, _optional: Record<string, never> = {}): void {
  const dbId = db.prepare<[], { value: string }>("SELECT value FROM meta WHERE key='db_id'").get()?.value;
  const key: ImportIndexIntegrityKey = dbId === undefined ? db : JSON.stringify([file, dbId]);
  if (integrityMemo.has({ key })) return;
  checkIntegrity({ db, file }, {});
  integrityMemo.add({ key });
}

export function openImportIndex({ file, open, clock, policy, checkIntegrity, integrityMemo }: {
  file: string; open: SqliteSyncOpener; clock: { nowMs(): number }; policy: ImportHistoryPolicy;
  integrityMemo: ImportIndexIntegrityMemo;
  checkIntegrity: (required: { db: SqliteSyncClient; file: string }, optional?: Record<string, never>) => void;
}, { mustExist = false, readonly = false }: { mustExist?: boolean; readonly?: boolean } = {}) {
  let db: SqliteSyncClient | undefined;
  try {
    db = open(file, { readonly, fileMustExist: readonly || mustExist });
    prepareDatabase({ db, clock, readonly, mustExist });
    checkIntegrityOnce({ db, file, checkIntegrity, integrityMemo });
    const handle = db;
    return { db: handle, store: createImportIndexStore({ db: handle, clock, policy }), close(_required: Record<string, never>, _optional: Record<string, never> = {}): void { handle.close(); } };
  } catch (error) {
    try { db?.close(); } catch {}
    return mapSqliteError({ error, messages: {
      busy: 'Import history is busy. Try again in a moment.',
      storage: 'There is not enough free disk space to record the import. Free up space and try again.',
      damaged: DAMAGED_MESSAGE,
    } });
  }
}
