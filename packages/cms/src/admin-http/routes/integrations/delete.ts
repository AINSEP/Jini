import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { toAdminSubscriptionResponse, type AdminWebhookSubscriptionEnvelope, type WebhookSubscriptionRow } from "../../http/integrations.js";
import { authorizeIntegrations, rejectWebhookError, subscriptionIdParam, webhookMessageMapping, WEBHOOK_VERSION_CONFLICT, type WebhookFailureMatcher } from "./shared.js";

/**
 * Soft-disables one subscription and returns it. Injected because the webhook feature is the host's.
 * It throws its not-found error for a missing subscription and a version conflict when the row
 * changed mid-write.
 */
export type WebhookSubscriptionDeleteFn = (required: { workspaceId: string; subscriptionId: string }) => Promise<{ subscription: WebhookSubscriptionRow }>;

/** The deps this route reads: the workspace, the host's delete service and how to recognise its not-found failure. */
export interface IntegrationsDeleteRouteDeps {
  workspaceId: string;
  deleteSubscription: WebhookSubscriptionDeleteFn;
  isNotFoundError: WebhookFailureMatcher;
}

/**
 * DELETE a webhook subscription. Soft-deletes (never row-deletes) — the service sets
 * `status: "disabled"` and stamps `disabledAt` for audit durability (ADR-036 §2); the response
 * still echoes the (now-disabled) subscription so the admin UI can show its terminal state.
 *
 * Gated by `admin.integrations.manage` for that subscription, checked directly via `authorize()`
 * (same pattern as `create`).
 */
export const integrationsDeleteRoute = defineJsonRoute<{ subscriptionId: string }, AdminWebhookSubscriptionEnvelope, IntegrationsDeleteRouteDeps, unknown>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/integrations/subscriptions/:subscriptionId",
  parse: (raw) => ok({ value: { subscriptionId: subscriptionIdParam(raw.params) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeIntegrations({ authorize }, { entityId: input.subscriptionId });
    try {
      // The egress policy is not exercised here: delete never re-validates the target URL.
      const { subscription } = await deps.deleteSubscription({ workspaceId: deps.workspaceId, subscriptionId: input.subscriptionId });
      return ok({ value: { subscription: toAdminSubscriptionResponse({ subscription, lastDelivery: null }) } });
    } catch (err) {
      return rejectWebhookError({ err, mappings: [webhookMessageMapping({ matches: deps.isNotFoundError, status: 404 }), WEBHOOK_VERSION_CONFLICT] });
    }
  },
});
