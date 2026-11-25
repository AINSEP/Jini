import type { Kysely, Selectable } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { ISODateTime, UUID } from "@jini-ai/core/primitives";
import type { DomainEvent, OutboxPort, OutboxRecord } from "@jini-ai/core/contracts/events";
import { assertConsistentActor, type OutboxEventsTable } from "./repo.rows.js";

/**
 * @file THE `OutboxPort` adapter over `outbox_events` (Phase 1): one Kysely query body for
 * every dialect (storage plan). Rule-of-two "second adapter" half;
 * `core/events/memory-bus.ts`'s `InMemoryOutbox` is the first. The host's binding is the thin class that
 * builds it from the content db handle: its kernel, its table name and its claim lease.
 *
 * Events enqueued by `executeCommand()` (via `ChangeSetRepoPort.insert()`'s co-persisted write) and
 * by direct `OutboxPort.enqueue()` callers survive a restart. `enqueue()` is the plain single-row
 * path for callers outside `executeCommand()`.
 *
 * `claimPending()` selects and marks rows `processing` inside one kernel transaction under
 * `lockKey("outbox_events:claim")` ("claim rows atomically"): two concurrent claims can
 * never both walk away with the same row — on Postgres too, where a transaction alone would not
 * serialize the select-then-update.
 *
 * A claim is a lease (2026-09-14). The claim stores its expiry in `next_attempt_at`, and a
 * `processing` row past that expiry is claimable again, so a process that dies mid-drain no longer
 * strands its rows forever; delivery is at-least-once. `idx_outbox_events_claim` (status,
 * next_attempt_at) covers the query.
 */

/** Host-owned table name. No schema or product table default lives in the adapter. */
export interface OutboxTables { outboxEvents: string }
export interface OutboxSqlRequired {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: OutboxTables;
  /** How long a claim holds a row before another claimer may take it; the host owns the number. */
  claimLeaseMs: number;
}
export type OutboxSqlOptional = Record<string, never>;

/** Host hook returning the envelope to persist (for example with producer trace context in
 * `metadata`). It must return a new envelope rather than modify the one it is given. */
export type PrepareOutboxEvent = (required: { event: DomainEvent }, _optional?: Record<string, never>) => DomainEvent;
/** Constructor options shared by both outbox writers: the direct enqueue and the co-persisted change-set write. */
export interface OutboxEventPreparation { prepareOutboxEvent?: PrepareOutboxEvent }

function toRecord(row: Selectable<OutboxEventsTable>): OutboxRecord {
  return {
    id: row.id,
    event: JSON.parse(row.event_json) as DomainEvent,
    status: row.status as OutboxRecord["status"],
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
  };
}

/** Statuses `claimPending` may take: never claimed, or claimed under a lease that may have expired. */
const CLAIMABLE_STATUSES = ["pending", "processing"];

/**
 * Statuses an attempt's outcome may still overwrite (F9C, 2026-10-20). `delivered` and `failed` are
 * settled: a purge fails a job whose attempt may still be in flight (`form-delivery-repo.ts`
 * `scrubPurged`), and that attempt's outcome must not revive it, or the retry would send the
 * blanked answers. `pending` stays writable because a timeout records `pending` while its handler
 * keeps running, and Jini's `recordOverrun` then lets the late outcome replace that record.
 */
const UNSETTLED_STATUSES = ["pending", "processing"];

/** The `outbox_events` row for a freshly-produced event (snake_case). Shared by enqueue
 * and transactional callers so an audit event can be inserted atomically with its domain
 * writes, using the identical row shape rather than a copy or an independent enqueue.
 */
export function outboxEventValues(event: DomainEvent<object>) {
  // The actor (id and kind) rides inside the existing `event_json`, so no outbox column is added.
  assertConsistentActor(event);
  return {
    id: event.id,
    workspace_id: event.workspaceId,
    event_json: JSON.stringify(event),
    status: "pending",
    attempts: 0,
    next_attempt_at: event.occurredAt,
    created_at: event.occurredAt,
  };
}

/**
 * The envelope an outbox writer serializes, prepared inside the caller's existing write. Correlation
 * is captured here, while the producer is still running, because the asynchronous delivery cannot
 * inherit the producer's request-local state and must not depend on when this transaction commits.
 * The prepared envelope keeps the original's id, workspace and occurrence time, so the dedupe key
 * (`ON CONFLICT (id)`) and the first due time cannot move. A failing or malformed preparation
 * persists the original envelope and the write still succeeds: losing correlation is preferable to
 * losing the event or rolling back the domain write it belongs to.
 * @example const stored = preparedOutboxEvent({ event }, { prepareOutboxEvent });
 * @complexity O(1) beyond the injected hook.
 */
export function preparedOutboxEvent(required: { event: DomainEvent }, optional: OutboxEventPreparation = {}): DomainEvent {
  const { event } = required;
  if (!optional.prepareOutboxEvent) return event;
  try {
    const prepared = optional.prepareOutboxEvent({ event });
    if (typeof prepared !== "object" || prepared === null) return event;
    return { ...prepared, id: event.id, workspaceId: event.workspaceId, occurredAt: event.occurredAt };
  } catch {
    return event;
  }
}

export class SqlOutboxAdapter implements OutboxPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: OutboxTables;
  private readonly claimLeaseMs: number;
  private readonly preparation: OutboxEventPreparation;

  /**
   * @param required.kernel the database holding the outbox table.
   * @param required.tables.outboxEvents the host's outbox table name.
   * @param required.claimLeaseMs claim lease length.
   * @param optional.prepareOutboxEvent host hook preparing each envelope inside the enqueue write.
   */
  constructor({ kernel, tables, claimLeaseMs }: OutboxSqlRequired, optional: OutboxEventPreparation = {}) {
    this.kernel = kernel;
    this.tables = tables;
    this.claimLeaseMs = claimLeaseMs;
    this.preparation = optional;
  }

  /** Host-owned table name needs an explicit column schema, as in the settings adapter. */
  private table(db: Kysely<unknown>) {
    return db.withTables<Record<string, OutboxEventsTable>>();
  }

  /** A repeated `event.id` is a no-op, never a primary-key error: ids are deterministic per event
   *  (`${aggregate}-${name}-${version}`, or `${aggregate}-entry.published-at-${publishAt}` for a
   *  scheduled go-live), so the same id is the same event, and the post go-live sweep
   *  (`features/post/go-live.ts`) relies on this to announce each go-live exactly once. */
  async enqueue(event: DomainEvent): Promise<void> {
    await this.kernel.run((db) =>
      this.table(db).insertInto(this.tables.outboxEvents).values(outboxEventValues(preparedOutboxEvent({ event }, this.preparation))).onConflict((oc) => oc.column("id").doNothing()).execute()
    );
  }

  /** Selects due rows (pending, or processing under an expired claim lease) and marks them
   * `processing` under a fresh lease in one kernel transaction — the select-then-update is never
   * observable as two separate steps to a concurrent claimer. Returned records keep the due time
   * they were claimed at. */
  async claimPending({ batchSize, nowIso }: { batchSize: number; nowIso: ISODateTime }, _optional: OutboxSqlOptional = {}): Promise<OutboxRecord[]> {
    const leaseExpiresAt = new Date(Date.parse(nowIso) + this.claimLeaseMs).toISOString();
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey("outbox_events:claim");
      const eligible = await this.kernel.run((db) =>
        this.table(db)
          .selectFrom(this.tables.outboxEvents)
          .selectAll()
          .where("status", "in", CLAIMABLE_STATUSES)
          .where("next_attempt_at", "<=", nowIso)
          .orderBy("next_attempt_at", "asc")
          .limit(batchSize)
          .execute()
      );
      for (const row of eligible) {
        await this.kernel.run((db) =>
          this.table(db)
            .updateTable(this.tables.outboxEvents)
            .set({ status: "processing", attempts: row.attempts + 1, next_attempt_at: leaseExpiresAt })
            .where("id", "=", row.id)
            .execute()
        );
      }
      return eligible.map((row) => toRecord({ ...row, status: "processing", attempts: row.attempts + 1 }));
    });
  }

  /** Settles a claimed row as delivered; a row already settled (see {@link UNSETTLED_STATUSES}) is left as it is. */
  async markDelivered({ id }: { id: UUID }, _optional: OutboxSqlOptional = {}): Promise<void> {
    await this.kernel.run((db) => this.table(db).updateTable(this.tables.outboxEvents).set({ status: "delivered" }).where("id", "=", id)
      .where("status", "in", UNSETTLED_STATUSES).execute());
  }

  /**
   * Marks a claimed row failed and persists whichever `nextStatus` the caller decided (the retry-cap
   * decision lives with the worker — `contracts/core/events/outbox-worker.ts`'s header doc). A
   * single UPDATE, same shape as `markDelivered`: the caller already had every value it needed.
   * A row already settled (see {@link UNSETTLED_STATUSES}) is left as it is.
   */
  async markFailed(
    { id, error, nextAttemptAt, nextStatus }: {
      id: UUID;
      error: string;
      nextAttemptAt: ISODateTime;
      nextStatus: Extract<OutboxRecord["status"], "pending" | "failed">;
    },
    _optional: OutboxSqlOptional = {},
  ): Promise<void> {
    await this.kernel.run((db) =>
      this.table(db)
        .updateTable(this.tables.outboxEvents)
        .set({ status: nextStatus, last_error: error, next_attempt_at: nextAttemptAt })
        .where("id", "=", id)
        .where("status", "in", UNSETTLED_STATUSES)
        .execute()
    );
  }
}
