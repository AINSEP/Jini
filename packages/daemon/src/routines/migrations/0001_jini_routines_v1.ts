import { sql, type Kysely } from 'kysely';
import type { MigrationStep, StorageKernel } from '@jini-ai/core/contracts/storage';

/**
 * @file Step 0001 of the routine sidecar's ADR-066 history: the three routine tables. The DDL lives in
 * this file, not beside the store, because the pinned checksum in `checksums.ts` hashes THIS source;
 * a DDL constant imported from elsewhere could change without tripping the pin. The node entry
 * re-exports it as `SQLITE_ROUTINES_SCHEMA` (one DDL source); the migration runner is the boot path.
 */

/** The routine tables, scoped by `scope` so one sidecar file can serve several workspaces. */
export const SQLITE_ROUTINES_SCHEMA = `
CREATE TABLE jini_routines (
  scope TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, prompt TEXT NOT NULL,
  schedule TEXT NOT NULL, target TEXT NOT NULL, skill_id TEXT, agent_id TEXT, model TEXT,
  context TEXT NOT NULL, creator_id TEXT NOT NULL, enabled INTEGER NOT NULL,
  next_run_at INTEGER, revision INTEGER NOT NULL, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, deleted_at INTEGER, PRIMARY KEY (scope,id)
);
CREATE INDEX jini_routines_live ON jini_routines(scope,created_at,id) WHERE deleted_at IS NULL;
CREATE TABLE jini_routine_runs (
  scope TEXT NOT NULL, id TEXT NOT NULL, routine_id TEXT NOT NULL, trigger TEXT NOT NULL,
  status TEXT NOT NULL, catch_up INTEGER NOT NULL, slot_at INTEGER, holder_id TEXT NOT NULL,
  project_id TEXT NOT NULL, conversation_id TEXT NOT NULL, agent_run_id TEXT NOT NULL,
  assistant_message_id TEXT, agent_id TEXT, model TEXT, started_at INTEGER NOT NULL,
  completed_at INTEGER, summary TEXT, error TEXT, error_code TEXT,
  approval_state TEXT NOT NULL, approval_ref TEXT, approval_since INTEGER,
  PRIMARY KEY (scope,id), FOREIGN KEY (scope,routine_id) REFERENCES jini_routines(scope,id)
);
CREATE INDEX jini_routine_history ON jini_routine_runs(scope,routine_id,started_at DESC,id DESC);
CREATE UNIQUE INDEX jini_routine_slots ON jini_routine_runs(scope,routine_id,slot_at)
  WHERE trigger='scheduled' AND slot_at IS NOT NULL;
CREATE UNIQUE INDEX jini_routine_active ON jini_routine_runs(scope,routine_id)
  WHERE status IN ('queued','running');
CREATE TABLE jini_routine_leases (
  scope TEXT NOT NULL PRIMARY KEY, holder_id TEXT NOT NULL, expires_at INTEGER NOT NULL
);
`;

export function jiniRoutinesV1(
  { checksum }: { checksum: string }, _optional = {},
): MigrationStep<StorageKernel<Kysely<unknown>, unknown>> {
  return {
    id: '0001_jini_routines_v1', checksum,
    async up(kernel) {
      // The DDL has no string literals or triggers, so splitting on ';' yields whole statements.
      for (const statement of SQLITE_ROUTINES_SCHEMA.split(';').filter((part) => part.trim())) {
        await kernel.run((db) => sql.raw(statement).execute(db));
      }
    },
  };
}
