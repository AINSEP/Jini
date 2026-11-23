import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { toDataResponse, type NewsletterCampaign } from "../../http/newsletter.js";
import type { NewsletterCampaignResult } from "./campaigns.js";
import { admitNewsletterRequest, newsletterIdParam, runNewsletterRoute, type NewsletterRouteBaseDeps, type NewsletterRoutePrincipal } from "./shared.js";

/** One request's send pipeline: the host's `authorizeSend` -> `freezeAudience` -> `claimBatch`, all
 *  bound to the SAME pipeline deps (one Launch Gate evaluation, one hook registry, one mailer). */
export interface NewsletterSendPipeline {
  authorizeSend(required: { workspaceId: string; campaignId: string }): Promise<NewsletterCampaignResult>;
  freezeAudience(required: { workspaceId: string; campaignId: string; listId: string }): Promise<unknown>;
  claimBatch(): Promise<unknown>;
}

/** The deps this route reads: the base newsletter deps, the per-request pipeline factory and the
 *  host's sink for a delivery failure that happens after the 202 was already answered. */
export interface NewsletterSendCampaignRouteDeps extends NewsletterRouteBaseDeps {
  /** Builds the pipeline after boot readiness, once per request (the host may bind a test or real Launch Gate). */
  openSendPipeline: (required?: Record<string, never>) => NewsletterSendPipeline;
  reportDeliveryFailure: (required: { message: string }, optional?: Record<string, never>) => void;
}

/**
 * Freeze the audience, then claim the first batch. Best-effort: orchestrator.spec.md §5 says a
 * `freezeAudience` failure "leaves the campaign `sending` with no snapshot — resumable by
 * re-running `freezeAudience`, never silently retried as a duplicate snapshot", so it is reported
 * and swallowed rather than downgrading an already-committed 202 into a 500 the client would
 * misread as "the send never started."
 * @complexity O(1) plus the pipeline calls.
 */
async function continueDelivery(
  { pipeline, campaign, deps }: { pipeline: NewsletterSendPipeline; campaign: NewsletterCampaign; deps: Pick<NewsletterSendCampaignRouteDeps, "workspaceId" | "reportDeliveryFailure"> },
  _optional: Record<string, never> = {},
): Promise<void> {
  try {
    await pipeline.freezeAudience({ workspaceId: deps.workspaceId, campaignId: campaign.id, listId: campaign.listId });
    await pipeline.claimBatch();
  } catch (freezeErr) {
    deps.reportDeliveryFailure({ message: `freezeAudience/claimBatch failed after authorizeSend for campaign ${campaign.id}: ${(freezeErr as Error).message}` });
  }
}

/**
 * `SEND_CAMPAIGN` (api.spec.md §1/§5) — `POST .../campaigns/:id/send`. `admin.newsletter.
 * campaign.send`-gated. No request body — the Launch Readiness Gate is evaluated server-side,
 * never a client-supplied override (REQ-21).
 *
 * Chains `authorizeSend` -> `freezeAudience` -> `claimBatch` (orchestrator.spec.md §5:
 * `onFreezeAudience` runs "immediately after `authorizeSend` commits, before any batch is
 * claimed"), mirroring the posts update route's inline `processOutbox` drain-after-write idiom
 * (`claimBatch` IS `processOutbox` for this pipeline — see `send-pipeline.ts`). Responds `202` with
 * the campaign as soon as `authorizeSend` itself succeeds (its own committed `status: 'sending'`)
 * — `freezeAudience`/`claimBatch` run best-effort right after, not awaited by the response (see
 * {@link continueDelivery}).
 *
 * In practice `authorizeSend` throws `NEWSLETTER_LAUNCH_GATE_BLOCKED` (409) in both of the host's
 * composition roots today (its Launch Gate precondition (a) is hard-wired off) — by design, not a
 * gap this route can or should close (see tasks.md's "Real Sending Is Inherently Blocked Today" flag).
 */
export const newsletterSendCampaignRoute = defineJsonRoute<{ id: string }, { data: NewsletterCampaign }, NewsletterSendCampaignRouteDeps, NewsletterRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns/:id/send",
  parse: (raw) => ok({ value: { id: newsletterIdParam(raw.params) } }),
  handle: ({ input, deps, authorize }) => runNewsletterRoute({ mapError: deps.mapNewsletterError, run: async () => {
    await admitNewsletterRequest({ authorize, deps, permission: "admin.newsletter.campaign.send", entityType: "newsletter_campaign" });
    const pipeline = deps.openSendPipeline();
    const { campaign } = await pipeline.authorizeSend({ workspaceId: deps.workspaceId, campaignId: input.id });
    // Not awaited: the 202 answers the committed authorization; delivery never fails it (see continueDelivery).
    void continueDelivery({ pipeline, campaign, deps });
    return ok({ value: toDataResponse({ data: campaign }) });
  } }),
}, { successStatus: 202 });
