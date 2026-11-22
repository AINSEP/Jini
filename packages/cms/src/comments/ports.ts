/**
 * @file Port contracts introduced by the Comments bundled plugin.
 *
 * Two ports, each passing the rule-of-two (two plausible adapters, one built now):
 *   1. `CommentRepoPort`  — in-memory (now) + SQLite-over-dataModule (now). The typed, core-owned
 *      write path mandated for plugin tables: no raw plugin write SQL, so the
 *      write chokepoint (revision + `pluginId` attribution) is preserved.
 *   2. `SpamCheckPort`    — heuristic/local (built now) + external service (plausible
 *      next). This is the brief's anti-spam seam.
 *
 * `CommentIngressPolicy` is the core-mediated public-submission boundary (NOT a rule-of-two port —
 * one policy, like the single `MediaIngressPolicy`): anonymous submission cannot ride
 * `authorize()` RBAC, so it enters here — rate-limited, spam-checked, sanitized — and is the only
 * write path a hostile visitor can reach.
 *
 * All cross-seam payloads are async + serializable, no live core objects.
 * INTERFACES + TYPES ONLY — no feature logic lives here.
 */
import type { ISODateTime, UUID } from "@jini-ai/core/primitives";
import type { DomainEvent } from "@jini-ai/core/contracts/events";
import type {
  CommentRecord,
  CommentStatus,
  CommentSubmission,
  ModerationAction,
  ModerationLogEntry,
  ModerationQueuePage,
  CommentThreadNode,
  SpamVerdict,
} from "./types.js";

/** Every read/write is workspace-scoped; all methods async. */
export interface CommentRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }, optional?: Record<string, never>): Promise<CommentRecord | null>;

  /** Public/threaded read for the widget — approved-only unless `includeStatuses` is passed. */
  listThreadForEntry(required: {
    workspaceId: UUID;
    entryId: UUID;
    includeStatuses?: readonly CommentStatus[];
  }, optional?: Record<string, never>): Promise<CommentThreadNode[]>;

  /** The moderation queue: filter by status, keyset-paginated.
   *  @throws {ToolInputError} `invalid cursor` when `cursor` names no comment in the workspace. */
  listModerationQueue(required: {
    workspaceId: UUID;
    entryId?: UUID;
    status: CommentStatus;
    limit: number;
    cursor?: string | null;
  }, optional?: Record<string, never>): Promise<ModerationQueuePage>;

  /** Count for a status (e.g. the pending badge) — derived, not a denormalized column in v1. */
  countByStatus(required: { workspaceId: UUID; entryId?: UUID; status: CommentStatus }, optional?: Record<string, never>): Promise<number>;

  /**
   * Insert a new comment through the typed chokepoint.
   *
   * `submitLog`, when present, must be durably recorded ATOMICALLY with `record` — OQ-3's
   * resolution: every ingress-created comment gets a `submit` `moderation_log` row,
   * attributed to the seeded `COMMENTS_INGRESS_SYSTEM_PRINCIPAL_ID` (`types.ts`). Mirrors
   * `ChangeSetRepoPort.insert()`'s optional third-argument co-persistence pattern:
   * a SQLite adapter wraps both inserts in one transaction; the in-memory adapter
   * pushes both synchronously. Omit `submitLog` for a comment created outside the public ingress
   * (e.g. test fixtures, a future member-authored write path with its own attribution story).
   * @example repo.create({ record }, { submitLog })
   */
  create(required: { record: CommentRecord }, optional?: { submitLog?: ModerationLogEntry }): Promise<void>;

  /** The append-only audit trail for one comment, oldest-first (admin "history" view; also how
   * OQ-3's ingress-time `submit` row is verified in tests). */
  listModerationLog(required: { workspaceId: UUID; commentId: UUID }, optional?: Record<string, never>): Promise<ModerationLogEntry[]>;

  /**
   * OCC status flip + audit-log append, executed by CORE as ONE atomic unit — the multi-table,
   * both-or-neither write the envelope exists for (comment row + `moderation_log` row).
   * Returns the updated record, or a serializable conflict (never throws a live object).
   */
  applyModeration(required: {
    workspaceId: UUID;
    id: UUID;
    expectedVersion: number;
    action: ModerationAction;
    toStatus: CommentStatus;
    actorPrincipalId: UUID;
    note: string | null;
    at: ISODateTime;
  }, optional?: Record<string, never>): Promise<
    | { ok: true; record: CommentRecord; log: ModerationLogEntry }
    | { ok: false; reason: "not-found" | "conflict"; currentVersion?: number | undefined }
  >;

  /**
   * The trash→purge ladder's hard-delete half (additive widening; `purge` was
   * a valid `ModerationAction` value with no repo method to execute it in the originally-accepted
   * interfaces). A REAL row delete, unlike `applyModeration`'s status flip — this is the one
   * irreversible act in the ladder. The `moderation_log` row is appended and RETAINED after the
   * comment row is gone (chokepoint-validated, not FK-enforced — an orphaned log
   * row is the intended, permanent audit trail of a purge, not a dangling reference to clean up).
   */
  purge(required: {
    workspaceId: UUID;
    id: UUID;
    actorPrincipalId: UUID;
    note: string | null;
    at: ISODateTime;
  }, optional?: Record<string, never>): Promise<{ ok: true; log: ModerationLogEntry } | { ok: false; reason: "not-found" }>;
}

/**
 * The anti-spam seam (rule-of-two). Async + serializable; a network-backed
 * adapter is a core-mediated capability, never a raw `fetch` from plugin code.
 */
export interface SpamCheckPort {
  /** Classify a submission. Adapters: local heuristic (now) / external service (plausible next). */
  check(submission: CommentSubmission, optional?: Record<string, never>): Promise<SpamVerdict>;

  /** Feed a moderator ham/spam correction back to the classifier; no-op locally. */
  report?(required: {
    workspaceId: UUID;
    comment: CommentRecord;
    verdict: "ham" | "spam";
  }, optional?: Record<string, never>): Promise<void>;
}

/**
 * Core-mediated public-submission boundary. The single entry point for visitor-authored comments;
 * enforces rate-limit, honeypot, size/link caps, sanitization, and spam classification before a
 * `pending`/`spam` row is written. Mirrors `MediaIngressPolicy` as one policy object.
 */
export interface CommentIngressPolicy {
  submit(submission: CommentSubmission, optional?: Record<string, never>): Promise<CommentIngressResult>;
}

export type CommentIngressResult =
  | { ok: true; comment: CommentRecord; autoClassified: CommentStatus }
  | { ok: false; reason: CommentIngressRejection };

/** Fail-closed rejection reasons (spam is stored silently, not rejected — no oracle for spammers). */
export type CommentIngressRejection =
  | "comments-disabled"
  | "entry-not-found"
  | "entry-closed"
  | "parent-not-found"
  | "max-depth-exceeded"
  | "rate-limited"
  | "body-too-large"
  | "too-many-links"
  | "honeypot-tripped"
  | "invalid";

/**
 * Typed hook points the Comments plugin DECLARES (anti-hook-soup: declared owner + signature,
 * declared upfront). Handlers are async, serializable-only, with explicit priority +
 * deterministic order + fail-closed behavior. Spam adapters attach at `beforeSubmit`.
 */
export interface CommentHookPoints {
  /** Filter: transform or veto a submission pre-persist. Returning `reject` drops it fail-closed. */
  "comments.beforeSubmit": (payload: {
    submission: CommentSubmission;
  }) => Promise<{ submission: CommentSubmission } | { reject: CommentIngressRejection }>;

  /** Action: a comment's moderation status changed (post-commit notification hook). */
  "comments.statusChanged": (payload: {
    workspaceId: UUID;
    commentId: UUID;
    fromStatus: CommentStatus | null;
    toStatus: CommentStatus;
  }) => Promise<void>;
}

/**
 * Domain events emitted to the outbox for async side effects: notify the entry
 * author, invalidate the rendered page cache, feed search/AI memory. Serializable envelopes,
 * workspace-stamped. Names are frozen strings for subscribers.
 */
export type CommentEventName =
  | "comments.submitted"
  | "comments.approved"
  | "comments.marked_spam"
  | "comments.trashed"
  | "comments.purged";

export interface CommentEventPayload {
  commentId: UUID;
  entryId: UUID;
  status: CommentStatus;
}

export type CommentDomainEvent = DomainEvent<CommentEventPayload> & { name: CommentEventName };
