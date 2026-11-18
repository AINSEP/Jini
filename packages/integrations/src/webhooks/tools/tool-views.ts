import type { WebhookDeliveryRecord, WebhookSubscriptionRecord } from "../types.js";

/** Most recent delivery by `createdAt`, computed here rather than assumed from repo return order —
 * `WebhookDeliveryRepoPort.listBySubscription` makes no ordering guarantee (mirrors
 * the host's admin list route's helper of the same name/shape, duplicated
 * rather than imported for the same ports/adapters reason as the constants in `tool-handlers.ts`). */
export function mostRecentDelivery(deliveries: readonly WebhookDeliveryRecord[]): WebhookDeliveryRecord | null {
  if (deliveries.length === 0) return null;
  return deliveries.reduce((latest, candidate) => (candidate.createdAt > latest.createdAt ? candidate : latest));
}

/** Model-facing subscription view — drops `ownerPrincipalId`/`createdByPrincipalId`/
 * `createdByPluginId` (attribution internals no wired tool's follow-up call consumes; the same reasoning
 * as every other domain view that drops actor attribution). Never
 * includes a secret value — `WebhookSubscriptionRecord` has no secret field to begin with (see
 * `agent-tools.ts`'s file header). */
export function toSubscriptionToolView(
  { subscription, lastDelivery }: { subscription: WebhookSubscriptionRecord; lastDelivery: WebhookDeliveryRecord | null },
  _optional = {}
) {
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
    lastDelivery: lastDelivery ? toWebhookDeliveryView({ delivery: lastDelivery }) : null,
  };
}

/** Model-facing delivery view — drops `workspaceId` (redundant: every call is already scoped to
 * the caller's own workspace). */
export function toWebhookDeliveryView({ delivery }: { delivery: WebhookDeliveryRecord }, _optional = {}) {
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
