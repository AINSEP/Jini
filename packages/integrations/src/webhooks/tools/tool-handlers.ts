import { isDeepStrictEqual } from "node:util";
import {
  ToolInputError,
  adaptLegacyAuthorize,
  optionalBoolean,
  optionalNumber,
  requireInputRecord,
  requireNoInput,
  requireString,
  requireToolPermission,
  type ToolHandler,
} from "@jini-ai/core";
import { requireExpectedVersion } from "@jini-ai/core/optimistic-concurrency";
import {
  createSubscription,
  updateSubscription,
  deleteSubscription,
  pauseSubscription,
  WebhookSubscriptionNotFoundError,
  WebhookSubscriptionValidationError,
} from "../subscriptions.js";
import type { WebhooksPackageToolDeps, WebhooksToolSurfaces } from "./tool-handlers.types.js";
import { mostRecentDelivery, toSubscriptionToolView, toWebhookDeliveryView } from "./tool-views.js";

const MANAGE_INTEGRATIONS_PERMISSION = "admin.integrations.manage";

/**
 * Bound on how many of a subscription's most recent deliveries are read to compute the
 * "last delivery" summary shown per row in `webhooks_list_subscriptions`. Duplicated from
 * the host's admin list route's own `LAST_DELIVERY_LOOKUP_LIMIT` (a literal, not logic —
 * importing from a host route would invert the ports/adapters direction, so the value is repeated here).
 */
const LAST_DELIVERY_LOOKUP_LIMIT = 50;

/** Default/cap for `webhooks_get_deliveries`' `limit` — duplicated from
 * the host's admin deliveries route, same reasoning as above. */
const DEFAULT_DELIVERIES_LIMIT = 50;
const MAX_DELIVERIES_LIMIT = 200;

function clampDeliveriesLimit({ requested }: { requested: number | undefined }, _optional = {}): number {
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) return DEFAULT_DELIVERIES_LIMIT;
  return Math.min(Math.floor(requested), MAX_DELIVERIES_LIMIT);
}

/** Whether a webhook target URL may be called from this workspace, per the verified-origin registry. */
function egressTargetCheck(routeDeps: WebhooksPackageToolDeps) {
  return ({ url }: { url: string }, _optional = {}) =>
    routeDeps.originRegistry.isAllowedEgressTarget({ context: { workspaceId: routeDeps.workspaceId }, url: url });
}

/** What every tool handler factory is given: the route deps and the confirmation surface store. */
interface WebhookHandlerArgs {
  deps: WebhooksPackageToolDeps;
  surfaces: WebhooksToolSurfaces;
}

/** The deps bag the subscription write-service takes, over the route deps and its egress check. */
function subscriptionServiceDeps(deps: WebhooksPackageToolDeps, _optional = {}) {
  return { clock: deps.clock, repo: deps.webhookSubscriptionRepo, idGenerator: deps.idGen, isAllowedTarget: egressTargetCheck(deps) };
}

export const webhooksListSubscriptionsHandler = ({ deps }: WebhookHandlerArgs, _optional = {}): ToolHandler => async (ctx) => {
  requireNoInput({ input: ctx.input });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_INTEGRATIONS_PERMISSION }, { entityType: "webhook_subscription" });

  const subscriptions = await deps.webhookSubscriptionRepo.listByWorkspace({ workspaceId: deps.workspaceId });
  const views = await Promise.all(
    subscriptions.map(async (subscription) => {
      const recentDeliveries = await deps.webhookDeliveryRepo.listBySubscription({
        workspaceId: deps.workspaceId,
        subscriptionId: subscription.id,
        limit: LAST_DELIVERY_LOOKUP_LIMIT,
      });
      return toSubscriptionToolView({ subscription, lastDelivery: mostRecentDelivery(recentDeliveries) });
    }),
  );
  return { subscriptions: views };
};

export const webhooksGetDeliveriesHandler = ({ deps }: WebhookHandlerArgs, _optional = {}): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const subscriptionId = requireString({ input, key: "subscriptionId" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_INTEGRATIONS_PERMISSION }, { entityType: "webhook_subscription", entityId: subscriptionId });

  const subscription = await deps.webhookSubscriptionRepo.findById({ workspaceId: deps.workspaceId, id: subscriptionId });
  if (!subscription) throw new WebhookSubscriptionNotFoundError({ message: `webhook subscription '${subscriptionId}' was not found` });

  const deliveries = await deps.webhookDeliveryRepo.listBySubscription({
    workspaceId: deps.workspaceId,
    subscriptionId,
    limit: clampDeliveriesLimit({ requested: optionalNumber({ input, key: "limit" }) }),
  });
  const newestFirst = [...deliveries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { deliveries: newestFirst.map((delivery) => toWebhookDeliveryView({ delivery })) };
};

export const webhooksCreateSubscriptionHandler = ({ deps }: WebhookHandlerArgs, _optional = {}): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_INTEGRATIONS_PERMISSION }, { entityType: "webhook_subscription" });

  const rawTopics = input.topics;
  ctx.signal.throwIfAborted();
  const { subscription } = await createSubscription({
    deps: subscriptionServiceDeps(deps),
    input: {
      workspaceId: deps.workspaceId,
      // Mirrors the host's admin create route (its dev-mode placeholder): there is no per-agent-run
      // owner-principal concept yet, so the owner is the same run principal the permission
      // check above already authorized (never a caller-supplied id).
      ownerPrincipalId: ctx.principal.id,
      createdByPrincipalId: ctx.principal.id,
      label: requireString({ input, key: "label" }),
      targetUrl: requireString({ input, key: "targetUrl" }),
      topics: Array.isArray(rawTopics) ? rawTopics.map(String) : [],
    },
  });
  return { subscription: toSubscriptionToolView({ subscription, lastDelivery: null }) };
};

/** Uses the existing validation/egress owner and never exposes signing material. */
export const webhooksUpdateSubscriptionHandler = ({ deps }: WebhookHandlerArgs, _optional = {}): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const expectedVersion = requireExpectedVersion({ value: input.expectedVersion, readToolId: "content_read.webhook_subscription" });
  const subscriptionId = requireString({ input, key: "subscriptionId" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_INTEGRATIONS_PERMISSION }, { entityType: "webhook_subscription", entityId: subscriptionId });
  if (!Array.isArray(input.topics) || !input.topics.every(topic => typeof topic === "string")) {
    throw new WebhookSubscriptionValidationError({ message: "topics must be an array of strings" });
  }
  ctx.signal.throwIfAborted();
  const { subscription } = await updateSubscription({
    deps: subscriptionServiceDeps(deps),
    input: { workspaceId: deps.workspaceId, id: subscriptionId, label: requireString({ input, key: "label" }), targetUrl: requireString({ input, key: "targetUrl" }), topics: input.topics },
  }, { expectedVersion });
  const deliveries = await deps.webhookDeliveryRepo.listBySubscription({
    workspaceId: deps.workspaceId, subscriptionId, limit: 1,
  });
  return { subscription: toSubscriptionToolView({ subscription, lastDelivery: mostRecentDelivery(deliveries) }) };
};

export const webhooksPauseSubscriptionHandler = ({ deps }: WebhookHandlerArgs, _optional = {}): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const subscriptionId = requireString({ input, key: "subscriptionId" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_INTEGRATIONS_PERMISSION }, { entityType: "webhook_subscription", entityId: subscriptionId });

  const { subscription } = await pauseSubscription(
    {
      deps: subscriptionServiceDeps(deps),
      input: { workspaceId: deps.workspaceId, id: subscriptionId },
    },
    { paused: optionalBoolean({ input, key: "paused" }) ?? true },
  );
  return { subscription: toSubscriptionToolView({ subscription, lastDelivery: null }) };
};

/**
 * The MCP-UI-gated delete — migrated onto the shared held-open confirmation exchange
 * (2026-09-08, ADS-memory/reports/2026-09-08-delete-confirmation-build.md). No separate
 * staleness re-check: `deleteSubscription` performs its own fresh existence lookup at write
 * time (confirmed by reading it in full — no `expectedVersion`/optimistic-concurrency field
 * anywhere in its input), so whatever the row looks like at confirm time is exactly what gets
 * deleted, or a fresh `WebhookSubscriptionNotFoundError` if it is gone by then.
 * The owner opt-in now adds a full snapshot check before that service so changed targets re-ask.
 */
export const webhooksDeleteSubscriptionHandler = ({ deps, surfaces }: WebhookHandlerArgs, _optional = {}): ToolHandler => deps.confirmDelete({ surfaces,
  prepare: async ({ ctx }) => {
    const subscriptionId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "subscriptionId" });
    await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_INTEGRATIONS_PERMISSION }, { entityType: "webhook_subscription", entityId: subscriptionId });
    const existing = await deps.webhookSubscriptionRepo.findById({ workspaceId: deps.workspaceId, id: subscriptionId });
    if (!existing) throw new WebhookSubscriptionNotFoundError({ message: `webhook subscription '${subscriptionId}' was not found` });
    return { subscriptionId, existing: structuredClone(existing) };
  },
  run: async ({ ctx, prepared: { subscriptionId, existing } }) => {
    // Authorization can be revoked while the human reads the card; the service has no gate.
    await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: MANAGE_INTEGRATIONS_PERMISSION }, { entityType: "webhook_subscription", entityId: subscriptionId });
    if (ctx.signal.aborted) return { deleted: false, ...deps.notConfirmedResult({ confirmed: false, reason: "abandoned" }) };
    const current = await deps.webhookSubscriptionRepo.findById({ workspaceId: deps.workspaceId, id: subscriptionId });
    if (!isDeepStrictEqual(current, existing)) throw new ToolInputError({ message: "webhooks_delete_subscription: target changed while confirmation was open. Request a new confirmation; nothing was deleted." });
    ctx.signal.throwIfAborted();
    const { subscription } = await deleteSubscription({
      deps: subscriptionServiceDeps(deps),
      input: { workspaceId: deps.workspaceId, id: subscriptionId },
    });
    return { deleted: true, cancelled: false, subscription: toSubscriptionToolView({ subscription, lastDelivery: null }) };
  },
  declined: ({ reason, prepared }) => {
    if (reason === "declined" && prepared) return { deleted: false, cancelled: true, subscription: toSubscriptionToolView({ subscription: prepared.existing, lastDelivery: null }) };
    return { deleted: false, cancelled: false, reason, note: reason === "expired"
      ? "The user did not respond to the confirmation dialog before it expired. Nothing was deleted."
      : "The confirmation dialog was closed because the run ended. Nothing was deleted." };
  },
});
