import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { toDataResponse, type NewsletterCampaign } from "../../http/newsletter.js";
import type { NewsletterCampaignResult } from "./campaigns.js";
import { admitNewsletterRequest, newsletterActorId, newsletterIdParam, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** The host's `scheduleCampaign` (`draft` -> `scheduled`), deps already bound. */
export type NewsletterScheduleCampaignFn = (
  required: { workspaceId: string; id: string; actorId: string; scheduledAt: string },
  optional?: Record<string, never>,
) => Promise<NewsletterCampaignResult>;

/** The deps this route reads: the base newsletter deps, the clock for "now" and the host's bound `scheduleCampaign`. */
export interface NewsletterScheduleCampaignRouteDeps extends NewsletterRouteBaseDeps {
  clock: { nowIso(): string };
  scheduleCampaign: NewsletterScheduleCampaignFn;
}

/** True when `scheduledAt` is a valid request value: absent, `null`, or a string.
 *  @complexity O(1). */
function isValidScheduledAt({ rawBody }: { rawBody: unknown }, _optional = {}): boolean {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  return body.scheduledAt === undefined || body.scheduledAt === null || typeof body.scheduledAt === "string";
}

/**
 * `SCHEDULE_CAMPAIGN` (api.spec.md §1/§4) — `POST .../campaigns/:id/schedule`, `draft` ->
 * `scheduled`. `scheduledAt` is optional (absent/null = send as soon as the pipeline picks it up);
 * `scheduleCampaign` (`campaign-write-service.ts`) requires a `string`, so an absent/null value
 * defaults to "now" here at the route layer (a reasonable, disclosed route-level interpretation of
 * "as soon as the pipeline picks it up" — the write chokepoint's own type does not model a null
 * `scheduledAt`, and changing that type is out of this dispatch's scope).
 */
export const newsletterScheduleCampaignRoute = defineJsonRoute<{ id: string; scheduledAt: string | undefined }, { data: NewsletterCampaign }, NewsletterScheduleCampaignRouteDeps, NewsletterRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns/:id/schedule",
  parse: (raw) => {
    if (!isValidScheduledAt({ rawBody: raw.body })) {
      rejectRoute({ status: 400, error: "scheduledAt must be a date-time string when provided", code: "NEWSLETTER_VALIDATION_ERROR" });
    }
    const scheduledAt = (raw.body as { scheduledAt?: unknown } | undefined)?.scheduledAt;
    return ok({ value: { id: newsletterIdParam(raw.params), scheduledAt: typeof scheduledAt === "string" ? scheduledAt : undefined } });
  },
  handle: ({ input, deps, context, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.campaign.schedule", entityType: "newsletter_campaign" });
    // Absent/null resolves to "now" — see the route doc for why.
    const scheduledAt = input.scheduledAt ?? deps.clock.nowIso();
    const { campaign } = await deps.scheduleCampaign({ workspaceId: deps.workspaceId, id: input.id, actorId: newsletterActorId({ context }), scheduledAt });
    return ok({ value: toDataResponse({ data: campaign }) });
  } }),
});
