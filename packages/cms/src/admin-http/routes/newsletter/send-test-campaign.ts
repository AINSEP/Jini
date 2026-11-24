import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { admitNewsletterRequest, newsletterIdParam, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** One test-send outcome as the host's send pipeline reports it. */
export interface NewsletterTestSendResult { email: string; outcome: "sent" | "failed"; error: string | null; errorCode?: string }

/** One test-send outcome on the wire. */
export interface NewsletterTestSendResultDto { address: string; ok: boolean; errorCode: string | null; message?: string | null }

/** The host's `sendTestCampaign`, deps already bound. */
export type NewsletterSendTestCampaignFn = (
  required: { workspaceId: string; campaignId: string; testAddresses: readonly string[] },
  optional?: Record<string, never>,
) => Promise<{ results: readonly NewsletterTestSendResult[] }>;

/** The deps this route reads: the base newsletter deps and the host's bound `sendTestCampaign`. */
export interface NewsletterSendTestCampaignRouteDeps extends NewsletterRouteBaseDeps {
  sendTestCampaign: NewsletterSendTestCampaignFn;
}

/** The wire shape of one result: a sent address carries no error code (even if the pipeline set
 *  one); only a failed one carries its `message`. @complexity O(1). */
function toTestSendResultDto(r: NewsletterTestSendResult): NewsletterTestSendResultDto {
  return { address: r.email, ok: r.outcome === "sent", errorCode: r.outcome === "sent" ? null : (r.errorCode ?? null), ...(r.outcome === "failed" ? { message: r.error ?? null } : {}) };
}

/**
 * `SEND_TEST_CAMPAIGN` (api.spec.md §1/§4/§5) — `POST .../campaigns/:id/send-test`. `admin.
 * newsletter.campaign.send_test`-gated. `testAddresses`: 1-10 emails, never touches the real
 * subscriber list (REQ-20) — `sendTestCampaign` itself enforces the 1-10 bound and evaluates the
 * Launch Gate with `isTestSend: true` (only preconditions (c)/(d), never (a)/(b)). This route only
 * checks the shape, in `parse`, so a bad body is a 400 before the permission check.
 */
export const newsletterSendTestCampaignRoute = defineJsonRoute<{ id: string; testAddresses: string[] }, { data: { results: NewsletterTestSendResultDto[] } }, NewsletterSendTestCampaignRouteDeps, NewsletterRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns/:id/send-test",
  parse: (raw) => {
    const body = (raw.body ?? {}) as { testAddresses?: unknown };
    if (!Array.isArray(body.testAddresses) || !body.testAddresses.every((a: unknown) => typeof a === "string")) {
      rejectRoute({ status: 400, error: "testAddresses must be an array of email strings", code: "VALIDATION_ERROR" });
    }
    return ok({ value: { id: newsletterIdParam(raw.params), testAddresses: body.testAddresses as string[] } });
  },
  handle: ({ input, deps, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.campaign.send_test", entityType: "newsletter_campaign" });
    const { results } = await deps.sendTestCampaign({ workspaceId: deps.workspaceId, campaignId: input.id, testAddresses: input.testAddresses });
    return ok({ value: { data: { results: results.map(toTestSendResultDto) } } });
  } }),
});
