import { toolMetadata } from '@jini-ai/core/tool-metadata/newsletter';
import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";
/**
 * Newsletter delivery registrations over the existing send pipeline and campaign write services.
 * Subscriber delivery uses browser-only confirmation; test recipients resolve from the owner profile.
 */
import { ToolInputError, type ToolHandler } from "@jini-ai/core";
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, requireString, type DerivedRiskByToolId, type ToolRegistration } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "@jini-ai/core";
import type { UserRepoPort } from "@jini-ai/core/contracts/site/user-management";
import type { ToolContributor } from "@jini-ai/core";
import { ToolPermissionDeniedError as ForbiddenError } from "@jini-ai/core";
import { forbiddenRule } from "@jini-ai/core/model-facing-tool-errors";
import { withModelFacingErrors } from "@jini-ai/core/model-facing-tool-errors";

import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { AgentToolDefinition } from "@jini-ai/core";
import { isValidScheduleTimestamp, scheduleCampaign } from "@jini-ai/user-management/newsletter/campaign-write-service";
import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";
import type { ToolExecutionContext, ToolExecutionOptions, HumanConfirmer } from "@jini-ai/core";
import type { CampaignRecord } from "@jini-ai/user-management/newsletter/types";
import { NewsletterCampaignNotEditableError, NewsletterCampaignNotFoundError, NewsletterLaunchGateBlockedError, NewsletterValidationError } from "@jini-ai/user-management/newsletter/errors";
import { evaluateLaunchGate } from "@jini-ai/user-management/newsletter/launch-gate";
import { authorizeSend, claimBatch, completeIfDrained, freezeAudience, resumeCampaign, sendTestCampaign } from "@jini-ai/user-management/newsletter/send-pipeline";
import { toNewsletterSendPipelineDeps, type NewsletterToolDeps } from "../tool-registrations.js";

const MUTATES_DURABLE_STATE = "mutates-durable-state" as const;

/** Owner identity is injected by composition; recipient addresses never come from tool input. */
export interface NewsletterDeliveryToolDeps extends NewsletterToolDeps {
  deliveryCopy: {
    mailOff: string; processingAttention: string; scheduled: string; ownerOnly: string; ownerEmailMissing: string; testNotAccepted: string;
    launchGateBlocked: (unmetPreconditions: readonly string[]) => string;
  };
  reportDeliveryFailure: (message: string, diagnostic: string) => void;
  approvalToolHandler<TPrepared>(required: {
    surfaces: AssistantSurfaceDeps;
    prepare: (required: { ctx: ToolExecutionContext }, optional: ToolExecutionOptions) => Promise<TPrepared>;
    describe: (required: { ctx: ToolExecutionContext; prepared: TPrepared }) => HumanConfirmSpec | Promise<HumanConfirmSpec>;
    run: (required: { ctx: ToolExecutionContext; prepared: TPrepared; confirmer: HumanConfirmer; choice?: string }, optional: ToolExecutionOptions) => Promise<unknown>;
  }, optional?: { ask?: (required: { prepared: TPrepared }) => boolean; declined?: (required: { reason: "declined" | "expired" | "abandoned"; prepared?: TPrepared }) => unknown }): ToolHandler;
  ownerPrincipalId: Promise<string>;
  userRepo: Pick<UserRepoPort, "findByPrincipalId">;
}

const campaignIdSchema = { type: "string", minLength: 1 } as const;
// Real campaign mail cannot be undone; resume continues that same effect for the remaining audience,
// and scheduling expresses future-send intent. Browser-only human confirmation gates these tools.
// Test mail resolves the owner's stored address: accepting an arbitrary model-supplied recipient
// would allow attacker-chosen addresses to receive attacker-influenced campaign content.
/** Newsletter delivery catalog, separate from composition/list management. */
export const newsletterDeliveryAgentToolCatalog: AgentToolDefinition[] = [
  {
    name: "newsletter_send_test",
    description: "Sends a test copy of an existing newsletter issue only to the site owner's stored email, without a confirmation card. Call before a subscriber send; never accepts recipient addresses. Returns {delivered,mailDeliveryAvailable}. Refuses missing owner email, unconfigured mail or an unverified origin. A successful result means provider acceptance, not confirmed inbox delivery.",
    sideEffects: MUTATES_DURABLE_STATE, authorization: { permission: "admin.newsletter.campaign.send_test" },
    inputSchema: { type: "object", additionalProperties: false, required: ["campaignId"], properties: { campaignId: campaignIdSchema } },
  },
  {
    name: "newsletter_send_campaign",
    description: "Launches an existing newsletter issue to its subscriber list after a human confirmation card. Call to send an issue now, not to compose a draft or test it. Returns {confirmed,started,campaignId,status,delivered:false,mailDeliveryAvailable}; launch is not inbox delivery. Refuses mail-off, failed launch readiness, stale confirmation or unavailable confirmation channel.",
    sideEffects: MUTATES_DURABLE_STATE, authorization: { permission: "admin.newsletter.campaign.send" },
    inputSchema: { type: "object", additionalProperties: false, required: ["campaignId"], properties: { campaignId: campaignIdSchema } },
  },
  {
    name: "newsletter_schedule_campaign",
    description: "Saves a draft newsletter issue's scheduled date after a human confirmation card. Call to record when a subscriber send should occur. Returns {confirmed,scheduled,campaignId,status,scheduledAt,delivered:false,mailDeliveryAvailable,note}. Automatic timed delivery is not wired: use newsletter_send_campaign when due. Refuses mail-off, invalid dates, non-drafts, stale confirmation or unavailable confirmation channel.",
    sideEffects: MUTATES_DURABLE_STATE, authorization: { permission: "admin.newsletter.campaign.schedule" },
    inputSchema: { type: "object", additionalProperties: false, required: ["campaignId", "scheduledAt"], properties: { campaignId: campaignIdSchema, scheduledAt: { type: "string", format: "date-time", description: "ISO date-time with explicit timezone." } } },
  },
  {
    name: "newsletter_resume_campaign",
    description: "Resumes a paused newsletter issue's remaining subscriber delivery after a human confirmation card. Use after newsletter_pause_campaign, not to resend a finished issue. Returns {confirmed,started,campaignId,status,delivered:false,mailDeliveryAvailable}. Refuses mail-off, failed launch readiness, stale confirmation, wrong status or unavailable confirmation channel.",
    sideEffects: MUTATES_DURABLE_STATE, authorization: { permission: "admin.newsletter.campaign.send" },
    inputSchema: { type: "object", additionalProperties: false, required: ["campaignId"], properties: { campaignId: campaignIdSchema } },
  },
];

export const newsletterDeliveryDerivedRisk: DerivedRiskByToolId = new Map([
  // sendTestCampaign -> mailer.send (externally visible mail, provider dedup state).
  ["newsletter_send_test", MUTATES_DURABLE_STATE],
  // authorizeSend -> campaign/revision writes; freezeAudience -> snapshot/send/outbox writes; claimBatch -> mail.
  ["newsletter_send_campaign", MUTATES_DURABLE_STATE],
  // scheduleCampaign -> campaign/revision writes, authorizes a future mass send.
  ["newsletter_schedule_campaign", MUTATES_DURABLE_STATE],
  // resumeCampaign -> campaign write; claimBatch -> remaining mail.
  ["newsletter_resume_campaign", MUTATES_DURABLE_STATE],
]);

/** Returns an explicit refusal for non-delivering adapters before a card or write. @complexity O(1). */
function mailOffResult(deps: NewsletterDeliveryToolDeps) {
  const driver = deps.mailer.capabilities().driver;
  if (driver !== "console" && driver !== "memory") return null;
  return { delivered: false, mailDeliveryAvailable: false, note: deps.deliveryCopy.mailOff };
}

/** Reports committed launch state without claiming that downstream processing finished. @complexity O(1). */
function processingAttentionResult({ campaignId, status, deps }: { campaignId: string; status: string; deps: NewsletterDeliveryToolDeps }, _options = {}) {
  return { confirmed: true, started: true, campaignId, status, delivered: false, mailDeliveryAvailable: true, note: deps.deliveryCopy.processingAttention };
}

/** Publishes only fixed launch prerequisites, never provider errors or subscriber addresses. @complexity O(1). */
async function requireMassLaunchReady(deps: NewsletterDeliveryToolDeps): Promise<void> {
  const result = await evaluateLaunchGate({ deps: toNewsletterSendPipelineDeps(deps).launchGateDeps, workspaceId: deps.workspaceId, isTestSend: false });
  if (!result.met) throw new ToolInputError({ message: deps.deliveryCopy.launchGateBlocked(result.unmetPreconditions) });
}
type Prepared = { refusal: NonNullable<ReturnType<typeof mailOffResult>> } | { campaignId: string; existing: CampaignRecord; scheduledAt: string | null };
function createNewsletterCampaignPreparation(deps: NewsletterDeliveryToolDeps, toolId: string): Parameters<typeof deps.approvalToolHandler<Prepared>>[0]['prepare'] {
  return async ({ ctx }) => {
      const input = requireInputRecord({ input: ctx.input });
      const campaignId = requireString({ input: input, key: "campaignId" });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: toolId === "newsletter_schedule_campaign" ? "admin.newsletter.campaign.schedule" : "admin.newsletter.campaign.send" }, { entityType: "newsletter_campaign" });
      const mailOff = mailOffResult(deps);
      if (mailOff) return { refusal: mailOff };
      await deps.newsletterReady;
      const existing = await deps.newsletterCampaignRepo.findById({ workspaceId: deps.workspaceId, id: campaignId });
      if (!existing) throw new NewsletterCampaignNotFoundError(`campaign ${campaignId} was not found`);
      const scheduledAt = toolId === "newsletter_schedule_campaign" ? requireString({ input: input, key: "scheduledAt" }) : null;
      if (scheduledAt !== null && !isValidScheduleTimestamp({ value: scheduledAt })) throw new NewsletterValidationError({ message: "scheduledAt must be a valid ISO date-time string with an explicit timezone", field: "scheduledAt", reason: "format" });
      return { campaignId, existing: structuredClone(existing), scheduledAt };
    };
}

function createNewsletterCampaignDescription(deps: NewsletterDeliveryToolDeps, toolId: string): Parameters<typeof deps.approvalToolHandler<Prepared>>[0]['describe'] {
  return ({ prepared }) => {
      let title = "Send this newsletter?";
      if (toolId === "newsletter_schedule_campaign") title = "Schedule this newsletter?";
      if (toolId === "newsletter_resume_campaign") title = "Resume this newsletter?";
      const spec = { toolId, errorCode: "NEWSLETTER", title,
        description: "This action can send email to real people. Only your confirmation can authorize it.", confirmLabel: "Confirm" };
      if ("refusal" in prepared) return { ...spec, details: [] };
      const { existing, campaignId, scheduledAt } = prepared;
      return { ...spec, details: [
        { label: "Subject", value: existing.subject }, { label: "Campaign", value: campaignId }, { label: "Subscriber list", value: existing.listId }, { label: "Status", value: existing.status },
        ...(scheduledAt === null ? [] : [{ label: "Scheduled date", value: scheduledAt }]),
      ] };
    };
}

function transitionConfirmedCampaign(deps: NewsletterDeliveryToolDeps, toolId: string, { ctx, campaignId, existing, scheduledAt }: Exclude<Prepared, { refusal: unknown }> & { ctx: Parameters<ToolHandler>[0] }) {
  return deps.newsletterCampaignRepo.transaction({ fn: async () => {
    const current = await deps.newsletterCampaignRepo.findById({ workspaceId: deps.workspaceId, id: campaignId });
    // Pipeline transitions do not always increment version; compare the complete snapshot as well.
    if (JSON.stringify(current) !== JSON.stringify(existing)) throw new ToolInputError({ message: "NEWSLETTER_STALE_CONFIRMATION: The campaign changed while the card was open. Review it and request a new confirmation." });
    if (ctx.signal.aborted) return { abandoned: true as const };
    if (scheduledAt !== null) return scheduleCampaign({ deps: { campaignRepo: deps.newsletterCampaignRepo, listRepo: deps.newsletterListRepo, clock: deps.clock, ids: deps.idGen }, input: { workspaceId: deps.workspaceId, id: campaignId, actorId: ctx.principal.id, scheduledAt } });
    if (toolId === "newsletter_resume_campaign") {
      await requireMassLaunchReady(deps);
      if (ctx.signal.aborted) return { abandoned: true as const };
      return resumeCampaign({ deps: toNewsletterSendPipelineDeps(deps), input: { workspaceId: deps.workspaceId, campaignId } });
    }
    return authorizeSend({ deps: toNewsletterSendPipelineDeps(deps), input: { workspaceId: deps.workspaceId, campaignId } });
  } });
}

async function fanOutNewsletterCampaign(deps: NewsletterDeliveryToolDeps, campaignId: string, campaign: CampaignRecord) {
  // The campaign status has committed, so a later fan-out failure must not imply no launch occurred.
  try {
    await freezeAudience({ deps: toNewsletterSendPipelineDeps(deps), input: { workspaceId: deps.workspaceId, campaignId, listId: campaign.listId } });
    await claimBatch({ deps: toNewsletterSendPipelineDeps(deps) });
    // An empty audience emits no batch event, so the subscriber cannot complete it for us.
    await completeIfDrained({ deps: toNewsletterSendPipelineDeps(deps), input: { workspaceId: deps.workspaceId, campaignId } });
  } catch (err) {
    let errorDiagnostic = "[diagnostic unavailable]";
    try { errorDiagnostic = describeErrorForLog({ err }); } catch { /* Keep the original failure path if diagnostics fail. */ }
    deps.reportDeliveryFailure("[newsletter] delivery fan-out failed after launch; inspect the send log before retrying", errorDiagnostic);
    return processingAttentionResult({ campaignId, status: campaign.status, deps });
  }
  return { confirmed: true, started: true, campaignId, status: campaign.status, delivered: false, mailDeliveryAvailable: true };
}

function createNewsletterCampaignRun(deps: NewsletterDeliveryToolDeps, toolId: string): Parameters<typeof deps.approvalToolHandler<Prepared>>[0]['run'] {
  return async ({ ctx, prepared }) => {
      if ("refusal" in prepared) return prepared.refusal;
      const { campaignId, existing, scheduledAt } = prepared;
      // Authorization and mail configuration may change while the human reads the card.
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: toolId === "newsletter_schedule_campaign" ? "admin.newsletter.campaign.schedule" : "admin.newsletter.campaign.send" }, { entityType: "newsletter_campaign" });
      if (ctx.signal.aborted) return { confirmed: false, reason: "abandoned", delivered: false, mailDeliveryAvailable: true };
      const currentMailOff = mailOffResult(deps);
      if (currentMailOff) return currentMailOff;
      const transition = await transitionConfirmedCampaign(deps, toolId, { ctx, campaignId, existing, scheduledAt });
      if ("abandoned" in transition) return { confirmed: false, reason: "abandoned", delivered: false, mailDeliveryAvailable: true };
      const { campaign } = transition;
      if (scheduledAt !== null) return { confirmed: true, scheduled: true, campaignId, status: campaign.status, scheduledAt: campaign.scheduledAt, delivered: false, mailDeliveryAvailable: true, note: deps.deliveryCopy.scheduled };
      if ("requeueFailed" in transition && transition.requeueFailed) return processingAttentionResult({ campaignId, status: campaign.status, deps });
      return fanOutNewsletterCampaign(deps, campaignId, campaign);
    };
}

function createNewsletterCampaignHandler(deps: NewsletterDeliveryToolDeps, surfaces: AssistantSurfaceDeps, toolId: string): ToolHandler {
  return deps.approvalToolHandler<Prepared>({ surfaces, prepare: createNewsletterCampaignPreparation(deps, toolId), describe: createNewsletterCampaignDescription(deps, toolId), run: createNewsletterCampaignRun(deps, toolId) }, { ask: ({ prepared }) => !("refusal" in prepared),
      declined: ({ reason }) => ({ confirmed: false, reason, delivered: false, mailDeliveryAvailable: true }),
    });
}

/**
 * Builds handlers over existing services. Human consent is scoped to an unchanged campaign.
 * @param deps - Existing newsletter services and owner identity, bound at boot.
 * @param surfaces - Shared browser-only exchange store (a local store is useful for isolated callers).
 * @returns Four durable-write registrations; none supports a model-supplied confirmation flag.
 * @throws ToolInputError for permissions, missing configuration, invalid input or stale consent.
 * @complexity O(1) registration setup; launch uses the existing pipeline's audience cost.
 */
export function buildNewsletterDeliveryRegistrations(deps: NewsletterDeliveryToolDeps, surfaces: AssistantSurfaceDeps): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    newsletter_send_test: async (ctx) => {
      const input = requireInputRecord({ input: ctx.input });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.newsletter.campaign.send_test" }, { entityType: "newsletter_campaign" });
      if (Object.keys(input).some((key) => key !== "campaignId")) throw new ToolInputError({ message: deps.deliveryCopy.ownerOnly });
      const campaignId = requireString({ input: input, key: "campaignId" });
      const mailOff = mailOffResult(deps);
      if (mailOff) return mailOff;
      await deps.newsletterReady;
      const owner = await deps.userRepo.findByPrincipalId({ workspaceId: deps.workspaceId, principalId: await deps.ownerPrincipalId });
      if (!owner?.email?.trim()) throw new ToolInputError({ message: deps.deliveryCopy.ownerEmailMissing });
      ctx.signal.throwIfAborted();
      const { results } = await sendTestCampaign({ deps: toNewsletterSendPipelineDeps(deps), input: { workspaceId: deps.workspaceId, campaignId, testAddresses: [owner.email] } });
      // Provider error text can carry an email or endpoint; the caller receives only a fixed recovery note.
      if (results[0]?.outcome !== "sent") return { delivered: false, mailDeliveryAvailable: true, note: deps.deliveryCopy.testNotAccepted };
      return { delivered: true, mailDeliveryAvailable: true };
    },
  };
  for (const toolId of ["newsletter_send_campaign", "newsletter_schedule_campaign", "newsletter_resume_campaign"]) {
    handlers[toolId] = createNewsletterCampaignHandler(deps, surfaces, toolId);
  }
  // authorizeSend's gate result is safe vocabulary; its generic message alone omits the reason.
  const guarded: Record<string, ToolHandler> = {};
  for (const [id, handler] of Object.entries(handlers)) guarded[id] = async (ctx, options = {}) => {
    try { return await handler(ctx, options); } catch (error) {
      if (error instanceof NewsletterLaunchGateBlockedError) throw new ToolInputError({ message: deps.deliveryCopy.launchGateBlocked(error.unmetPreconditions) });
      throw error;
    }
  };
  return buildDomainRegistrations({ metadata: toolMetadata, domain: "newsletter-delivery", catalogModule: "newsletter/delivery/tool-registrations.ts", catalog: indexCatalogById({ catalog: newsletterDeliveryAgentToolCatalog }), handlers: withModelFacingErrors({ handlers: guarded, rules: [forbiddenRule({ domainPrefix: "NEWSLETTER", error: ForbiddenError }), { error: NewsletterCampaignNotFoundError, code: "NEWSLETTER_CAMPAIGN_NOT_FOUND" }, { error: NewsletterCampaignNotEditableError, code: "NEWSLETTER_CAMPAIGN_NOT_EDITABLE" }, { error: NewsletterValidationError, code: "NEWSLETTER_VALIDATION_FAILED" }] }), derivedRisk: newsletterDeliveryDerivedRisk });
}

/** Registers delivery under its own key so it cannot replace the existing newsletter catalog. */
export function contributeNewsletterDeliveryTools(): ToolContributor<NewsletterDeliveryToolDeps, AssistantSurfaceDeps> {
  return { domain: "newsletter-delivery", build: buildNewsletterDeliveryRegistrations, risk: newsletterDeliveryDerivedRisk };
}
