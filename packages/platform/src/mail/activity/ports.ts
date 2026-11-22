import type { MailSuppressionScope } from "../ports.js";
import type { MailActivityOutcome, MailActivityUse } from "./vocabulary.js";

/**
 * @file The record and port types of the mail activity ledger and the suppression admin list, as
 * the activity operations consume them. Types only: a host's SQL repos implement these ports.
 */

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
