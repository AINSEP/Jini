import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { toDataResponse, type NewsletterCampaign } from "../../http/newsletter.js";
import type { NewsletterCampaignFields, NewsletterSaveCampaignFn } from "./campaigns.js";
import { admitNewsletterRequest, newsletterActorId, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** The deps this route reads: the base newsletter deps and the host's bound `saveCampaign`. */
export interface NewsletterCreateCampaignRouteDeps extends NewsletterRouteBaseDeps {
  saveCampaign: NewsletterSaveCampaignFn;
}

/** This route's five required string fields, in the one order used for validation. */
const REQUIRED_CAMPAIGN_STRING_FIELDS = ["subject", "fromName", "fromEmail", "replyTo", "listId"] as const;

/** This route's campaign fields, validated and read off an untyped body in one place, or `null` if
 *  a required field is missing or the wrong shape.
 *  @complexity O(1) — iterates a fixed 5-entry field list. */
function parseCreateCampaignBody({ rawBody }: { rawBody: unknown }, _optional = {}): NewsletterCampaignFields | null {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  for (const name of REQUIRED_CAMPAIGN_STRING_FIELDS) {
    if (typeof body[name] !== "string") {
      return null;
    }
  }
  if (typeof body.bodyJson !== "object" || body.bodyJson === null || Array.isArray(body.bodyJson)) {
    return null;
  }
  return {
    subject: body.subject as string,
    bodyJson: body.bodyJson as Record<string, unknown>,
    preheader: typeof body.preheader === "string" ? body.preheader : null,
    fromName: body.fromName as string,
    fromEmail: body.fromEmail as string,
    replyTo: body.replyTo as string,
    listId: body.listId as string,
  };
}

/**
 * `CREATE_CAMPAIGN` (api.spec.md §1/§4) — `POST .../newsletter/campaigns`, creates a `draft`
 * campaign. `admin.newsletter.campaign.compose`-gated. The body is refused in `parse`, so a bad
 * body is a 400 before the permission check, as the hand-written route answered it.
 *
 * The bespoke campaign table (ADR-PIPE-011 Decision §2) stores only envelope fields, which
 * previously caused this route to validate then discard bodyJson. The write chokepoint now keeps
 * the document in its existing same-transaction revision state_json; detail reads project the
 * latest document alongside the live envelope; list reads keep only the envelope. No new column or alternate content owner is needed.
 */
export const newsletterCreateCampaignRoute = defineJsonRoute<{ fields: NewsletterCampaignFields }, { data: NewsletterCampaign }, NewsletterCreateCampaignRouteDeps, NewsletterRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns",
  parse: (raw) => {
    const fields = parseCreateCampaignBody({ rawBody: raw.body });
    if (!fields) {
      rejectRoute({ status: 400, error: "subject, fromName, fromEmail, replyTo, listId (strings) and bodyJson (object) are required", code: "VALIDATION_ERROR" });
    }
    return ok({ value: { fields } });
  },
  handle: ({ input, deps, context, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.campaign.compose", entityType: "newsletter_campaign" });
    const { campaign } = await deps.saveCampaign({ workspaceId: deps.workspaceId, actorId: newsletterActorId({ context }), fields: input.fields });
    return ok({ value: toDataResponse({ data: campaign }) });
  } }),
}, { successStatus: 201 });
