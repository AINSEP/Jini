import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { toDataResponse, type NewsletterSubscription } from "../../http/newsletter.js";
import { rejectSubscriptionNotFound, type NewsletterSubscriptionReader, type NewsletterUnsubscribeSubscriptionFn } from "./subscriptions.js";
import { admitNewsletterRequest, newsletterIdParam, newsletterListIdParam, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** The deps this route reads: the base newsletter deps, the one subscription lookup and the host's bound `unsubscribeSubscription`. */
export interface NewsletterRemoveSubscriptionRouteDeps extends NewsletterRouteBaseDeps {
  newsletterSubscriptionRepo: NewsletterSubscriptionReader;
  unsubscribeSubscription: NewsletterUnsubscribeSubscriptionFn;
}

/**
 * `REMOVE_SUBSCRIPTION` (api.spec.md §1/§5) — `DELETE .../newsletter/lists/:listId/
 * subscriptions/:id`. `admin.newsletter.subscriber.manage`-gated. Returns the `unsubscribed`
 * subscription (200), not `204` (a soft state transition, not a hard delete).
 *
 * The host's `unsubscribeSubscription` is the real domain-layer function backing this route (added
 * alongside it — the host's `subscriptions.ts` previously exported only the create-side
 * `saveSubscription`/`importSubscriptions`; the only removal-shaped repo method,
 * `NewsletterSubscriptionRepoPort.remove()`, is a hard delete, which would have contradicted this
 * endpoint's documented response). See that function's own doc comment for the full rationale.
 *
 * The lookup here, before it, is what scopes the id to the list in the URL: a subscription that
 * exists but belongs to another list answers the same 404 as an unknown id.
 */
export const newsletterRemoveSubscriptionRoute = defineJsonRoute<{ listId: string; id: string }, { data: NewsletterSubscription }, NewsletterRemoveSubscriptionRouteDeps, NewsletterRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/lists/:listId/subscriptions/:id",
  parse: (raw) => ok({ value: { listId: newsletterListIdParam(raw.params), id: newsletterIdParam(raw.params) } }),
  handle: ({ input, deps, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.subscriber.manage", entityType: "newsletter_subscription" });
    const existing = await deps.newsletterSubscriptionRepo.findById({ workspaceId: deps.workspaceId, id: input.id });
    if (!existing || existing.listId !== input.listId) rejectSubscriptionNotFound({ id: input.id });
    const { subscription } = await deps.unsubscribeSubscription({ workspaceId: deps.workspaceId, id: input.id });
    return ok({ value: toDataResponse({ data: subscription }) });
  } }),
});
