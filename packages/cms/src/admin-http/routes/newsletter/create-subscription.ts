import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { toDataResponse, type NewsletterSubscription } from "../../http/newsletter.js";
import type { NewsletterSaveSubscriptionFn, NewsletterSubscriptionSource } from "./subscriptions.js";
import { admitNewsletterRequest, newsletterListIdParam, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** The deps this route reads: the base newsletter deps and the host's bound `saveSubscription`. */
export interface NewsletterCreateSubscriptionRouteDeps extends NewsletterRouteBaseDeps {
  saveSubscription: NewsletterSaveSubscriptionFn;
}

/** The sources a caller may name; the same three the host's subscription record allows. */
const VALID_SOURCES: readonly NewsletterSubscriptionSource[] = ["admin", "import", "api"];

/** Narrows a caller-supplied string to a known source. @complexity O(1) — a 3-entry lookup. */
function isSubscriptionSource(value: string): value is NewsletterSubscriptionSource {
  return (VALID_SOURCES as readonly string[]).includes(value);
}

/**
 * `CREATE_SUBSCRIPTION` (api.spec.md §1/§4) — `POST .../newsletter/lists/:listId/subscriptions`.
 * `admin.newsletter.subscriber.manage`-gated. `subscriberId` must resolve to an existing Members
 * principal (REQ-10; `saveSubscription` checks that, not this route); `source` defaults to `admin`.
 * Both body fields are checked in `parse`, subscriber first, so a bad body is a 400 before the
 * permission check, as the hand-written route answered it. A non-string `source` is not an error: it
 * falls back to the default, exactly as before.
 */
export const newsletterCreateSubscriptionRoute = defineJsonRoute<{ listId: string; subscriberId: string; source: NewsletterSubscriptionSource }, { data: NewsletterSubscription }, NewsletterCreateSubscriptionRouteDeps, NewsletterRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/lists/:listId/subscriptions",
  parse: (raw) => {
    const body = (raw.body ?? {}) as { subscriberId?: unknown; source?: unknown };
    const { subscriberId } = body;
    if (typeof subscriberId !== "string") rejectRoute({ status: 400, error: "subscriberId is a required string", code: "VALIDATION_ERROR" });
    const source = typeof body.source === "string" ? body.source : "admin";
    if (!isSubscriptionSource(source)) rejectRoute({ status: 400, error: "source must be one of admin, import, api", code: "VALIDATION_ERROR" });
    return ok({ value: { listId: newsletterListIdParam(raw.params), subscriberId, source } });
  },
  handle: ({ input, deps, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.subscriber.manage", entityType: "newsletter_subscription" });
    const { subscription } = await deps.saveSubscription({ workspaceId: deps.workspaceId, listId: input.listId, subscriberId: input.subscriberId, source: input.source });
    return ok({ value: toDataResponse({ data: subscription }) });
  } }),
}, { successStatus: 201 });
