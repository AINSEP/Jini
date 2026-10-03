
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

export interface MailSuppressionRepoPort {
  // Keep the do-not-send ledger in an always-present write path. A module's status is only a
  // projection: disabling/re-enabling that module must not erase a complaint and permit re-mailing.
  isSuppressed(required: {
    workspaceId: UUID;
    normalizedAddress: string;
    scope: "global" | { module: string };
  }): Promise<boolean>;
  suppress(required: {
    workspaceId: UUID;
    normalizedAddress: string;
    scope: "global" | { module: string };
    reason: "bounced" | "complained" | "manual";
  }): Promise<void>;
}

export interface MailSendDedupRepoPort {
  // Providers without idempotency keys (SMTP) need a ledger before dispatch so outbox redelivery
  // cannot double-send. This port is declared only; the SMTP adapter does not consult it itself.
  wasSent(required: { workspaceId: UUID; idempotencyKey: string }): Promise<boolean>;
  markSent(required: { workspaceId: UUID; idempotencyKey: string }): Promise<void>;
}

export interface DeliveryReadinessPolicy { isReady(required: { capabilityName: string }): boolean; }
