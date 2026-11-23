import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { decodeListCursor, pageFromOverfetch, parseListPageRequest } from "@jini-ai/core/list-page";

import { toDataResponse } from "../../http/newsletter.js";
import { rejectCampaignNotFound, type NewsletterCampaignReader } from "./campaigns.js";
import { admitNewsletterRequest, newsletterIdParam, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** A send-log row: the route reads only its id (the keyset position); the host's row is answered whole. */
export interface NewsletterSendLogRow { id: string }

/** The deps this route reads: the base newsletter deps, the campaign existence check and the send-log read. */
export interface NewsletterListSendLogRouteDeps extends NewsletterRouteBaseDeps {
  newsletterCampaignRepo: NewsletterCampaignReader;
  newsletterSendRepo: {
    listByCampaign(required: { workspaceId: string; campaignId: string; afterId?: string | undefined; limit?: number }): Promise<NewsletterSendLogRow[]>;
  };
}

/**
 * `LIST_SEND_LOG` (api.spec.md §1) — `GET .../newsletter/campaigns/:id/sends`.
 * `admin.newsletter.subscriber.read`-gated (PII-adjacent). An unknown campaign is the 404 before
 * the paging query is even read, as the hand-written route ordered it.
 */
export const newsletterListSendLogRoute = defineJsonRoute<{ id: string; query: Record<string, unknown> }, { data: NewsletterSendLogRow[]; nextCursor: string | null }, NewsletterListSendLogRouteDeps, NewsletterRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns/:id/sends",
  parse: (raw) => ok({ value: { id: newsletterIdParam(raw.params), query: raw.query } }),
  handle: ({ input, deps, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.subscriber.read", entityType: "newsletter_campaign" });
    const campaignId = input.id;
    const campaign = await deps.newsletterCampaignRepo.findById({ workspaceId: deps.workspaceId, id: campaignId });
    if (!campaign) rejectCampaignNotFound({ id: campaignId });

    const { limit, cursor } = parseListPageRequest({ value: input.query }, { defaultLimit: 100, maxLimit: 100 });
    const after = cursor != null ? decodeListCursor({ cursor, shape: ["string"] }) : null;
    const afterId = after ? String(after[0]) : undefined;
    // One row past the limit only proves another page exists; pageFromOverfetch never returns it.
    const rows = await deps.newsletterSendRepo.listByCampaign({ workspaceId: deps.workspaceId, campaignId, afterId, limit: limit + 1 });
    const page = pageFromOverfetch({ rows, limit, positionOf: (row) => [row.id] });
    return ok({ value: { ...toDataResponse({ data: [...page.items] }), nextCursor: page.nextCursor } });
  } }, { listPaging: true }),
});
