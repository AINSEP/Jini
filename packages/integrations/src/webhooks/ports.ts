/** Repository adapters own durable claims, deduplication and workspace isolation. */
import type { ISODateTime, UUID } from "@jini-ai/core/primitives";

import type {
  IntegrationId,
  IntegrationSecretRecord,
  SealedSecret,
  WebhookDeliveryRecord,
  WebhookDeliveryStatus,
  WebhookEventEnvelope,
  WebhookSubscriptionRecord,
  WebhookTopic,
} from "./types.js";

export interface RootKeyHandle {
  readonly keyId: string;
}

export interface KeyringPort {
  activeKey(): Promise<RootKeyHandle>;

  deriveSigningSecret(input: {
    workspaceId: UUID;
    subscriptionId: IntegrationId;
    version: number;
  }): Promise<Uint8Array>;

  derive(input: { workspaceId: UUID; purpose: string; info: string }): Promise<Uint8Array>;
}

export interface SecretSealerPort {
  seal(input: { plaintext: string; key: RootKeyHandle; aad: string }): Promise<SealedSecret>;
  open(input: { sealed: SealedSecret }, optional?: { aad?: string }): Promise<string>;
}

export interface WebhookSubscriptionRepoPort {
  insert(record: WebhookSubscriptionRecord): Promise<void>;
  save(record: WebhookSubscriptionRecord): Promise<void>;
  findById(required: { workspaceId: UUID; id: IntegrationId }): Promise<WebhookSubscriptionRecord | null>;
  listByWorkspace(required: { workspaceId: UUID }): Promise<WebhookSubscriptionRecord[]>;

  findMatching(required: { workspaceId: UUID; topic: WebhookTopic }): Promise<WebhookSubscriptionRecord[]>;
}

export interface WebhookDeliveryRepoPort {
  enqueue(required: { record: WebhookDeliveryRecord }, optional?: { envelope?: WebhookEventEnvelope }): Promise<void>;

  claimPending(required: { batchSize: number; nowIso: ISODateTime }): Promise<WebhookDeliveryRecord[]>;
  markDelivered(required: {
    workspaceId: UUID;
    id: IntegrationId;
    responseStatus: number;
    deliveredAtIso: ISODateTime;
  }): Promise<void>;

  markFailed(required: {
    workspaceId: UUID;
    id: IntegrationId;
    error: string;
    responseStatus: number | null;
    nextStatus: Extract<WebhookDeliveryStatus, "failed" | "dead">;
    nextAttemptAt: ISODateTime;
  }, optional?: { deadAtIso?: ISODateTime }): Promise<void>;
  findById(required: { workspaceId: UUID; id: IntegrationId }): Promise<WebhookDeliveryRecord | null>;
  listBySubscription(required: {
    workspaceId: UUID;
    subscriptionId: IntegrationId;
    limit: number;
  }): Promise<WebhookDeliveryRecord[]>;
}

export interface IntegrationSecretRepoPort {
  insert(record: IntegrationSecretRecord): Promise<void>;
  findById(required: { workspaceId: UUID; id: IntegrationId }): Promise<IntegrationSecretRecord | null>;
  listByWorkspace(required: { workspaceId: UUID }): Promise<IntegrationSecretRecord[]>;
  delete(required: { workspaceId: UUID; id: IntegrationId }): Promise<void>;
}

/** Structural mapping to platform/secrets ports; no runtime import or key custody here. */
export interface DeliveryEnvelopeStorePort {
  save(required: { deliveryId: IntegrationId; envelope: WebhookEventEnvelope }): Promise<void>;
  find(required: { deliveryId: IntegrationId }): Promise<WebhookEventEnvelope | null>;
}
/** Required host-specific HTTP header vocabulary. */
export interface WebhookHeaderVocabulary {
  signature: string;
  deliveryId: string;
  eventId: string;
}
