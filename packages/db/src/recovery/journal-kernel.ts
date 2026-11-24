import type { Generated } from "kysely";

import type { KyselyKernel } from "../kernel/port.js";
import { afterSettled, observed } from "@jini-ai/core/errors/idioms";

/**
 * @file The sidecar database journal (`ops/database-journal.db`; the host opens it on its SQLite driver)
 * as a storage kernel: `StorageKernel<JournalDatabase>`. The journal twin of the host's chat kernel.
 *
 * The journal is per-site ops metadata (restore points, migration runs, the boot ledger) and stays
 * a local SQLite file whatever database the site's content lives in — so its tables are typed here
 * by hand, snake_case, exactly as `journal-schema.ts` creates them. Type aliases,
 * not interfaces: Kysely's table typing needs them (see `packages/cms/src/comments/sql/repo.rows.ts`).
 */

export type DatabaseLedgerTable = {
  id: string;
  site_id: string;
  kind: string;
  correlation_id: string | null;
  restore_point_id: string | null;
  schema_before_version: number | null;
  schema_before_tag: string | null;
  schema_after_version: number | null;
  schema_after_tag: string | null;
  drift_status: string | null;
  outcome: string;
  detail_json: string | null;
  actor_workspace_id: string | null;
  actor_id: string | null;
  delegated_by_workspace_id: string | null;
  delegated_by_id: string | null;
  created_at: string;
};

export type MigrationRunsTable = {
  id: string;
  site_id: string;
  dialect: string;
  status: string;
  revision_seq_at_quiesce: number | null;
  quiesce_integrity: string | null;
  /** 0/1 (SQLite has no boolean). */
  blue_touched: Generated<number>;
  correlation_id: string | null;
  restore_point_id: string | null;
  actor_workspace_id: string | null;
  actor_id: string | null;
  delegated_by_workspace_id: string | null;
  delegated_by_id: string | null;
  created_at: string;
  updated_at: string;
};

export type RestorePointsTable = {
  id: string;
  site_id: string;
  trigger: string;
  cost_class: string;
  kind: string;
  artifact_ref: string;
  watermark_at_capture: number | null;
  captured_schema_version: number | null;
  captured_schema_tag: string | null;
  size_bytes: number | null;
  idempotency_key: string | null;
  actor_workspace_id: string | null;
  actor_id: string | null;
  created_at: string;
};

export type JournalDatabase = {
  database_ledger: DatabaseLedgerTable;
  migration_runs: MigrationRunsTable;
  restore_points: RestorePointsTable;
};

export type JournalKernel = KyselyKernel<JournalDatabase>;

/**
 * `kernel` with every database call held until `ready` settles (and failing with its error if it
 * rejects), and `ready` reported as the kernel's own: the {@link StorageKernel.ready} contract, for a
 * kernel whose schema is applied through the kernel itself after the connection opens.
 */
export function gateJournalKernel({ kernel, ready }: { kernel: JournalKernel; ready: Promise<void> }, _optional: Record<string, never> = {}): JournalKernel {
  // Observed here so a failed open is not an unhandled rejection; every call below re-throws it.
  observed({ promise: ready });
  return {
    ...kernel,
    ready,
    run: async (fn) => {
      await ready;
      return kernel.run(fn);
    },
    transaction: async (fn) => {
      await ready;
      return kernel.transaction(fn);
    },
    query: async (statement) => {
      await ready;
      return kernel.query(statement);
    },
    execute: async (statement) => {
      await ready;
      await kernel.execute(statement);
    },
    backupTo: async (destPath) => {
      await ready;
      await kernel.backupTo(destPath);
    },
    close: async () => {
      // Readiness errors reach kernel callers; close must still release the underlying handle.
      await afterSettled({ promise: ready });
      await kernel.close();
    },
  };
}
