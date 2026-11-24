import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { NewsletterCampaign } from "../../http/newsletter.js";

/**
 * @file The campaign collaborators the campaign route specs share. Each is the host's own
 * campaign-write-service / send-pipeline function with its deps already bound, so a spec only
 * supplies the request's input — the same input object the hand-written route passed.
 */

/** A campaign write's result: the campaign as it now stands. */
export interface NewsletterCampaignResult { campaign: NewsletterCampaign }

/** The editable campaign fields `saveCampaign` always overwrites (it has no partial-update mode). */
export type NewsletterCampaignFields = Pick<NewsletterCampaign, "subject" | "bodyJson" | "preheader" | "fromName" | "fromEmail" | "replyTo" | "listId">;

/** The host's `saveCampaign`: create (no `id`) or overwrite (with `id`) a draft campaign. */
export type NewsletterSaveCampaignFn = (
  required: { workspaceId: string; id?: string | undefined; actorId: string; expectedVersion?: number | undefined; fields: NewsletterCampaignFields },
  optional?: Record<string, never>,
) => Promise<NewsletterCampaignResult>;

/** The host's send-pipeline status transitions (pause, resume), keyed by `campaignId`. */
export type NewsletterCampaignTransitionFn = (
  required: { workspaceId: string; campaignId: string },
  optional?: Record<string, never>,
) => Promise<NewsletterCampaignResult>;

/** The one repo read the get/update/send-log routes make. */
export interface NewsletterCampaignReader {
  findById(required: { workspaceId: string; id: string }): Promise<NewsletterCampaign | null>;
}

/**
 * The host's `NewsletterCampaignNotFoundError` answer, raised directly: the route itself decided
 * the campaign is missing, so there is no host error to map. Same status, code and message as the
 * host's error table writes for that class.
 * @complexity O(1).
 */
export function rejectCampaignNotFound({ id }: { id: string }, _optional: Record<string, never> = {}): never {
  rejectRoute({ status: 404, error: `campaign ${id} was not found`, code: "NEWSLETTER_CAMPAIGN_NOT_FOUND" });
}
