import { defineJsonRoute, ok, type JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { rejectRoute, RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { BackstopAuditPort } from "../../../publish/transfer/index.js";
import { readBackstopApplyReport, toPublishContentReportDto, type PublishContentReportSource } from "../../http/publish-content.js";
import { bodyRecord, type PublishRoutePrincipal } from "./transport-shared.js";

/**
 * @file Task 7 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §1.5/§4 task 7.
 *
 * `POST /api/admin/v1/workspaces/:workspaceId/publish-content/import/{plan,confirm,execute}` —
 * the gated import ceremony over a bundle already staged by Task 6's
 * `POST .../publish-content/bundles`, plus `GET .../runs/:runId`. The host owns the gated-mutation
 * gateway, the per-request hooks, the publishing-grant attenuation and the error classes; it injects
 * them as functions keyed on the spec's `context`. These specs own the body refusals, the overwrite
 * rule, the raw-values gate, the execute pre-check's 403 and the answer shapes.
 *
 * `plan` and `execute` both take `{bundleId}` in the body — the SAME bundle must be named at both
 * steps, since the host's import hooks close over it fresh per request (mirrors
 * `merge-term.ts`'s `intoTermId` being required in both `plan` and `execute` bodies for the
 * identical reason: `computePlan()`/`executeMutation()` need to know what to recompute against).
 */

/** The status-and-body pair the host maps one of its typed import errors to. */
export interface ImportRouteRefusal { status: number; body: Record<string, unknown> }

/** The host's typed-error mapping; `undefined` leaves the error to the mount's redacted 500. */
export type ImportRefusalFn = (required: { error: unknown }) => ImportRouteRefusal | undefined;

/** The fields every import spec reads. */
export interface ImportRouteBaseDeps {
  workspaceId: string;
  importRefusal: ImportRefusalFn;
}

/** Overwrite ticks; `null` = force nothing. */
export type OverwriteEntityKeys = readonly string[] | null;

/**
 * publish-overwrite-live-plan §4/S6 and §4/S7 — reads `overwriteEntityKeys` off a request body: the
 * `entityKey()` strings (planner.ts) the operator ticked "overwrite on live" for. Absent/`null`
 * means "force nothing", the pre-S6 default every existing caller keeps getting. Bounded at 1000
 * entries, matching the plan's own cap — this ceremony never has a legitimate use for more than
 * that in one bundle.
 * @complexity O(n) in the submitted key count.
 */
export function readOverwriteEntityKeys({ overwriteEntityKeys }: { overwriteEntityKeys: unknown }, _optional: Record<string, never> = {}): OverwriteEntityKeys | "invalid" {
  if (overwriteEntityKeys === undefined || overwriteEntityKeys === null) return null;
  if (!Array.isArray(overwriteEntityKeys) || overwriteEntityKeys.length > 1000) return "invalid";
  if (!overwriteEntityKeys.every((key): key is string => typeof key === "string")) return "invalid";
  return overwriteEntityKeys;
}

/** The ticks, or the 400 for a malformed set. @complexity O(n). */
function overwriteKeysOrRefuse({ body }: { body: Record<string, unknown> }, _optional: Record<string, never> = {}): OverwriteEntityKeys {
  const keys = readOverwriteEntityKeys({ overwriteEntityKeys: body.overwriteEntityKeys });
  if (keys === "invalid") rejectRoute({ status: 400, error: "'overwriteEntityKeys' must be an array of strings", code: "VALIDATION_ERROR" });
  return keys;
}

/** A required string body field set, or the route's exact 400. @complexity O(fields). */
function requireStrings({ body, fields, error }: { body: Record<string, unknown>; fields: readonly string[]; error: string }, _optional: Record<string, never> = {}): void {
  if (fields.some((field) => typeof body[field] !== "string")) rejectRoute({ status: 400, error, code: "VALIDATION_ERROR" });
}

/** The credential-kind reader the overwrite rule asks. */
export type CredentialKindFn = (required: { context: PublishRoutePrincipal | undefined }) => string;

/**
 * publish-overwrite-live-plan §7: "Overwrite on live" ticks come only from a person's click — here,
 * a signed-in admin session, or a publishing instance relaying its own admin's click (its relay
 * refuses an API key the same way, `peer-transport.ts`'s `mayOverwrite`). An API key on this
 * instance is refused. Empty ticks ask for nothing and pass (and never read the credential kind).
 * @complexity O(1).
 */
function refuseApiKeyOverwrite({ keys, credentialKind, context }: { keys: OverwriteEntityKeys; credentialKind: CredentialKindFn; context: PublishRoutePrincipal | undefined }, _optional: Record<string, never> = {}): void {
  if (keys === null || keys.length === 0) return;
  if (credentialKind({ context }) !== "api_key") return;
  rejectRoute({
    status: 403, error: "'overwriteEntityKeys' can only be sent from a signed-in admin session or a publishing instance",
    code: "FORBIDDEN", details: { permission: "publish_content.apply", reason: "credential_kind_not_permitted" },
  });
}

/** Runs `work`, turning a host-mapped typed error into its refusal; anything else is rethrown. @complexity O(1). */
async function mapImportErrors<T>({ deps, work }: { deps: ImportRouteBaseDeps; work: () => Promise<T> }, _optional: Record<string, never> = {}): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RouteRefusalError) throw error;
    const refusal = deps.importRefusal({ error });
    if (refusal) throw new RouteRefusalError(refusal);
    throw error;
  }
}

/** The principal, or a fail-closed wiring error. @complexity O(1). */
function principalOf({ context }: { context: PublishRoutePrincipal | undefined }, _optional: Record<string, never> = {}): PublishRoutePrincipal {
  if (!context) throw new Error("publish-content admin route has no authenticated principal");
  return context;
}

const BASE = "/api/admin/v1/workspaces/:workspaceId/publish-content";

/** The plan spec's deps. */
export interface ImportPlanRouteDeps extends ImportRouteBaseDeps {
  credentialKind: CredentialKindFn;
  /** Builds the hooks and runs the gateway's `plan` for this request's principal and grant. */
  planImport(required: { context: PublishRoutePrincipal; bundleId: string; overwriteEntityKeys: OverwriteEntityKeys }): Promise<{ result: Record<string, unknown>; report: PublishContentReportSource }>;
  /** Whether this principal may read manual-publishing values for every type in the report. */
  mayReadRawValues(required: { context: PublishRoutePrincipal; report: PublishContentReportSource }): Promise<boolean>;
  /** The manual-send value preview, or `undefined` when there is none to show. */
  backstopPreview(required: { bundleId: string; report: PublishContentReportSource }): Promise<unknown>;
}

/** True when a plan carries manual-publish rows, whose values the preview would show. @complexity O(n). */
function planCarriesRawRows({ report }: { report: PublishContentReportSource }, _optional: Record<string, never> = {}): boolean {
  return !report.refused && report.rows.some((row) => row.entityType === "raw-row" || row.entityType === "raw-file");
}

/**
 * A read-capable account cannot turn the raw plan into a private-data reader. The planner does not
 * attach backstop metadata; the apply loop adds that to the durable run later, so raw rows are
 * detected here and the first manual plan also has a value review.
 * @complexity O(n) plus the host's checks.
 */
async function rawPlanPreview({ deps, context, bundleId, report }: { deps: ImportPlanRouteDeps; context: PublishRoutePrincipal; bundleId: string; report: PublishContentReportSource }, _optional: Record<string, never> = {}): Promise<unknown> {
  if (!planCarriesRawRows({ report })) return undefined;
  if (!(await deps.mayReadRawValues({ context, report }))) {
    rejectRoute({ status: 403, error: "Manual publishing values are not available to this account.", code: "FORBIDDEN" });
  }
  return deps.backstopPreview({ bundleId, report });
}

type PlanInput = { bundleId: string; overwriteEntityKeys: OverwriteEntityKeys };

/** `POST .../import/plan`. */
export const importPlanRoute = defineJsonRoute<PlanInput, Record<string, unknown>, ImportPlanRouteDeps, PublishRoutePrincipal>({
  method: "post",
  path: `${BASE}/import/plan`,
  parse: (raw) => {
    const body = bodyRecord({ body: raw.body });
    requireStrings({ body, fields: ["bundleId"], error: "'bundleId' (string) is required" });
    return ok({ value: { bundleId: body.bundleId as string, overwriteEntityKeys: overwriteKeysOrRefuse({ body }) } });
  },
  handle: ({ input, deps, context }) => mapImportErrors({ deps, work: async () => {
    refuseApiKeyOverwrite({ keys: input.overwriteEntityKeys, credentialKind: deps.credentialKind, context });
    const principal = principalOf({ context });
    const { result, report } = await deps.planImport({ context: principal, ...input });
    const backstopPreview = await rawPlanPreview({ deps, context: principal, bundleId: input.bundleId, report });
    return ok({ value: { ...result, details: toPublishContentReportDto(report), ...(backstopPreview === undefined ? {} : { backstopPreview }) } });
  } }),
});

/** The confirm spec's deps. */
export interface ImportConfirmRouteDeps extends ImportRouteBaseDeps {
  /** Runs the gateway's `confirm` for this request's principal and grant. */
  confirmImport(required: { context: PublishRoutePrincipal; planId: string; planHash: string }): Promise<{ confirmationToken: string }>;
}

/** `POST .../import/confirm` — answers only the confirmation token. */
export const importConfirmRoute = defineJsonRoute<{ planId: string; planHash: string }, { confirmationToken: string }, ImportConfirmRouteDeps, PublishRoutePrincipal>({
  method: "post",
  path: `${BASE}/import/confirm`,
  parse: (raw) => {
    const body = bodyRecord({ body: raw.body });
    requireStrings({ body, fields: ["planId", "planHash"], error: "'planId' and 'planHash' (strings) are required" });
    return ok({ value: { planId: body.planId as string, planHash: body.planHash as string } });
  },
  handle: ({ input, deps, context }) => mapImportErrors({ deps, work: async () => {
    const record = await deps.confirmImport({ context: principalOf({ context }), ...input });
    return ok({ value: { confirmationToken: record.confirmationToken } });
  } }),
});

/** The execute spec's deps. */
export interface ImportExecuteRouteDeps extends ImportRouteBaseDeps {
  credentialKind: CredentialKindFn;
  /** The gateway's own authorization answer for `publish_content.apply`, asked before the costClass refusal. */
  authorizeExecute(required: { context: PublishRoutePrincipal }): Promise<{ allowed: boolean; reason: string }>;
  /** Builds the hooks and runs the gated execute (restore-point cost check included). */
  executeImport(required: { context: PublishRoutePrincipal; bundleId: string; confirmationToken: string; overwriteEntityKeys: OverwriteEntityKeys }): Promise<Record<string, unknown> & { runId: string }>;
  /** The manual-send audit storage, when installed. */
  backstopAudit(): BackstopAuditPort | undefined;
}

type ExecuteInput = PlanInput & { confirmationToken: string };

/**
 * Pre-check mirroring `database/migrate-forward.ts`'s AUD-001 fix: authorize BEFORE the costClass
 * refusal ever runs, so an authenticated-but-unauthorized caller cannot learn this workspace's
 * restore-point capability at all. The gateway's own fresh authorize() (CIC U-001) remains the
 * authoritative check and is unchanged by this. @complexity O(1).
 */
async function authorizeImportExecute({ deps, principal }: { deps: ImportExecuteRouteDeps; principal: PublishRoutePrincipal }, _optional: Record<string, never> = {}): Promise<void> {
  const preCheck = await deps.authorizeExecute({ context: principal });
  if (preCheck.allowed) return;
  rejectRoute({ status: 403, error: `principal '${principal.id}' is not authorized for 'publish_content.apply' (${preCheck.reason})`, code: "NOT_AUTHORIZED" });
}

/** `POST .../import/execute`. */
export const importExecuteRoute = defineJsonRoute<ExecuteInput, Record<string, unknown>, ImportExecuteRouteDeps, PublishRoutePrincipal>({
  method: "post",
  path: `${BASE}/import/execute`,
  parse: (raw) => {
    const body = bodyRecord({ body: raw.body });
    requireStrings({ body, fields: ["bundleId", "confirmationToken"], error: "'bundleId' and 'confirmationToken' (strings) are required" });
    return ok({ value: { bundleId: body.bundleId as string, confirmationToken: body.confirmationToken as string, overwriteEntityKeys: overwriteKeysOrRefuse({ body }) } });
  },
  handle: ({ input, deps, context }) => mapImportErrors({ deps, work: async () => {
    refuseApiKeyOverwrite({ keys: input.overwriteEntityKeys, credentialKind: deps.credentialKind, context });
    const principal = principalOf({ context });
    await authorizeImportExecute({ deps, principal });
    const result = await deps.executeImport({ context: principal, ...input });
    // The manual result must name apply-time skips rather than repeat the dry-run prediction;
    // `readBackstopApplyReport` keeps that audit read advisory (its own doc).
    const applyReport = await readBackstopApplyReport({ audit: deps.backstopAudit(), workspaceId: deps.workspaceId, runId: result.runId });
    return ok({ value: { ...result, ...applyReport } });
  } }),
});

/** The run-status spec's deps. */
export interface ImportRunStatusRouteDeps extends ImportRouteBaseDeps {
  runStatus(required: { runId: string }): Promise<unknown>;
}

/** `publish_content.read`, guarded, no entity type. @complexity O(1). */
async function authorizeRead({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("publish-content admin route has no authorizer");
  await authorize({ permission: "publish_content.read" });
}

/** `GET .../runs/:runId` — a run's status, or the 404. */
export const importRunStatusRoute = defineJsonRoute<{ runId: string }, unknown, ImportRunStatusRouteDeps, PublishRoutePrincipal>({
  method: "get",
  path: `${BASE}/runs/:runId`,
  // The hand-written route passed `req.params.runId` through with no fallback; kept as-is.
  parse: (raw) => ok({ value: { runId: raw.params.runId as string } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeRead({ authorize });
    return mapImportErrors({ deps, work: async () => {
      const status = await deps.runStatus({ runId: input.runId });
      if (!status) rejectRoute({ status: 404, error: "publish-content run was not found", code: "RUN_NOT_FOUND" });
      return ok({ value: status });
    } });
  },
});
