import type { AuthorizeFn } from "../events.js";
import type { EmailAddress, MailerFeedbackEvent, MailSuppressionScope } from "../mail.js";

/**
 * @file The record and port types of the mail activity ledger and the suppression admin list, as
 * the activity operations consume them. Types only: a host's SQL repos implement these ports.
 *
 * Additive copy of the declarations in `@jini-ai/platform/mail` (`activity/ports.ts`,
 * `activity/vocabulary.ts`, `activity/activity.ts`, `activity/suppressions.ts`, `feedback.ts`,
 * `sender-identity.ts`). The rest of that entry's types already live in `../mail.js`.
 */

/**
 * The closed vocabularies of a mail activity ledger's derived columns: what happened to a
 * send (`outcome`) and which owner sent it (`use`). The runtime arrays the activity operation
 * validates caller input against stay with the operation; a SQL repo only needs their types.
 */
export type MailActivityOutcome = "accepted" | "delivered" | "bounced" | "complained" | "suppressed" | "deferred" | "failed" | "unknown" | "captured";
export type MailActivityUse = "sign_in" | "newsletter_confirmation" | "form_notification" | "newsletter" | "test" | "unknown";

export interface MailActivityRecord {
  cursorKey: string;
  originalRecipient?: string;
  deliveryMode?: "redirect" | "capture";
  idempotencyKey: string;
  recipient: string;
  lane: "transactional" | "bulk";
  providerId: string;
  use: MailActivityUse;
  outcome: MailActivityOutcome;
  providerMessageId: string | null;
  errorCode: string | null;
  message: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MailFeedbackRecord {
  kind: "delivered" | "bounced" | "complained";
  hardBounce: boolean;
  providerId: string;
  occurredAt: string;
  receivedAt: string;
}

/** Keyset position: rows at or before `createdAt`, skipping the `skip` already returned at exactly that time. */
export interface MailActivityPosition {
  createdAt: string;
  key: string;
}

export interface MailActivityFilter {
  outcome?: MailActivityOutcome;
  use?: MailActivityUse;
  /** Exact address, compared lowercased as the ledger stores it. */
  recipient?: string;
}

export interface MailActivityRepo {
  list(required: { workspaceId: string; limit: number }, optional?: MailActivityFilter & { before?: MailActivityPosition }): Promise<MailActivityRecord[]>;
  get(required: { workspaceId: string; idempotencyKey: string; recipient: string }): Promise<{ record: MailActivityRecord; feedback: MailFeedbackRecord[] } | null>;
}

export type MailSuppressionReason = "bounced" | "complained" | "manual";

export interface MailSuppressionEntry {
  address: string;
  scope: MailSuppressionScope;
  reason: MailSuppressionReason;
  createdAt: string;
  revision: string;
}

export interface MailSuppressionRemoval {
  id: string;
  address: string;
  scope: MailSuppressionScope;
  suppressionReason: MailSuppressionReason;
  suppressedAt: string;
  removalReason: string;
  removedBy: string;
  removedAt: string;
}

export interface MailSuppressionListFilter {
  /** Substring of the address, matched lowercased; `%` and `_` are literal. */
  search?: string;
  scope?: MailSuppressionScope;
  reason?: MailSuppressionReason;
  before?: { createdAt: string; key: string };
}

export interface MailSuppressionAdminRepo {
  list(required: { workspaceId: string; limit: number }, optional?: MailSuppressionListFilter): Promise<MailSuppressionEntry[]>;
  find(required: { workspaceId: string; address: string; scope: MailSuppressionScope }): Promise<MailSuppressionEntry | null>;
  /** Deletes the suppression and records the removal atomically; `null` when it was not suppressed. */
  remove(required: { workspaceId: string; address: string; scope: MailSuppressionScope; removalReason: string; removedBy: string; revision: string }): Promise<MailSuppressionRemoval | null>;
  /** The newest verified webhook event for a provider; only verified events are ever recorded. */
  lastFeedbackEvent(required: { workspaceId: string; providerId: string }): Promise<{ kind: "delivered" | "bounced" | "complained"; receivedAt: string } | null>;
}

/** The ids the host grants the three roles of the mail operations; the operations never spell one. */
export interface MailPermissionIds {
  /** Full recipient details of the send history, and reading the suppression list. */
  activityRead: string;
  /** The host's status permission: the masked tier of the history. */
  status: string;
  /** Removing an address from the do-not-send list (a holder must also be the owner). */
  suppressionsManage: string;
}

export interface MailActivityDeps {
  workspaceId: string;
  authorize: AuthorizeFn;
  permissions: MailPermissionIds;
  /** Absent in hermetic roots: every read refuses with {@link MailActivityUnavailableError}. */
  mailActivity?: MailActivityRepo;
}

export interface MailSuppressionDeps {
  workspaceId: string;
  authorize: AuthorizeFn;
  permissions: MailPermissionIds;
  ownerPrincipalId?: Promise<string>;
  /** Absent in hermetic roots: every call refuses with {@link MailSuppressionsUnavailableError}. */
  mailSuppressionAdmin?: MailSuppressionAdminRepo;
}

export interface MailFeedbackInboxPort {
  /**
   * Insert-if-absent on (providerId, eventId). `duplicate` means this event was already applied
   * (completed); `inserted` means it must be applied now: either new, or recorded earlier but never
   * completed (the earlier attempt failed or stopped part-way).
   */
  record(required: { providerId: string; event: MailerFeedbackEvent & { eventId: string; recipient: string } }): Promise<"inserted" | "duplicate">;
  /** Marks (providerId, eventId) applied; later `record` calls for it return `duplicate`. */
  complete(required: { providerId: string; eventId: string }): Promise<void>;
}

/** The site's saved sender, either part possibly absent. */
export interface ConfiguredMailSender {
  email?: string;
  name?: string;
}

/** Resolves the `From` for one system email. */
export interface MailSenderIdentityPort {
  /**
   * @param required.fallback The caller's placeholder sender; its `name` also fills in a missing
   *   configured display name.
   * @throws SenderIdentityNotConfiguredError when a delivering mailer is active but the site has
   *   no sender address configured (see `@jini-ai/platform/mail`'s `sender-identity.ts` header).
   */
  resolve(required: { workspaceId: string; fallback: EmailAddress }, optional?: Record<string, never>): Promise<EmailAddress>;
}
