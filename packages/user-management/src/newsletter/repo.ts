import type { Kysely } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import { decodeListCursor, pageFromOverfetch, type ListPage } from "@jini-ai/core/list-page";
import type { CampaignOutcomeCounter, NewsletterCampaignRepoPort } from "./ports.js";
import {
  type CampaignBodyReporter,
  type CampaignJoinTableViews,
  type CampaignRevisionTableViews,
  type CampaignTableViews,
  type NewsletterSqlRequired,
  type NewsletterSqlTables,
  toCampaignRecord,
  toCampaignRevision,
  toCampaignRow,
  updatableCampaignColumns,
} from "./repo.rows.js";
import type { CampaignCounters, CampaignRecord, CampaignRevision } from "./types.js";
import { DEFAULT_LIST_LIMIT } from "./repo-subscribers.js";

/**
 * @file THE newsletter repositories: one Kysely query body for every database the storage kernel
 * drives (SQLite, PGlite, Postgres), six classes over the campaign pair (migrated core schema) and
 * the five `p_newsletter__*` dataModule tables (typed locally in `repo.rows.ts`). Every table name is
 * the host's ({@link NewsletterSqlTables}); an unreadable campaign revision body goes to the
 * host-bound {@link CampaignBodyReporter} (this package never logs).
 *
 * Every statement goes through `kernel.run` and is awaited. A read-then-write takes `lockKey`
 * inside `kernel.transaction` first, so two writers cannot interleave on Postgres.
 */

/** One query with indexed latest-body and sequence projections for the opened campaign; no history scan.
 * Body ownership stays in revision state_json; live counters/status always come from the campaign row.
 * @complexity O(log revisions), one round trip and one revision snapshot per detail read.
 */
function campaignsWithEditorialState({ db, tables }: { db: Kysely<unknown>; tables: Pick<NewsletterSqlTables, "campaigns" | "campaignRevisions"> }) {
  const { campaigns, campaignRevisions } = tables;
  return db.withTables<CampaignJoinTableViews>().selectFrom(campaigns).selectAll().select(eb => eb
    .selectFrom(campaignRevisions)
    .select("state_json")
    .whereRef("campaign_id", "=", `${campaigns}.id` as const)
    .whereRef("workspace_id", "=", `${campaigns}.workspace_id` as const)
    .orderBy("seq", "desc").limit(1).as("editorial_state_json"))
    .select(eb => eb.selectFrom(campaignRevisions).select("seq")
      .whereRef("campaign_id", "=", `${campaigns}.id` as const)
      .whereRef("workspace_id", "=", `${campaigns}.workspace_id` as const)
      .orderBy("seq", "desc").limit(1).as("editorial_seq"));
}

/** The campaign repo's constructor object: the shared SQL deps plus the unreadable-body reporter. */
export interface SqlNewsletterCampaignRepoRequired extends NewsletterSqlRequired<"campaigns" | "campaignRevisions"> {
  /** Reported when a stored revision body cannot be read. Required: there is no console default here. */
  onUnreadableBody: CampaignBodyReporter;
}

export class SqlNewsletterCampaignRepo implements NewsletterCampaignRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: Pick<NewsletterSqlTables, "campaigns" | "campaignRevisions">;
  private readonly onUnreadableBody: CampaignBodyReporter;
  constructor(required: SqlNewsletterCampaignRepoRequired, _optional: Record<string, never> = {}) {
    this.kernel = required.kernel;
    this.tables = required.tables;
    this.onUnreadableBody = required.onUnreadableBody;
  }

  /** One covering-index existence lookup; never loads campaign bodies or applies list paging.
   * @complexity O(log campaigns) lookup, O(1) returned payload/space; storage failures propagate.
   */
  async hasSending({ workspaceId }: { workspaceId: string }, _options: Record<string, never> = {}): Promise<boolean> {
    const row = await this.kernel.run(db => db.withTables<CampaignTableViews>().selectFrom(this.tables.campaigns).select('workspace_id')
      .where('workspace_id', '=', workspaceId).where('status', '=', 'sending').limit(1).executeTakeFirst());
    return row !== undefined;
  }

  async findById(required: { workspaceId: string; id: string }): Promise<CampaignRecord | null> {
    const row = await this.kernel.run((db) =>
      campaignsWithEditorialState({ db, tables: this.tables })
        .where("workspace_id", "=", required.workspaceId)
        .where("id", "=", required.id)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toCampaignRecord({ row, onUnreadableBody: this.onUnreadableBody }) : null;
  }

  /** Lists a workspace's campaign envelopes in ID order with a position-based continuation.
   * @throws {ToolInputError} If the cursor is malformed.
   * @complexity O(limit) returned rows, in one indexed query; storage errors propagate.
   */
  async list(required: { workspaceId: string }, optional: { limit?: number; cursor?: string | null } = {}): Promise<ListPage<CampaignRecord>> {
    const limit = Math.min(optional.limit ?? DEFAULT_LIST_LIMIT, DEFAULT_LIST_LIMIT);
    const after = optional.cursor != null ? decodeListCursor({ cursor: optional.cursor, shape: ['string'] }) : null;
    const rows = await this.kernel.run((db) => {
      // One bounded page of envelopes per list call; bodies are loaded only by findById.
      let query = db.withTables<CampaignTableViews>().selectFrom(this.tables.campaigns).selectAll().where("workspace_id", "=", required.workspaceId);
      if (after) query = query.where("id", ">", String(after[0]));
      return query
        .orderBy("id", "asc")
        .limit(limit + 1)
        .execute();
    });
    return pageFromOverfetch({ rows: rows.map(row => toCampaignRecord({ row, onUnreadableBody: this.onUnreadableBody })), limit, positionOf: campaign => [campaign.id] });
  }

  async saveCampaignRow(campaign: CampaignRecord): Promise<void> {
    const row = toCampaignRow(campaign);
    await this.kernel.run((db) =>
      db
        .withTables<CampaignTableViews>()
        .insertInto(this.tables.campaigns)
        .values(row)
        .onConflict((oc) => oc.column("id").doUpdateSet(updatableCampaignColumns(row)))
        .execute()
    );
  }

  async appendRevision(revision: CampaignRevision): Promise<void> {
    await this.kernel.run((db) =>
      db
        .withTables<CampaignRevisionTableViews>()
        .insertInto(this.tables.campaignRevisions)
        .values({
          campaign_id: revision.campaignId,
          workspace_id: revision.workspaceId,
          state_json: JSON.stringify(revision.state),
          actor_id: revision.actorId,
          recorded_at: revision.recordedAt,
        })
        .execute()
    );
  }

  async listRevisions(required: { workspaceId: string; campaignId: string }): Promise<CampaignRevision[]> {
    const rows = await this.kernel.run((db) =>
      db
        .withTables<CampaignRevisionTableViews>()
        .selectFrom(this.tables.campaignRevisions)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("campaign_id", "=", required.campaignId)
        .orderBy("seq", "asc")
        .execute()
    );
    return rows.map(toCampaignRevision);
  }

  /** The kernel's transaction: nested calls join, other requests wait their turn. Takes the campaign write lock first. */
  async transaction<T>({ fn }: { fn: () => Promise<T> }, _options: Record<string, never> = {}): Promise<T> {
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey("newsletter:campaigns");
      return fn();
    });
  }

  /**
   * Reads the counters and writes them back one higher inside a transaction that holds the
   * campaign's lock, so two increments (on any connection) cannot both read the same old count
   * (see `ports.ts`). No JSON operator is needed: the counters are compact text parsed here.
   *
   * @complexity O(1) (primary-key read and update).
   */
  async incrementCounter(required: {
    workspaceId: string;
    id: string;
    counter: CampaignOutcomeCounter;
    updatedAt: string;
  }): Promise<void> {
    await this.kernel.transaction(async () => {
      await this.kernel.lockKey(`newsletter:campaign:${required.workspaceId}:${required.id}`);
      const current = await this.kernel.run((db) =>
        db
          .withTables<CampaignTableViews>()
          .selectFrom(this.tables.campaigns)
          .select("counters_json")
          .where("workspace_id", "=", required.workspaceId)
          .where("id", "=", required.id)
          .executeTakeFirst()
      );
      if (!current) return;
      const counters = JSON.parse(current.counters_json) as CampaignCounters;
      const bumped = { ...counters, [required.counter]: (counters[required.counter] ?? 0) + 1 };
      await this.kernel.run((db) =>
        db
          .withTables<CampaignTableViews>()
          .updateTable(this.tables.campaigns)
          .set({ counters_json: JSON.stringify(bumped), updated_at: required.updatedAt })
          .where("workspace_id", "=", required.workspaceId)
          .where("id", "=", required.id)
          .execute()
      );
    });
  }
}
