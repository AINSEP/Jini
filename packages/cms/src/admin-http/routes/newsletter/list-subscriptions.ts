import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { parseListPageRequest } from "@jini-ai/core/list-page";

import { toDataResponse, type NewsletterSubscription } from "../../http/newsletter.js";
import { admitNewsletterRequest, newsletterListIdParam, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** The deps this route reads: the base newsletter deps and the subscription repo's page read. */
export interface NewsletterListSubscriptionsRouteDeps extends NewsletterRouteBaseDeps {
  newsletterSubscriptionRepo: {
    list(required: { workspaceId: string; listId: string }, optional?: { limit?: number; cursor?: string | null }): Promise<{ items: readonly NewsletterSubscription[]; nextCursor: string | null }>;
  };
}

/** The list whose subscriptions are read, and the raw query for paging. */
export interface NewsletterListSubscriptionsInput { listId: string; query: Record<string, unknown> }

/**
 * `LIST_SUBSCRIPTIONS` (api.spec.md §1) — `GET .../newsletter/lists/:listId/subscriptions`.
 * `admin.newsletter.subscriber.read`-gated. Paging is parsed only after the permission check, as the
 * hand-written route did, so a refused caller with a malformed `limit` still gets the 403, not the 400.
 */
export const newsletterListSubscriptionsRoute = defineJsonRoute<NewsletterListSubscriptionsInput, { data: readonly NewsletterSubscription[]; nextCursor: string | null }, NewsletterListSubscriptionsRouteDeps, NewsletterRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/lists/:listId/subscriptions",
  parse: (raw) => ok({ value: { listId: newsletterListIdParam(raw.params), query: raw.query } }),
  handle: ({ input, deps, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.subscriber.read", entityType: "newsletter_subscription" });
    const paging = parseListPageRequest({ value: input.query }, { defaultLimit: 100, maxLimit: 100 });
    const page = await deps.newsletterSubscriptionRepo.list({ workspaceId: deps.workspaceId, listId: input.listId }, paging);
    return ok({ value: { ...toDataResponse({ data: page.items }), nextCursor: page.nextCursor } });
  } }, { listPaging: true }),
});
