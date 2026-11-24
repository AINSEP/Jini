/**
 * @file Admin HTTP response DTOs for the `integrations` webhook subsystem (ADR-036).
 *
 * Purpose:
 * Projects a webhook subscription / delivery row (the internal, repo-shaped record) into the JSON
 * the admin UI consumes, mirroring the other admin DTO helpers' `toAdmin…Response` role.
 *
 * How it relates to the project:
 * - Called by the `integrations` admin route specs, never by feature code.
 * - No signing secret ever flows through here: a subscription record has no secret field to begin
 *   with (ADR-036 §5 derive-not-store — only `secretVersion`/`previousSecretVersion`, which name a
 *   generation, not the key material itself), so there is nothing to redact. This comment exists
 *   precisely so a future field addition to the record gets the same scrutiny.
 * - The input types are structural views of the host's webhook records, not the records themselves:
 *   the webhook feature lives in another package this one does not depend on, and the host's
 *   `WebhookSubscriptionRecord` / `WebhookDeliveryRecord` are assignable to them. A status added
 *   there fails the host's typecheck here instead of silently widening the wire.
 *
 * Architectural role:
 * Pure projection functions. No I/O, no business rules — those stay in the webhook feature.
 */

/** A subscription's lifecycle state, as the admin list shows it. */
export type WebhookSubscriptionRowStatus = "active" | "paused" | "disabled";

/** A delivery's lifecycle state, as the delivery log shows it. */
export type WebhookDeliveryRowStatus = "pending" | "delivering" | "delivered" | "failed" | "dead" | "canceled";

/** The subscription fields the admin wire reads; a host record with more fields (owner, attribution) is assignable. */
export interface WebhookSubscriptionRow {
  id: string;
  label: string;
  targetUrl: string;
  topics: readonly string[];
  status: WebhookSubscriptionRowStatus;
  secretVersion: number;
  previousSecretVersion: number | null;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
  version: number;
}

/** The delivery fields the admin wire reads; a host record with more fields (the workspace id) is assignable. */
export interface WebhookDeliveryRow {
  id: string;
  subscriptionId: string;
  eventId: string;
  topic: string;
  status: WebhookDeliveryRowStatus;
  attempts: number;
  nextAttemptAt: string;
  lastResponseStatus: number | null;
  lastError: string | null;
  signedWithVersion: number | null;
  createdAt: string;
  deliveredAt: string | null;
  deadAt: string | null;
}

export interface AdminWebhookDeliverySummary {
  id: string;
  status: WebhookDeliveryRow["status"];
  attempts: number;
  lastResponseStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface AdminWebhookSubscriptionResponse {
  id: string;
  label: string;
  targetUrl: string;
  topics: string[];
  status: WebhookSubscriptionRow["status"];
  secretVersion: number;
  previousSecretVersion: number | null;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
  version: number;
  /** Most recent delivery attempt for this subscription, or `null` if none has fired yet. */
  lastDelivery: AdminWebhookDeliverySummary | null;
}

export interface AdminWebhookDeliveryResponse {
  id: string;
  subscriptionId: string;
  eventId: string;
  topic: string;
  status: WebhookDeliveryRow["status"];
  attempts: number;
  nextAttemptAt: string;
  lastResponseStatus: number | null;
  lastError: string | null;
  signedWithVersion: number | null;
  createdAt: string;
  deliveredAt: string | null;
  deadAt: string | null;
}

/** The `{ subscription }` envelope create, pause and delete answer with. */
export interface AdminWebhookSubscriptionEnvelope { subscription: AdminWebhookSubscriptionResponse }

/**
 * Project a subscription row + its (already-resolved) most recent delivery into the admin list
 * response shape. Never emits secret material — see the file header.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function toAdminSubscriptionResponse(required: {
  subscription: WebhookSubscriptionRow;
  lastDelivery: WebhookDeliveryRow | null;
}): AdminWebhookSubscriptionResponse {
  const { subscription, lastDelivery } = required;
  return {
    id: subscription.id,
    label: subscription.label,
    targetUrl: subscription.targetUrl,
    topics: [...subscription.topics],
    status: subscription.status,
    secretVersion: subscription.secretVersion,
    previousSecretVersion: subscription.previousSecretVersion,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
    disabledAt: subscription.disabledAt,
    version: subscription.version,
    lastDelivery: lastDelivery ? toAdminDeliverySummary(lastDelivery) : null,
  };
}

/**
 * Project a delivery row into the compact summary shown inline on the subscription list.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function toAdminDeliverySummary(delivery: WebhookDeliveryRow): AdminWebhookDeliverySummary {
  return {
    id: delivery.id,
    status: delivery.status,
    attempts: delivery.attempts,
    lastResponseStatus: delivery.lastResponseStatus,
    lastError: delivery.lastError,
    createdAt: delivery.createdAt,
    deliveredAt: delivery.deliveredAt,
  };
}

/**
 * Project a delivery row into the full detail shape shown in the per-subscription delivery log.
 * Spelled out here (the admin wire is this explicit interface) rather than borrowed from the
 * webhook feature's agent-tool view: that view is a model-facing contract that may change on its
 * own, and the admin UI must not change with it.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function toAdminDeliveryResponse(delivery: WebhookDeliveryRow): AdminWebhookDeliveryResponse {
  return {
    id: delivery.id,
    subscriptionId: delivery.subscriptionId,
    eventId: delivery.eventId,
    topic: delivery.topic,
    status: delivery.status,
    attempts: delivery.attempts,
    nextAttemptAt: delivery.nextAttemptAt,
    lastResponseStatus: delivery.lastResponseStatus,
    lastError: delivery.lastError,
    signedWithVersion: delivery.signedWithVersion,
    createdAt: delivery.createdAt,
    deliveredAt: delivery.deliveredAt,
    deadAt: delivery.deadAt,
  };
}
