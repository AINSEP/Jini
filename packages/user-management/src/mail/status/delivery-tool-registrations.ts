import { toolMetadata } from "@jini-ai/core/tool-metadata/mail-status";
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, ToolInputError, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolExecutionContext, type ToolRegistration } from "@jini-ai/core";
import { adaptLegacyAuthorize, ToolPermissionDeniedError as ForbiddenError, requireToolPermission } from "@jini-ai/core";
import { forbiddenRule, withModelFacingErrors } from "@jini-ai/core/model-facing-tool-errors";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { ToolContributor } from "@jini-ai/core";
import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";
import type { HumanConfirmer, ToolHandler, ToolExecutionOptions } from "@jini-ai/core";
import { mailDeliveryAgentToolCatalog } from "@jini-ai/user-management/mail/status/delivery-agent-tools";
import {
  getMailActivity, listMailActivity, listMailSuppressions, MailActivityForbiddenError, MailActivityUnavailableError, MailSuppressionsUnavailableError, planMailSuppressionRemoval,
  readMailActivityId, readMailActivityQuery, readMailSuppressionQuery, readMailSuppressionRemoval, runMailSuppressionRemoval, type MailSuppressionRemovalPlan,
} from "@jini-ai/platform/mail";
import { mailDomainDepsFrom, type MailHostActivityDeps } from "@jini-ai/user-management/mail/status/domain-deps";
import { readMailFeedbackSetup, type MailFeedbackSetupDeps } from "@jini-ai/platform/mail/feedback-setup";
import { MAIL_STATUS_PERMISSION } from "@jini-ai/user-management/mail/status/permissions";
import { mailUseReadinessDepsFrom, readMailUseReadiness, type MailUseReadinessHostDeps } from "@jini-ai/platform/mail/use-readiness";
import type { MailCaptureClearPlan, MailCaptureClearResult } from "@jini-ai/core/contracts/mail";

/**
 * @file Assistant adapters for the delivery visibility operations (`./use-readiness.ts`,
 * `./activity.ts`, `./suppressions.ts`, `./feedback-setup.ts`), the same ones the admin
 * `system/mail-uses`, `system/mail-activity`, `system/mail-suppressions` and `system/mail-feedback`
 * routes call. Kept apart from the status and provider slices so each evolves independently.
 */

/** `contentKernel` holds `mail_capture` for `mail_clear_captured`; absent, that tool answers unavailable. */
export type MailDeliveryToolDeps = MailHostActivityDeps & MailUseReadinessHostDeps & MailFeedbackSetupDeps;

export const mailDeliveryDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> owner checks (sender read, launch gate, form list, gate probe that sends nothing) + one activity row per use.
  ["mail_get_readiness", "none"],
  // -> one ledger page read joined with feedback.
  ["mail_list_activity", "none"],
  // -> one ledger row and its feedback events.
  ["mail_get_activity", "none"],
  // -> one suppression page read.
  ["mail_list_suppressions", "none"],
  // -> one suppression delete plus its audit row, after a fresh confirmation.
  ["mail_remove_suppression", "mutates-durable-state"],
  // -> one delete of this workspace's captured test emails, after a fresh confirmation of the count.
  ["mail_clear_captured", "mutates-durable-state"],
  // -> provider describe, credential list (labels only, no decrypt), origin read, inbox probe.
  ["mail_get_feedback_setup", "none"],
]);

/** The card: what was blocked and why, the recorded reason, and what removal does not mean. */
function removalCard({ prepared }: { prepared: MailSuppressionRemovalPlan }) {
  return { toolId: "mail_remove_suppression", errorCode: "MAIL", title: `Allow email to ${prepared.address} again?`,
    details: [{ label: "Address", value: prepared.address }, { label: "Scope", value: prepared.scope === "all" ? "All email" : "Newsletters (bulk mail)" },
      { label: "Blocked because", value: `${prepared.suppressionReason} (${prepared.suppressedAt})` }, { label: "Your reason (recorded)", value: prepared.reason }],
    warning: prepared.warnings.join(" "), confirmLabel: "Remove from do-not-send list" };
}

/** A planned "clear all": the reviewed count and newest capture, the revision naming that exact set, and the clear bound to it. */
export interface CaptureClearPlan { plan: MailCaptureClearPlan; revision: string; clear: () => Promise<MailCaptureClearResult> }

/**
 * Plans "clear all" for this workspace as the caller, without deleting anything. Bound at the host
 * (`server/runtime/composition/mail-capture-clear-planner.ts`), which owns the capture repo and the
 * owner-grant check; only the approved run calls the plan's `clear`.
 */
export type MailCaptureClearPlanner = (args: { deps: MailDeliveryToolDeps; ctx: ToolExecutionContext }, _optional?: Record<string, never>) => Promise<CaptureClearPlan>;

/** The host-bound collaborators the delivery tools need beyond their deps. */
export interface MailDeliveryToolCollaborators {
  planCaptureClear: MailCaptureClearPlanner;
  approvalToolHandler<TPrepared>(required: {
    surfaces: AssistantSurfaceDeps;
    prepare: (required: { ctx: ToolExecutionContext }, optional: ToolExecutionOptions) => Promise<TPrepared>;
    describe: (required: { ctx: ToolExecutionContext; prepared: TPrepared }) => HumanConfirmSpec | Promise<HumanConfirmSpec>;
    run: (required: { ctx: ToolExecutionContext; prepared: TPrepared; confirmer: HumanConfirmer; choice?: string }, optional: ToolExecutionOptions) => Promise<unknown>;
  }, optional?: { flag?: string; ask?: (required: { prepared: TPrepared }) => boolean }): ToolHandler;
}

/** The card: how many captured test emails go, and what is not touched. */
function captureClearCard({ prepared }: { prepared: CaptureClearPlan }) {
  const { count, newestAt } = prepared.plan;
  return { toolId: "mail_clear_captured", errorCode: "MAIL", title: `Delete ${count} captured test email${count === 1 ? "" : "s"}?`,
    details: [{ label: "Test emails", value: String(count) }, { label: "Newest", value: newestAt ?? "-" }],
    warning: "This cannot be undone. Sent-email records, delivery history and the do-not-send list are not touched.", confirmLabel: "Delete test emails" };
}

/** Deletes only when the count and newest capture still match the card the person approved; the plan is re-run at the write to catch a stale card. */
async function runCaptureClear({ deps, ctx, prepared, planCaptureClear }: { deps: MailDeliveryToolDeps; ctx: ToolExecutionContext; prepared: CaptureClearPlan; planCaptureClear: MailCaptureClearPlanner }) {
  const fresh = await planCaptureClear({ deps, ctx });
  if (fresh.revision !== prepared.revision) throw new ToolInputError({ message: "New test emails arrived after you were asked. Nothing was deleted; ask again to review the new count." });
  if (fresh.plan.count === 0) return { cleared: false, empty: true };
  return fresh.clear();
}

function permission({ deps, ctx, name }: { deps: MailDeliveryToolDeps; ctx: ToolExecutionContext; name: string }, _optional = {}): Promise<unknown> {
  return requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: name }, { entityType: "mail" });
}

/**
 * `mail_get_readiness`, `mail_list_activity`, `mail_get_activity`, `mail_list_suppressions`,
 * `mail_remove_suppression` and `mail_clear_captured` (approval-gated, never remembered), `mail_get_feedback_setup`.
 * @param deps - Site scope, authorization, the mail repos and the readiness/feedback inputs.
 * @param surfaces - The authenticated card transport for the removal card.
 * @param collaborators - `planCaptureClear`, the host-bound capture-clear planner.
 * @returns The seven registrations.
 * @throws {ToolInputError} For malformed input, a refusal or a missing activity record.
 * @complexity One readiness pass or one activity read per call.
 */
export function buildMailDeliveryRegistrations(deps: MailDeliveryToolDeps, surfaces: AssistantSurfaceDeps, collaborators: MailDeliveryToolCollaborators): ToolRegistration[] {
  const { planCaptureClear, approvalToolHandler } = collaborators;
  return buildDomainRegistrations({ metadata: toolMetadata, domain: "system-mail-delivery", catalogModule: "features/mail-status/delivery-agent-tools.ts", catalog: indexCatalogById({ catalog: mailDeliveryAgentToolCatalog }), derivedRisk: mailDeliveryDerivedRisk, handlers: withModelFacingErrors({ handlers: {
    mail_get_readiness: async (ctx) => {
      requireInputRecord({ input: ctx.input });
      await permission({ deps, ctx, name: MAIL_STATUS_PERMISSION });
      return readMailUseReadiness(mailUseReadinessDepsFrom(deps));
    },
    mail_list_activity: async (ctx) => {
      const query = readMailActivityQuery({ input: requireInputRecord({ input: ctx.input }) });
      return listMailActivity({ ...{ principalId: ctx.principal.id, query }, deps: mailDomainDepsFrom({ deps }) });
    },
    mail_get_activity: async (ctx) => {
      const activityId = readMailActivityId({ value: requireInputRecord({ input: ctx.input }).activityId });
      const found = await getMailActivity({ ...{ principalId: ctx.principal.id, activityId }, deps: mailDomainDepsFrom({ deps }) });
      if (!found) throw new ToolInputError({ message: "No email send with that id exists on this site. List them with mail_list_activity." });
      return found;
    },
    mail_list_suppressions: async (ctx) => listMailSuppressions({ ...{ principalId: ctx.principal.id, query: readMailSuppressionQuery({ input: requireInputRecord({ input: ctx.input }) }) }, deps: mailDomainDepsFrom({ deps }) }),
    // No rememberKey: each removal lets mail reach someone who bounced or complained, so it always asks.
    mail_remove_suppression: approvalToolHandler({ surfaces,
      prepare: async ({ ctx }) => planMailSuppressionRemoval({ ...{ principalId: ctx.principal.id, input: readMailSuppressionRemoval({ input: requireInputRecord({ input: ctx.input }) }) }, deps: mailDomainDepsFrom({ deps }) }),
      describe: removalCard,
      // The card may sit open for minutes: the run re-checks the grant at the moment of the write.
      run: async ({ ctx, prepared }) => runMailSuppressionRemoval({ ...{ principalId: ctx.principal.id, plan: prepared }, deps: mailDomainDepsFrom({ deps }) }),
    }, { flag: "removed" }),
    // No rememberKey: each clear permanently deletes test emails, so it always asks (unless there are none).
    mail_clear_captured: approvalToolHandler({ surfaces,
      prepare: async ({ ctx }) => { requireInputRecord({ input: ctx.input }); return planCaptureClear({ deps, ctx }); },
      describe: captureClearCard,
      run: async ({ ctx, prepared }) => runCaptureClear({ deps, ctx, prepared, planCaptureClear }),
    }, { flag: "cleared", ask: ({ prepared }) => prepared.plan.count > 0 }),
    mail_get_feedback_setup: async (ctx) => {
      requireInputRecord({ input: ctx.input });
      await permission({ deps, ctx, name: MAIL_STATUS_PERMISSION });
      return readMailFeedbackSetup(deps);
    },
  }, rules: [
    forbiddenRule({ domainPrefix: "MAIL_DELIVERY", error: ForbiddenError }),
    { error: MailActivityForbiddenError, code: "MAIL_DELIVERY_FORBIDDEN" },
    { error: MailActivityUnavailableError, code: "MAIL_DELIVERY_UNAVAILABLE" },
    { error: MailSuppressionsUnavailableError, code: "MAIL_DELIVERY_UNAVAILABLE" },
  ] }) });
}

/** Registers the delivery visibility tools under their own contributor domain, with the host-bound capture-clear planner. */
export function contributeMailDeliveryTools(collaborators: MailDeliveryToolCollaborators, _optional = {}): ToolContributor<MailDeliveryToolDeps, AssistantSurfaceDeps> {
  return { domain: "system-mail-delivery", build: (deps, surfaces) => buildMailDeliveryRegistrations(deps, surfaces, collaborators), risk: mailDeliveryDerivedRisk };
}
