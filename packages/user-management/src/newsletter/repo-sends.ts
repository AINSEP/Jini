import type { Kysely } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { NewsletterAudienceSnapshotRepoPort, NewsletterSendRepoPort } from "./ports.js";
import {
  type AudienceSnapshotTableViews,
  type NewsletterSqlRequired,
  type NewsletterSqlTables,
  type SendTableViews,
  toAudienceSnapshotRecord,
  toAudienceSnapshotRow,
  toSendRecord,
  toSendRow,
  updatableSendColumns,
} from "./repo.rows.js";
import type { AudienceSnapshotRow, SendRow } from "./types.js";

/**
 * @file The audience-snapshot and send repositories over the host's `p_newsletter__*` dataModule
 * tables: one Kysely query body for every dialect, the table names passed in by the host
 * ({@link NewsletterSqlTables}).
 */
import { DEFAULT_LIST_LIMIT } from "./repo-subscribers.js";

export class SqlNewsletterAudienceSnapshotRepo implements NewsletterAudienceSnapshotRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: Pick<NewsletterSqlTables, "audienceSnapshots">;
  constructor(required: NewsletterSqlRequired<"audienceSnapshots">, _optional: Record<string, never> = {}) {
    this.kernel = required.kernel;
    this.tables = required.tables;
  }

  async findByCampaignId(required: { workspaceId: string; campaignId: string }): Promise<AudienceSnapshotRow | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<AudienceSnapshotTableViews>()
        .selectFrom(this.tables.audienceSnapshots)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("campaign_id", "=", required.campaignId)
        .orderBy("id", "asc")
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toAudienceSnapshotRecord(row) : null;
  }

  async findById(required: { workspaceId: string; id: string }): Promise<AudienceSnapshotRow | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<AudienceSnapshotTableViews>()
        .selectFrom(this.tables.audienceSnapshots)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .executeTakeFirst()
    );
    return row ? toAudienceSnapshotRecord(row) : null;
  }

  /** INV-06: immutable after creation. A plain INSERT (no upsert), so a primary-key collision surfaces as a thrown error. */
  async save(row: AudienceSnapshotRow): Promise<void> {
    await this.kernel.run((db) =>
      db.withTables<AudienceSnapshotTableViews>().insertInto(this.tables.audienceSnapshots).values(toAudienceSnapshotRow(row)).execute()
    );
  }
}

export class SqlNewsletterSendRepo implements NewsletterSendRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: Pick<NewsletterSqlTables, "sends">;
  constructor(required: NewsletterSqlRequired<"sends">, _optional: Record<string, never> = {}) {
    this.kernel = required.kernel;
    this.tables = required.tables;
  }

  async findById(required: { workspaceId: string; id: string }): Promise<SendRow | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<SendTableViews>()
        .selectFrom(this.tables.sends)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .executeTakeFirst()
    );
    return row ? toSendRecord(row) : null;
  }

  async findByIdempotencyKey(required: { workspaceId: string; idempotencyKey: string }): Promise<SendRow | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<SendTableViews>()
        .selectFrom(this.tables.sends)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("idempotency_key", "=", required.idempotencyKey)
        .orderBy("id", "asc")
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toSendRecord(row) : null;
  }

  async listByCampaign(required: {
    workspaceId: string;
    campaignId: string;
    afterId?: string;
    limit?: number;
  }): Promise<SendRow[]> {
    const rows = await this.kernel.run((db) => {
      let query = db
        .withTables<SendTableViews>()
        .selectFrom(this.tables.sends)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("campaign_id", "=", required.campaignId);
      if (required.afterId) query = query.where("id", ">", required.afterId);
      return query
        .orderBy("id", "asc")
        .limit(required.limit ?? DEFAULT_LIST_LIMIT)
        .execute();
    });
    return rows.map(toSendRecord);
  }

  async listPendingByAudienceSnapshot(required: {
    workspaceId: string;
    audienceSnapshotId: string;
    limit: number;
  }): Promise<SendRow[]> {
    const rows = await this.kernel.run((db) =>
      db
        .withTables<SendTableViews>()
        .selectFrom(this.tables.sends)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("audience_snapshot_id", "=", required.audienceSnapshotId)
        .where("status", "=", "pending")
        .orderBy("id", "asc")
        .limit(required.limit)
        .execute()
    );
    return rows.map(toSendRecord);
  }

  async countPendingByCampaign(required: { workspaceId: string; campaignId: string }): Promise<number> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<SendTableViews>()
        .selectFrom(this.tables.sends)
        .select((eb) => eb.fn.countAll().as("n"))
        .where("workspace_id", "=", required.workspaceId)
        .where("campaign_id", "=", required.campaignId)
        .where("status", "=", "pending")
        .executeTakeFirst()
    );
    // Postgres returns a COUNT as a bigint string.
    return Number(row?.n ?? 0);
  }

  async save(row: SendRow): Promise<void> {
    const values = toSendRow(row);
    await this.kernel.run((db) =>
      db
        .withTables<SendTableViews>()
        .insertInto(this.tables.sends)
        .values(values)
        .onConflict((oc) => oc.column("id").doUpdateSet(updatableSendColumns(values)))
        .execute()
    );
  }

  /** All rows land or none do: the batch is one transaction. */
  async saveBatch({ rows }: { rows: readonly SendRow[] }, _optional: Record<string, never> = {}): Promise<void> {
    if (rows.length === 0) return;
    await this.kernel.transaction(async () => {
      for (const row of rows) await this.save(row);
    });
  }

  /**
   * Atomically takes the dispatch lease on one send row (2026-09-16, see `ports.ts` doc). One
   * conditional `UPDATE ... RETURNING` makes the claim atomic across processes and hands back the
   * row it claimed, so nothing can change it between the write and the read.
   *
   * @complexity O(1) (indexed lookup by primary key).
   */
  async claimForDispatch(required: { workspaceId: string; id: string; nowIso: string; leaseUntilIso: string }): Promise<SendRow | null> {
    const claimed = await this.kernel.run((db) =>
      db
        .withTables<SendTableViews>()
        .updateTable(this.tables.sends)
        .set({ next_attempt_at: required.leaseUntilIso, updated_at: required.nowIso })
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .where("status", "=", "pending")
        .where((eb) => eb.or([eb("next_attempt_at", "is", null), eb("next_attempt_at", "<=", required.nowIso)]))
        .returningAll()
        .executeTakeFirst()
    );
    return claimed ? toSendRecord(claimed) : null;
  }

  /**
   * Atomically records a dispatch outcome (2026-09-16, see `ports.ts` doc). One conditional
   * `UPDATE ... WHERE status = 'pending' RETURNING`: a concurrent second call matches zero rows and
   * returns `null` without touching the row. A null `providerMessageId` keeps the stored one.
   *
   * @complexity O(1) (indexed lookup by primary key).
   */
  async recordOutcome(required: {
    workspaceId: string;
    id: string;
    status: "delivered" | "failed";
    providerMessageId: string | null;
    lastError: string | null;
    updatedAt: string;
  }): Promise<SendRow | null> {
    const recorded = await this.kernel.run((db) =>
      db
        .withTables<SendTableViews>()
        .updateTable(this.tables.sends)
        .set((eb) => ({
          status: required.status,
          attempts: eb("attempts", "+", 1),
          ...(required.providerMessageId === null ? {} : { provider_message_id: required.providerMessageId }),
          last_error: required.lastError,
          next_attempt_at: null,
          updated_at: required.updatedAt,
        }))
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .where("status", "=", "pending")
        .returningAll()
        .executeTakeFirst()
    );
    return recorded ? toSendRecord(recorded) : null;
  }
}
