

import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";
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

import { cancelCampaign, saveCampaign, type CampaignWriteServiceDeps } from "@jini-ai/user-management/newsletter/campaign-write-service";
import { issueConfirmationToken } from "@jini-ai/user-management/newsletter/confirmation";

import { NewsletterCampaignNotFoundError, NewsletterSubscriptionNotFoundError } from "@jini-ai/user-management/newsletter/errors";

import { archiveList, saveList, type ListsDeps } from "@jini-ai/user-management/newsletter/lists";

import { pauseCampaign } from "@jini-ai/user-management/newsletter/send-pipeline";
import { saveSubscription, unsubscribeSubscription, type UnsubscribeSubscriptionDeps } from "@jini-ai/user-management/newsletter/subscriptions";
import type { SubscriptionRow } from "@jini-ai/user-management/newsletter/types";
import { toNewsletterSendPipelineDeps, type NewsletterToolDeps } from "./tool-registrations.js";
import { toCampaignToolView, toListToolView, toSubscriptionToolView } from "./tool-registrations.read.js";

/**
 * Assembles `campaign-write-service.ts`'s deps bundle from {@link NewsletterToolDeps} — a local
 * duplicate of `host src/server/inbound/admin-http/routes/newsletter/deps.ts`'s `toCampaignWriteServiceDeps` rather than
 * an import of it, for the same reason `features/settings/tool-registrations.ts`'s header gives for
 * duplicating `toWriteServiceDeps`: importing from the HTTP admin layer would invert this codebase's
 * ports/adapters direction. Each `to*Deps` mapper below carries the identical rationale.
 */
export function toCampaignWriteServiceDeps(deps: NewsletterToolDeps): CampaignWriteServiceDeps {
  return {
    campaignRepo: deps.newsletterCampaignRepo,
    listRepo: deps.newsletterListRepo,
    clock: deps.clock,
    ids: deps.idGen,
  };
}

/** Assembles `lists.ts`'s deps bundle — the local twin of `toCampaignWriteServiceDeps` above. */
export function toListsDeps(deps: NewsletterToolDeps): ListsDeps {
  return { listRepo: deps.newsletterListRepo, clock: deps.clock, ids: deps.idGen };
}

/** Assembles `subscriptions.ts`'s `unsubscribeSubscription` deps bundle — the local twin of
 * `toCampaignWriteServiceDeps` above. */
export function toUnsubscribeSubscriptionDeps(deps: NewsletterToolDeps): UnsubscribeSubscriptionDeps {
  return {
    subscriptionRepo: deps.newsletterSubscriptionRepo,
    consentCapability: deps.membersConsentCapability,
    clock: deps.clock,
  };
}

export async function resendPendingSubscriptionConfirmation(
  { deps, subscriptionId, signal }: { deps: NewsletterToolDeps; subscriptionId: string; signal: AbortSignal },
  _options: Record<string, never> = {},
) {
  try {
    const subscription = await deps.newsletterSubscriptionRepo.findById({ workspaceId: deps.workspaceId, id: subscriptionId });
    // Constant acknowledgement for missing subscriptions, missing contacts and non-pending records.
    if (!subscription || subscription.status !== "pending") return { delivered: true, mailDeliveryAvailable: true };
    const contact = await deps.newsletterSubscriberDirectory.getContact({ workspaceId: deps.workspaceId, subscriberId: subscription.subscriberId });
    if (signal.aborted) return { confirmed: false, reason: "abandoned", delivered: false, mailDeliveryAvailable: true };
    if (contact) {
      await issueConfirmationToken({
        deps: deps.buildConfirmationDeps({ deps }),
        input: { workspaceId: deps.workspaceId, subscriptionId: subscription.id, recipientEmail: contact.email },
      });
    }
  } catch (error) {
    let errorDiagnostic = "[diagnostic unavailable]";
    try { errorDiagnostic = describeErrorForLog({ err: error }); } catch { /* Keep the original failure path if diagnostics fail. */ }
    // A contact-specific failure must not turn this acknowledgement into an enumeration oracle.
    // Keep diagnostics free of addresses, tokens and provider endpoints.
    console.error("[newsletter] confirmation request could not be processed; inspect mail configuration", errorDiagnostic);
  }
  return { delivered: true, mailDeliveryAvailable: true };
}

export function createNewsletterCreateCampaignHandler(deps: NewsletterToolDeps): ToolHandler {
  return async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.newsletter.campaign.compose" }, { entityType: "newsletter_campaign" });

  await deps.newsletterReady;
  ctx.signal.throwIfAborted();
  const { campaign } = await saveCampaign({
    deps: toCampaignWriteServiceDeps(deps),
    input: {
      workspaceId: deps.workspaceId,
      actorId: ctx.principal.id,
      // Recorded at write time so the agent-pause hold can tell this campaign from an owner-made one.
      creatorKind: "agent",
      fields: {
        subject: requireString({ input, key: "subject" }),
        preheader: typeof input.preheader === "string" ? input.preheader : null,
        fromName: requireString({ input, key: "fromName" }),
        fromEmail: requireString({ input, key: "fromEmail" }),
        replyTo: requireString({ input, key: "replyTo" }),
        listId: requireString({ input, key: "listId" }),
      },
    },
  });
  return { campaign: toCampaignToolView(campaign) };
};
}

export function createNewsletterUpdateCampaignHandler(deps: NewsletterToolDeps): ToolHandler {
  return async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const campaignId = requireString({ input, key: "campaignId" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.newsletter.campaign.compose" }, { entityType: "newsletter_campaign" });

  await deps.newsletterReady;
  const existing = await deps.newsletterCampaignRepo.findById({ workspaceId: deps.workspaceId, id: campaignId });
  if (!existing) throw new NewsletterCampaignNotFoundError(`campaign ${campaignId} was not found`);

  ctx.signal.throwIfAborted();
  const { campaign } = await saveCampaign({
    deps: toCampaignWriteServiceDeps(deps),
    input: {
      workspaceId: deps.workspaceId,
      id: campaignId,
      actorId: ctx.principal.id,
      fields: {
        subject: typeof input.subject === "string" ? input.subject : existing.subject,
        preheader: typeof input.preheader === "string" ? input.preheader : existing.preheader,
        fromName: typeof input.fromName === "string" ? input.fromName : existing.fromName,
        fromEmail: typeof input.fromEmail === "string" ? input.fromEmail : existing.fromEmail,
        replyTo: typeof input.replyTo === "string" ? input.replyTo : existing.replyTo,
        listId: typeof input.listId === "string" ? input.listId : existing.listId,
      },
    },
  });
  return { campaign: toCampaignToolView(campaign) };
};
}

export function createNewsletterCancelCampaignHandler(deps: NewsletterToolDeps): ToolHandler {
  return async (ctx) => {
  const campaignId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "campaignId" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.newsletter.campaign.compose" }, { entityType: "newsletter_campaign" });

  await deps.newsletterReady;
  ctx.signal.throwIfAborted();
  const { campaign } = await cancelCampaign({
    deps: toCampaignWriteServiceDeps(deps),
    input: { workspaceId: deps.workspaceId, id: campaignId, actorId: ctx.principal.id },
  });
  return { campaign: toCampaignToolView(campaign) };
};
}

export function createNewsletterPauseCampaignHandler(deps: NewsletterToolDeps): ToolHandler {
  return async (ctx) => {
  const campaignId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "campaignId" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.newsletter.campaign.send" }, { entityType: "newsletter_campaign" });

  await deps.newsletterReady;
  const { campaign } = await pauseCampaign({ deps: toNewsletterSendPipelineDeps(deps), input: { workspaceId: deps.workspaceId, campaignId } });
  return { campaign: toCampaignToolView(campaign) };
};
}

export function createNewsletterCreateListHandler(deps: NewsletterToolDeps): ToolHandler {
  return async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.newsletter.list.manage" }, { entityType: "newsletter_list" });

  await deps.newsletterReady;
  ctx.signal.throwIfAborted();
  const { list } = await saveList({
    deps: toListsDeps(deps),
    input: { workspaceId: deps.workspaceId, name: requireString({ input, key: "name" }), slug: requireString({ input, key: "slug" }) },
  });
  return { list: toListToolView(list) };
};
}

export function createNewsletterArchiveListHandler(deps: NewsletterToolDeps): ToolHandler {
  return async (ctx) => {
  const listId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "listId" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.newsletter.list.manage" }, { entityType: "newsletter_list" });

  await deps.newsletterReady;
  ctx.signal.throwIfAborted();
  const { list } = await archiveList({ deps: toListsDeps(deps), input: { workspaceId: deps.workspaceId, id: listId } });
  return { list: toListToolView(list) };
};
}

export function createNewsletterCreateSubscriptionHandler(deps: NewsletterToolDeps): ToolHandler {
  return async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const listId = requireString({ input, key: "listId" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.newsletter.subscriber.manage" }, { entityType: "newsletter_subscription" });

  await deps.newsletterReady;
  const source = typeof input.source === "string" ? (input.source as SubscriptionRow["source"]) : "admin";
  ctx.signal.throwIfAborted();
  const { subscription } = await saveSubscription({
    deps: deps.buildSubscriptionsDeps({ deps }),
    input: { workspaceId: deps.workspaceId, listId, subscriberId: requireString({ input, key: "subscriberId" }), source },
  });
  return { subscription: toSubscriptionToolView(subscription) };
};
}

export function createNewsletterRemoveSubscriptionHandler(deps: NewsletterToolDeps): ToolHandler {
  return async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const listId = requireString({ input, key: "listId" });
  const subscriptionId = requireString({ input, key: "subscriptionId" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.newsletter.subscriber.manage" }, { entityType: "newsletter_subscription" });

  await deps.newsletterReady;
  const existing = await deps.newsletterSubscriptionRepo.findById({ workspaceId: deps.workspaceId, id: subscriptionId });
  if (!existing || existing.listId !== listId) {
    throw new NewsletterSubscriptionNotFoundError(`subscription ${subscriptionId} was not found`);
  }

  const { subscription } = await unsubscribeSubscription({
    deps: toUnsubscribeSubscriptionDeps(deps),
    input: { workspaceId: deps.workspaceId, id: subscriptionId },
  });
  return { subscription: toSubscriptionToolView(subscription) };
};
}

export function createNewsletterResendConfirmationHandler(deps: NewsletterToolDeps): ToolHandler {
  return async (ctx) => {
  const subscriptionId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "subscriptionId" });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.newsletter.subscriber.manage" }, { entityType: "newsletter_subscription" });

  await deps.newsletterReady;
  const mailOff = { delivered: false, mailDeliveryAvailable: false, note: "Email sending is not configured. Configure an SMTP credential or a mail adapter in Agent Plugins to send real email." };
  const driver = deps.mailer.capabilities().driver;
  if (driver === "console" || driver === "memory") return mailOff;
  if (ctx.signal.aborted) return { confirmed: false, reason: "abandoned", delivered: false, mailDeliveryAvailable: true };
  const currentDriver = deps.mailer.capabilities().driver;
  if (currentDriver === "console" || currentDriver === "memory") return mailOff;
  return resendPendingSubscriptionConfirmation({ deps, subscriptionId, signal: ctx.signal });
};
}