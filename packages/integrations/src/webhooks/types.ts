/** Workspace-scoped subscription/delivery records and serializable wire envelopes. */
import type { UUID, ISODateTime, JsonObject } from "@jini-ai/core/primitives";

/** Topic names share the domain-event catalog ({entity}.{action}); an entity's trailing .*
 * subscribes to all its actions, while all-topic * requires the host's owner authorization. */
export type WebhookTopic = string;

// Stable identity for an integration-owned row; the host supplies the concrete ID scheme.
export type IntegrationId = UUID;

/** Monotonic subscription signing generation; rotation increments it and honors both versions
 * during overlap. Signing material is derived from root key, subscription ID and generation,
 * never stored as plaintext on the subscription. */
export type SecretVersion = number;

export type WebhookSubscriptionStatus = "active" | "paused" | "disabled";

/** Storage must isolate rows by (workspaceId, id); API-key ownership is a principal reference,
 * not a second API-key definition. Store only signing generations, not their derived secrets. */
export interface WebhookSubscriptionRecord {
  id: IntegrationId;
  workspaceId: UUID;
  // Host authorization must bound a delivery's reach by this owner, including an API-key owner.
  ownerPrincipalId: UUID;
  label: string;
  // An absolute HTTPS target; the injected outbound HTTP adapter must apply egress policy on send.
  targetUrl: string;
  // Empty topics match nothing; catalog validation and all-topic owner authorization stay host-owned.
  topics: readonly WebhookTopic[];
  secretVersion: SecretVersion;
  // Honor the prior generation during rotation overlap so receivers can migrate without loss.
  previousSecretVersion: SecretVersion | null;
  status: WebhookSubscriptionStatus;
  // Stamp originating actor/plugin attribution at the host's mutation chokepoint.
  createdByPrincipalId: UUID;
  createdByPluginId: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  // Retain the disabled row and timestamp for durable audit lineage.
  disabledAt: ISODateTime | null;
}

/** pending -> delivering -> delivered | failed; retryable failures become eligible again after
 * backoff, then dead after exhaustion. canceled is available to subscription-removal adapters. */
export type WebhookDeliveryStatus =
  | "pending"
  | "delivering"
  | "delivered"
  | "failed"
  | "dead"
  | "canceled";

/**
 * One event/subscription pair owns its own attempt group. Fan-out endpoints retry independently,
 * so their HTTP retry state must not share the source event's outbox row. This high-churn machine
 * state is operational bookkeeping, rather than a content revision for every retry.
 */
export interface WebhookDeliveryRecord {
  id: IntegrationId;
  workspaceId: UUID;
  subscriptionId: IntegrationId;
  eventId: UUID;
  topic: WebhookTopic;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: ISODateTime;
  // Null before any attempt or on transport failure; no HTTP response status exists then.
  lastResponseStatus: number | null;
  lastError: string | null;
  // Signing-generation attribution supports delivery audits and receiver diagnostics.
  signedWithVersion: SecretVersion | null;
  createdAt: ISODateTime;
  deliveredAt: ISODateTime | null;
  deadAt: ISODateTime | null;
}

/** Serializable projection of the source event, never a live core object; a stable wire
 * contract lets async redaction hooks transform data without leaking internal event objects. */
export interface WebhookEventEnvelope {
  // Stable across this event/subscription attempt group; the host echoes it in a delivery header.
  deliveryId: IntegrationId;
  // Source event identity supports receiver deduplication under at-least-once delivery.
  eventId: UUID;
  topic: WebhookTopic;
  workspaceId: UUID;
  occurredAt: ISODateTime;
  data: JsonObject;
}

export interface WebhookSignature {
  timestamp: number;
  signatures: readonly string[];
}

/** Outbound credentials must be recoverable for sending, unlike derived webhook signing keys.
 * Persist them sealed under a root key and open only through the sealer, never as portable plaintext. */
export interface IntegrationSecretRecord {
  id: IntegrationId;
  workspaceId: UUID;
  ownerPrincipalId: UUID;
  // The logical credential name is public metadata; only sealed contains its recoverable value.
  name: string;
  sealed: SealedSecret;
  createdByPrincipalId: UUID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** keyId identifies the wrapping-key generation so export adapters can rewrap or strip a secret
 * explicitly instead of silently transporting it with ordinary content. Ciphertext/nonce are
 * base64 AEAD data; alg identifies the authenticated cipher. */
export interface SealedSecret {
  keyId: string;
  ciphertext: string;
  nonce: string;
  alg: string;
}

/** Async filters operate only on serializable envelope data before signing. They can redact,
 * replace or veto; lower priority runs first rather than relying on registration order. */
export interface WebhookBeforeDispatchHook {
  readonly priority: number;
  handle(input: {
    readonly subscription: WebhookSubscriptionRecord;
    readonly envelope: WebhookEventEnvelope;
  }): Promise<WebhookBeforeDispatchResult>;
}

/** send=false vetoes this attempt; a missing replacement passes the envelope through unchanged. */
export interface WebhookBeforeDispatchResult {
  readonly send: boolean;
  readonly envelope?: WebhookEventEnvelope;
}
