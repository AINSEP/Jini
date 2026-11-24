import { sql } from "kysely";

import type { JournalKernel } from "./journal-kernel.js";

/**
 * @file DDL for the sidecar `ops/database-journal.db` (ADR-041 §2). SQLite by design: the journal
 * is a local SQLite file on every dialect (see `./journal-kernel.ts`, which types these tables).
 *
 * Purpose:
 * `database_ledger`, `migration_runs`, and `restore_points` — the three tables ADR-041 §2/§4
 * requires to live OUTSIDE `content.db`, in a physically separate SQLite file, so that restoring
 * `content.db` from a snapshot never erases the incident record that snapshot restore is supposed
 * to narrate, and boot recovery can append a `migration.interrupted` row even when `content.db`
 * itself won't open. Never merged into the `content.db` schema.
 *
 * The statements are exactly what the journal's former Drizzle migrations
 * (`../drizzle-database-journal/` 0000 + 0001) left on disk — same columns, defaults and index
 * names (the ledger's indexes kept their `idx_storage_ledger_*` names through the 0001 rename) —
 * made idempotent, so a file those migrations already built is left as it is. A file only 0000
 * ever touched still has `storage_ledger`; {@link applyDatabaseJournalSchema} renames it first.
 *
 * Composite actor identity (`actor_workspace_id`/`actor_id`, `delegated_by_workspace_id`/
 * `delegated_by_id`) is a soft, value-join reference only — SQLite has no cross-database FK, so this
 * is NOT a DB-enforced foreign key against `content.db`'s `principals` table (ADR-041 §4).
 *
 * `SITE_SCOPE_EXEMPT_TABLES` (ADR-041 §4, extending ADR-007 Decision 2's workspace-less-events
 * escape hatch to these three tables): every row here carries `site_id` (never `workspace_id`) — a
 * deliberate, disclosed extension, not a silent gap.
 */

/** Terminal `migration_runs.status` values a row is never found by `findNonTerminalForSite`. */
// MigrationRunStatus (features/database/migrate-forward/state-machine.ts) was deleted 2026-10-03: unused; this schema owns the persisted terminal values; see the host's development/DELETED-CODE.md.
export const MIGRATION_RUN_TERMINAL_STATUSES = ["DONE", "ABORTED_SAFE", "RESTORED", "RESTORE_FAILED", "ROLLBACK_TO_BLUE"] as const;

/**
 * `database_ledger` is the never-brick ledger (ADR-041 §1/§4): append-only; `restore_point_id` is
 * NULL only for `index.provision`/`index.drop` rows (the ADR-023 §4 carve-out). `migration_runs` has
 * one row per migrate-forward attempt (ADR-041 §3). `restore_points` has one row per restore-point
 * artifact (ADR-041 §2); `watermark_at_capture` is nullable so a legacy row needs no fabricated value.
 */
const DATABASE_JOURNAL_DDL = [
  sql`CREATE TABLE IF NOT EXISTS migration_runs (
    id text PRIMARY KEY NOT NULL,
    site_id text NOT NULL,
    dialect text NOT NULL,
    status text NOT NULL,
    revision_seq_at_quiesce integer,
    quiesce_integrity text,
    blue_touched integer DEFAULT 0 NOT NULL,
    correlation_id text,
    restore_point_id text,
    actor_workspace_id text,
    actor_id text,
    delegated_by_workspace_id text,
    delegated_by_id text,
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`,
  sql`CREATE INDEX IF NOT EXISTS idx_migration_runs_site_status ON migration_runs (site_id, status)`,
  sql`CREATE TABLE IF NOT EXISTS restore_points (
    id text PRIMARY KEY NOT NULL,
    site_id text NOT NULL,
    trigger text NOT NULL,
    cost_class text NOT NULL,
    kind text NOT NULL,
    artifact_ref text NOT NULL,
    watermark_at_capture integer,
    captured_schema_version integer,
    captured_schema_tag text,
    size_bytes integer,
    idempotency_key text,
    actor_workspace_id text,
    actor_id text,
    created_at text NOT NULL
  )`,
  sql`CREATE INDEX IF NOT EXISTS idx_restore_points_site_created ON restore_points (site_id, created_at)`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_restore_points_site_idempotency_key ON restore_points (site_id, idempotency_key)`,
  sql`CREATE TABLE IF NOT EXISTS database_ledger (
    id text PRIMARY KEY NOT NULL,
    site_id text NOT NULL,
    kind text NOT NULL,
    correlation_id text,
    restore_point_id text,
    schema_before_version integer,
    schema_before_tag text,
    schema_after_version integer,
    schema_after_tag text,
    drift_status text,
    outcome text NOT NULL,
    detail_json text,
    actor_workspace_id text,
    actor_id text,
    delegated_by_workspace_id text,
    delegated_by_id text,
    created_at text NOT NULL
  )`,
  sql`CREATE INDEX IF NOT EXISTS idx_storage_ledger_site_created ON database_ledger (site_id, created_at)`,
  sql`CREATE INDEX IF NOT EXISTS idx_storage_ledger_site_kind ON database_ledger (site_id, kind)`,
];

/**
 * Brings the journal file behind `kernel` to the current schema, in one transaction: renames a
 * pre-0001 `storage_ledger` to `database_ledger`, then creates whatever is missing. Idempotent.
 * Called on the kernel's own (ungated) connection before any repo query runs.
 */
export async function applyDatabaseJournalSchema({ kernel }: { kernel: JournalKernel }, _optional: Record<string, never> = {}): Promise<void> {
  await kernel.transaction(async () => {
    const tables = new Set(
      (await kernel.run((db) => db.introspection.getTables())).map((table) => table.name)
    );
    if (tables.has("storage_ledger") && !tables.has("database_ledger")) {
      await kernel.execute(sql`ALTER TABLE storage_ledger RENAME TO database_ledger`);
    }
    for (const statement of DATABASE_JOURNAL_DDL) await kernel.execute(statement);
  });
}
