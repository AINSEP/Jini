import type { SqliteSyncClient } from '@jini-ai/core/contracts/storage';
import { ImportHistoryUnavailable } from './errors.js';
import { IMPORT_INDEX_V1_DDL } from './migrations/site-imports-v1.js';
import { IMPORT_INDEX_MIGRATION_CHECKSUMS } from './migrations/checksums.js';

const steps = [{ id: 'site-imports-v1', checksum: IMPORT_INDEX_MIGRATION_CHECKSUMS['site-imports-v1'], ddl: IMPORT_INDEX_V1_DDL }] as const;

export function migrateImportIndex({ db, clock }: { db: SqliteSyncClient; clock: { nowMs(): number } }, _optional: Record<string, never> = {}): void {
  const version = Number(db.pragma('user_version', { simple: true }));
  if (version > 1) throw new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_NEWER', status: 503, message: 'Import history was written by a newer version of the app. Update the app to continue.' });
  if (version === 0) db.transaction(() => {
    const current = Number(db.pragma('user_version', { simple: true }));
    if (current !== 0) return;
    for (const step of steps) {
      db.exec(step.ddl);
      db.prepare('INSERT INTO site_import_migrations(id,checksum,applied_at) VALUES(?,?,?)').run(step.id, step.checksum, clock.nowMs());
    }
    db.prepare('INSERT INTO meta VALUES(?,?)').run('schema', 'site-imports-v1');
  }).immediate();
  const appliedVersion = Number(db.pragma('user_version', { simple: true }));
  if (appliedVersion > 1) throw new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_NEWER', status: 503, message: 'Import history was written by a newer version of the app. Update the app to continue.' });
  if (appliedVersion !== 1) throw new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_DAMAGED', status: 503, message: 'Import history could not be read. Imports are paused and nothing was changed. Contact support with this error ID.' });
  const applied = db.prepare<[], { id: string; checksum: string }>('SELECT id, checksum FROM site_import_migrations ORDER BY id').all();
  const schema = db.prepare<[], { value: string }>("SELECT value FROM meta WHERE key='schema'").get();
  if (applied.length !== steps.length || applied.some((row, index) => row.id !== steps[index]!.id || row.checksum !== steps[index]!.checksum) || schema?.value !== 'site-imports-v1') {
    throw new ImportHistoryUnavailable({ code: 'IMPORT_HISTORY_DAMAGED', status: 503, message: 'Import history could not be read. Imports are paused and nothing was changed. Contact support with this error ID.' });
  }
}
