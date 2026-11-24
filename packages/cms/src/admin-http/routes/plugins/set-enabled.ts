import type { AuthorizeFn, CommandMutation, ExecuteCommandDeps } from "@jini-ai/core/contracts/events";
import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";
import type { PluginActivationRecord, PluginActivationRepoPort } from "@jini-ai/core/contracts/site/plugins-host";
import { rejectRoute, RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { executeCommand, ForbiddenError } from "../../../core/index.js";
import { pluginActorId, pluginIdParam, type AdminPluginDto, type PluginErrorClass, type PluginRouteRecord, type PluginsRoutePrincipal } from "./shared.js";

/** One activation change, as the plugin engine's `setPluginEnabled` takes it. */
export interface PluginSetEnabledInput { workspaceId: string; pluginId: string; enabled: boolean }

/** The error classes the set-enabled ladder maps (host and engine classes, injected). */
export interface PluginSetEnabledErrors {
  /** The committed OFF could not confirm affected answers stopped; carries its own code. */
  toolAccessLowering: PluginErrorClass<Error & { readonly code: string }>;
  /** A local install/update holds the plugin; carries its own code. */
  install: PluginErrorClass<Error & { readonly code: string }>;
  notFound: PluginErrorClass;
  incompatible: PluginErrorClass;
  invalid: PluginErrorClass;
  conflict: PluginErrorClass<Error & { readonly pluginId: string; readonly conflicts: readonly unknown[] }>;
  load: PluginErrorClass<Error & { readonly pluginId: string; readonly reason: string }>;
}

/**
 * The deps this route reads. The gateway fields go to `executeCommand` as they are; `authorizeCommand`
 * is the host's raw authorizer (the gateway asks it and throws its own 403), not the mount's port.
 * Functions are methods so a host may bind ones typed against its full discovery record.
 */
export interface PluginSetEnabledRouteDeps extends Pick<ExecuteCommandDeps, "clock" | "idGen" | "changeSets"> {
  workspaceId: string;
  /** When the host has one, `change-set.applied` is enqueued; `undefined` is an explicit "none". */
  outbox: ExecuteCommandDeps["outbox"];
  authorizeCommand: AuthorizeFn;
  pluginActivationRepo: Pick<PluginActivationRepoPort, "getActivation" | "save" | "deleteActivation">;
  /** Pre-bound discovery (install dir and built-ins captured by the host); runs on every call. */
  discoverPlugins(): Promise<readonly PluginRouteRecord[]>;
  /** The engine's `setPluginEnabled`, pre-bound to the clock, activation repo and hook attach/detach. */
  setPluginEnabled(required: { discovery: readonly PluginRouteRecord[]; input: PluginSetEnabledInput }): Promise<{ activation: PluginActivationRecord }>;
  /** Rollback's compensating side effects (the same ones `setPluginEnabled` runs). */
  onPluginEnabled(pluginId: string): Promise<void>;
  onPluginDisabled(pluginId: string): void;
  /** Records the owner's enable of a site plugin as its approved capability set (a no-op when the host has no source). */
  recordApproval(required: { record: PluginRouteRecord }): Promise<void>;
  /** Stops the serving runtime's affected answers after a committed OFF. */
  lowerToolAccess(required: { pluginId: string }): Promise<void>;
  /** Owner-action signals; the host's noop means off. */
  tracker: Pick<Tracker, "capture">;
  /** The host's serializer (the same one `PLUGINS_LIST` uses, which also takes a missing row). */
  toAdminPluginResponse(required: { discovery: PluginRouteRecord; activation: PluginActivationRecord | null }): AdminPluginDto;
  setEnabledErrors: PluginSetEnabledErrors;
}

/** The `PLUGIN_SET_ENABLED` envelope. */
export interface PluginSetEnabledEnvelope { plugin: AdminPluginDto; changeSetId: string }

/** One ladder rung; `code`/`details` read the error when the wire body carries its fields. */
interface SetEnabledRung { is: PluginErrorClass; status: number; code: string | ((err: never) => string); details?: (err: never) => object }

/** The ladder, top to bottom, exactly as the hand-written route ordered it. @complexity O(1). */
function setEnabledRungs(errors: PluginSetEnabledErrors, _optional: Record<string, never> = {}): readonly SetEnabledRung[] {
  return [
    { is: errors.toolAccessLowering, status: 503, code: (err: { code: string }) => err.code },
    { is: errors.install, status: 409, code: (err: { code: string }) => err.code },
    { is: ForbiddenError, status: 403, code: "FORBIDDEN", details: (err: ForbiddenError) => ({ permission: err.permission, reason: err.reason }) },
    { is: errors.notFound, status: 404, code: "PLUGIN_NOT_FOUND" },
    { is: errors.incompatible, status: 422, code: "PLUGIN_INCOMPATIBLE" },
    { is: errors.invalid, status: 422, code: "PLUGIN_INVALID" },
    // 2026-10-04: a name another plugin or core already holds — the operator's fix is to turn the
    // other plugin off, so this is a 409 with the structured clash, never a 500.
    { is: errors.conflict, status: 409, code: "PLUGIN_CONFLICT", details: (err: { pluginId: string; conflicts: readonly unknown[] }) => ({ pluginId: err.pluginId, conflicts: err.conflicts }) },
    { is: errors.load, status: 500, code: "PLUGIN_LOAD_FAILED", details: (err: { pluginId: string; reason: string }) => ({ pluginId: err.pluginId, reason: err.reason }) },
  ];
}

/**
 * Refuses with the first matching rung as the flat `{ error, code[, details] }` body; anything
 * unmapped is rethrown for the host's redacted 500.
 * @complexity O(n) in the rung count (eight).
 */
function rejectSetEnabledError({ err, errors }: { err: unknown; errors: PluginSetEnabledErrors }, _optional: Record<string, never> = {}): never {
  const rung = setEnabledRungs(errors).find((candidate) => err instanceof candidate.is);
  if (!rung) throw err;
  const code = typeof rung.code === "string" ? rung.code : rung.code(err as never);
  const body = { error: (err as Error).message, code, ...(rung.details ? { details: rung.details(err as never) } : {}) };
  throw new RouteRefusalError({ status: rung.status, body });
}

/**
 * `executeCommand`'s `rollback` for this route: restores the captured prior activation row (or
 * deletes it, for a first-time enable/disable), then re-invokes the matching `onPluginEnabled`/
 * `onPluginDisabled` side effect so hook attachment stays consistent with the restored row.
 *
 * Declared as its own top-level function, not inline in the `mutation` object, so its two-branch
 * shape doesn't nest inside the route handler.
 *
 * @complexity O(1).
 */
async function rollbackPluginActivation(
  deps: Pick<PluginSetEnabledRouteDeps, "pluginActivationRepo" | "onPluginEnabled" | "onPluginDisabled">,
  params: { workspaceId: string; pluginId: string; priorActivation: PluginActivationRecord | null },
): Promise<void> {
  const { workspaceId, pluginId, priorActivation } = params;
  if (priorActivation) {
    await deps.pluginActivationRepo.save(priorActivation);
  } else {
    await deps.pluginActivationRepo.deleteActivation({ workspaceId, pluginId });
  }
  if (priorActivation?.enabled) {
    await deps.onPluginEnabled(pluginId);
  } else {
    deps.onPluginDisabled(pluginId);
  }
}

/** The gateway mutation plus a reader for the prior row it captured. @complexity O(1) to build. */
function createPluginActivationMutation(
  { deps, pluginId, enabled, discovery }: { deps: PluginSetEnabledRouteDeps; pluginId: string; enabled: boolean; discovery: readonly PluginRouteRecord[] },
  _optional: Record<string, never> = {},
): { priorActivation: () => PluginActivationRecord | null; mutation: CommandMutation<{ activation: PluginActivationRecord }> } {
  const site = discovery.find((r) => r.id === pluginId && r.source === "site");
  // Full pre-transition activation row, captured in captureInverse and reused verbatim by
  // rollback — mirrors the posts update route's `priorPost` shape exactly (ADR API/Event
  // Contract Summary: this route is thin, `executeCommand`-wrapped, same as that one).
  let priorActivation: PluginActivationRecord | null = null;
  return { priorActivation: () => priorActivation, mutation: {
    entityType: "plugin-activation",
    entityId: pluginId,
    operation: "update",
    captureInverse: async () => {
      priorActivation = await deps.pluginActivationRepo.getActivation({ workspaceId: deps.workspaceId, pluginId });
      // BR-05/REQ-07: the inverse is the PRIOR enabled value only — a plugin activation has
      // no other revertible field a restore would need (mirrors `presentation.ts`'s
      // single-field activation shape).
      return { enabled: priorActivation?.enabled ?? false };
    },
    execute: async () => {
      // The owner's own click is the approval later assistant re-seals are compared against,
      // so a code-only re-seal does not ask again. Inside `execute`, i.e. only after the
      // permission gate; recorded first, so a failed record leaves the plugin off.
      if (enabled && site) await deps.recordApproval({ record: site });
      return deps.setPluginEnabled({ discovery, input: { workspaceId: deps.workspaceId, pluginId, enabled } });
    },
    rollback: () => rollbackPluginActivation(deps, { workspaceId: deps.workspaceId, pluginId, priorActivation }),
  } };
}

/** The audited write, then the post-commit effects. @complexity O(n) in discovered plugins plus the gateway. */
async function setPluginEnabledCommand(
  { deps, principalId, pluginId, enabled }: { deps: PluginSetEnabledRouteDeps; principalId: string; pluginId: string; enabled: boolean },
  _optional: Record<string, never> = {},
): Promise<PluginSetEnabledEnvelope> {
  const discovery = await deps.discoverPlugins();
  const activation = createPluginActivationMutation({ deps, pluginId, enabled, discovery });
  const { result, changeSetId } = await executeCommand({
    deps: { clock: deps.clock, idGen: deps.idGen, changeSets: deps.changeSets, outbox: deps.outbox, authorize: deps.authorizeCommand },
    command: {
      workspaceId: deps.workspaceId,
      actor: { id: principalId, kind: "user" },
      summary: `Set plugin '${pluginId}' enabled=${enabled}`,
      permission: "admin.plugins.enable",
      // No `idempotencyKey`: an enable/disable is a target-state write, so the gateway can never
      // raise `DuplicateCommandError` for this route and there is no `DUPLICATE_COMMAND` arm to map.
    },
    mutation: activation.mutation,
  });
  // OFF commits before the existing serving runtime stops affected answers.
  if (!result.activation.enabled) await deps.lowerToolAccess({ pluginId });
  // `setPluginEnabled` throws its not-found error for an id absent from this same `discovery`
  // snapshot, so reaching this line means the record is in it.
  const record = discovery.find((r) => r.id === pluginId) as PluginRouteRecord;
  // The gateway has committed; retries that keep the same state do not count.
  if ((activation.priorActivation()?.enabled ?? false) !== result.activation.enabled) void deps.tracker.capture({ name: "plugin_toggled", userId: principalId }, { properties: { pluginId: record.id, pluginKind: "cms", enabled: result.activation.enabled, source: "admin" } });
  return { plugin: deps.toAdminPluginResponse({ discovery: record, activation: result.activation }), changeSetId };
}

/**
 * `PLUGIN_SET_ENABLED` — `PATCH /api/admin/v1/workspaces/:workspaceId/plugins/:pluginId`
 * (SPEC-005 REQ-07/REQ-10, api.spec.md §1/§4/§5/§6; C-016).
 *
 * `executeCommand`-wrapped like the posts update route: `captureInverse` snapshots the prior
 * activation row (or `null` — a plugin enabled for the first time has no prior row), `execute` calls
 * the engine's `setPluginEnabled()`. Its typed errors (unknown id ⇒ 404 `PLUGIN_NOT_FOUND`; invalid/
 * incompatible ⇒ 422) are mapped by this route's ladder, as every gateway-wrapped route maps its
 * feature function's typed errors. On a later gateway failure `rollback` restores the prior row and
 * re-runs the matching side effect. Authorization is the gateway's own (its 403 carries `details`),
 * so the mount's authorize port is never asked.
 */
export const pluginSetEnabledRoute = defineJsonRoute<{ pluginId: string; enabled: boolean }, PluginSetEnabledEnvelope, PluginSetEnabledRouteDeps, PluginsRoutePrincipal>({
  method: "patch",
  path: "/api/admin/v1/workspaces/:workspaceId/plugins/:pluginId",
  parse: (raw) => {
    // Validated, not coerced (api.spec.md: malformed body is 400): `Boolean("false")` is `true`, so
    // coercion let a malformed body ENABLE a plugin and run its enable hook. Same rule as the
    // agent-plugins set-enabled route.
    const enabled = (raw.body as { enabled?: unknown } | undefined | null)?.enabled;
    if (typeof enabled !== "boolean") rejectRoute({ status: 400, error: "'enabled' must be a boolean", code: "VALIDATION_ERROR" });
    return ok({ value: { pluginId: pluginIdParam(raw.params), enabled } });
  },
  handle: async ({ input, deps, context }) => {
    try {
      const principalId = pluginActorId({ context });
      return ok({ value: await setPluginEnabledCommand({ deps, principalId, ...input }) });
    } catch (err) {
      return rejectSetEnabledError({ err, errors: deps.setEnabledErrors });
    }
  },
});
