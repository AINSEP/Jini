/**
 * @file In-memory adapters for all 6 Newsletter repo ports (ADR-PIPE-011 File Map).
 *
 * One class per port, matching the host members feature's in-memory repo private rows and
 * plain array find/filter/push-or-replace methods. Each constructor copies its optional initial rows.
 * Rule-of-two adapter #1 (`repo.sqlite.ts` is #2).
 */
import { upsertRecord } from "@jini-ai/core/records";
import { decodeListCursor, pageFromArray, type ListPage } from "@jini-ai/core/list-page";
import type {
  AudienceSnapshotRow,
  CampaignRecord,
  CampaignRevision,
  ConfirmationTokenRecord,
  NewsletterListRow,
  SendRow,
  SubscriptionRow,
} from "./types.js";
import type {
  CampaignOutcomeCounter,
  NewsletterAudienceSnapshotRepoPort,
  NewsletterCampaignRepoPort,
  NewsletterConfirmationTokenRepoPort,
  NewsletterListRepoPort,
  NewsletterSendRepoPort,
  NewsletterSubscriptionRepoPort,
} from "./ports.js";

const DEFAULT_LIST_LIMIT = 100;

export class InMemoryNewsletterCampaignRepo implements NewsletterCampaignRepoPort {
  private campaigns: CampaignRecord[];
  private revisions: CampaignRevision[];

  constructor(initial: { campaigns?: CampaignRecord[]; revisions?: CampaignRevision[] } = {}) {
    this.campaigns = [...(initial.campaigns ?? [])];
    this.revisions = [...(initial.revisions ?? [])];
  }

  /** Mirror the SQL existence probe without copying campaign records or applying pagination.
   * @complexity O(campaigns) comparisons, O(1) space; no I/O.
   */
  async hasSending({ workspaceId }: { workspaceId: string }, _optional: Record<string, never> = {}): Promise<boolean> {
    return this.campaigns.some(campaign => campaign.workspaceId === workspaceId && campaign.status === 'sending');
  }

  async findById(required: { workspaceId: string; id: string }): Promise<CampaignRecord | null> {
    return (
      this.campaigns.find((c) => c.workspaceId === required.workspaceId && c.id === required.id) ?? null
    );
  }

  /** Lists campaign envelopes with the same cursor contract as the SQL adapter.
   * @throws {ToolInputError} If the cursor is malformed, including for an empty workspace.
   * @complexity O(n log n) time and O(n) space for n stored campaigns; no I/O.
   */
  async list(required: { workspaceId: string }, optional: { limit?: number; cursor?: string | null } = {}): Promise<ListPage<CampaignRecord>> {
    const limit = Math.min(optional.limit ?? DEFAULT_LIST_LIMIT, DEFAULT_LIST_LIMIT);
    if (optional.cursor != null) decodeListCursor({ cursor: optional.cursor, shape: ['string'] });
    return pageFromArray({ rows: this.campaigns.filter(c => c.workspaceId === required.workspaceId),
      limit, cursor: optional.cursor ?? null, positionOf: campaign => [campaign.id], shape: ['string'] });
  }

  async saveCampaignRow(campaign: CampaignRecord): Promise<void> {
    const idx = this.campaigns.findIndex((c) => c.workspaceId === campaign.workspaceId && c.id === campaign.id);
    // Counters are insert-only here; `incrementCounter` owns them afterwards (see `ports.ts`).
    const existing = idx >= 0 ? this.campaigns[idx] : undefined;
    if (existing) this.campaigns[idx] = { ...campaign, counters: existing.counters };
    else this.campaigns.push(campaign);
  }

  async appendRevision(revision: CampaignRevision): Promise<void> {
    this.revisions.push(revision);
  }

  async listRevisions(required: { workspaceId: string; campaignId: string }): Promise<CampaignRevision[]> {
    return this.revisions
      .filter((r) => r.workspaceId === required.workspaceId && r.campaignId === required.campaignId)
      .sort((a, b) => a.seq - b.seq);
  }

  async transaction<T>({ fn }: { fn: () => Promise<T> }, _optional: Record<string, never> = {}): Promise<T> {
    // In-process, single-threaded: mutations are already atomic — no-op, mirrors
    // `InMemorySettingsRepo.transaction`. A forced mid-transaction failure test (AC-08) therefore
    // proves the SQLite adapter's real transaction, not this one — see `repo.contract.test.ts`.
    return fn();
  }

  /**
   * Atomically adds 1 to one counter (see `ports.ts`). No `await` happens before the write, so a
   * concurrent caller cannot interleave between read and write. Replaces the stored object instead of
   * mutating it, because `findById` hands out the stored reference.
   *
   * @complexity O(campaigns.length) to locate the row.
   */
  async incrementCounter(required: { workspaceId: string; id: string; counter: CampaignOutcomeCounter; updatedAt: string }): Promise<void> {
    const idx = this.campaigns.findIndex((c) => c.workspaceId === required.workspaceId && c.id === required.id);
    const campaign = idx >= 0 ? this.campaigns[idx] : undefined;
    if (!campaign) return;
    const counters = { ...campaign.counters, [required.counter]: campaign.counters[required.counter] + 1 };
    this.campaigns[idx] = { ...campaign, counters, updatedAt: required.updatedAt };
  }
}

export class InMemoryNewsletterListRepo implements NewsletterListRepoPort {
  private rows: NewsletterListRow[];

  constructor(_required: Record<string, never> = {}, { initialRows = [] }: { initialRows?: NewsletterListRow[] } = {}) {
    this.rows = [...initialRows];
  }

  async findById(required: { workspaceId: string; id: string }): Promise<NewsletterListRow | null> {
    return this.rows.find((r) => r.workspaceId === required.workspaceId && r.id === required.id) ?? null;
  }

  async findDefault(required: { workspaceId: string }): Promise<NewsletterListRow | null> {
    return this.rows.find((r) => r.workspaceId === required.workspaceId && r.isDefault) ?? null;
  }

  async list(required: { workspaceId: string }): Promise<NewsletterListRow[]> {
    return this.rows.filter((r) => r.workspaceId === required.workspaceId);
  }

  async save(row: NewsletterListRow): Promise<void> {
    upsertRecord({ records: this.rows, record: row, identity: { workspaceId: row.workspaceId, id: row.id } });
  }
}

export class InMemoryNewsletterSubscriptionRepo implements NewsletterSubscriptionRepoPort {
  private rows: SubscriptionRow[];

  constructor(_required: Record<string, never> = {}, { initialRows = [] }: { initialRows?: SubscriptionRow[] } = {}) {
    this.rows = [...initialRows];
  }

  async findById(required: { workspaceId: string; id: string }): Promise<SubscriptionRow | null> {
    return this.rows.find((r) => r.workspaceId === required.workspaceId && r.id === required.id) ?? null;
  }

  async findBySubscriberAndList(required: {
    workspaceId: string;
    listId: string;
    subscriberId: string;
  }): Promise<SubscriptionRow | null> {
    return (
      this.rows.find(
        (r) =>
          r.workspaceId === required.workspaceId &&
          r.listId === required.listId &&
          r.subscriberId === required.subscriberId
      ) ?? null
    );
  }

  /** Lists one list's subscriptions with the SQL adapter's position-based contract.
   * @throws {ToolInputError} If the cursor is malformed, even for an empty list.
   * @complexity O(n log n) time and O(n) space for n stored subscriptions; no I/O.
   */
  async list(required: {
    workspaceId: string;
    listId: string;
  }, optional: { limit?: number; cursor?: string | null } = {}): Promise<ListPage<SubscriptionRow>> {
    const limit = Math.min(optional.limit ?? DEFAULT_LIST_LIMIT, DEFAULT_LIST_LIMIT);
    if (optional.cursor != null) decodeListCursor({ cursor: optional.cursor, shape: ['string'] });
    return pageFromArray({ rows: this.rows.filter(r => r.workspaceId === required.workspaceId && r.listId === required.listId),
      limit, cursor: optional.cursor ?? null, positionOf: row => [row.id], shape: ['string'] });
  }

  async listSubscribed(required: { workspaceId: string; listId: string }): Promise<SubscriptionRow[]> {
    return this.rows.filter(
      (r) => r.workspaceId === required.workspaceId && r.listId === required.listId && r.status === "subscribed"
    );
  }

  async save(row: SubscriptionRow): Promise<void> {
    upsertRecord({ records: this.rows, record: row, identity: { workspaceId: row.workspaceId, id: row.id } });
  }

  async remove(required: { workspaceId: string; id: string }): Promise<void> {
    this.rows = this.rows.filter((r) => !(r.workspaceId === required.workspaceId && r.id === required.id));
  }
}

export class InMemoryNewsletterAudienceSnapshotRepo implements NewsletterAudienceSnapshotRepoPort {
  private rows: AudienceSnapshotRow[];

  constructor(_required: Record<string, never> = {}, { initialRows = [] }: { initialRows?: AudienceSnapshotRow[] } = {}) {
    this.rows = [...initialRows];
  }

  async findByCampaignId(required: { workspaceId: string; campaignId: string }): Promise<AudienceSnapshotRow | null> {
    return (
      this.rows.find((r) => r.workspaceId === required.workspaceId && r.campaignId === required.campaignId) ?? null
    );
  }

  async findById(required: { workspaceId: string; id: string }): Promise<AudienceSnapshotRow | null> {
    return this.rows.find((r) => r.workspaceId === required.workspaceId && r.id === required.id) ?? null;
  }

  async save(row: AudienceSnapshotRow): Promise<void> {
    // INV-06: immutable after creation — `save` is create-only; a duplicate id is a caller bug.
    const exists = this.rows.some((r) => r.workspaceId === row.workspaceId && r.id === row.id);
    if (exists) throw new Error(`AudienceSnapshotRow ${row.id} already exists and is immutable (INV-06)`);
    this.rows.push(row);
  }
}

export class InMemoryNewsletterSendRepo implements NewsletterSendRepoPort {
  private rows: SendRow[];

  constructor(_required: Record<string, never> = {}, { initialRows = [] }: { initialRows?: SendRow[] } = {}) {
    this.rows = [...initialRows];
  }

  async findById(required: { workspaceId: string; id: string }): Promise<SendRow | null> {
    return this.rows.find((r) => r.workspaceId === required.workspaceId && r.id === required.id) ?? null;
  }

  async findByIdempotencyKey(required: { workspaceId: string; idempotencyKey: string }): Promise<SendRow | null> {
    return (
      this.rows.find(
        (r) => r.workspaceId === required.workspaceId && r.idempotencyKey === required.idempotencyKey
      ) ?? null
    );
  }

  async listByCampaign(required: {
    workspaceId: string;
    campaignId: string;
    afterId?: string;
    limit?: number;
  }): Promise<SendRow[]> {
    const limit = required.limit ?? DEFAULT_LIST_LIMIT;
    let rows = this.rows
      .filter((r) => r.workspaceId === required.workspaceId && r.campaignId === required.campaignId)
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
    const afterId = required.afterId;
    if (afterId) {
      rows = rows.filter((r) => r.id > afterId);
    }
    return rows.slice(0, limit);
  }

  async listPendingByAudienceSnapshot(required: {
    workspaceId: string;
    audienceSnapshotId: string;
    limit: number;
  }): Promise<SendRow[]> {
    return this.rows
      .filter(
        (r) =>
          r.workspaceId === required.workspaceId &&
          r.audienceSnapshotId === required.audienceSnapshotId &&
          r.status === "pending"
      )
      .slice(0, required.limit);
  }

  async countPendingByCampaign(required: { workspaceId: string; campaignId: string }): Promise<number> {
    return this.rows.filter(
      (r) => r.workspaceId === required.workspaceId && r.campaignId === required.campaignId && r.status === "pending"
    ).length;
  }

  async save(row: SendRow): Promise<void> {
    upsertRecord({ records: this.rows, record: row, identity: { workspaceId: row.workspaceId, id: row.id } });
  }

  async saveBatch({ rows }: { rows: readonly SendRow[] }, _optional: Record<string, never> = {}): Promise<void> {
    for (const row of rows) await this.save(row);
  }

  /**
   * Atomically takes the dispatch lease on one send row (2026-09-16, see `ports.ts` doc). No `await`
   * happens before the write, which is what makes this atomic in-process: a concurrent caller's own
   * turn cannot interleave between the read and the write.
   *
   * @complexity O(rows.length) to locate the row.
   */
  async claimForDispatch(required: { workspaceId: string; id: string; nowIso: string; leaseUntilIso: string }): Promise<SendRow | null> {
    const idx = this.rows.findIndex((r) => r.workspaceId === required.workspaceId && r.id === required.id);
    const row = idx >= 0 ? this.rows[idx] : undefined;
    if (!row || row.status !== "pending" || (row.nextAttemptAt !== null && row.nextAttemptAt > required.nowIso)) return null;
    const leased: SendRow = { ...row, nextAttemptAt: required.leaseUntilIso, updatedAt: required.nowIso };
    this.rows[idx] = leased;
    return leased;
  }

  /**
   * Atomically records a dispatch outcome (2026-09-16, see `ports.ts` doc). No `await` happens before
   * the write, so a concurrent caller's own turn cannot interleave between the pending check and the
   * write — the first call to run wins the row; a later concurrent call sees it already non-pending.
   *
   * @complexity O(rows.length) to locate the row.
   */
  async recordOutcome(required: {
    workspaceId: string;
    id: string;
    status: "delivered" | "failed";
    providerMessageId: string | null;
    lastError: string | null;
    updatedAt: string;
  }): Promise<SendRow | null> {
    const idx = this.rows.findIndex((r) => r.workspaceId === required.workspaceId && r.id === required.id);
    const row = idx >= 0 ? this.rows[idx] : undefined;
    if (!row || row.status !== "pending") return null;
    const recorded: SendRow = {
      ...row,
      status: required.status,
      attempts: row.attempts + 1,
      providerMessageId: required.providerMessageId ?? row.providerMessageId,
      lastError: required.lastError,
      nextAttemptAt: null,
      updatedAt: required.updatedAt,
    };
    this.rows[idx] = recorded;
    return recorded;
  }
}

export class InMemoryNewsletterConfirmationTokenRepo implements NewsletterConfirmationTokenRepoPort {
  private rows: ConfirmationTokenRecord[];

  constructor(_required: Record<string, never> = {}, { initialRows = [] }: { initialRows?: ConfirmationTokenRecord[] } = {}) {
    this.rows = [...initialRows];
  }

  async findById(required: { workspaceId: string; id: string }): Promise<ConfirmationTokenRecord | null> {
    return this.rows.find((r) => r.workspaceId === required.workspaceId && r.id === required.id) ?? null;
  }

  async findUnconsumedBySubscription(required: {
    workspaceId: string;
    subscriptionId: string;
  }): Promise<ConfirmationTokenRecord[]> {
    return this.rows.filter(
      (r) =>
        r.workspaceId === required.workspaceId &&
        r.subscriptionId === required.subscriptionId &&
        r.consumedAt === null
    );
  }

  async findByTokenHash(required: { workspaceId: string; tokenHash: string }): Promise<ConfirmationTokenRecord | null> {
    return (
      this.rows.find((r) => r.workspaceId === required.workspaceId && r.tokenHash === required.tokenHash) ?? null
    );
  }

  async save(row: ConfirmationTokenRecord): Promise<void> {
    upsertRecord({ records: this.rows, record: row, identity: { workspaceId: row.workspaceId, id: row.id } });
  }
}
