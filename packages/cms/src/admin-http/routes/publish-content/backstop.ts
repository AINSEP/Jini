import { defineJsonRoute, ok, type JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { rejectRoute, RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { BackstopAuditPort, BackstopAuditRecord, BackstopGap, BackstopSelection } from "../../../publish/transfer/index.js";
import { bodyRecord, type PublishRoutePrincipal } from "./transport-shared.js";

/**
 * @file Send by hand (manual publishing, "backstop"): the five admin routes under
 * `/api/admin/v1/workspaces/:workspaceId/publish-content` — `GET backstop/status`,
 * `GET runs/:runId/backstop`, `POST backstop` (`plan`, then `send`), `GET backstop/gaps` and
 * `POST runs/:runId/undo-backstop`.
 *
 * Session-only: neither an API key nor an assistant can perform the manual confirmation. The host
 * mount refuses every other credential before these specs run; the host injects who may send by hand
 * (`mayUseBackstop`), the audit storage, the peer store, the request checker, the pack/push and
 * confirm/execute work, the undo transaction and its typed-error mapping (`backstopRefusal`). These
 * specs own the refusals, the "which plan may be redeemed" rule and every answer shape.
 */

const BASE = "/api/admin/v1/workspaces/:workspaceId/publish-content";
const NOT_INSTALLED = "Send by hand needs its audit storage installed.";

/** The status-and-body pair the host maps one of its typed errors to. */
export interface BackstopRouteRefusal { status: number; body: Record<string, unknown> }

/** The host's typed-error mapping; `undefined` leaves the error to the mount's redacted 500. */
export type BackstopRefusalFn = (required: { error: unknown }) => BackstopRouteRefusal | undefined;

/** The fields the "may this actor send by hand" gate reads. */
export interface BackstopActorDeps {
  workspaceId: string;
  /** The 403 copy when the actor is not allowed. */
  forbiddenMessage: string;
  /** The `publish.backstop` permission AND the owner or a built-in admin/owner role. */
  mayUseBackstop(required: { context: PublishRoutePrincipal }): Promise<boolean>;
}

/** The audit storage, or `null` while it is not installed (or not ready). */
export interface BackstopAuditDeps {
  readyAudit(): Promise<BackstopAuditPort | null>;
}

/** The status and run-detail specs' deps. */
export type BackstopReadRouteDeps = BackstopActorDeps & BackstopAuditDeps;

/** The gaps spec's deps (no actor gate: it asks the authorizer for `publish_content.read`). */
export interface BackstopGapsRouteDeps extends BackstopAuditDeps { workspaceId: string }

/** The operator's checked confirmation, as the host's request checker answers it. */
export interface BackstopCheckedRequest { reason: string; typedHost: string; selection: BackstopSelection }

/** The checked request a send/plan acts on. */
export interface BackstopTarget {
  peerId: string;
  destination: { baseUrl: string };
  host: string;
  request: BackstopCheckedRequest;
}

/** What `plan` answers: the host's answer, or that an overwrite named an item the plan did not select. */
export type BackstopPlanOutcome = { value: Record<string, unknown> } | { overwriteNotSelected: true };

/** The send/plan spec's deps. */
export interface BackstopSendRouteDeps extends BackstopActorDeps, BackstopAuditDeps {
  backstopRefusal: BackstopRefusalFn;
  findPeer(required: { peerId: string }): Promise<{ baseUrl: string } | null>;
  checkRequest(required: { body: Record<string, unknown>; destinationHost: string }): { request: BackstopCheckedRequest } | { error: string };
  /** Confirms and executes the plan `log` recorded, under the audit. */
  redeemPlan(required: { target: BackstopTarget; audit: BackstopAuditPort; log: BackstopAuditRecord }): Promise<Record<string, unknown>>;
  /** Packs the selection, pushes it as a staged bundle and records this actor's `planned` source log. */
  planSelection(required: { actorId: string; target: BackstopTarget; audit: BackstopAuditPort; overwriteEntityKeys: unknown }): Promise<BackstopPlanOutcome>;
}

/** The undo storage the host opened: the audit and its one-transaction undo of every inverse. */
export interface BackstopUndo {
  audit: BackstopAuditPort;
  /** Undoes every inverse newest-first; answers the reasons for the ones it left alone. */
  undoAll(required: { log: BackstopAuditRecord }): Promise<string[]>;
}

/** The undo spec's deps. */
export interface BackstopUndoRouteDeps extends BackstopActorDeps {
  backstopRefusal: BackstopRefusalFn;
  /** The audit, row and file ports an undo needs, or `null` while the audit storage is not installed. */
  openUndo(): Promise<BackstopUndo | null>;
}

/** The principal, or a fail-closed wiring error. @complexity O(1). */
function principalOf({ context }: { context: PublishRoutePrincipal | undefined }, _optional: Record<string, never> = {}): PublishRoutePrincipal {
  if (!context) throw new Error("publish-content admin route has no authenticated principal");
  return context;
}

/** The actor id when this principal may send by hand, else the flat 403. @complexity O(1) plus the host check. */
async function requireBackstopActor({ deps, context }: { deps: BackstopActorDeps; context: PublishRoutePrincipal | undefined }, _optional: Record<string, never> = {}): Promise<string> {
  const principal = principalOf({ context });
  if (!(await deps.mayUseBackstop({ context: principal }))) rejectRoute({ status: 403, error: deps.forbiddenMessage, code: "FORBIDDEN" });
  return principal.id;
}

/** Runs `work`, turning a host-mapped typed error into its refusal; anything else is rethrown. @complexity O(1). */
async function mapBackstopErrors<T>({ deps, work }: { deps: { backstopRefusal: BackstopRefusalFn }; work: () => Promise<T> }, _optional: Record<string, never> = {}): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RouteRefusalError) throw error;
    const refusal = deps.backstopRefusal({ error });
    if (refusal) throw new RouteRefusalError(refusal);
    throw error;
  }
}

/** A destination-side run can be undone after a success, or after a failure that recorded inverses. */
function hasUndo(log: BackstopAuditRecord): boolean {
  return log.result === "success" || (log.result === "failure" && log.inverses.length > 0);
}

/** `:runId` as the hand-written route read it (`String(req.params.runId)`). */
const runIdOf = (params: Record<string, string | undefined>) => ({ runId: String(params.runId) });

/** `GET .../backstop/status` — whether this actor may send by hand, and whether the audit storage is installed. */
export const backstopStatusRoute = defineJsonRoute<undefined, { allowed: true; installed: boolean }, BackstopReadRouteDeps, PublishRoutePrincipal>({
  method: "get",
  path: `${BASE}/backstop/status`,
  parse: () => ok({ value: undefined }),
  handle: async ({ deps, context }) => {
    await requireBackstopActor({ deps, context });
    const audit = await deps.readyAudit();
    return ok({ value: { allowed: true, installed: audit !== null } });
  },
});

/** `GET .../runs/:runId/backstop` — one destination-side send's summary. */
export const backstopRunRoute = defineJsonRoute<{ runId: string }, Record<string, unknown>, BackstopReadRouteDeps, PublishRoutePrincipal>({
  method: "get",
  path: `${BASE}/runs/:runId/backstop`,
  parse: (raw) => ok({ value: runIdOf(raw.params) }),
  handle: async ({ input, deps, context }) => {
    await requireBackstopActor({ deps, context });
    const audit = await deps.readyAudit();
    if (!audit) rejectRoute({ status: 503, error: NOT_INSTALLED, code: "BACKSTOP_NOT_INSTALLED" });
    const log = await audit.get({ workspaceId: deps.workspaceId, id: input.runId });
    if (!log || log.direction !== "destination") rejectRoute({ status: 404, error: "This send was not found on this site." });
    return ok({ value: { runId: log.runId, reason: log.reason, items: log.items.map(({ entityType, id }) => ({ entityType, id })), canUndo: hasUndo(log) } });
  },
});

/** Reads the peer, its live address and the operator's confirmation off a send/plan body.
 *  @complexity O(n) in the selected rows/files, plus one peer read. */
async function readBackstopTarget({ deps, body }: { deps: BackstopSendRouteDeps; body: Record<string, unknown> }, _optional: Record<string, never> = {}): Promise<BackstopTarget> {
  const peerId = body.peerId;
  if (typeof peerId !== "string") rejectRoute({ status: 400, error: "Choose a connected live site.", code: "VALIDATION_ERROR" });
  const destination = await deps.findPeer({ peerId });
  if (!destination) rejectRoute({ status: 404, error: "The connected live site was not found." });
  const host = new URL(destination.baseUrl).host;
  // Checking is not the human confirmation. A supplied wrong host still fails, but the UI
  // leaves this field empty until the operator has seen the plan. Send always requires it.
  const checked = deps.checkRequest({ body: body.action === "plan" && body.typedHost === undefined
    ? { ...body, typedHost: host } : body, destinationHost: host });
  if ("error" in checked) rejectRoute({ status: 400, error: checked.error, code: "VALIDATION_ERROR" });
  return { peerId, destination, host, request: checked.request };
}

/** The checked plan `send` redeems: this actor's own `planned` source log for the same
 *  destination, reason and peer. Anything else must be checked again. */
function isSendablePlan(log: BackstopAuditRecord | null, { actorId, target }: { actorId: string; target: BackstopTarget }): log is BackstopAuditRecord {
  if (log === null || log.direction !== "source" || log.actorId !== actorId) return false;
  return log.destination === target.destination.baseUrl && log.result === "planned" &&
    log.reason === target.request.reason && log.details.peerId === target.peerId;
}

/** One send/plan request once its target is checked and audit is ready. */
interface BackstopRun { deps: BackstopSendRouteDeps; actorId: string; target: BackstopTarget; audit: BackstopAuditPort }

/** `send`: confirms and executes the plan a previous `plan` call recorded. @complexity O(1) plus the host work. */
async function sendCheckedPlan({ run, logId }: { run: BackstopRun; logId: unknown }, _optional: Record<string, never> = {}): Promise<Record<string, unknown>> {
  const { deps, audit, target } = run;
  const log = typeof logId === "string" ? await audit.get({ workspaceId: deps.workspaceId, id: logId }) : null;
  if (!isSendablePlan(log, { actorId: run.actorId, target })) rejectRoute({ status: 409, error: "Check what would change again before sending." });
  const result = await deps.redeemPlan({ target, audit, log });
  return { ...result, logId: log.id, destination: target.destination.baseUrl };
}

/** `plan`: the host's answer, or the 400 when `overwriteEntityKeys` names an item this plan did not select. */
async function planChecked({ run, overwriteEntityKeys }: { run: BackstopRun; overwriteEntityKeys: unknown }, _optional: Record<string, never> = {}): Promise<Record<string, unknown>> {
  const outcome = await run.deps.planSelection({ actorId: run.actorId, target: run.target, audit: run.audit, overwriteEntityKeys });
  if ("overwriteNotSelected" in outcome) rejectRoute({ status: 400, error: "Only selected items can be overwritten.", code: "VALIDATION_ERROR" });
  return outcome.value;
}

/** `POST .../backstop`: the source side of send by hand (`plan`, then `send`). */
async function handleBackstopRequest({ deps, context, body }: { deps: BackstopSendRouteDeps; context: PublishRoutePrincipal | undefined; body: Record<string, unknown> }, _optional: Record<string, never> = {}): Promise<Record<string, unknown>> {
  const actorId = await requireBackstopActor({ deps, context });
  const target = await readBackstopTarget({ deps, body });
  const audit = await deps.readyAudit();
  if (!audit) rejectRoute({ status: 503, error: "Send by hand needs its audit storage installed before it can send anything.", code: "BACKSTOP_NOT_INSTALLED" });
  const run: BackstopRun = { deps, actorId, target, audit };
  if (body.action === "send") return sendCheckedPlan({ run, logId: body.logId });
  if (body.action !== "plan") rejectRoute({ status: 400, error: "Choose Check what would change or Send to live." });
  return planChecked({ run, overwriteEntityKeys: body.overwriteEntityKeys });
}

/** `POST .../backstop` — the body is read only after the actor gate, so parse refuses nothing. */
export const backstopSendRoute = defineJsonRoute<{ body: Record<string, unknown> }, Record<string, unknown>, BackstopSendRouteDeps, PublishRoutePrincipal>({
  method: "post",
  path: `${BASE}/backstop`,
  parse: (raw) => ok({ value: { body: bodyRecord({ body: raw.body }) } }),
  handle: async ({ input, deps, context }) => ok({ value: await mapBackstopErrors({ deps, work: () => handleBackstopRequest({ deps, context, body: input.body }) }) }),
});

/** `publish_content.read` with no entity type; a mount without an authorizer fails closed. @complexity O(1). */
async function authorizeHistoryRead({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("publish-content admin route has no authorizer");
  await authorize({ permission: "publish_content.read" });
}

/** `GET .../backstop/gaps` — the recorded gaps, or none while the audit storage is not installed. */
export const backstopGapsRoute = defineJsonRoute<undefined, { gaps: readonly BackstopGap[] }, BackstopGapsRouteDeps, PublishRoutePrincipal>({
  method: "get",
  path: `${BASE}/backstop/gaps`,
  parse: () => ok({ value: undefined }),
  handle: async ({ deps, authorize }) => {
    await authorizeHistoryRead({ authorize });
    const audit = await deps.readyAudit();
    return ok({ value: { gaps: audit ? await audit.gaps({ workspaceId: deps.workspaceId }) : [] } });
  },
});

/** `POST .../runs/:runId/undo-backstop`: the destination side's one-click undo. */
async function handleUndoRequest({ deps, context, runId }: { deps: BackstopUndoRouteDeps; context: PublishRoutePrincipal | undefined; runId: string }, _optional: Record<string, never> = {}): Promise<Record<string, unknown>> {
  await requireBackstopActor({ deps, context });
  const undo = await deps.openUndo();
  if (!undo) rejectRoute({ status: 503, error: NOT_INSTALLED });
  const log = await undo.audit.get({ workspaceId: deps.workspaceId, id: runId });
  if (!log || log.direction !== "destination" || !hasUndo(log)) rejectRoute({ status: 404, error: "This send has no undo available." });
  const skipped = await undo.undoAll({ log });
  return { runId: log.runId, undone: log.inverses.length - skipped.length, skipped };
}

/** `POST .../runs/:runId/undo-backstop`. */
export const backstopUndoRoute = defineJsonRoute<{ runId: string }, Record<string, unknown>, BackstopUndoRouteDeps, PublishRoutePrincipal>({
  method: "post",
  path: `${BASE}/runs/:runId/undo-backstop`,
  parse: (raw) => ok({ value: runIdOf(raw.params) }),
  handle: async ({ input, deps, context }) => ok({ value: await mapBackstopErrors({ deps, work: () => handleUndoRequest({ deps, context, runId: input.runId }) }) }),
});
