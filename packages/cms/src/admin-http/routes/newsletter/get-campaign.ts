import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { toDataResponse, type NewsletterCampaign } from "../../http/newsletter.js";
import { rejectCampaignNotFound, type NewsletterCampaignReader } from "./campaigns.js";
import { admitNewsletterRequest, newsletterIdParam, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** The deps this route reads: the base newsletter deps and the one campaign lookup. */
export interface NewsletterGetCampaignRouteDeps extends NewsletterRouteBaseDeps {
  newsletterCampaignRepo: NewsletterCampaignReader;
}

/** `GET_CAMPAIGN` (api.spec.md §1) — fetch a single campaign. `admin.newsletter.read`-gated. */
export const newsletterGetCampaignRoute = defineJsonRoute<{ id: string }, { data: NewsletterCampaign }, NewsletterGetCampaignRouteDeps, NewsletterRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns/:id",
  parse: (raw) => ok({ value: { id: newsletterIdParam(raw.params) } }),
  handle: ({ input, deps, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.read", entityType: "newsletter_campaign" });
    const campaign = await deps.newsletterCampaignRepo.findById({ workspaceId: deps.workspaceId, id: input.id });
    if (!campaign) rejectCampaignNotFound({ id: input.id });
    return ok({ value: toDataResponse({ data: campaign }) });
  } }),
});
