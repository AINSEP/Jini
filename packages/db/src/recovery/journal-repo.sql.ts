import type { Updateable } from "kysely";
import fs from "node:fs/promises";
import path from "node:path";
import { decodeKeysetCursor, encodeKeysetCursor } from "@jini-ai/core/keyset-cursor";

import { pruneDatabaseCopies } from "../sqlite/backup-policy.js";
import type { LedgerReadPort, LedgerRow } from "../tools/timeline.js";
import type { LedgerAppendPort } from "./migrate-forward-hooks.js";
import type { BootLedgerPort, MigrationRunsRepoPort } from "./reconcile-interrupted-migration.js";
import type { CreateRestorePointRepoPort } from "./restore-point-create.js";
import { MIGRATION_RUN_TERMINAL_STATUSES } from "./journal-schema.js";
import type { JournalDatabase, JournalKernel } from "./journal-kernel.js";

/**
 * @file ADR-041 §2/§4 — the adapters over the sidecar `ops/database-journal.db`: Kysely queries on
 * the journal's own kernel (`./journal-kernel.ts`), every one through `kernel.run` and awaited.
 *
 * Purpose:
 * Every class here is a thin, siteId-scoped implementation of an ALREADY-DEFINED port from
 * `../tools/` and this folder — no port shape changes, only real persistence behind
 * them. `SqliteDatabaseLedgerRepo` doubles as `LedgerReadPort` (Timeline's read side) and
 * `BootLedgerPort` (boot reconciliation's append side), since both operate on the same
 * `database_ledger` table.
 *
 * How it relates to the project:
 * The host's composition root constructs these against the journal kernel its journal driver binding
 * opens alongside `content.db` (schema: `./journal-schema.ts`); the host's in-memory test composition uses
 * simple in-process fakes instead (mirrors every other feature's app.ts/deps.ts split in the host).
 *
 * Architectural role:
 * Infrastructure adapters. The journal is SQLite on every content dialect, so these keep their
 * `Sqlite*` names.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `created_at` is a full ISO timestamp compared as a string, so a bare `2026-09-24` upper bound sorted
 *  before every row of that day and excluded it. A date-only bound means "through the end of that day".
 *  @complexity O(1). */
function inclusiveUpperBound({ toDate }: { toDate: string }, _optional: Record<string, never> = {}): string {
  return DATE_ONLY.test(toDate) ? `${toDate}T23:59:59.999Z` : toDate;
}

/** An optional port field that was left out is stored as SQL `NULL`, the same as an explicit `null`.
 *  @complexity O(1). */
function orNull<T>({ value }: { value: T | null | undefined }, _optional: Record<string, never> = {}): T | null {
  return value ?? null;
}

/** `database_ledger` adapter — implements both the Timeline's read port and the boot
 * reconciliation's append port, siteId-scoped at construction. */
export class SqliteDatabaseLedgerRepo implements LedgerReadPort, BootLedgerPort {
  private readonly deps: { db: JournalKernel; siteId: string };
  constructor(deps: { db: JournalKernel; siteId: string }) {
    this.deps = deps;
  }

  /**
   * REQ-01/REQ-04 — filtered, cursor-paginated read over `database_ledger`, newest-first. The
   * cursor is an opaque `${createdAt}::${id}` composite (never a raw offset — stable under
   * concurrent inserts).
   *
   * @complexity O(limit) via the `(site_id, created_at)` index; one extra row fetched to detect
   * `nextCursor` presence without a second COUNT query.
   * @overallScore 100
   */
  async query(filter: {
    kind?: string;
    fromDate?: string;
    toDate?: string;
    outcome?: string;
    cursor?: string | null;
    limit: number;
  }): Promise<{ items: LedgerRow[]; nextCursor: string | null }> {
    const decoded = filter.cursor ? decodeKeysetCursor({ cursor: filter.cursor }) : null;
    const rows = await this.deps.db.run((db) => {
      let query = db
        .selectFrom("database_ledger")
        .select(["id", "kind", "created_at", "restore_point_id", "outcome"])
        .where("site_id", "=", this.deps.siteId);
      if (filter.kind) query = query.where("kind", "=", filter.kind);
      if (filter.outcome) query = query.where("outcome", "=", filter.outcome);
      if (filter.fromDate) query = query.where("created_at", ">=", filter.fromDate);
      if (filter.toDate) query = query.where("created_at", "<=", inclusiveUpperBound({ toDate: filter.toDate }));
      if (decoded) {
        query = query.where((eb) =>
          eb.or([
            eb("created_at", "<", decoded.createdAt),
            eb.and([eb("created_at", "=", decoded.createdAt), eb("id", "<", decoded.id)]),
          ])
        );
      }
      return query.orderBy("created_at", "desc").orderBy("id", "desc").limit(filter.limit + 1).execute();
    });

    const page = rows.slice(0, filter.limit);
    const items: LedgerRow[] = page.map((row) => ({
      id: row.id,
      kind: row.kind,
      createdAt: row.created_at,
      restorePointId: row.restore_point_id,
      outcome: row.outcome,
    }));

    const last = page[page.length - 1];
    const nextCursor = rows.length > filter.limit && last ? encodeKeysetCursor({ createdAt: last.created_at, id: last.id }) : null;
    return { items, nextCursor };
  }

  /** Appends one `database_ledger` row (ADR-041 §4). Never mutates or deletes an existing row —
   * the ledger is append-only by construction. */
  async append(row: Parameters<LedgerAppendPort["append"]>[0]): Promise<void> {
    await this.deps.db.run((db) =>
      db
        .insertInto("database_ledger")
        .values({
          id: row.id,
          site_id: this.deps.siteId,
          kind: row.kind,
          correlation_id: orNull({ value: row.correlationId }),
          restore_point_id: orNull({ value: row.restorePointId }),
          schema_before_version: orNull({ value: row.schemaBeforeVersion }),
          schema_before_tag: orNull({ value: row.schemaBeforeTag }),
          schema_after_version: orNull({ value: row.schemaAfterVersion }),
          schema_after_tag: orNull({ value: row.schemaAfterTag }),
          drift_status: orNull({ value: row.driftStatus }),
          outcome: row.outcome,
          detail_json: orNull({ value: row.detailJson }),
          actor_workspace_id: orNull({ value: row.actorWorkspaceId }),
          actor_id: orNull({ value: row.actorId }),
          delegated_by_workspace_id: orNull({ value: row.delegatedByWorkspaceId }),
          delegated_by_id: orNull({ value: row.delegatedById }),
          created_at: row.createdAt,
        })
        .execute()
    );
  }

  /** SPEC-017 C-106 — converts a non-terminal `migration_runs` row into a `migration.interrupted`
   * ledger row (ADR-041 §3's boot-time crash reconciliation).
   *
   * Round-5 re-audit (2026-07-16, TM-adr041-043-044-045-audit-001, codex `R5-F1-BLOCKED-RECOVERY-
   * NOT-RESTART-SAFE` / Fable `R5-F1-INTERRUPTED-SECOND-BOOT-BRICK`, both independently confirmed
   * by direct code inspection and Fable's empirical double-boot reproduction): `database_ledger.id`
   * is the primary key, and this method's id (`interrupted-${migrationRunId}`) is
   * deterministic BY DESIGN so a second boot re-detecting the SAME still-unresolved migration
   * targets the same row. Before this fix, the plain insert this called through
   * `append()` threw `UNIQUE constraint failed` on that second boot, which — because this is a
   * CRITICAL boot module — failed the whole boot and `process.exit(1)`'d before `app.listen()`,
   * making Recovery itself unreachable. `ON CONFLICT (id) DO NOTHING` makes the deterministic id do what
   * it was always meant to: every boot re-detects and re-blocks idempotently. */
  async appendInterruptedRow(params: { siteId: string; migrationRunId: string }): Promise<void> {
    await this.deps.db.run((db) =>
      db
        .insertInto("database_ledger")
        .values({
          id: `interrupted-${params.migrationRunId}`,
          site_id: this.deps.siteId,
          kind: "migration.interrupted",
          restore_point_id: null,
          outcome: "blocked_pending_recovery",
          detail_json: JSON.stringify({ migrationRunId: params.migrationRunId }),
          created_at: new Date().toISOString(),
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .execute()
    );
  }
}

/** `migration_runs` adapter — implements the boot-sequence's `MigrationRunsRepoPort`, plus the
 * insert/status-update helpers the state machine's own persistence caller needs. */
export class SqliteMigrationRunsRepo implements MigrationRunsRepoPort {
  private static readonly TERMINAL_STATUSES = new Set(MIGRATION_RUN_TERMINAL_STATUSES as readonly string[]);

  private readonly deps: { db: JournalKernel; siteId: string };
  constructor(deps: { db: JournalKernel; siteId: string }) {
    this.deps = deps;
  }

  /**
   * SPEC-017 C-106/C-107 (INV-08) — the single defensive read both boot-sequence steps consult:
   * a non-null result means a crashed-mid-migration run has not yet been reconciled.
   *
   * @complexity O(1) via the `(site_id, status)` index.
   * @overallScore 100
   */
  async findNonTerminalForSite(siteId: string): Promise<{ id: string; status: string } | null> {
    const rows = await this.deps.db.run((db) =>
      db.selectFrom("migration_runs").select(["id", "status"]).where("site_id", "=", siteId).execute()
    );

    const nonTerminal = rows.find((row) => !SqliteMigrationRunsRepo.TERMINAL_STATUSES.has(row.status));
    return nonTerminal ?? null;
  }

  /** Round-5 re-audit (2026-07-16, TM-adr041-043-044-045-audit-001, R5-F1/R5-F2 fix) — terminalizes
   * a run as `RESTORED` (a real member of `MIGRATION_RUN_TERMINAL_STATUSES`) so the next boot's
   * `findNonTerminalForSite` no longer re-detects it. Thin wrapper over `updateState`, kept as its
   * own port method so callers outside this file (the restore ceremony) don't need `updateState`'s
   * full row shape. */
  async markResolved(params: { id: string }): Promise<void> {
    await this.deps.db.run((db) =>
      db
        .updateTable("migration_runs")
        .set({ status: "RESTORED", updated_at: new Date().toISOString() })
        .where("site_id", "=", this.deps.siteId)
        .where("id", "=", params.id)
        .execute()
    );
  }

  /** Inserts a new `migration_runs` row (state machine's initial `IDLE`/`PLANNED` write). */
  async insert(row: {
    id: string;
    dialect: "sqlite" | "postgres";
    status: string;
    correlationId?: string | null;
    createdAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.deps.db.run((db) =>
      db
        .insertInto("migration_runs")
        .values({
          id: row.id,
          site_id: this.deps.siteId,
          dialect: row.dialect,
          status: row.status,
          blue_touched: 0,
          correlation_id: orNull({ value: row.correlationId }),
          created_at: row.createdAt,
          updated_at: row.updatedAt,
        })
        .execute()
    );
  }

  /** Persists a state-machine transition's resulting fields against an existing row. A field left
   * `undefined` is not written (an explicit `null` clears it). */
  async updateState(row: {
    id: string;
    status: string;
    revisionSeqAtQuiesce?: number | null;
    quiesceIntegrity?: string | null;
    blueTouched?: boolean;
    restorePointId?: string | null;
    updatedAt: string;
  }): Promise<void> {
    const set: Updateable<JournalDatabase["migration_runs"]> = { status: row.status, updated_at: row.updatedAt };
    if (row.revisionSeqAtQuiesce !== undefined) set.revision_seq_at_quiesce = row.revisionSeqAtQuiesce;
    if (row.quiesceIntegrity !== undefined) set.quiesce_integrity = row.quiesceIntegrity;
    if (row.blueTouched !== undefined) set.blue_touched = row.blueTouched ? 1 : 0;
    if (row.restorePointId !== undefined) set.restore_point_id = row.restorePointId;
    await this.deps.db.run((db) =>
      db
        .updateTable("migration_runs")
        .set(set)
        .where("site_id", "=", this.deps.siteId)
        .where("id", "=", row.id)
        .execute()
    );
  }
}

/** What {@link SqliteRestorePointsRepo} is constructed with. `onPruneWarning` is the host's port for a
 *  failed cleanup of older restore-point copies: the host formats and redacts the error and decides where
 *  the warning goes, so this package never writes to a console or knows a host's secret shapes. */
export type RestorePointsRepoDeps = {
  db: JournalKernel;
  siteId: string;
  protectedRestorePointIds?: () => Promise<ReadonlySet<string>>;
  onPruneWarning: ({ error }: { error: unknown }) => void;
};

/** `restore_points` adapter — implements `./restore-point-create.ts`'s
 * `CreateRestorePointRepoPort`, plus the database-side persistence helper `db-ops`'s
 * `captureRestorePoint()` result needs to become a durable row. */
export class SqliteRestorePointsRepo implements CreateRestorePointRepoPort {
  private readonly deps: RestorePointsRepoDeps;
  constructor(deps: RestorePointsRepoDeps) {
    this.deps = deps;
  }

  /** REQ-05 (recovery) / REQ-22 (database) — persists one `restore_points` row. */
  async save(row: {
    restorePointId: string;
    idempotencyKey: string;
    trigger: string;
    createdAt: string;
    createdBy: string;
    costClass?: string;
    kind?: string;
    artifactRef?: string;
    watermarkAtCapture?: number | null;
    capturedSchemaVersion?: number | null;
    capturedSchemaTag?: string | null;
  }): Promise<void> {
    await this.deps.db.run((db) =>
      db
        .insertInto("restore_points")
        .values({
          id: row.restorePointId,
          site_id: this.deps.siteId,
          trigger: row.trigger,
          cost_class: row.costClass ?? "cheap",
          kind: row.kind ?? "file-snapshot",
          artifact_ref: row.artifactRef ?? "",
          watermark_at_capture: orNull({ value: row.watermarkAtCapture }),
          captured_schema_version: orNull({ value: row.capturedSchemaVersion }),
          captured_schema_tag: orNull({ value: row.capturedSchemaTag }),
          idempotency_key: row.idempotencyKey,
          actor_id: row.createdBy,
          created_at: row.createdAt,
        })
        .execute()
    );
    if (!row.artifactRef) return;
    try {
      await this.pruneCopies({ justWritten: row.artifactRef });
    } catch (error) {
      // The copy and its row are saved; cleanup must not turn the operation that needed them into an error.
      this.deps.onPruneWarning({ error });
    }
  }

  /** Row/file deletion stays in this repository; generic policy never learns the journal's schema.
   * @complexity O(n log n) restore rows, plus two bounded-shape reference queries and one delete per expired row. */
  private async pruneCopies({ justWritten }: { justWritten: string }): Promise<void> {
    const rows = (await this.list()).filter(row => /^restore-point-[A-Za-z0-9_-]+-wm\d+-\d+\.db$/.test(path.basename(row.artifactRef)));
    // In-flight publishes and unfinished migrations may still roll back to their copy.
    const protectedIds = new Set(await this.deps.protectedRestorePointIds?.());
    const migrations = await this.deps.db.run(db => db.selectFrom("migration_runs").select("restore_point_id")
      .where("site_id", "=", this.deps.siteId).where("status", "not in", [...MIGRATION_RUN_TERMINAL_STATUSES]).execute());
    for (const row of migrations) if (row.restore_point_id) protectedIds.add(row.restore_point_id);
    await pruneDatabaseCopies({ justWritten, copies: rows.map(row => ({ filePath: row.artifactRef, createdAt: Date.parse(row.createdAt) })) }, {
      protectedPaths: new Set(rows.filter(row => protectedIds.has(row.id)).map(row => row.artifactRef)),
      remove: async ({ filePath }) => {
        // An unlink refusal leaves its row visible and retryable; never report a retained file as gone.
        await fs.rm(filePath, { force: true });
        await this.deps.db.run(db => db.deleteFrom("restore_points").where("site_id", "=", this.deps.siteId).where("artifact_ref", "=", filePath).execute());
      },
    });
  }

  /** AC-11 (recovery) — `(site_id, idempotency_key)` single-row lookup. */
  async findByIdempotencyKey(key: string): Promise<{ restorePointId: string; idempotencyKey: string } | null> {
    const row = await this.deps.db.run((db) =>
      db
        .selectFrom("restore_points")
        .select(["id", "idempotency_key"])
        .where("site_id", "=", this.deps.siteId)
        .where("idempotency_key", "=", key)
        .limit(1)
        .executeTakeFirst()
    );
    return row && row.idempotency_key ? { restorePointId: row.id, idempotencyKey: row.idempotency_key } : null;
  }

  /** Newest-first restore-point listing for the Recovery screen / Timeline. */
  async list(): Promise<
    Array<{
      id: string;
      trigger: string;
      costClass: string;
      kind: string;
      watermarkAtCapture: number | null;
      createdAt: string;
      artifactRef: string;
    }>
  > {
    const rows = await this.deps.db.run((db) =>
      db
        .selectFrom("restore_points")
        // `artifact_ref` was once never selected — see `save()` for the matching write side and
        // `./restore-hooks.ts`'s `buildRestoreHooks` for why the omission mattered
        // (the restore ceremony had no way to know which file to restore from).
        .select(["id", "trigger", "cost_class", "kind", "watermark_at_capture", "created_at", "artifact_ref"])
        .where("site_id", "=", this.deps.siteId)
        .orderBy("created_at", "desc")
        .execute()
    );
    return rows.map((row) => ({
      id: row.id,
      trigger: row.trigger,
      costClass: row.cost_class,
      kind: row.kind,
      watermarkAtCapture: row.watermark_at_capture,
      createdAt: row.created_at,
      artifactRef: row.artifact_ref,
    }));
  }
}
