import { sql, type Kysely } from 'kysely';
import type { MigrationStep, StorageKernel } from '@jini-ai/core/contracts/storage';
import { SQLITE_ROUTINES_SCHEMA } from '../routine-store.sqlite-schema.js';

export function jiniRoutinesV1(
  { checksum }: { checksum: string }, _optional = {},
): MigrationStep<StorageKernel<Kysely<unknown>, unknown>> {
  return {
    id: '0001_jini_routines_v1', checksum,
    async up(kernel) {
      for (const statement of SQLITE_ROUTINES_SCHEMA.split(';').filter((part) => part.trim())) {
        await kernel.run((db) => sql.raw(statement).execute(db));
      }
    },
  };
}
