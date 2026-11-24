import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { toAdminDeliveryResponse, type AdminWebhookDeliveryResponse } from "../../http/integrations.js";
import { authorizeIntegrations, subscriptionIdParam, type WebhookDeliveryReadPort, type WebhookSubscriptionReadPort } from "./shared.js";

/** The deps this route reads: the workspace, the subscription lookup and the delivery log read. */
export interface IntegrationsDeliveriesRouteDeps {
  workspaceId: string;
  webhookSubscriptionRepo: Pick<WebhookSubscriptionReadPort, "findById">;
  webhookDeliveryRepo: Pick<WebhookDeliveryReadPort, "listBySubscription">;
}

/** The GET's input: the subscription and the already-clamped page size. */
export interface IntegrationsDeliveriesInput { subscriptionId: string; limit: number }

/** `{ deliveries }`: the log, newest first. */
export interface AdminWebhookDeliveriesEnvelope { deliveries: AdminWebhookDeliveryResponse[] }

/** Default page size when the caller doesn't pass `?limit=`. */
const DEFAULT_DELIVERIES_PAGE_SIZE = 50;
/** Hard cap on a single delivery-log page, regardless of what the caller requests. */
const MAX_DELIVERIES_PAGE_SIZE = 200;

/** Parses and clamps the `?limit=` query param into `[1, MAX_DELIVERIES_PAGE_SIZE]`. */
function resolvePageSize({ rawLimit }: { rawLimit: unknown }, _optional = {}): number {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DELIVERIES_PAGE_SIZE;
  return Math.min(Math.floor(parsed), MAX_DELIVERIES_PAGE_SIZE);
}

/**
 * GET the delivery log for one subscription (status, attempts, last response, timestamp),
 * newest-first.
 *
 * Gated by `admin.integrations.manage` — no dedicated read permission exists for the `integrations`
 * domain (no other route in this pass split it into `.read`/`.manage`), so the same single
 * permission that gates subscription mutations also gates this read, mirroring `member.manage`'s
 * coverage of its whole domain.
 */
export const integrationsDeliveriesRoute = defineJsonRoute<IntegrationsDeliveriesInput, AdminWebhookDeliveriesEnvelope, IntegrationsDeliveriesRouteDeps, unknown>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/integrations/subscriptions/:subscriptionId/deliveries",
  parse: (raw) => ok({ value: { subscriptionId: subscriptionIdParam(raw.params), limit: resolvePageSize({ rawLimit: raw.query.limit }) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeIntegrations({ authorize }, { entityId: input.subscriptionId });
    const subscription = await deps.webhookSubscriptionRepo.findById({ workspaceId: deps.workspaceId, id: input.subscriptionId });
    if (!subscription) rejectRoute({ status: 404, error: `webhook subscription '${input.subscriptionId}' was not found` });
    const deliveries = await deps.webhookDeliveryRepo.listBySubscription({ workspaceId: deps.workspaceId, subscriptionId: input.subscriptionId, limit: input.limit });
    // Newest-first for the log view — the repo orders before limiting (with id breaking ties).
    // Sorting here after LIMIT would leave the wrong rows on the "most recent" page (F1761).
    return ok({ value: { deliveries: deliveries.map((delivery) => toAdminDeliveryResponse(delivery)) } });
  },
});
