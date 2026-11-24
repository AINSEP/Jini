import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { parseListPageRequest } from "@jini-ai/core/list-page";

import { toDataResponse, type NewsletterCampaign } from "../../http/newsletter.js";
import { admitNewsletterRequest, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** The deps this route reads: the base newsletter deps and the campaign repo's page read. */
export interface NewsletterListCampaignsRouteDeps extends NewsletterRouteBaseDeps {
  newsletterCampaignRepo: {
    list(required: { workspaceId: string }, optional?: { limit?: number; cursor?: string | null }): Promise<{ items: readonly NewsletterCampaign[]; nextCursor: string | null }>;
  };
}

/** The status filter (string-only, as Express may hand an array) and the raw query for paging. */
export interface NewsletterListCampaignsInput { status: string | undefined; query: Record<string, unknown> }

/**
 * `LIST_CAMPAIGNS` (api.spec.md §1) — `GET .../newsletter/campaigns`, optionally filtered by
 * `?status=`. `admin.newsletter.read`-gated. No dedicated read-service exists for Newsletter (the
 * spec's write chokepoints are `campaign-write-service.ts`; reads go straight through
 * `NewsletterCampaignRepoPort.list`), mirroring `members/list.ts`'s identical "no read-service
 * wrapper, call the repo directly" precedent.
 *
 * Paging is parsed only after the permission check, as the hand-written route did, so a refused
 * caller with a malformed `limit` still gets the 403, not the 400.
 */
export const newsletterListCampaignsRoute = defineJsonRoute<NewsletterListCampaignsInput, { data: NewsletterCampaign[]; nextCursor: string | null }, NewsletterListCampaignsRouteDeps, NewsletterRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns",
  parse: (raw) => ok({ value: { status: typeof raw.query.status === "string" ? raw.query.status : undefined, query: raw.query } }),
  handle: ({ input, deps, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.read", entityType: "newsletter_campaign" });
    const paging = parseListPageRequest({ value: input.query }, { defaultLimit: 100, maxLimit: 100 });
    const page = await deps.newsletterCampaignRepo.list({ workspaceId: deps.workspaceId }, paging);
    // The filter applies to this one page only (the repo has no status predicate), as before.
    const filtered = input.status ? page.items.filter((c) => c.status === input.status) : [...page.items];
    return ok({ value: { ...toDataResponse({ data: filtered }), nextCursor: page.nextCursor } });
  } }, { listPaging: true }),
});
