import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { RawSetting, SettingsService } from "@jini-ai/core/settings";

import {
  rejectCrossPrincipalRead, runSettingsRoute, settingsRouteInput,
  type SettingsReadTargetFn, type SettingsRouteBaseDeps, type SettingsRouteInput, type SettingsRoutePrincipal,
} from "./shared.js";

/** The deps this route reads: readiness, the host's settings service, and the cross-principal read policy. */
export interface SettingsGetRawRouteDeps extends SettingsRouteBaseDeps {
  /** Host-composed settings service (built per request, as the hand-written route did). */
  settingsService: () => Pick<SettingsService, "raw">;
  /** Second, non-throwing grant check for reading another principal's user layer. */
  resolveReadTarget: SettingsReadTargetFn;
  /** The permission that check asks for, echoed in the 403's `details` (host policy). */
  crossPrincipalReadPermission: string;
}

/** This route's two required query params, or `null` if either is missing.
 *  @complexity O(1). */
function parseGetRawQuery(query: Record<string, unknown>): { namespace: string; key: string; principalId: string | undefined } | null {
  const namespace = String(query.namespace ?? "");
  const key = String(query.key ?? "");
  if (!namespace || !key) {
    return null;
  }
  return { namespace, key, principalId: query.principalId ? String(query.principalId) : undefined };
}

/**
 * GET the per-layer raw values of one setting key. `state === "set"` yields stored data; cleared
 * or absent layers read as null (layer resolution: `@jini-ai/core/settings` cms-adapter).
 *
 * Authorizes BEFORE validating the query (a denied caller learns nothing about the contract).
 * `workspaceId` is NOT honored as a query param (the workspace always comes from the authorized
 * `deps.workspaceId`), and `principalId` naming another principal requires the injected
 * cross-principal read permission. A missing/tombstoned definition 404s `DEFINITION_NOT_FOUND`,
 * mirroring set/clear's identical mapping for the same error.
 */
export const settingsGetRawRoute = defineJsonRoute<SettingsRouteInput, RawSetting, SettingsGetRawRouteDeps, SettingsRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/settings/raw",
  parse: (raw) => settingsRouteInput(raw),
  handle: async ({ input, deps, context, authorize }) => ok({ value: await runSettingsRoute({ deps, context, authorize, run: async ({ principal, authorize: auth }) => {
    await auth({ permission: "settings.read.raw", entityType: "setting-value" });
    const parsedQuery = parseGetRawQuery(input.query);
    if (!parsedQuery) {
      rejectRoute({ status: 400, error: "'namespace' and 'key' query params are required", code: "VALIDATION_ERROR" });
    }
    const { namespace, key } = parsedQuery;
    // `authorize()` above was checked against `deps.workspaceId` and the caller — never let the
    // actual read target a different workspace or principal than what was authorized.
    const workspaceId = deps.workspaceId;
    const readTarget = await deps.resolveReadTarget({ requestedPrincipalId: parsedQuery.principalId, callerPrincipalId: principal.id });
    if (!readTarget.allowed) {
      rejectCrossPrincipalRead({ principalId: principal.id, reason: readTarget.reason, permission: deps.crossPrincipalReadPermission });
    }
    const value = await deps.settingsService().raw({ namespace, key, workspaceId, principalId: readTarget.principalId });
    if (!value) {
      rejectRoute({ status: 404, error: `definition '${namespace}.${key}' was not found`, code: "DEFINITION_NOT_FOUND" });
    }
    return value;
  } }) }),
});
