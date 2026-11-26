
import { toolMetadata } from '@jini-ai/core/tool-metadata/newsletter';

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
import { buildDomainRegistrations, indexCatalogById, resolveHostReadRefs, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolHandler, type ToolRegistration } from "@jini-ai/core";

import { type AuthorizeFn, type EventBusPort, type OutboxPort } from "@jini-ai/core/contracts/events";
import type { PositionalMailer as MailerPort, MailSenderIdentityPort } from "@jini-ai/platform/mail";
import type { OriginRegistryPort } from "@jini-ai/core/contracts/server/verified-origin";
import type { ToolContributor } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import { ToolPermissionDeniedError as ForbiddenError } from "@jini-ai/core";
import { forbiddenRule, withModelFacingErrors, type ModelFacingErrorRule } from "@jini-ai/core/model-facing-tool-errors";
import { newsletterAgentToolCatalog } from "@jini-ai/user-management/newsletter/agent-tools";
import type { HostReadVocabulary } from "@jini-ai/core";

import type { ConfirmationDeps } from "./confirmation.js";
import type { SubscriptionsDeps } from "./subscriptions.js";
import { NewsletterCampaignNotEditableError, NewsletterCampaignNotFoundError, NewsletterConflictError, NewsletterDefaultListProtectedError, NewsletterForbiddenError, NewsletterListNotFoundError, NewsletterSubscriberNotFoundError, NewsletterSubscriptionNotFoundError, NewsletterValidationError } from "@jini-ai/user-management/newsletter/errors";
import type { HookRegistry } from "@jini-ai/user-management/newsletter/hooks";

import type { MembersConsentCapability, NewsletterAudienceSnapshotRepoPort, NewsletterCampaignRepoPort, NewsletterConfirmationTokenRepoPort, NewsletterListRepoPort, NewsletterSendRepoPort, NewsletterSubscriptionRepoPort, SubscriberDirectoryPort } from "@jini-ai/user-management/newsletter/ports";
import { type SendPipelineDeps } from "@jini-ai/user-management/newsletter/send-pipeline";

import { createNewsletterListCampaignsHandler, createNewsletterGetCampaignHandler, createNewsletterListListsHandler, createNewsletterListSubscriptionsHandler, createNewsletterListSendLogHandler } from "./tool-registrations.read.js";
import { createNewsletterCreateCampaignHandler, createNewsletterUpdateCampaignHandler, createNewsletterCancelCampaignHandler, createNewsletterPauseCampaignHandler, createNewsletterCreateListHandler, createNewsletterArchiveListHandler, createNewsletterCreateSubscriptionHandler, createNewsletterRemoveSubscriptionHandler, createNewsletterResendConfirmationHandler } from "./tool-registrations.write.js";

const MUTATES_DURABLE_STATE = "mutates-durable-state" as const;

// The Jini catalog names its id reads as `{{read:newsletter_campaign}}`/`{{read:newsletter_list}}` (the
// engine may not name a host tool id); Tovu binds `contentReadVocabulary` so the model keeps seeing
// `content_read.<resource>` byte-for-byte, as members does.

/**
 * The exact slice of the route-deps bag Newsletter's tool handlers read. Declared structurally
 * (rather than importing `server/routes/types`'s `RouteDeps`, or `server/routes/admin/newsletter/
 * deps.ts`'s `NewsletterRouteDeps`, which itself extends `RouteDeps`) so this module carries no
 * back-edge into the composition root. `server/routes/*` satisfies this structurally by passing its
 * existing `NewsletterRouteDeps` object; nothing there changes.
 */
export interface NewsletterToolDeps {
  catalog: typeof newsletterAgentToolCatalog;
  hostReads: HostReadVocabulary;
  buildConfirmationDeps: (required: { deps: NewsletterToolDeps }) => ConfirmationDeps;
  buildSubscriptionsDeps: (required: { deps: NewsletterToolDeps }) => SubscriptionsDeps;
  buildSendPipelineDeps: (required: { deps: NewsletterToolDeps; isSendingEnabled: (workspaceId: string) => Promise<boolean> }) => SendPipelineDeps;
  authorize: AuthorizeFn;
  workspaceId: string;
  clock: { nowIso(): string };
  idGen: { newId(): string };
  outbox: OutboxPort;
  bus: EventBusPort;
  mailer: MailerPort;
  originRegistry: OriginRegistryPort;
  newsletterReady: Promise<void>;
  newsletterCampaignRepo: NewsletterCampaignRepoPort;
  newsletterListRepo: NewsletterListRepoPort;
  newsletterSubscriptionRepo: NewsletterSubscriptionRepoPort;
  newsletterAudienceSnapshotRepo: NewsletterAudienceSnapshotRepoPort;
  newsletterSendRepo: NewsletterSendRepoPort;
  newsletterConfirmationTokenRepo: NewsletterConfirmationTokenRepoPort;
  newsletterSubscriberDirectory: SubscriberDirectoryPort;
  newsletterHooks: HookRegistry;
  membersConsentCapability: MembersConsentCapability | null;
  /** Optional binding to the launch setting; absent preserves the existing fail-closed default. */
  newsletterSendingEnabled?: (workspaceId: string) => Promise<boolean>;
  /** The site's system-email From resolver — see `ConfirmationDeps.senderIdentity`. */
  mailSenderIdentity?: MailSenderIdentityPort;
}

/**
 * Assembles `send-pipeline.ts`'s deps bundle — the local twin of `toCampaignWriteServiceDeps` above.
 * The optional launch-setting binding defaults to false, preserving the admin routes' existing
 * fail-closed behavior. Runtime composition still has no sending toggle or consent binding.
 */
export function toNewsletterSendPipelineDeps(deps: NewsletterToolDeps, _optional: Record<string, never> = {}): SendPipelineDeps {
  return deps.buildSendPipelineDeps({ deps, isSendingEnabled: deps.newsletterSendingEnabled ?? (async () => false) });
}

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const newsletterDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> newsletterCampaignRepo.list / .findById: read only.
  ["newsletter_list_campaigns", "none"],
  ["newsletter_get_campaign", "none"],
  // -> newsletterListRepo.list: read only.
  ["newsletter_list_lists", "none"],
  // -> newsletterSubscriptionRepo.list: read only.
  ["newsletter_list_subscriptions", "none"],
  // -> newsletterSendRepo.listByCampaign: read only.
  ["newsletter_list_send_log", "none"],
  // -> saveCampaign (campaign-write-service.ts): campaign row + revision write in one tx.
  ["newsletter_create_campaign", MUTATES_DURABLE_STATE],
  ["newsletter_update_campaign", MUTATES_DURABLE_STATE],
  // -> cancelCampaign (campaign-write-service.ts): status transition + revision.
  ["newsletter_cancel_campaign", MUTATES_DURABLE_STATE],
  // -> pauseCampaign (send-pipeline.ts): status transition + revision; only ever HALTS sending.
  ["newsletter_pause_campaign", MUTATES_DURABLE_STATE],
  // -> saveList (lists.ts): list row write.
  ["newsletter_create_list", MUTATES_DURABLE_STATE],
  // -> archiveList (lists.ts): status flip.
  ["newsletter_archive_list", MUTATES_DURABLE_STATE],
  // -> saveSubscription (subscriptions.ts): subscription row write + mints/sends one confirmation email.
  ["newsletter_create_subscription", MUTATES_DURABLE_STATE],
  // -> unsubscribeSubscription (subscriptions.ts): status flip + conditional consent revoke.
  ["newsletter_remove_subscription", MUTATES_DURABLE_STATE],
  // -> issueConfirmationToken (confirmation.ts): invalidates prior tokens, writes a new token row, sends mail.
  ["newsletter_resend_confirmation", MUTATES_DURABLE_STATE],
]);

/**
 * The Newsletter errors that reach the model with their real reason instead of a redacted
 * `INTERNAL_ERROR` — see `contracts/core/model-facing-tool-errors.ts` for the mechanism and for why
 * this list is an ALLOWLIST rather than a blanket unwrap.
 *
 * Every message listed is built from the caller's own ids plus this domain's vocabulary; none
 * carries a subscriber's email, name, or any other contact detail. That was checked rather than
 * assumed: `subscriptions.ts`/`campaign-write-service.ts`/`lists.ts` interpolate `listId`,
 * `subscriberId`, `campaignId` and field/limit names only, and `NewsletterSubscriberNotFoundError`
 * names a subscriber UUID, not the person behind it. Note that
 * `newsletter_resend_confirmation` reports mail-off before looking up a subscription and otherwise
 * returns the same acknowledgement whether or not a pending contact resolves.
 *
 * Both TOKEN classes are deliberately ABSENT. `NewsletterConfirmTokenInvalidError` and
 * `NewsletterUnsubscribeTokenInvalidError` are raised on the public confirm/unsubscribe redemption
 * paths (`confirmation.ts`, `unsubscribe.ts`), which no tool in this catalog calls, and their
 * messages ("token was already consumed", "signature is invalid") answer a question about a token
 * HOLDER rather than about the caller's own request — the same line `features/members/tool-
 * registrations.ts` draws around `MemberAuthError`. `NewsletterLaunchGateBlockedError` is absent
 * because delivery/tool-registrations.ts handles launch prerequisites separately with fixed, safe vocabulary.
 */
const NEWSLETTER_MODEL_FACING_ERRORS: readonly ModelFacingErrorRule[] = [
  forbiddenRule({ domainPrefix: "NEWSLETTER", error: ForbiddenError }),
  { error: NewsletterForbiddenError, code: "NEWSLETTER_FORBIDDEN" },
  { error: NewsletterCampaignNotFoundError, code: "NEWSLETTER_CAMPAIGN_NOT_FOUND" },
  { error: NewsletterListNotFoundError, code: "NEWSLETTER_LIST_NOT_FOUND" },
  { error: NewsletterSubscriptionNotFoundError, code: "NEWSLETTER_SUBSCRIPTION_NOT_FOUND" },
  { error: NewsletterSubscriberNotFoundError, code: "NEWSLETTER_SUBSCRIBER_NOT_FOUND" },
  { error: NewsletterValidationError, code: "NEWSLETTER_VALIDATION_FAILED" },
  { error: NewsletterCampaignNotEditableError, code: "NEWSLETTER_CAMPAIGN_NOT_EDITABLE" },
  { error: NewsletterDefaultListProtectedError, code: "NEWSLETTER_DEFAULT_LIST_PROTECTED" },
  {
    error: NewsletterConflictError,
    code: "NEWSLETTER_CONFLICT",
    guidance: "Nothing was written. Re-read the record to get its current version and resend with that as expectedVersion.",
  },
];

export function buildNewsletterRegistrations(deps: NewsletterToolDeps, _surfaces?: AssistantSurfaceDeps): ToolRegistration[] {
  const CATALOG_BY_ID = indexCatalogById({ catalog: resolveHostReadRefs({ value: deps.catalog }, { hostReads: deps.hostReads }) });
  const handlers: Record<string, ToolHandler> = {
    newsletter_list_campaigns: createNewsletterListCampaignsHandler(deps),
    newsletter_get_campaign: createNewsletterGetCampaignHandler(deps),
    newsletter_list_lists: createNewsletterListListsHandler(deps),
    newsletter_list_subscriptions: createNewsletterListSubscriptionsHandler(deps),
    newsletter_list_send_log: createNewsletterListSendLogHandler({ deps }),
    newsletter_create_campaign: createNewsletterCreateCampaignHandler(deps),
    newsletter_update_campaign: createNewsletterUpdateCampaignHandler(deps),
    newsletter_cancel_campaign: createNewsletterCancelCampaignHandler(deps),
    newsletter_pause_campaign: createNewsletterPauseCampaignHandler(deps),
    newsletter_create_list: createNewsletterCreateListHandler(deps),
    newsletter_archive_list: createNewsletterArchiveListHandler(deps),
    newsletter_create_subscription: createNewsletterCreateSubscriptionHandler(deps),
    newsletter_remove_subscription: createNewsletterRemoveSubscriptionHandler(deps),
    newsletter_resend_confirmation: createNewsletterResendConfirmationHandler(deps),

  };

  // No `unwiredToolIds`: Newsletter wires its ENTIRE catalog, same tripwire discipline as Forms.
  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "newsletter",
    catalogModule: "newsletter/agent-tools.ts",
    catalog: CATALOG_BY_ID,
    // The whole map at once, so none of the 14 can be the one that forgot — see
    // `withModelFacingErrors`' own doc for why a per-call-site reshape is the defect this avoids.
    handlers: withModelFacingErrors({ handlers, rules: NEWSLETTER_MODEL_FACING_ERRORS }),
    derivedRisk: newsletterDerivedRisk,
  });
}

/**
 * Contributes Newsletter's AI tools to the assistant's catalog — called once by
 * `apps/website/src/server/runtime/composition/tool-catalog-manifest.ts`'s `installFirstPartyToolContributors()`, not by importing this
 * module. `assistant/tool-registrations.ts` no longer imports `buildNewsletterRegistrations`/
 * `newsletterDerivedRisk` by name; this is the seam that replaced it (2026-08-17 — see
 * `tool-contribution-registry.ts`'s header for why: this edge used to close a module cycle with
 * `assistant`, and a one-directional `newsletter -> assistant` registration call does not).
 */
export function contributeNewsletterTools(): ToolContributor<NewsletterToolDeps, AssistantSurfaceDeps> {
  return { domain: "newsletter", build: buildNewsletterRegistrations, risk: newsletterDerivedRisk };
}