
import type { UUID } from "@jini-ai/core/primitives";
import type {
  MailerCapabilities,
  MailerSendOptions,
  MailerSendResult,
  OutboundEmail, MailerSendRequired, MailerBatchRequired, MailerOptional,
} from "./types.js";

export type { MailerCapabilities, MailerSendOptions, MailerSendResult, OutboundEmail } from "./types.js";

export interface MailerPort {
  // sendBatch is mandatory so consumers do not branch on method presence; single-send providers
  // implement a loop. Policy facades should refuse suppressed recipients and unsupported attachments
  // before dispatch. These interfaces alone do not enforce either policy in every concrete adapter.
  capabilities(_required: Record<string, never>): MailerCapabilities;
  send(required: MailerSendRequired, optional?: MailerOptional): Promise<MailerSendResult>;
  sendBatch(
    required: MailerBatchRequired,
    optional?: MailerOptional
  ): Promise<readonly MailerSendResult[]>;
}

export type ConsoleMailerAdapter = MailerPort; // development adapter (logs to stdout)
// Marker aliases avoid importing a consumer-owned adapter upward into this contract layer.
// Console/memory fakes do not establish that two real external-delivery providers are swappable.
export type InMemoryMailerAdapter = MailerPort; // test double (captures sends)

/** `all` blocks every send (hard bounce, manual); `bulk` blocks only bulk mail (complaints), so a
 * member who marked a newsletter as spam can still receive their own sign-in link. */
export type MailSuppressionScope = "all" | "bulk";

export interface MailSuppressionRepoPort {
  // Keep the do-not-send ledger in an always-present write path. A module's status is only a
  // projection: disabling/re-enabling that module must not erase a complaint and permit re-mailing.
  // It is keyed by address, never by provider, so it survives a provider switch.
  isSuppressed(required: {
    workspaceId: UUID;
    normalizedAddress: string;
    /** The lane being sent: `transactional` consults `all` only, `bulk` consults both scopes. */
    lane: MailDeliveryLane;
  }): Promise<boolean>;
  suppress(required: {
    workspaceId: UUID;
    normalizedAddress: string;
    scope: MailSuppressionScope;
    reason: "bounced" | "complained" | "manual";
  }): Promise<void>;
}

/** Hard delivery lanes. Distinct from `MailerSendOptions.lane` (interactive/notification readiness). */
export type MailDeliveryLane = "transactional" | "bulk";

export type MailLedgerOutcome = "reserved" | "sent" | "failed" | "unknown";

export interface MailSendLedgerPort {
  // Reserve → send → mark replaces wasSent/markSent: a check-then-send pair either double-sends
  // (two workers both see "not sent") or loses mail (crash after markSent, before the send).
  /**
   * Atomically insert (workspaceId, idempotencyKey, recipient) as `reserved`. An existing row is
   * returned as-is, except `failed`, which the port flips back to `reserved` in the same statement
   * (a definitive failure means nothing was sent, so retrying under the same identity is safe).
   * With `optional.reclaimUnknown`, an `unknown` row with the SAME payloadHash is flipped to
   * `reserved` in that same statement too: the caller that wins the flip is the only one that
   * re-sends, and a concurrent retry sees `reserved` (an unknown outcome) instead of also re-sending.
   */
  reserve(required: {
    workspaceId: UUID; idempotencyKey: string; recipient: string; payloadHash: string;
    lane: MailDeliveryLane; providerId: string;
  }, optional?: { reclaimUnknown?: boolean }): Promise<
    | { status: "reserved" }
    | { status: "existing"; outcome: Exclude<MailLedgerOutcome, "failed">; payloadHash: string; providerMessageId?: string }
  >;
  mark(required: {
    workspaceId: UUID; idempotencyKey: string; recipient: string;
    outcome: Exclude<MailLedgerOutcome, "reserved">; providerMessageId?: string; errorCode?: string;
  }): Promise<void>;
}

/** @deprecated Racy check-then-send pair; use {@link MailSendLedgerPort}. Kept for type consumers. */
export interface MailSendDedupRepoPort {
  wasSent(required: { workspaceId: UUID; idempotencyKey: string }): Promise<boolean>;
  markSent(required: { workspaceId: UUID; idempotencyKey: string }): Promise<void>;
}

/** Test/capture mode sink: messages are stored for the operator instead of leaving the process. */
export interface MailCapturePort {
  capture(required: { message: OutboundEmail; lane: MailDeliveryLane; idempotencyKey: string }): Promise<{ id: string }>;
}

export interface DeliveryReadinessPolicy { isReady(required: { capabilityName: string }): boolean; }
