import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { toDataResponse, type NewsletterCampaign } from "../../http/newsletter.js";
import type { NewsletterCampaignResult } from "./campaigns.js";
import { admitNewsletterRequest, newsletterActorId, newsletterIdParam, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** The host's `cancelCampaign`, deps already bound. */
export type NewsletterCancelCampaignFn = (
  required: { workspaceId: string; id: string; actorId: string },
  optional?: Record<string, never>,
) => Promise<NewsletterCampaignResult>;

/** The deps this route reads: the base newsletter deps and the host's bound `cancelCampaign`. */
export interface NewsletterCancelCampaignRouteDeps extends NewsletterRouteBaseDeps {
  cancelCampaign: NewsletterCancelCampaignFn;
}

/**
 * `CANCEL_CAMPAIGN` (api.spec.md §1/§5) — `POST .../campaigns/:id/cancel`. `admin.newsletter.
 * campaign.compose`-gated (cancel is a compose-tier transition per `campaign.ts`'s
 * `transitionCampaignStatus`). Returns the canceled campaign (200), not `204`.
 */
export const newsletterCancelCampaignRoute = defineJsonRoute<{ id: string }, { data: NewsletterCampaign }, NewsletterCancelCampaignRouteDeps, NewsletterRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns/:id/cancel",
  parse: (raw) => ok({ value: { id: newsletterIdParam(raw.params) } }),
  handle: ({ input, deps, context, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.campaign.compose", entityType: "newsletter_campaign" });
    const { campaign } = await deps.cancelCampaign({ workspaceId: deps.workspaceId, id: input.id, actorId: newsletterActorId({ context }) });
    return ok({ value: toDataResponse({ data: campaign }) });
  } }),
});
