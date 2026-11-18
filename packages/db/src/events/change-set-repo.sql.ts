import type { Kysely } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type {
  DomainEvent,
  ChangeSetItemRecord,
  ChangeSetRecord,
  ChangeSetRepoPort,
  ChangeSetWithItems,
} from "@jini-ai/core/contracts/events";
import { outboxEventValues } from "./outbox-repo.sql.js";
import {
  toItemRecord,
  toItemRow,
  toRecord,
  toRow,
  type ChangeSetItemsTable,
  type ChangeSetsTable,
  type OutboxEventsTable,
} from "./repo.rows.js";

/**
 * @file SPEC-023 / ADR-046 Phase 1 — THE `ChangeSetRepoPort` adapter: one Kysely query body for every
 * dialect (storage plan §4, ADR-066). ADR-006 rule-of-two "second adapter" half;
 * Jini `@jini-ai/cms/core/commands`'s `InMemoryChangeSetRepo` is the first.
 * The host's binding is the thin class that builds it from the content db handle.
 *
 * Purpose:
 * Change-set mutation history (ADR-008's audit/undo trail) previously lived only in-memory in the
 * real running server, lost on every restart — ADR-046's Context section names
 * this explicitly as unacceptable for user-visible state. This adapter closes that gap.
 *
 * Transaction-participation scope (disclosed, deliberate): `insert()` writes the change-set header,
 * its items, AND (BR-04 resolution, 2026-07-16 swarm debate — full record:
 * `ADS-memory/reports/swarm-consensus/runs/20260716T-br04-outbox-seam-consensus-report.md`)
 * its optional outbox event, as ONE atomic kernel transaction — none of the three rows can ever
 * partially land. This does NOT extend to wrapping the *domain* mutation's own write in the same
 * transaction as this repo's insert — `core/commands/command.ts`'s `executeCommand()` keeps its
 * existing capture-then-compensating-rollback design unchanged for the domain write (ADR-046 Phase
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
export type ChangeSetSqlOptional = Record<string, never>;

export class SqlChangeSetRepo implements ChangeSetRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: ChangeSetTables;
  constructor({ kernel, tables }: ChangeSetSqlRequired, _optional: ChangeSetSqlOptional = {}) {
    this.kernel = kernel;
    this.tables = tables;
  }

  // Host-owned table names need an explicit column schema, as in the settings adapter.
  private sets(db: Kysely<unknown>) {
    return db.withTables<Record<string, ChangeSetsTable>>();
  }

  private items(db: Kysely<unknown>) {
    return db.withTables<Record<string, ChangeSetItemsTable>>();
  }

  /** Header + items + (when supplied) the outbox event land as one atomic transaction — never a
   * partial write (ADR-046 Phase 1's "transaction participation" requirement, and BR-04's
   * resolution for the outbox event specifically; see this file's header). */
  async insert(
    { record, items }: { record: ChangeSetRecord; items: ChangeSetItemRecord[] },
    { event }: { event?: DomainEvent } = {},
  ): Promise<void> {
    await this.kernel.transaction(async () =>
      this.kernel.run(async (db) => {
        await this.sets(db).insertInto(this.tables.changeSets).values(toRow(record)).execute();
        for (const item of items) await this.items(db).insertInto(this.tables.changeSetItems).values(toItemRow(item)).execute();
        if (event) await db.withTables<Record<string, OutboxEventsTable>>().insertInto(this.tables.outboxEvents).values(outboxEventValues(event)).execute();
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
      return { changeSet: toRecord(row), items: itemRows.map(toItemRecord) };
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
    return row ? toRecord(row) : null;
  }

  async listByWorkspace(required: { workspaceId: string }, _optional: ChangeSetSqlOptional = {}): Promise<ChangeSetRecord[]> {
    const rows = await this.kernel.run((db) =>
      this.sets(db).selectFrom(this.tables.changeSets).selectAll().where("workspace_id", "=", required.workspaceId).orderBy("created_at").execute()
    );
    return rows.map(toRecord);
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
