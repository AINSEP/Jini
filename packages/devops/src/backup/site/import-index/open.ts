import type { ImportHistoryPolicy } from '@jini-ai/core/contracts/site/site-import-history';
import type { SqliteSyncClient, SqliteSyncOpener } from '@jini-ai/core/contracts/storage';
import { ImportHistoryUnavailable, mapSqliteError } from './errors.js';
import { migrateImportIndex } from './schema.js';
import { IMPORT_INDEX_MIGRATION_CHECKSUMS } from './migrations/checksums.js';
import { createImportIndexStore } from './store.js';

const checkedIdentities = new Set<string>();
const checkedHandles = new WeakSet<SqliteSyncClient>();

export function openImportIndex({ file, open, clock, policy, checkIntegrity }: {
  file: string; open: SqliteSyncOpener; clock: { nowMs(): number }; policy: ImportHistoryPolicy;
  checkIntegrity: (required: { db: SqliteSyncClient; file: string }, optional?: Record<string, never>) => void;
}, { mustExist = false, readonly = false }: { mustExist?: boolean; readonly?: boolean } = {}) {
  let db: SqliteSyncClient | undefined;
  try {
    db = open(file, { readonly, fileMustExist: readonly || mustExist });
    if (!readonly) {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = FULL');
    }
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    if ((readonly || mustExist) && Number(db.pragma('user_version', { simple: true })) === 0) {
      throw new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_DAMAGED', status: 503, message: 'Import history could not be read. Imports are paused and nothing was changed. Contact support with this error ID.' });
    }
    if (readonly) {
      const version = Number(db.pragma('user_version', { simple: true }));
      if (version > 1) throw new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_NEWER', status: 503, message: 'Import history was written by a newer version of the app. Update the app to continue.' });
      if (version !== 1) throw new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_DAMAGED', status: 503, message: 'Import history could not be read. Imports are paused and nothing was changed. Contact support with this error ID.' });
      const applied = db.prepare<[], { id: string; checksum: string }>('SELECT id, checksum FROM site_import_migrations ORDER BY id').all();
      const schema = db.prepare<[], { value: string }>("SELECT value FROM meta WHERE key='schema'").get();
      if (applied.length !== 1 || applied[0]!.id !== 'site-imports-v1' || applied[0]!.checksum !== IMPORT_INDEX_MIGRATION_CHECKSUMS['site-imports-v1'] || schema?.value !== 'site-imports-v1') {
        throw new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_DAMAGED', status: 503, message: 'Import history could not be read. Imports are paused and nothing was changed. Contact support with this error ID.' });
      }
    } else migrateImportIndex({ db, clock });
    const dbId = db.prepare<[], { value: string }>("SELECT value FROM meta WHERE key='db_id'").get()?.value;
    const identity = dbId === undefined ? undefined : JSON.stringify([file, dbId]);
    if (identity === undefined ? !checkedHandles.has(db) : !checkedIdentities.has(identity)) {
      checkIntegrity({ db, file }, {});
      if (identity === undefined) checkedHandles.add(db);
      else checkedIdentities.add(identity);
    }
    const handle = db;
    return { db: handle, store: createImportIndexStore({ db: handle, clock, policy }), close(_required: Record<string, never>, _optional: Record<string, never> = {}): void { handle.close(); } };
  } catch (error) {
    try { db?.close(); } catch {}
    return mapSqliteError({ error, messages: {
      busy: 'Import history is busy. Try again in a moment.',
      storage: 'There is not enough free disk space to record the import. Free up space and try again.',
      damaged: 'Import history could not be read. Imports are paused and nothing was changed. Contact support with this error ID.',
    } });
  }
}
