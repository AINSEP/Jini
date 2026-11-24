import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { toDataResponse, type NewsletterList } from "../../http/newsletter.js";
import { admitNewsletterRequest, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** The deps this route reads: the base newsletter deps and the list repo's unpaged read. */
export interface NewsletterListListsRouteDeps extends NewsletterRouteBaseDeps {
  newsletterListRepo: { list(required: { workspaceId: string }): Promise<readonly NewsletterList[]> };
}

/** `LIST_LISTS` (api.spec.md §1) — `GET .../newsletter/lists`. `admin.newsletter.read`-gated. */
export const newsletterListListsRoute = defineJsonRoute<Record<string, never>, { data: readonly NewsletterList[] }, NewsletterListListsRouteDeps, NewsletterRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/lists",
  parse: () => ok({ value: {} }),
  handle: ({ deps, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.read", entityType: "newsletter_list" });
    const lists = await deps.newsletterListRepo.list({ workspaceId: deps.workspaceId });
    return ok({ value: toDataResponse({ data: lists }) });
  } }),
});
