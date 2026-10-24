
import type { ISODateTime, UUID } from "@jini-ai/core/primitives";
// One shared mail shape avoids consumer-local contracts drifting between single/batch delivery.


export interface OutboundEmail {
  // Transport fully rendered, serializable content, never templates, live streams or file handles.
  
  workspaceId: UUID;
  to: EmailAddress;
  from: EmailAddress;
  replyTo?: EmailAddress;
  subject: string;
  
  /** At least one of html/text must be supplied; the transport does not render missing content. */
  html?: string;
  
  /** A plain-text alternative improves accessibility and deliverability. */
  text?: string;
  
  /** Allows caller-owned List-Unsubscribe and RFC 8058 one-click headers without provider coupling. */
  headers?: Readonly<Record<string, string>>;
  
  /** Additive/optional for existing consumers; content is base64 so no live stream/path crosses the ABI. */
  attachments?: readonly EmailAttachment[];
}

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
}

export interface MailerSendOptions {
  
  /** Redelivery must reuse this identity; generating a new key defeats outbox deduplication. */
  idempotencyKey: string;
  
  /** Scope suppression and send dedup to the same delivery boundary. */
  workspaceId: UUID;
  
  /** Preserve provenance so delivery feedback can be attributed to the originating campaign/module. */
  sourceContext: { module: string; ref?: string };
  timeoutMs?: number;
  purpose?: "transactional" | "bulk" | `feature:${string}`;
  
  /** Keep interaction separate from notification readiness: a shared transactional purpose cannot
   * distinguish them. Unmapped/absent lanes resolve to notification rather than opening the
   * interactive bypass; the caller-facing facade applies that fail-closed allowlist. */
  lane?: "interactive" | "notification";

  /** Configuration facts approved by the caller, rechecked immediately before delivery. */
  mailTestApproval?: MailTestApproval;
}

/** Serializable outcomes cross the adapter ABI; live thrown objects cannot be carried as results. */
export type MailerSendResult =
  | { ok: true; providerMessageId: string; acceptedAt: ISODateTime }
  | {
      ok: false; retryable: boolean; errorCode: string; message: string;
      /** The provider may have accepted the message (timeout after submit, crash mid-send): never
       * auto-retry under a new identity; the send ledger records the outcome as `unknown`. */
      unknown?: boolean;
      /** Rate-limit hint (provider 429 or the local token bucket); absent means "caller's backoff". */
      retryAfterMs?: number;
    };

export interface MailerCapabilities {
  
  driver: string;
  
  supportsIdempotencyKey: boolean;
  
  supportsWebhookFeedback: boolean;
  
  /** A limit of one means sequential send fallback, not an optional batch method consumers branch on. */
  maxBatchSize: number;
  
  /** Required attachments must be refused when unsupported, never dropped while reporting success. */
  supportsAttachments: boolean;
}

export interface MailerFeedbackEvent {
  // Normalized feedback retains sourceContext for module filtering; global suppression consumers
  // must still observe every bounce/complaint rather than only their own campaign's events.
  workspaceId: UUID;
  providerMessageId: string;
  sourceContext: { module: string; ref?: string };
  kind: "delivered" | "bounced" | "complained";
  /** Provider event id: the inbox dedups replays on (providerId, eventId). Optional for v1 parsers. */
  eventId?: string;
  /** Lower-cased recipient address; suppression needs it, provider message ids alone cannot key it. */
  recipient?: string;
  
  hardBounce: boolean;
  occurredAt: ISODateTime;
}

/** Required delivery identity/provenance belongs in the first argument of every send. */
export type MailerDelivery = Pick<MailerSendOptions, "idempotencyKey" | "workspaceId" | "sourceContext">;
export type MailerOptional = Omit<MailerSendOptions, keyof MailerDelivery>;
export type MailerSendRequired = MailerDelivery & { message: OutboundEmail };
export type MailerBatchRequired = MailerDelivery & { messages: readonly OutboundEmail[] };

/** Persisted test-mode shape; capture availability is decided separately by the delivery wrapper. */
export type MailTestModeSetting = { mode: "off" } | { mode: "redirect"; to: string } | { mode: "capture" };

/** Preserve field order when constructing/comparing approvals: approval bytes are caller-owned. */
export interface MailTestApproval {
  providerId: string | null;
  driver: string;
  from: OutboundEmail["from"];
  mode: MailTestModeSetting["mode"];
  effectiveRecipient: string;
}
