import { decodeListCursor, listPageForModel, pageFromOverfetch, parseListPageRequest } from "@jini-ai/core/list-page";

/**
 * @file Newsletter's half of ADR-049 Decision 4 (ADR-PIPE-011/SPEC-011): maps `agent-tools.ts`'s
 * catalog entries onto existing campaign/list/subscription services as ToolRegistrations.
 * Delivery operations are contributed separately from delivery/tool-registrations.ts; bulk import is absent.
 *
 * Authorization shape: `@jini-ai/user-management/newsletter/http-error-responses`'s consumers (the admin route specs in Jini's
 * `@jini-ai/cms/admin-http/routes/newsletter/*`) record that "none of Newsletter's domain functions call authorize() ...
 * every admin route therefore asks for its own permission as its first step". Every handler here does the same via
 * the kit's `requireToolPermission` — ADR-021 §2's single evaluation, located where the real route
 * locates it.
 */
import { requireInputRecord, requireString, type ToolHandler } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "@jini-ai/core";

import { NewsletterCampaignNotFoundError } from "@jini-ai/user-management/newsletter/errors";

import type { CampaignRecord, NewsletterListRow, SendRow, SubscriptionRow } from "@jini-ai/user-management/newsletter/types";
import type { NewsletterToolDeps } from "./tool-registrations.js";

/** Model-facing campaign view — drops `workspaceId` (same reasoning as every other `to*View` in this codebase) and the pipeline-internal `audienceSnapshotId`/`sendStartedAt`/`createdByPrincipal` (plumbing no wired tool's follow-up call consumes). */
export function toCampaignToolView(campaign: CampaignRecord) {
  return {
    id: campaign.id,
    status: campaign.status,
    subject: campaign.subject,
    preheader: campaign.preheader,
    fromName: campaign.fromName,
    fromEmail: campaign.fromEmail,
    replyTo: campaign.replyTo,
    listId: campaign.listId,
    scheduledAt: campaign.scheduledAt,
    counters: { ...campaign.counters },
    version: campaign.version,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  };
}

/** Model-facing list view. */
export function toListToolView(list: NewsletterListRow) {
  return { id: list.id, name: list.name, slug: list.slug, isDefault: list.isDefault, status: list.status };
}

/** Model-facing subscription view — drops `consentRevisionIdAtSubscribe` (an internal binding token, not a decision-relevant value). */
export function toSubscriptionToolView(subscription: SubscriptionRow) {
  return {
    id: subscription.id,
    listId: subscription.listId,
    subscriberId: subscription.subscriberId,
    status: subscription.status,
    source: subscription.source,
    subscribedAt: subscription.subscribedAt,
    unsubscribedAt: subscription.unsubscribedAt,
  };
}

/** Model-facing send-log row view — drops `idempotencyKey`/`audienceSnapshotId` (delivery-plumbing internals). */
export function toSendLogToolView(row: SendRow) {
  return {
    id: row.id,
    subscriberId: row.subscriberId,
    recipientEmail: row.recipientEmail,
    status: row.status,
    attempts: row.attempts,
    providerMessageId: row.providerMessageId,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt,
    updatedAt: row.updatedAt,
  };
}

export function createNewsletterListCampaignsHandler(deps: NewsletterToolDeps): ToolHandler {
  return async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.newsletter.read" }, { entityType: "newsletter_campaign" });

  await deps.newsletterReady;
  const status = typeof input.status === "string" ? input.status : undefined;
  const paging = parseListPageRequest({ value: input }, { defaultLimit: 100, maxLimit: 100 });
  const page = await deps.newsletterCampaignRepo.list({ workspaceId: deps.workspaceId }, paging);
  const items = status ? page.items.filter(campaign => campaign.status === status) : page.items;
  const { items: campaigns, ...continuation } = listPageForModel({ page: { ...page, items }, toolId: "newsletter_list_campaigns" });
  return { campaigns: campaigns.map(toCampaignToolView), ...continuation };
};
}

export function createNewsletterGetCampaignHandler(deps: NewsletterToolDeps): ToolHandler {
  return async (ctx) => {
  const campaignId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "campaignId" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.newsletter.read" }, { entityType: "newsletter_campaign" });

  await deps.newsletterReady;
  const campaign = await deps.newsletterCampaignRepo.findById({ workspaceId: deps.workspaceId, id: campaignId });
  if (!campaign) throw new NewsletterCampaignNotFoundError(`campaign ${campaignId} was not found`);
  return { campaign: toCampaignToolView(campaign) };
};
}

export function createNewsletterListListsHandler(deps: NewsletterToolDeps): ToolHandler {
  return async (ctx) => {
  requireInputRecord({ input: ctx.input });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.newsletter.read" }, { entityType: "newsletter_list" });

  await deps.newsletterReady;
  const lists = await deps.newsletterListRepo.list({ workspaceId: deps.workspaceId });
  return { lists: lists.map(toListToolView) };
};
}

export function createNewsletterListSubscriptionsHandler(deps: NewsletterToolDeps): ToolHandler {
  return async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const listId = requireString({ input, key: "listId" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.newsletter.subscriber.read" }, { entityType: "newsletter_subscription" });

  await deps.newsletterReady;
  const paging = parseListPageRequest({ value: input }, { defaultLimit: 100, maxLimit: 100 });
  const page = await deps.newsletterSubscriptionRepo.list({ workspaceId: deps.workspaceId, listId }, paging);
  const { items, ...continuation } = listPageForModel({ page, toolId: "newsletter_list_subscriptions" });
  return { subscriptions: items.map(toSubscriptionToolView), ...continuation };
};
}

export function createNewsletterListSendLogHandler({ deps }: { deps: NewsletterToolDeps }, _optional = {}): ToolHandler {
  return async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const campaignId = requireString({ input, key: "campaignId" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.newsletter.subscriber.read" }, { entityType: "newsletter_campaign" });

  await deps.newsletterReady;
  const campaign = await deps.newsletterCampaignRepo.findById({ workspaceId: deps.workspaceId, id: campaignId });
  if (!campaign) throw new NewsletterCampaignNotFoundError(`campaign ${campaignId} was not found`);
  const { limit, cursor } = parseListPageRequest(
    { value: input },
    { defaultLimit: 100, maxLimit: 100 },
  );
  const after = cursor != null ? decodeListCursor({ cursor, shape: ["string"] }) : null;
  const afterId = after ? String(after[0]) : undefined;
  // One extra row proves continuation.
  const rows = await deps.newsletterSendRepo.listByCampaign({
    workspaceId: deps.workspaceId,
    campaignId,
    ...(afterId === undefined ? {} : { afterId }),
    limit: limit + 1,
  });
  const page = pageFromOverfetch({ rows, limit, positionOf: (row) => [row.id] });
  const { items, ...continuation } = listPageForModel({
    page,
    toolId: "newsletter_list_send_log",
  });
  return {
    sends: items.map(toSendLogToolView),
    ...continuation,
    truncated: continuation.nextCursor !== null,
  };
};
}