import type { Kysely } from 'kysely';
import type { MigrationStep, StorageKernel } from '@jini-ai/core/contracts/storage';
import { jiniRoutinesV1 } from './0001_jini_routines_v1.js';
import { JINI_ROUTINES_MIGRATION_CHECKSUMS } from './checksums.js';

export const JINI_ROUTINES_LEDGER_TABLE = 'jini_routine_migrations';

export function pinnedChecksum({ id }: { id: string }, _optional = {}): string {
  const checksum = Object.hasOwn(JINI_ROUTINES_MIGRATION_CHECKSUMS, id) ? JINI_ROUTINES_MIGRATION_CHECKSUMS[id] : undefined;
  if (checksum === undefined) throw new Error(`routine migration ${id} has no pinned checksum`);
  return checksum;
}

export const JINI_ROUTINES_MIGRATIONS = [jiniRoutinesV1({ checksum: pinnedChecksum({ id: '0001_jini_routines_v1' }, {}) })];

export function migrateJiniRoutines<Kernel extends StorageKernel<Kysely<unknown>, unknown>, Report>(
  { kernel, runMigrations }: { kernel: Kernel; runMigrations: (kernel: Kernel,
    steps: readonly MigrationStep<StorageKernel<Kysely<unknown>, unknown>>[],
    options: { ledgerTable: string; historyCheck: 'ordered-prefix' }) => Promise<Report> },
  _optional = {},
): Promise<Report> {
  return runMigrations(kernel, JINI_ROUTINES_MIGRATIONS, { ledgerTable: JINI_ROUTINES_LEDGER_TABLE, historyCheck: 'ordered-prefix' });
}
