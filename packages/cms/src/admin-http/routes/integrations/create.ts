import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { toAdminSubscriptionResponse, type AdminWebhookSubscriptionEnvelope, type WebhookSubscriptionRow } from "../../http/integrations.js";
import { authorizeIntegrations, rejectWebhookError, webhookMessageMapping, type WebhookFailureMatcher } from "./shared.js";

/**
 * Creates one active subscription. Injected because the webhook feature is the host's: it owns the
 * validation order, the egress policy (the real origin oracle, which fails closed on any parse
 * failure or ambiguity), the actor attribution and the repo. It throws its validation error for a
 * missing label, a malformed or non-https or disallowed target, and no topics.
 */
export type WebhookSubscriptionCreateFn = (required: {
  workspaceId: string;
  /** The signed-in operator making the request: the host records them as the subscription's owner and creator. */
  actorPrincipalId: string;
  label: string;
  targetUrl: string;
  topics: string[];
}) => Promise<{ subscription: WebhookSubscriptionRow }>;

/** The deps this route reads: the workspace, the host's create service and how to recognise its validation failure. */
export interface IntegrationsCreateRouteDeps {
  workspaceId: string;
  createSubscription: WebhookSubscriptionCreateFn;
  isValidationError: WebhookFailureMatcher;
}

/** The signed-in operator the host's session port resolved; only its id is read. */
export interface IntegrationsCreatePrincipal { id: string }

/** The POST body's fields, read off the untyped body in one place. */
export interface IntegrationsCreateInput { label: string; targetUrl: string; topics: string[] }

/**
 * POST create a webhook subscription. Gated by `admin.integrations.manage`, checked directly via
 * `authorize()` — mirrors the members `disable` route's pattern, since subscription mutations are a
 * direct feature call, not routed through the SPEC-001 command gateway.
 *
 * `parse` applies the same string-coercion/defaulting the service's own validation expects and never
 * refuses: a malformed shape just becomes an empty or invalid value that the service rejects (400),
 * after authorization, as the hand-written route did.
 */
export const integrationsCreateRoute = defineJsonRoute<IntegrationsCreateInput, AdminWebhookSubscriptionEnvelope, IntegrationsCreateRouteDeps, IntegrationsCreatePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/integrations/subscriptions",
  parse: (raw) => {
    const body = (raw.body ?? {}) as Record<string, unknown>;
    const rawTopics = body.topics;
    return ok({ value: {
      label: String(body.label ?? ""),
      targetUrl: String(body.targetUrl ?? ""),
      topics: Array.isArray(rawTopics) ? rawTopics.map(String) : [],
    } });
  },
  handle: async ({ input, deps, context, authorize }) => {
    await authorizeIntegrations({ authorize });
    // Fail closed: a subscription must never be stamped with a made-up owner when no one is signed in.
    if (!context) throw new Error("integrations admin route has no authenticated principal");
    try {
      const { subscription } = await deps.createSubscription({ workspaceId: deps.workspaceId, actorPrincipalId: context.id, ...input });
      return ok({ value: { subscription: toAdminSubscriptionResponse({ subscription, lastDelivery: null }) } });
    } catch (err) {
      return rejectWebhookError({ err, mappings: [webhookMessageMapping({ matches: deps.isValidationError, status: 400 })] });
    }
  },
}, { successStatus: 201 });
