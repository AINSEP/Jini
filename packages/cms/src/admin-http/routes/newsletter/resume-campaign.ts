import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { toDataResponse, type NewsletterCampaign } from "../../http/newsletter.js";
import type { NewsletterCampaignTransitionFn } from "./campaigns.js";
import { admitNewsletterRequest, newsletterIdParam, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** The deps this route reads: the base newsletter deps and the host's bound send-pipeline `resumeCampaign`. */
export interface NewsletterResumeCampaignRouteDeps extends NewsletterRouteBaseDeps {
  resumeCampaign: NewsletterCampaignTransitionFn;
}

/** `RESUME_CAMPAIGN` (api.spec.md §1) — `POST .../campaigns/:id/resume`, `paused` -> `sending`. `admin.newsletter.campaign.send`-gated.
 * Only the campaign is answered: the pipeline's own `requeueFailed` flag never reached the wire. */
export const newsletterResumeCampaignRoute = defineJsonRoute<{ id: string }, { data: NewsletterCampaign }, NewsletterResumeCampaignRouteDeps, NewsletterRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns/:id/resume",
  parse: (raw) => ok({ value: { id: newsletterIdParam(raw.params) } }),
  handle: ({ input, deps, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.campaign.send", entityType: "newsletter_campaign" });
    const { campaign } = await deps.resumeCampaign({ workspaceId: deps.workspaceId, campaignId: input.id });
    return ok({ value: toDataResponse({ data: campaign }) });
  } }),
});
