import { toolMetadata } from '@jini-ai/core/tool-metadata/mail-status';
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, ToolInputError, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolExecutionContext, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { UserRepoPort } from "@jini-ai/core/contracts/site/user-management";
import type { ToolContributor } from "@jini-ai/core";
import type { MailDeliveryToolCollaborators } from "./delivery-tool-registrations.js";
import { ToolPermissionDeniedError as ForbiddenError } from "@jini-ai/core";
import { describeErrorForLog, forbiddenRule, withModelFacingErrors } from "@jini-ai/core/model-facing-tool-errors";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";

import type { PositionalMailer as MailerPort, MailStatusReport, MailTestModeSetting, MailTestApproval } from "@jini-ai/core/contracts/mail";
import type { MailSenderIdentityPort } from "@jini-ai/core/contracts/site/platform-mail";
import type { MailProviderControl } from "./provider-operations.js";
import { mailStatusAgentToolCatalog } from "@jini-ai/user-management/mail/status/agent-tools";

import { activateMailProvider, checkMailProvider } from "./provider-operations.js";
import { asToolInputError, currentLanesDetail } from "./provider-tool-registrations.js";

type MailTestSendRefusal = { ok: false; reason: "duplicate" | "rate_limited"; retryAfterMs: number };

/** Deliberate test sends per site; separate from (and in front of) the provider's own bucket. */
interface MailTestSendLimiter {
  tryTake(required: { principalId: string; to: string }): { ok: true } | MailTestSendRefusal;
}

/** Ports the operation reads; the field names match `RouteDeps`, so a route can pass its deps through. */
interface MailTestSendDeps {
  workspaceId: string;
  mailer: MailerPort;
  /** Await current transactional resolution before freezing synchronous capabilities. */
  mailLaneReady?: ((required: { lane: "transactional" | "bulk" }) => Promise<boolean>) | undefined;
  /** The operator's account, for the default recipient. */
  userRepo?: Pick<UserRepoPort, "findByPrincipalId"> | undefined;
  /** The site's system-mail From (`platform/mail/sender-identity.ts`). */
  mailSenderIdentity?: MailSenderIdentityPort | undefined;
  /** Host copy: the placeholder From for a non-delivering mailer, whose `name` also fills a configured
   *  sender's missing name. Absent: `no-reply@mail.local` named "Site". */
  mailTestFallbackSender?: { email: string | undefined; name: string } | undefined;
  /** Shared by the route and the tool (one per site, `deps.ts`); absent (hermetic roots), only the
   *  provider's own limits apply. */
  mailTestSendLimiter?: MailTestSendLimiter | undefined;
  /** Fresh `core.mail.testMode`, so a redirect is reported as one. Absent: treated as off. */
  mailTestMode?: (() => Promise<MailTestModeSetting>) | undefined;
  mailTestProvider?: (() => Promise<string | null>) | undefined;
  /** Site-owned request results, shared by HTTP and tools; no token is taken on replay. */
  mailTestRequests?: Map<string, Promise<MailTestSendResult>> | undefined;
}

/** Where the message is meant to go, frozen before any approval card or send. */
interface MailTestSendPlan {
  to: string;
  /** True when the caller chose the recipient; false for the operator's own address. */
  chosen: boolean;
  approval: MailTestApproval;
  driver: string;
  /** Set when test mode will rewrite the recipient. */
  redirectTo?: string;
  /** True when test mode keeps the message locally instead of sending it. */
  capture?: boolean;
}

interface Common { to: string; from: string; driver: string; at: string }
type MailTestSendResult =
  /** The provider accepted the message for delivery; delivery itself is not yet known. */
  | Common & { outcome: "accepted"; providerMessageId: string }
  /** Nothing left this machine: kept by test-mode capture or printed by the local console driver. */
  | Common & { outcome: "captured"; where: "capture" | "console"; providerMessageId: string }
  /** Test mode sent it to another address instead of `to`. */
  | Common & { outcome: "redirected"; redirectedTo: string; providerMessageId: string }
  /** Refused or failed; the code and message are the mailer's caller-safe ones. */
  | Common & { outcome: "failed" | "unknown"; errorCode: string; message: string; retryable: boolean; retryAfterMs?: number };

declare const planMailTestSend: (required: { principalId: string; to?: string; deps: MailTestSendDeps }, optional?: Record<string, never>) => Promise<MailTestSendPlan>;
declare const readTestRecipient: (required: { value: unknown }, optional?: Record<string, never>) => string | undefined;
declare const runMailTestSend: (required: { deps: MailTestSendDeps; principalId: string; plan: MailTestSendPlan; ref: string }, optional?: { now?: () => number }) => Promise<MailTestSendResult>;

export interface MailStatusToolDeps {
  authorize: AuthorizeFn; workspaceId: string; mailer: MailerPort;
  approvalToolHandler: MailDeliveryToolCollaborators["approvalToolHandler"];
  isMailDeliveryAvailable: (mailer: MailerPort) => boolean;
  unavailableNote: string;
  planMailTestSend: typeof planMailTestSend;
  readTestRecipient: typeof readTestRecipient;
  runMailTestSend: typeof runMailTestSend;
  /** Lanes, providers and warnings (`server/runtime/boot/resolve-mailer.ts`); absent in hermetic roots. */
  mailStatus?: (optional?: { refresh?: boolean }) => Promise<MailStatusReport>;
  /** Provider selection for `mail_set_provider`; absent, that tool refuses and changes nothing. */
  mailProviderControl?: MailProviderControl;
  /** The operator's account, for `mail_send_test`'s default recipient. */
  userRepo?: Pick<UserRepoPort, "findByPrincipalId">;
  /** The site's system-mail From (`platform/mail/sender-identity.ts`). */
  mailSenderIdentity?: MailSenderIdentityPort;
  /** Shared with the admin test-send route (`@jini-ai/platform/mail/test-send`). */
  mailTestSendLimiter?: MailTestSendDeps["mailTestSendLimiter"];
  mailTestMode?: MailTestSendDeps["mailTestMode"];
  mailTestProvider?: MailTestSendDeps["mailTestProvider"];
  mailLaneReady?: MailTestSendDeps["mailLaneReady"];
  mailTestRequests?: MailTestSendDeps["mailTestRequests"];
}
export const mailStatusDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> mailer.capabilities() only; the adapter may refresh configuration, but sends/writes nothing.
  ["system_get_mail_status", "none"],
  // -> mailProviderControl.select: one settings-ledger write of core.mail.provider.
  ["mail_set_provider", "mutates-durable-state"],
  // -> mailer.send: one delivery (ledger row, provider call) to the operator's own or a chosen address.
  ["mail_send_test", "mutates-durable-state"],
]);

function permission({ deps, ctx, name }: { deps: MailStatusToolDeps; ctx: ToolExecutionContext; name: string }, _optional = {}): Promise<unknown> {
  return requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: name }, { entityType: "mail" });
}

/** The selection seam, or a refusal when this root has none (hermetic roots, peer sites). */
function providerControl(deps: MailStatusToolDeps): MailProviderControl {
  if (!deps.mailProviderControl) throw new ToolInputError({ message: "Mail provider selection is unavailable on this server. Nothing was changed." });
  return deps.mailProviderControl;
}

/** The provider id the model asked for; the card and the write both use this frozen value. */
function readProviderId({ input }: { input: unknown }, _optional = {}): string {
  const record = requireInputRecord({ input });
  const providerId = typeof record.providerId === "string" ? record.providerId.trim() : "";
  if (!providerId) throw new ToolInputError({ message: "providerId must be an installed provider id from system_get_mail_status." });
  return providerId;
}

/** Test mode rewrites or keeps the message: the card says so before the person confirms. */
function testModeDetails(plan: MailTestSendPlan): { label: string; value: string }[] {
  if (plan.redirectTo !== undefined) return [{ label: "Test mode", value: `Redirected to ${plan.redirectTo}` }];
  return plan.capture ? [{ label: "Test mode", value: "Captured on this server; nothing is sent" }] : [];
}

    // No rememberKey: a provider switch redirects every email the site sends, so it always asks.
    function createSetMailProviderHandler(deps: MailStatusToolDeps, surfaces: AssistantSurfaceDeps): ToolHandler {
  return deps.approvalToolHandler({ surfaces,
      prepare: async ({ ctx }) => {
        const providerId = readProviderId({ input: ctx.input });
        await permission({ deps, ctx, name: "settings.workspace.write" });
        const control = providerControl(deps);
        const { label } = await asToolInputError({ run: () => checkMailProvider({ control, providerId }) });
        if (!control.readSelection) throw new ToolInputError({ message: "Mail provider selection snapshot is unavailable on this server. Nothing was changed. Reopen the chat after this site finishes starting." });
        const snapshot = await control.readSelection();
        return { providerId, label, current: snapshot.setting, revisionSeq: snapshot.revisionSeq };
      },
      describe: ({ ctx, prepared }) => ({ toolId: "mail_set_provider", errorCode: "MAIL", title: `Send this site's email through ${prepared.label}?`,
        access: { resources: [{ id: "core.mail.provider", label: "Mail provider", scope: { personId: ctx.principal.id, siteId: deps.workspaceId },
          previous: prepared.current, proposed: { transactional: prepared.providerId, bulk: prepared.providerId }, revision: String(prepared.revisionSeq) }] },
        details: [{ label: "Provider", value: `${prepared.label} (${prepared.providerId})` }, { label: "Applies to", value: "Transactional and bulk mail" }, ...currentLanesDetail(prepared)],
        warning: "From the next message on, every email this site sends (sign-in links, confirmations, form notifications, newsletters) goes through this provider.", confirmLabel: "Switch provider" }),
      run: async ({ ctx, prepared }) => {
        // The card may sit open for minutes: recheck the grant at the moment of the write.
        await permission({ deps, ctx, name: "settings.workspace.write" });
        // The shared activation re-checks the provider too: a key deleted meanwhile refuses, unchanged.
        await asToolInputError({ run: () => activateMailProvider({ control: providerControl(deps), providerId: prepared.providerId, principalId: ctx.principal.id, expectedRevisionSeq: prepared.revisionSeq }) });
        return { set: true, providerId: prepared.providerId };
      },
    }, { flag: "set" });
}


/** Reads delivery configuration after the admin route's permission check, and offers the two
 * approval-gated controls (`mail_set_provider`, `mail_send_test`).
 * @param deps - Site scope, authorization, mailer and the optional status/selection seams.
 * @param surfaces - The authenticated card transport for the approval cards.
 * @returns The three registrations.
 * @throws {ToolInputError} For malformed input or a denied permission.
 * @example buildMailStatusRegistrations(deps, surfaces)[0].handler(ctx)
 * @complexity O(1) per call; a test send is one delivery.
 */
export function buildMailStatusRegistrations(deps: MailStatusToolDeps, surfaces: AssistantSurfaceDeps): ToolRegistration[] {
  return buildDomainRegistrations({ metadata: toolMetadata, domain: "system-mail", catalogModule: "features/mail-status/agent-tools.ts", catalog: indexCatalogById({ catalog: mailStatusAgentToolCatalog }), derivedRisk: mailStatusDerivedRisk, handlers: withModelFacingErrors({ handlers: {
    system_get_mail_status: async ctx => {
      const refresh = requireInputRecord({ input: ctx.input }).refresh === true;
      await permission({ deps, ctx, name: "admin.forms.manage" });
      const mailDeliveryAvailable = deps.isMailDeliveryAvailable(deps.mailer);
      const status = deps.mailStatus ? await deps.mailStatus({ refresh }) : {};
      return { mailDeliveryAvailable, driver: deps.mailer.capabilities().driver, note: mailDeliveryAvailable ? "Email sending is configured." : deps.unavailableNote, ...status };
    },
    mail_set_provider: createSetMailProviderHandler(deps, surfaces),
    mail_send_test: deps.approvalToolHandler({ surfaces,
      prepare: async ({ ctx }) => {
        const to = deps.readTestRecipient({ value: requireInputRecord({ input: ctx.input }).to });
        await permission({ deps, ctx, name: "admin.forms.manage" });
        const plan = await deps.planMailTestSend({ ...{ principalId: ctx.principal.id, ...(to === undefined ? {} : { to }) }, deps: deps });
        // Display metadata must not prevent preparing a send when the catalog read is unavailable.
        const providers = await deps.mailProviderControl?.describe?.().catch((error: unknown) => {
          console.error("[mail] Could not read the provider catalog", describeErrorForLog({ err: error }));
          return undefined;
        });
        return { ...plan, providerLabel: providers?.providers.find(provider => provider.id === plan.approval.providerId)?.label ?? plan.driver };
      },
      describe: ({ prepared }) => ({ toolId: "mail_send_test", errorCode: "MAIL", title: `Send a test email to ${prepared.to}?`,
        details: [{ label: "From", value: prepared.approval.from.email }, { label: "To", value: prepared.to }, { label: "Through", value: prepared.providerLabel }, ...testModeDetails(prepared)], confirmLabel: "Send test email" }),
      run: async ({ ctx, prepared }) => {
        await permission({ deps, ctx, name: "admin.forms.manage" });
        const result = await deps.runMailTestSend({ deps, principalId: ctx.principal.id, plan: prepared, ref: ctx.executionId });
        // `sent` means it left for its recipient; a capture or a refusal did not. Never "delivered".
        return { sent: result.outcome === "accepted" || result.outcome === "redirected", ...result };
      },
    }, { flag: "sent" }),
  }, rules: [forbiddenRule({ domainPrefix: "MAIL_STATUS", error: ForbiddenError })] }) });
}

/** Keeps the diagnostic and its controls under a unique contributor domain. */
export function contributeMailStatusTools(): ToolContributor<MailStatusToolDeps, AssistantSurfaceDeps> {
  return { domain: "system-mail", build: buildMailStatusRegistrations, risk: mailStatusDerivedRisk };
}
