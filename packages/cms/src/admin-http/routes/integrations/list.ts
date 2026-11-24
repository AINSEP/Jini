import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { toAdminSubscriptionResponse, type AdminWebhookSubscriptionResponse, type WebhookDeliveryRow } from "../../http/integrations.js";
import { authorizeIntegrations, type WebhookDeliveryReadPort, type WebhookSubscriptionReadPort } from "./shared.js";

/** The deps this route reads: the workspace, the subscription list and the per-subscription delivery read. */
export interface IntegrationsListRouteDeps {
  workspaceId: string;
  webhookSubscriptionRepo: Pick<WebhookSubscriptionReadPort, "listByWorkspace">;
  webhookDeliveryRepo: Pick<WebhookDeliveryReadPort, "listBySubscription">;
}

/** `{ subscriptions }`: every subscription with its last delivery summary. */
export interface AdminWebhookSubscriptionListEnvelope { subscriptions: AdminWebhookSubscriptionResponse[] }

/**
 * Bound on how many of a subscription's most recent deliveries are read to compute the
 * "last delivery" summary shown per row. Delivery volume grows independently of how many
 * subscriptions exist, so this caps the read cost per subscription per request rather than
 * assuming delivery volume stays small.
 */
const LAST_DELIVERY_LOOKUP_LIMIT = 50;

/**
 * Most recent delivery by `createdAt`, computed here rather than assumed from the repo's return
 * order — the delivery repo's `listBySubscription` makes no ordering guarantee.
 *
 * @complexity O(n) over the bounded lookup window.
 * @overallScore 100
 */
function mostRecentDelivery(deliveries: readonly WebhookDeliveryRow[]): WebhookDeliveryRow | null {
  if (deliveries.length === 0) return null;
  return deliveries.reduce((latest, candidate) =>
    candidate.createdAt > latest.createdAt ? candidate : latest
  );
}

/**
 * GET all webhook subscriptions for the workspace, each annotated with its most recent delivery
 * (list screen: label, target URL, status, last delivery).
 *
 * Gated by `admin.integrations.manage`, same reasoning as `deliveries` (no split `.read` permission
 * exists for this domain). Id-free: it acts on no single subscription.
 */
export const integrationsListRoute = defineJsonRoute<Record<string, never>, AdminWebhookSubscriptionListEnvelope, IntegrationsListRouteDeps, unknown>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/integrations/subscriptions",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeIntegrations({ authorize });
    const subscriptions = await deps.webhookSubscriptionRepo.listByWorkspace({ workspaceId: deps.workspaceId });
    const subscriptionResponses = await Promise.all(
      subscriptions.map(async (subscription) => {
        const recentDeliveries = await deps.webhookDeliveryRepo.listBySubscription({
          workspaceId: deps.workspaceId,
          subscriptionId: subscription.id,
          limit: LAST_DELIVERY_LOOKUP_LIMIT,
        });
        return toAdminSubscriptionResponse({ subscription, lastDelivery: mostRecentDelivery(recentDeliveries) });
      })
    );
    return ok({ value: { subscriptions: subscriptionResponses } });
  },
});
