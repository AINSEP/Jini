import type { Kysely, Selectable } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type {
  DomainEvent,
  ChangeSetItemRecord,
  ChangeSetRecord,
  ChangeSetRepoPort,
  ChangeSetWithItems,
} from "@jini-ai/core/contracts/events";
import { outboxEventValues, preparedOutboxEvent, type OutboxEventPreparation } from "./outbox-repo.sql.js";
import {
  toItemRecord,
  toItemRow,
  toRecord,
  toRow,
  type ActorKindColumn,
  type ChangeSetItemsTable,
  type ChangeSetsTable,
  type OutboxEventsTable,
} from "./repo.rows.js";

/**
 * @file Phase 1 — THE `ChangeSetRepoPort` adapter: one Kysely query body for every
 * dialect (storage plan). Rule-of-two "second adapter" half;
 * Jini `@jini-ai/cms/core/commands`'s `InMemoryChangeSetRepo` is the first.
 * The host's binding is the thin class that builds it from the content db handle.
 *
 * Purpose:
 * Change-set mutation history (the audit/undo trail) previously lived only in-memory in the
 * real running server, lost on every restart — the original design's context names
 * this explicitly as unacceptable for user-visible state. This adapter closes that gap.
 *
 * Transaction-participation scope (disclosed, deliberate): `insert()` writes the change-set header,
 * its items, AND (BR-04 resolution, 2026-07-16 swarm debate — full record:
 * `ADS-memory/reports/swarm-consensus/runs/20260716T-br04-outbox-seam-consensus-report.md`)
 * its optional outbox event, as ONE atomic kernel transaction — none of the three rows can ever
 * partially land. This does NOT extend to wrapping the *domain* mutation's own write in the same
 * transaction as this repo's insert — `core/commands/command.ts`'s `executeCommand()` keeps its
 * existing capture-then-compensating-rollback design unchanged for the domain write (Phase
 * 1's own instruction for this row: "migrate existing local semantics without changing route
 * contracts"). Unifying the domain write and this repo's write into one shared transaction would
 * mean threading a transaction handle through every `CommandMutation.execute()` across the whole
 * codebase — that is Phase 3 (composition-root rework) territory, not this row's job.
 *
 * Architectural role:
 * Infrastructure adapter. `core/commands` never imports this file — it depends only on
 * `ChangeSetRepoPort`; composition roots bind the concrete class.
 */

/** Host-owned table names. No schema or product table default lives in the adapter. */
export interface ChangeSetTables { changeSets: string; changeSetItems: string; outboxEvents: string }
export interface ChangeSetSqlRequired {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: ChangeSetTables;
}
/**
 * `actorKindColumn` (default off): set it only once the host schema has `change_sets.actor_kind`,
 * so a rolling host never selects or inserts a column its database does not have yet.
 */
export type ChangeSetSqlOptional = ActorKindColumn;

export class SqlChangeSetRepo implements ChangeSetRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: ChangeSetTables;
  private readonly preparation: OutboxEventPreparation;
  private readonly columns: ActorKindColumn;
  /**
   * @param optional.actorKindColumn read/write `change_sets.actor_kind` (see `ChangeSetSqlOptional`).
   * @param optional.prepareOutboxEvent host hook preparing the co-persisted event for this repo's one transaction.
   */
  constructor(
    { kernel, tables }: ChangeSetSqlRequired,
    { actorKindColumn = false, ...preparation }: ChangeSetSqlOptional & OutboxEventPreparation = {},
  ) {
    this.kernel = kernel;
    this.tables = tables;
    this.preparation = preparation;
    this.columns = { actorKindColumn };
  }

  private read(row: Selectable<ChangeSetsTable>): ChangeSetRecord {
    return toRecord(row, this.columns);
  }

  // Host-owned table names need an explicit column schema, as in the settings adapter.
  private sets(db: Kysely<unknown>) {
    return db.withTables<Record<string, ChangeSetsTable>>();
  }

  private items(db: Kysely<unknown>) {
    return db.withTables<Record<string, ChangeSetItemsTable>>();
  }

  /** Header + items + (when supplied) the outbox event land as one atomic transaction — never a
   * partial write (the "transaction participation" requirement, and the
   * resolution for the outbox event specifically; see this file's header). */
  async insert(
    { record, items }: { record: ChangeSetRecord; items: ChangeSetItemRecord[] },
    { event }: { event?: DomainEvent } = {},
  ): Promise<void> {
    // Build every row first so conflicting attribution is refused before the transaction opens.
    const header = toRow(record, this.columns);
    // The host preparation runs first so the actor check sees the envelope that is actually stored.
    const eventRow = event ? outboxEventValues(preparedOutboxEvent({ event }, this.preparation)) : undefined;
    await this.kernel.transaction(async () =>
      this.kernel.run(async (db) => {
        await this.sets(db).insertInto(this.tables.changeSets).values(header).execute();
        for (const item of items) await this.items(db).insertInto(this.tables.changeSetItems).values(toItemRow(item)).execute();
        if (eventRow) await db.withTables<Record<string, OutboxEventsTable>>().insertInto(this.tables.outboxEvents).values(eventRow).execute();
      })
    );
  }

  async findById(required: { workspaceId: string; id: string }, _optional: ChangeSetSqlOptional = {}): Promise<ChangeSetWithItems | null> {
    return this.kernel.run(async (db) => {
      const row = await this.sets(db)
        .selectFrom(this.tables.changeSets)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .limit(1)
        .executeTakeFirst();
      if (!row) return null;
      const itemRows = await this.items(db)
        .selectFrom(this.tables.changeSetItems)
        .selectAll()
        .where("change_set_id", "=", row.id)
        .orderBy("position")
        .execute();
      return { changeSet: this.read(row), items: itemRows.map(toItemRecord) };
    });
  }

  async findByIdempotencyKey(required: { workspaceId: string; idempotencyKey: string }, _optional: ChangeSetSqlOptional = {}): Promise<ChangeSetRecord | null> {
    const row = await this.kernel.run((db) =>
      this.sets(db)
        .selectFrom(this.tables.changeSets)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("idempotency_key", "=", required.idempotencyKey)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? this.read(row) : null;
  }

  async listByWorkspace(required: { workspaceId: string }, _optional: ChangeSetSqlOptional = {}): Promise<ChangeSetRecord[]> {
    const rows = await this.kernel.run((db) =>
      this.sets(db).selectFrom(this.tables.changeSets).selectAll().where("workspace_id", "=", required.workspaceId).orderBy("created_at").execute()
    );
    return rows.map((row) => this.read(row));
  }

  async save(record: ChangeSetRecord): Promise<void> {
    await this.kernel.run((db) =>
      this.sets(db)
        .updateTable(this.tables.changeSets)
        .set({ status: record.status, applied_at: record.appliedAt ?? null, reverted_at: record.revertedAt ?? null })
        .where("workspace_id", "=", record.workspaceId)
        .where("id", "=", record.id)
        .execute()
    );
  }
}
