import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { toAdminSubscriptionResponse, type AdminWebhookSubscriptionEnvelope, type WebhookSubscriptionRow } from "../../http/integrations.js";
import { authorizeIntegrations, rejectWebhookError, subscriptionIdParam, webhookMessageMapping, WEBHOOK_VERSION_CONFLICT, type WebhookFailureMatcher } from "./shared.js";

/**
 * Pauses (`paused: true`) or resumes (`false`) one subscription and returns it. Injected because the
 * webhook feature is the host's. It throws its not-found error for a missing subscription, its
 * validation error for a disabled one (soft deletion is terminal), and a version conflict when the
 * row changed mid-write.
 */
export type WebhookSubscriptionPauseFn = (required: { workspaceId: string; subscriptionId: string; paused: boolean }) => Promise<{ subscription: WebhookSubscriptionRow }>;

/** The deps this route reads: the workspace, the host's pause service and how to recognise its two anticipated failures. */
export interface IntegrationsPauseRouteDeps {
  workspaceId: string;
  pauseSubscription: WebhookSubscriptionPauseFn;
  isNotFoundError: WebhookFailureMatcher;
  isValidationError: WebhookFailureMatcher;
}

/** The POST's input: the subscription and the direction. */
export interface IntegrationsPauseInput { subscriptionId: string; paused: boolean }

/**
 * POST pause/resume a webhook subscription. One route, both directions — mirrors the service's own
 * `{ paused?: boolean }` design (defaults to pausing); body `{ "paused": false }` resumes an
 * already-paused subscription back to `active`.
 *
 * Any non-boolean `paused`, including an absent body, means pause, so `{ "paused": false }` is the
 * only way to resume. Never refused in `parse`: a stray value must not turn into a 400 before the
 * caller is authorized. Gated by `admin.integrations.manage` for that subscription, checked directly
 * via `authorize()` (same pattern as `create`).
 */
export const integrationsPauseRoute = defineJsonRoute<IntegrationsPauseInput, AdminWebhookSubscriptionEnvelope, IntegrationsPauseRouteDeps, unknown>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/integrations/subscriptions/:subscriptionId/pause",
  parse: (raw) => {
    const flag = (raw.body as { paused?: unknown } | null | undefined)?.paused;
    return ok({ value: { subscriptionId: subscriptionIdParam(raw.params), paused: typeof flag === "boolean" ? flag : true } });
  },
  handle: async ({ input, deps, authorize }) => {
    await authorizeIntegrations({ authorize }, { entityId: input.subscriptionId });
    try {
      // The egress policy is not exercised here: pause never re-validates the target URL.
      const { subscription } = await deps.pauseSubscription({ workspaceId: deps.workspaceId, subscriptionId: input.subscriptionId, paused: input.paused });
      return ok({ value: { subscription: toAdminSubscriptionResponse({ subscription, lastDelivery: null }) } });
    } catch (err) {
      return rejectWebhookError({ err, mappings: [
        webhookMessageMapping({ matches: deps.isNotFoundError, status: 404 }),
        webhookMessageMapping({ matches: deps.isValidationError, status: 400 }),
        WEBHOOK_VERSION_CONFLICT,
      ] });
    }
  },
});
