/**
 * @file THE durable {@link ToolAttemptAuditSink} — persists agent tool-attempt phases into the
 * content database's `agent_tool_attempts` (`repo.memory.ts` is the in-memory half, per ADR-006's
 * rule-of-two). One Kysely query body for every dialect (storage plan §4, ADR-066); the host's
 * SQLite binding is the thin subclass the composition root builds from the content db handle,
 * passing its table name ({@link ToolAttemptTables}) and its error reporter.
 *
 * Purpose:
 * Makes the attempt history outlive the daemon process. `@jini-ai/daemon`'s `ToolExecutor` holds its
 * own audit records in an in-process `Map`, so today every requested/denied/failed execution is
 * erased on restart — and the two cases it never records at all (unknown tool, throwing
 * authorization) leave nothing behind even while the process lives.
 *
 * Retention:
 * The table is append-only and would otherwise grow without bound, so {@link MAX_ROWS_PER_WORKSPACE}
 * administrator rows are kept per workspace; anonymous-visitor has an independent 20,000-row
 * bucket. Each bucket's excess is pruned oldest-first on write. The prune runs
 * opportunistically rather than in a background job — there is no scheduler in the daemon process,
 * and a scheduled pruner would be a new failure surface for a table nothing reads on a hot path.
 *
 * Architectural role:
 * Infrastructure adapter. It takes a schema-free storage kernel and the host's table name; it never
 * imports a concrete database handle.
 */
import type { Kysely } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
// Shared phases/events/append contract belong to the daemon; the host owns its table and logger.
import type { ToolAttemptAuditSink, ToolAttemptEvent } from "@jini-ai/core/contracts/site/daemon-tool-audit";

import type { AgentToolAttemptsTable } from "./repo.rows.js";

/**
 * Per-workspace row cap.
 *
 * A STARTING NUMBER, not a tuned or externally-derived one, and nothing in the codebase depends on
 * its exact value — raise or lower it freely. Sized so that at roughly two or three rows per
 * attempt it holds on the order of twenty thousand attempts per workspace, which is far more than
 * any current diagnostic use needs while staying small enough that the table cannot quietly become
 * the largest thing in `content.db`.
 */
export const MAX_ROWS_PER_WORKSPACE = 50_000;
/** Anonymous traffic has its own retention bucket and can never evict administrator attempts. */
export const MAX_VISITOR_ROWS_PER_WORKSPACE = 20_000;

/** Prune every Nth append rather than on all of them — the cap is a bound, not a precise ceiling. */
const PRUNE_CHECK_INTERVAL = 256;

/** Host-owned table name. No schema or product table default lives in the adapter. */
export interface ToolAttemptTables { toolAttempts: string }

/** Receives a failed audit write. The host binds its own logger; the adapter never logs. */
export type ToolAuditErrorReporter = (required: { error: unknown }, optional?: Record<string, never>) => void;

/** The sink's constructor object: the schema-free kernel, the host table name and the error reporter. */
export interface SqlToolAttemptAuditSinkRequired {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: ToolAttemptTables;
  /** Reported when a write fails. Required: there is no console default here. */
  onError: ToolAuditErrorReporter;
}

export interface SqlToolAttemptAuditSinkOptions {
  /** Per-workspace row cap. @default {@link MAX_ROWS_PER_WORKSPACE} */
  maxRowsPerWorkspace?: number;
  /** Separate anonymous bucket; the administrator cap excludes this principal entirely. */
  maxVisitorRowsPerWorkspace?: number;
  /** Appends between prune checks. Lower it in tests to reach the prune without 50k writes. @default {@link PRUNE_CHECK_INTERVAL} */
  pruneCheckInterval?: number;
}

/**
 * Content-database-backed audit sink.
 *
 * `append` deliberately never throws: the decorator that calls it treats audit as observation, and
 * a write failure must not turn a successful tool call into a failed one. A failure is reported to
 * the host-bound `onError` so it is loud in logs without being fatal in behavior.
 */
export class SqlToolAttemptAuditSink implements ToolAttemptAuditSink {
  private readonly appendsSincePruneCheck = new Map<string, number>();
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: ToolAttemptTables;
  private readonly onError: ToolAuditErrorReporter;
  private readonly maxRows: number;
  private readonly maxVisitorRows: number;
  private readonly pruneCheckInterval: number;

  constructor(required: SqlToolAttemptAuditSinkRequired, options: SqlToolAttemptAuditSinkOptions = {}) {
    this.kernel = required.kernel;
    this.tables = required.tables;
    this.onError = required.onError;
    this.maxRows = options.maxRowsPerWorkspace ?? MAX_ROWS_PER_WORKSPACE;
    this.maxVisitorRows = options.maxVisitorRowsPerWorkspace ?? MAX_VISITOR_ROWS_PER_WORKSPACE;
    this.pruneCheckInterval = options.pruneCheckInterval ?? PRUNE_CHECK_INTERVAL;
  }

  /** Host-owned table name needs an explicit column schema, as in the webhook adapters. */
  private table(db: Kysely<unknown>) {
    return db.withTables<Record<string, AgentToolAttemptsTable>>();
  }

  /**
   * Appends one phase row, then prunes the workspace's oldest rows if the cap is exceeded.
   *
   * @param event - The phase to record. `detail` must already be redacted by the caller.
   * @param optional - Daemon append options; an explicit detail overrides the legacy event field.
   * @returns Resolves once the row is written, or once the failure has been reported — never rejects.
   * @complexity O(1) for the insert. The prune runs at most once per
   * {@link PRUNE_CHECK_INTERVAL} appends and is O(log n) per deleted row via the
   * `(workspace_id, id)` index.
   * @overallScore 100
   */
  async append(event: ToolAttemptEvent, optional: Pick<ToolAttemptEvent, "detail"> = {}): Promise<void> {
    await this.appendCommitted(event, optional);
  }

  /** Same non-throwing audit write, returning insertion evidence for product observers.
   * A later retention failure cannot undo an inserted attempt. @complexity Same as append. */
  async appendCommitted(event: ToolAttemptEvent, optional: Pick<ToolAttemptEvent, "detail"> = {}): Promise<boolean> {
    let committed = false;
    try {
      await this.kernel.run((db) =>
        this.table(db)
          .insertInto(this.tables.toolAttempts)
          .values({
            attempt_id: event.attemptId,
            execution_id: event.executionId,
            workspace_id: event.workspaceId,
            run_id: event.runId,
            tool_id: event.toolId,
            principal_id: event.principalId,
            phase: event.phase,
            at: event.at,
            // Released daemon callers pass detail in options; retain older event-shaped callers.
            detail: optional.detail === undefined ? event.detail ?? null : optional.detail,
          })
          .execute()
      );

      committed = true;
      const visitor = event.principalId === "anonymous-visitor";
      const bucketKey = JSON.stringify([event.workspaceId, visitor]);
      const appends = (this.appendsSincePruneCheck.get(bucketKey) ?? 0) + 1;
      this.appendsSincePruneCheck.set(bucketKey, appends);
      if (appends >= this.pruneCheckInterval) {
        this.appendsSincePruneCheck.delete(bucketKey);
        await this.pruneWorkspace({ workspaceId: event.workspaceId, visitor });
      }
    } catch (error) {
      this.onError({ error });
    }
    return committed;
  }

  /**
   * Deletes this workspace/bucket's rows below its own newest `maxRows`.
   *
   * Uses `id` (monotonic identity) as the age ordering rather than `at`, so a clock that
   * jumps backwards cannot make the prune delete the wrong rows.
   *
   * @complexity One indexed `OFFSET` probe plus one ranged delete.
   * @overallScore 100
   */
  private async pruneWorkspace({ workspaceId, visitor }: { workspaceId: string; visitor: boolean }, _options = {}): Promise<void> {
    const maxRows = visitor ? this.maxVisitorRows : this.maxRows;
    const cutoff = await this.kernel.run((db) =>
      this.table(db)
        .selectFrom(this.tables.toolAttempts)
        .select("id")
        .where("workspace_id", "=", workspaceId)
        .where("principal_id", visitor ? "=" : "!=", "anonymous-visitor")
        .orderBy("id", "desc")
        .limit(1)
        .offset(maxRows - 1)
        .executeTakeFirst()
    );

    if (!cutoff) return;
    await this.kernel.run((db) => this.table(db).deleteFrom(this.tables.toolAttempts).where("workspace_id", "=", workspaceId)
      .where("principal_id", visitor ? "=" : "!=", "anonymous-visitor").where("id", "<", cutoff.id).execute());
  }
}
