import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { NewsletterImportOutcome, NewsletterImportSubscriptionsFn } from "./subscriptions.js";
import { admitNewsletterRequest, newsletterListIdParam, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** The deps this route reads: the base newsletter deps and the host's bound `importSubscriptions`. */
export interface NewsletterImportSubscriptionsRouteDeps extends NewsletterRouteBaseDeps {
  importSubscriptions: NewsletterImportSubscriptionsFn;
}

/** True for a body row that is an object carrying a string `subscriberId`. @complexity O(1). */
function isSubscriberRow(row: unknown): row is { subscriberId: string } {
  return typeof row === "object" && row !== null && typeof (row as { subscriberId?: unknown }).subscriberId === "string";
}

/**
 * `IMPORT_SUBSCRIPTIONS` (api.spec.md §1/§4/§5) — `POST .../newsletter/lists/:listId/
 * subscriptions/import`. `admin.newsletter.subscriber.manage`-gated. `207 Multi-Status`: each row
 * routes through the identical `saveSubscription` path (REQ-31) — one invalid `subscriberId` never
 * blocks the valid rows in the same batch. The row shape is checked in `parse`, so a bad body is a
 * 400 before the permission check; an empty array passes, because the batch-size bound is the
 * service's rule. A row's own `source` is ignored: every imported row is recorded as `import`.
 */
export const newsletterImportSubscriptionsRoute = defineJsonRoute<{ listId: string; subscriberIds: string[] }, NewsletterImportOutcome, NewsletterImportSubscriptionsRouteDeps, NewsletterRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/lists/:listId/subscriptions/import",
  parse: (raw) => {
    const { subscribers } = (raw.body ?? {}) as { subscribers?: unknown };
    if (!Array.isArray(subscribers) || !subscribers.every(isSubscriberRow)) {
      rejectRoute({ status: 400, error: "subscribers must be an array of { subscriberId }", code: "VALIDATION_ERROR" });
    }
    return ok({ value: { listId: newsletterListIdParam(raw.params), subscriberIds: subscribers.map((row) => row.subscriberId) } });
  },
  handle: ({ input, deps, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.subscriber.manage", entityType: "newsletter_subscription" });
    const { created, failed } = await deps.importSubscriptions({
      workspaceId: deps.workspaceId,
      listId: input.listId,
      subscribers: input.subscriberIds.map((subscriberId) => ({ subscriberId, source: "import" as const })),
    });
    return ok({ value: { created, failed } });
  } }),
}, { successStatus: 207 });
