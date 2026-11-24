import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { toDataResponse, type NewsletterCampaign } from "../../http/newsletter.js";
import type { NewsletterCampaignTransitionFn } from "./campaigns.js";
import { admitNewsletterRequest, newsletterIdParam, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** The deps this route reads: the base newsletter deps and the host's bound send-pipeline `pauseCampaign`. */
export interface NewsletterPauseCampaignRouteDeps extends NewsletterRouteBaseDeps {
  pauseCampaign: NewsletterCampaignTransitionFn;
}

/** `PAUSE_CAMPAIGN` (api.spec.md §1) — `POST .../campaigns/:id/pause`, `sending` -> `paused`. `admin.newsletter.campaign.send`-gated. */
export const newsletterPauseCampaignRoute = defineJsonRoute<{ id: string }, { data: NewsletterCampaign }, NewsletterPauseCampaignRouteDeps, NewsletterRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns/:id/pause",
  parse: (raw) => ok({ value: { id: newsletterIdParam(raw.params) } }),
  handle: ({ input, deps, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.campaign.send", entityType: "newsletter_campaign" });
    const { campaign } = await deps.pauseCampaign({ workspaceId: deps.workspaceId, campaignId: input.id });
    return ok({ value: toDataResponse({ data: campaign }) });
  } }),
});
