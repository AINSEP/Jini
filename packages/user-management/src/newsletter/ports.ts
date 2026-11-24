/**
 * @file Newsletter — port contracts (INTERFACES & TYPES ONLY; no adapter logic).
 *
 * Draft ADR-034 (PROPOSED). One seam is declared here; `MailerPort` is imported, not declared:
 *
 *  1. `MailerPort` — imported from the shared `../mail` core primitive (ADR-037). Round-3 audit
 *     fold (TM-admin-sweep-001): the shape previously declared locally here predated ADR-037 and
 *     didn't match its frozen contract (`originPluginId` vs `sourceContext`, optional `sendBatch`
 *     vs the mandatory façade). Newsletter now imports the one shape every mail consumer shares.
 *
 *     IMPORTANT (ADR-024 §3): the Newsletter *plugin* never holds a live `MailerPort` object. The
 *     plugin submits send intent as data (through the outbox/command spine); **core** injects and
 *     calls the `MailerPort`. The port lives in core's DI graph, not across the plugin ABI.
 *
 *  2. `SubscriberDirectoryPort` — the **Members seam** (Members is designed in parallel; NOT here).
 *     Newsletter depends on this read seam to resolve a subscriber's address/consent at audience
 *     materialization; Members owns the implementation. Round-3 audit fold: this is a
 *     **single-evaluator typed dependency**, not an ADR-006 port — an in-memory test double does
 *     not count as Members' "second adapter" (ADR-037 amendment 6 precedent). Promote to a real
 *     port only if a second genuine directory adapter (e.g. an external ESP sync) is ever built.
 *
 * Grounding imports (typecheck against real code): `../core/ports`, `../mail`.
 */
import type { UUID } from "@jini-ai/core/primitives";
import type { ListPage } from "@jini-ai/core/list-page";
import type {
  AudienceSnapshotRow,
  CampaignRecord,
  CampaignRevision,
  ConfirmationTokenRecord,
  NewsletterListRow,
  SendRow,
  SubscriptionRow,
} from "./types.js";

export type { PositionalMailer as MailerPort } from "@jini-ai/core/contracts/mail";

/* ------------------------------------------------------------------------------------------------
 * SubscriberDirectoryPort — the Members seam (READ-only; Members owns the write side)
 * ------------------------------------------------------------------------------------------------ */

/** The subset of a Members-owned subscriber that Newsletter needs at send time. */
export interface SubscriberContact {
  subscriberId: UUID;
  workspaceId: UUID;
  email: string;
  /** Members-owned consent/lifecycle flag; a `false` here suppresses regardless of subscription. */
  emailDeliverable: boolean;
}

/**
 * Read port into Members. Newsletter NEVER writes subscriber identity/consent through this — it
 * only resolves contact info to freeze into the audience snapshot. Composite `(workspaceId, id)`
 * scoping (ADR-021 §4) is honoured by every method taking `workspaceId` explicitly (ADR-007).
 *
 * Single-evaluator typed dependency, NOT an ADR-006 port (Round-3 audit fold; round-2 re-audit
 * finding Codex-R2-001 caught this same misrepresentation surviving here after the ADR text was
 * fixed). `InMemorySubscriberDirectory` is a test double / interim implementation only — it does
 * NOT count as a second production adapter (ADR-037 amendment 6 precedent). Promote to a real
 * ADR-006 port only if a second genuine directory adapter (e.g. an external ESP sync) is built;
 * until then this stays `MembersSubscriberDirectory` (interim double) — see ADR-034 OPEN-1.
 */
export interface SubscriberDirectoryPort {
  getContact(required: {
    workspaceId: UUID;
    subscriberId: UUID;
  }): Promise<SubscriberContact | null>;
  getContacts(required: {
    workspaceId: UUID;
    subscriberIds: readonly UUID[];
  }): Promise<readonly SubscriberContact[]>;
}

/* ------------------------------------------------------------------------------------------------
 * Send-pipeline job payload (ADR-009 outbox spine) — serializable job the worker claims
 * ------------------------------------------------------------------------------------------------ */

/** The unit of work the outbox worker claims to drive one batch of a campaign's fan-out. */
export interface SendBatchJob {
  workspaceId: UUID;
  campaignId: UUID;
  audienceSnapshotId: UUID;
  /** The slice of `p_newsletter__sends` rows (by id) this job attempts. */
  sendIds: readonly UUID[];
}

/* ------------------------------------------------------------------------------------------------
 * Repo ports (ADR-PIPE-011 Module/Service Boundaries C-001..C-006) — six single-evaluator ports,
 * one per table family, matching the `members` multi-port convention (no merged mega-port).
 * ------------------------------------------------------------------------------------------------ */

/** The two delivery outcomes `incrementCounter` may bump (explicit union — `CampaignCounters extends JsonObject`, so `keyof` would widen to `string`). */
export type CampaignOutcomeCounter = "delivered" | "failed";

/** C-001 — `newsletter_campaigns`/`newsletter_campaign_revisions` (the bespoke Drizzle pair). */
export interface NewsletterCampaignRepoPort {
  /** Bounded idle-safety probe; missing capability means busy, never a paginated-list fallback. */
  hasSending?(required: { workspaceId: UUID }, optional?: {}): Promise<boolean>;
  findById(required: { workspaceId: UUID; id: UUID }): Promise<CampaignRecord | null>;
  /** Returns campaigns in ID order; pass nextCursor to continue after the last returned ID. */
  list(required: { workspaceId: UUID }, optional?: { limit?: number; cursor?: string | null }): Promise<ListPage<CampaignRecord>>;
  /**
   * Package-private by convention (Code Review file-boundary check) — called from
   * `campaign-write-service.ts` (inside a `transaction()` callback together with `appendRevision`,
   * INV-01: never one without the other in the same tx) and from `send-pipeline.ts`'s status writers
   * (`authorizeSend`, `freezeAudience`, `completeIfDrained`, `transitionAndSave`). Split into two
   * methods (rather than one combined `save`) so a test can force a failure between the two writes at
   * the real SQLite adapter (AC-08) — mirrors `SettingsRepoPort`'s `saveXValue`/`appendRevision` split.
   *
   * Counters are written on INSERT only (2026-09-16): updating an existing campaign keeps its stored
   * `counters`, whatever the passed record holds, so a status write built from a stale read cannot
   * erase a concurrent `incrementCounter`.
   */
  saveCampaignRow(campaign: CampaignRecord): Promise<void>;
  /** Package-private by convention — call only from `campaign-write-service.ts`. */
  appendRevision(revision: CampaignRevision): Promise<void>;
  listRevisions(required: { workspaceId: UUID; campaignId: UUID }): Promise<CampaignRevision[]>;
  /** Repo-port-level atomic boundary — mirrors `SettingsRepoPort.transaction`. */
  transaction<T>(required: { fn: () => Promise<T> }, optional?: {}): Promise<T>;
  /**
   * Atomically adds 1 to one delivery counter of one campaign and sets its `updatedAt` (2026-09-16). The only writer of
   * `counters` once the row exists; touches no other field (status, version and editorial fields stay as stored). A missing
   * campaign is a no-op. Writes no revision: counters are operational telemetry, narrowing INV-01 the way `redirect_hits`
   * and ADR-027's `asset_renditions` narrow ADR-022 INV-3.
   */
  incrementCounter(required: { workspaceId: UUID; id: UUID; counter: CampaignOutcomeCounter; updatedAt: string }): Promise<void>;
}

/** C-002 — `p_newsletter__lists`. */
export interface NewsletterListRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<NewsletterListRow | null>;
  findDefault(required: { workspaceId: UUID }): Promise<NewsletterListRow | null>;
  list(required: { workspaceId: UUID }): Promise<NewsletterListRow[]>;
  save(row: NewsletterListRow): Promise<void>;
}

/** C-003 — `p_newsletter__subscriptions`. */
export interface NewsletterSubscriptionRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<SubscriptionRow | null>;
  findBySubscriberAndList(required: {
    workspaceId: UUID;
    listId: UUID;
    subscriberId: UUID;
  }): Promise<SubscriptionRow | null>;
  /** Returns subscriptions in ID order, with a cursor when another page exists. */
  list(required: { workspaceId: UUID; listId: UUID }, optional?: { limit?: number; cursor?: string | null }): Promise<ListPage<SubscriptionRow>>;
  listSubscribed(required: { workspaceId: UUID; listId: UUID }): Promise<SubscriptionRow[]>;
  save(row: SubscriptionRow): Promise<void>;
  remove(required: { workspaceId: UUID; id: UUID }): Promise<void>;
}

/** C-004 — `p_newsletter__audience_snapshots`. Immutable after creation (INV-06). */
export interface NewsletterAudienceSnapshotRepoPort {
  findByCampaignId(required: { workspaceId: UUID; campaignId: UUID }): Promise<AudienceSnapshotRow | null>;
  findById(required: { workspaceId: UUID; id: UUID }): Promise<AudienceSnapshotRow | null>;
  save(row: AudienceSnapshotRow): Promise<void>;
}

/** C-005 — `p_newsletter__sends`. Source of truth for delivery counters. */
export interface NewsletterSendRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<SendRow | null>;
  findByIdempotencyKey(required: { workspaceId: UUID; idempotencyKey: string }): Promise<SendRow | null>;
  listByCampaign(required: { workspaceId: UUID; campaignId: UUID; afterId?: UUID; limit?: number }): Promise<SendRow[]>;
  listPendingByAudienceSnapshot(required: {
    workspaceId: UUID;
    audienceSnapshotId: UUID;
    limit: number;
  }): Promise<SendRow[]>;
  countPendingByCampaign(required: { workspaceId: UUID; campaignId: UUID }): Promise<number>;
  save(row: SendRow): Promise<void>;
  saveBatch(required: { rows: readonly SendRow[] }, optional?: {}): Promise<void>;
  /**
   * Atomically takes the dispatch lease on one send row (2026-09-16): succeeds only when the row is `pending` and not
   * under a live lease (`nextAttemptAt` is null or `<= nowIso`), storing `leaseUntilIso` as its `nextAttemptAt`. A leased
   * row stays `pending` (so `countPendingByCampaign` still counts it). Returns the leased row, or `null` when the row is
   * missing, no longer `pending`, or leased by another live dispatch. Timestamps are `toISOString()` strings and compare lexically.
   */
  claimForDispatch(required: { workspaceId: UUID; id: UUID; nowIso: string; leaseUntilIso: string }): Promise<SendRow | null>;
  /**
   * Atomically records a dispatch outcome on one send row (2026-09-16): succeeds only while the row is `pending`, setting
   * `status`, `attempts + 1`, `lastError`, `providerMessageId` (kept as stored when the input is null), `nextAttemptAt`
   * null (releases the `claimForDispatch` lease) and `updatedAt`. Returns the updated row, or `null` when the row is missing
   * or no longer `pending` (another run already recorded it).
   */
  recordOutcome(required: {
    workspaceId: UUID;
    id: UUID;
    status: "delivered" | "failed";
    providerMessageId: string | null;
    lastError: string | null;
    updatedAt: string;
  }): Promise<SendRow | null>;
}

/** C-006 — `p_newsletter__confirmation_tokens`. */
export interface NewsletterConfirmationTokenRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }): Promise<ConfirmationTokenRecord | null>;
  findUnconsumedBySubscription(required: {
    workspaceId: UUID;
    subscriptionId: UUID;
  }): Promise<ConfirmationTokenRecord[]>;
  findByTokenHash(required: { workspaceId: UUID; tokenHash: string }): Promise<ConfirmationTokenRecord | null>;
  save(row: ConfirmationTokenRecord): Promise<void>;
}

/* ------------------------------------------------------------------------------------------------
 * MembersConsentCapability — the Members seam for consent grant/revoke (C-007)
 * ------------------------------------------------------------------------------------------------
 * Declared here (Newsletter's side of the seam), NOT in `src/members/*` — avoids any file collision
 * with the parallel Members dispatch (ADR-PIPE-011 File Map). Same single-evaluator-typed-dependency
 * treatment as `SubscriberDirectoryPort` above (ADR Article IV note) — NOT an ADR-006 rule-of-two
 * port. Declared, unbound-by-default (`null`) until Members ships a real implementation — the Launch
 * Readiness Gate's precondition (b) checks for a real (non-null, non-stub) binding, never a stub that
 * merely returns success (ADR-PIPE-011 Risks item 3). Newsletter code MUST NOT implement a local
 * stand-in that returns success by default.
 */
export interface MembersConsentCapability {
  /** Request consent (double opt-in kickoff) — Newsletter supplies evidence, never asserts the grant itself. */
  request(input: {
    workspaceId: UUID;
    subscriberId: UUID;
    evidence: { consentTextRef: string; source: string; confirmTokenId: UUID };
  }): Promise<{ requested: true }>;
  /** Confirm a prior request. Returns the resulting consent state — Newsletter flips local status only after `granted`. */
  confirm(input: {
    workspaceId: UUID;
    subscriberId: UUID;
    confirmTokenId: UUID;
  }): Promise<{ status: "granted" | "denied" | "expired"; consentRevisionId: string }>;
  /** Revoke consent (unsubscribe). */
  revoke(input: { workspaceId: UUID; subscriberId: UUID }): Promise<{ status: "revoked" }>;
}
