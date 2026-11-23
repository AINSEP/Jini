import { ToolInputError } from "@jini-ai/core";
import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { mailActorId, type MailRoutePrincipal } from "./mail-shared.js";

/**
 * @file The Email page's **What uses email** and **Recent sends and failures**: thin adapters over
 * the operations the assistant's `mail_get_readiness`, `mail_list_activity` and `mail_get_activity`
 * tools run.
 *
 * - `GET  .../system/mail-uses` (the status permission) -> `{ checkedAt, uses }`.
 * - `GET  .../system/mail-activity?outcome=&use=&recipient=&limit=&cursor=` (`mail.activity.read`
 *   for full recipients; the status permission alone gets masked rows) -> an activity page.
 * - `GET  .../system/mail-activity/:activityId` (`mail.activity.read`) -> the send's detail, 404
 *   when no such send exists here.
 * - `GET  .../system/mail-suppressions?search=&scope=&reason=&limit=&cursor=` (`mail.activity.read`).
 * - `POST .../system/mail-suppressions/remove` (`mail.suppressions.manage`) body
 *   `{ address, scope, reason, confirmed?: true, revision? }`. Without `confirmed: true` it only
 *   previews: `{ removed: false, confirmationRequired: true, plan }` (what was blocked, why, and the
 *   warnings). With it, the reviewed `revision` must still match the current plan, else the person is
 *   asked to review again. Every removal is a fresh confirmation; nothing about it is remembered.
 * - `GET  .../system/mail-feedback` (the status permission) -> the feedback setup report.
 *
 * 400 for malformed input, 403 without the permission, 503 when this root has no activity or
 * suppression repo. Authorization for the activity and suppression reads happens inside the host's
 * operations (they know which permission each answer needs), so these specs never use the host
 * `authorize` handle: its 403 names the principal, while this page's 403 body never has.
 */

/** A domain failure the host recognises: a missing grant inside an operation, or a missing repo. */
export type MailActivityFailure = { kind: "forbidden"; permission: string } | { kind: "unavailable"; message: string };

/** The one classifier every route here needs: the host's own error classes are not the engine's to know. */
export interface MailActivityFailureDeps {
  /** Maps a thrown host error to its answer; `undefined` leaves it an unexpected failure (the host's redacted 500). */
  classifyMailActivityError: (error: unknown) => MailActivityFailure | undefined;
}

/** The Email page's status permission check, shared by the two routes that gate on it directly. */
export interface MailStatusPermissionDeps extends MailActivityFailureDeps {
  /** The Email page's status permission (the host's policy); the 403 names it. */
  statusPermission: string;
  /** Asks the host whether the principal holds `permission` for this workspace's mail. */
  checkPermission: (required: { principalId: string; permission: string }) => Promise<{ allowed: boolean; reason: string }>;
}

/** `mail-uses`: the readiness report is the host's DTO, answered unchanged. */
export interface MailUsesRouteDeps extends MailStatusPermissionDeps { readMailUseReadiness: () => Promise<object> }
/** `mail-activity`: the host reads the query (a bad one is its `ToolInputError`) and lists as the principal. */
export interface MailActivityListRouteDeps extends MailActivityFailureDeps {
  listMailActivity: (required: { principalId: string; input: Record<string, unknown> }) => Promise<object>;
}
/** `mail-activity/:activityId`: `activityId` is unvalidated; the host reads it and answers `undefined` for no such send. */
export interface MailActivityGetRouteDeps extends MailActivityFailureDeps {
  getMailActivity: (required: { principalId: string; activityId: string | undefined }) => Promise<object | undefined>;
}
/** `mail-suppressions`: as the activity list. */
export interface MailSuppressionsListRouteDeps extends MailActivityFailureDeps {
  listMailSuppressions: (required: { principalId: string; input: Record<string, unknown> }) => Promise<object>;
}

/** A reviewed removal: the plan answered in the preview, its revision, and the host's confirmed remove bound to that plan. */
export interface MailSuppressionRemovalPlan { plan: object; revision: unknown; remove: () => Promise<object> }
/** `mail-suppressions/remove`: the host reads the removal, plans it as the principal and binds the confirmed removal. */
export interface MailSuppressionRemoveRouteDeps extends MailActivityFailureDeps {
  planSuppressionRemoval: (required: { principalId: string; input: Record<string, unknown> }) => Promise<MailSuppressionRemovalPlan>;
}
/** `mail-feedback`: the feedback setup report is the host's DTO, answered unchanged. */
export interface MailFeedbackRouteDeps extends MailStatusPermissionDeps { readMailFeedbackSetup: () => Promise<object> }

const BASE = "/api/admin/v1/workspaces/:workspaceId/system";

/** A 403 that names the permission and reason but, unlike the host port's, not the principal. @complexity O(1). */
function rejectForbidden({ permission, reason }: { permission: string; reason: string }, _optional: Record<string, never> = {}): never {
  return rejectRoute({ status: 403, error: `not authorized for '${permission}' (${reason})`, code: "FORBIDDEN", details: { permission, reason } });
}

/**
 * Runs `run` for one request, answering the ladder every route here shares: a caller error
 * (`ToolInputError`) is a 400, a host-classified failure its 403/503, anything else is rethrown
 * unchanged so the host answers an unexpected, redacted failure.
 * @complexity O(1) plus `run`.
 */
async function withActivityFailures<T>(
  { run, classify }: { run: () => Promise<T>; classify: MailActivityFailureDeps["classifyMailActivityError"] },
  _optional: Record<string, never> = {},
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ToolInputError) rejectRoute({ status: 400, error: error.message, code: "INVALID_INPUT" });
    const failure = classify(error);
    if (failure?.kind === "forbidden") rejectForbidden({ permission: failure.permission, reason: "no_grant" });
    if (failure?.kind === "unavailable") rejectRoute({ status: 503, error: failure.message, code: "MAIL_ACTIVITY_UNAVAILABLE" });
    throw error;
  }
}

/** The Email page's status permission: refuses with the body that names it (never the principal) when not held. @complexity O(1) plus the injected check. */
async function requireStatusPermission({ deps, principalId }: { deps: MailStatusPermissionDeps; principalId: string }, _optional: Record<string, never> = {}): Promise<void> {
  const auth = await deps.checkPermission({ principalId, permission: deps.statusPermission });
  if (!auth.allowed) rejectForbidden({ permission: deps.statusPermission, reason: auth.reason });
}

/** The body as a plain object; anything else (none, an array, a scalar) is an empty one. @complexity O(1). */
function bodyRecord({ body }: { body: unknown }, _optional: Record<string, never> = {}): Record<string, unknown> {
  return (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
}

/** `GET .../system/mail-uses`: what uses email, gated by the status permission. @complexity O(1) plus the injected report. */
export const mailUsesRoute = defineJsonRoute<Record<string, never>, object, MailUsesRouteDeps, MailRoutePrincipal>({
  method: "get",
  path: `${BASE}/mail-uses`,
  parse: () => ok({ value: {} }),
  handle: ({ deps, context }) => withActivityFailures({ classify: deps.classifyMailActivityError, run: async () => {
    await requireStatusPermission({ deps, principalId: mailActorId({ context }) });
    return ok({ value: await deps.readMailUseReadiness() });
  } }),
});

/** `GET .../system/mail-activity`: recent sends and failures; the host's operation decides full or masked recipients. @complexity O(1) plus the injected read. */
export const mailActivityListRoute = defineJsonRoute<{ query: Record<string, unknown> }, object, MailActivityListRouteDeps, MailRoutePrincipal>({
  method: "get",
  path: `${BASE}/mail-activity`,
  parse: (raw) => ok({ value: { query: raw.query } }),
  handle: ({ input, deps, context }) => withActivityFailures({ classify: deps.classifyMailActivityError, run: async () =>
    ok({ value: await deps.listMailActivity({ principalId: mailActorId({ context }), input: input.query }) }) }),
});

/** `GET .../system/mail-activity/:activityId`: one send's detail, 404 when no such send exists here. @complexity O(1) plus the injected read. */
export const mailActivityGetRoute = defineJsonRoute<{ activityId: string | undefined }, object, MailActivityGetRouteDeps, MailRoutePrincipal>({
  method: "get",
  path: `${BASE}/mail-activity/:activityId`,
  parse: (raw) => ok({ value: { activityId: raw.params.activityId } }),
  handle: ({ input, deps, context }) => withActivityFailures({ classify: deps.classifyMailActivityError, run: async () => {
    const found = await deps.getMailActivity({ principalId: mailActorId({ context }), activityId: input.activityId });
    if (!found) rejectRoute({ status: 404, error: "no such email send", code: "NOT_FOUND" });
    return ok({ value: found });
  } }),
});

/** `GET .../system/mail-suppressions`: the blocked addresses. @complexity O(1) plus the injected read. */
export const mailSuppressionsListRoute = defineJsonRoute<{ query: Record<string, unknown> }, object, MailSuppressionsListRouteDeps, MailRoutePrincipal>({
  method: "get",
  path: `${BASE}/mail-suppressions`,
  parse: (raw) => ok({ value: { query: raw.query } }),
  handle: ({ input, deps, context }) => withActivityFailures({ classify: deps.classifyMailActivityError, run: async () =>
    ok({ value: await deps.listMailSuppressions({ principalId: mailActorId({ context }), input: input.query }) }) }),
});

/**
 * `POST .../system/mail-suppressions/remove`: preview unless `confirmed` is exactly `true`; a
 * confirmed removal must carry the revision of the plan it reviewed.
 * @complexity O(1) plus the injected plan and removal.
 */
export const mailSuppressionRemoveRoute = defineJsonRoute<{ body: Record<string, unknown> }, object, MailSuppressionRemoveRouteDeps, MailRoutePrincipal>({
  method: "post",
  path: `${BASE}/mail-suppressions/remove`,
  parse: (raw) => ok({ value: { body: bodyRecord({ body: raw.body }) } }),
  handle: ({ input, deps, context }) => withActivityFailures({ classify: deps.classifyMailActivityError, run: async () => {
    const { plan, revision, remove } = await deps.planSuppressionRemoval({ principalId: mailActorId({ context }), input: input.body });
    if (input.body.confirmed !== true) return ok({ value: { removed: false, confirmationRequired: true, plan } });
    if (input.body.revision !== revision) throw new ToolInputError({ message: "Suppression changed or no reviewed revision was supplied. Review and confirm the current suppression." });
    return ok({ value: await remove() });
  } }),
});

/** `GET .../system/mail-feedback`: the feedback setup report, gated by the status permission. @complexity O(1) plus the injected report. */
export const mailFeedbackRoute = defineJsonRoute<Record<string, never>, object, MailFeedbackRouteDeps, MailRoutePrincipal>({
  method: "get",
  path: `${BASE}/mail-feedback`,
  parse: () => ok({ value: {} }),
  handle: ({ deps, context }) => withActivityFailures({ classify: deps.classifyMailActivityError, run: async () => {
    await requireStatusPermission({ deps, principalId: mailActorId({ context }) });
    return ok({ value: await deps.readMailFeedbackSetup() });
  } }),
});
