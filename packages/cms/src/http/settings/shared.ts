import type { Response } from "express";
import type { SettingScope } from "../../settings/index.js";
import type { Authorize, SettingsPermissions } from "./contracts.js";

export type TargetWorkspaceResolution = { ok: true; workspaceId: string | undefined } | { ok: false; error: string };
/** Pin writes to the authorized workspace, rejecting a conflicting body target.
 * Global scope has no target workspace. Pure; O(1) time/space for string ids.
 * @example resolveTargetWorkspaceId({ workspaceId, input: { scope: "workspace", bodyWorkspaceId } });
 */
export function resolveTargetWorkspaceId(required: {
  workspaceId: string; input: { bodyWorkspaceId: unknown; scope: SettingScope };
}): TargetWorkspaceResolution {
  const { workspaceId, input } = required;
  const named = input.bodyWorkspaceId === undefined || input.bodyWorkspaceId === null || input.bodyWorkspaceId === ""
    ? undefined : String(input.bodyWorkspaceId);
  if (named !== undefined && named !== workspaceId) {
    return { ok: false, error: `workspaceId '${named}' does not match this route's workspace; a settings write cannot target another workspace` };
  }
  return { ok: true, workspaceId: input.scope === "global" ? undefined : workspaceId };
}
export type UserLayerReadTarget = { allowed: true; principalId: string | undefined } | { allowed: false; reason: string };
/** Require the injected cross-principal grant only when a read targets another user.
 * Returns the denial reason without reading values; one authorization effect at most.
 * @complexity O(1) excluding the authorizer.
 * @example resolveUserLayerReadTarget({ deps: { workspaceId, authorize, permission }, input });
 */
export async function resolveUserLayerReadTarget(required: {
  deps: { workspaceId: string; authorize: Authorize; permission: string };
  input: { requestedPrincipalId: string | undefined; callerPrincipalId: string };
}): Promise<UserLayerReadTarget> {
  const { deps, input } = required;
  if (!input.requestedPrincipalId || input.requestedPrincipalId === input.callerPrincipalId) {
    return { allowed: true, principalId: input.requestedPrincipalId };
  }
  const result = await deps.authorize({ principalId: input.callerPrincipalId, permission: deps.permission,
    workspaceId: deps.workspaceId, entityType: "setting-value" });
  return result.allowed ? { allowed: true, principalId: input.requestedPrincipalId } : { allowed: false, reason: result.reason };
}
export interface SettingsErrorMapping {
  readonly matches: (error: unknown) => boolean; readonly status: number; readonly code: string;
}
/** Write the first matching status/code, or a fixed 500 that does not disclose unknown errors.
 * @complexity O(mapping count) time, O(1) space; response write effect.
 * @example respondToSettingsError({ response, error, mappings });
 */
export function respondToSettingsError(required: {
  response: Pick<Response, "status" | "json">; error: unknown; mappings: readonly SettingsErrorMapping[];
}): void {
  const { response, error, mappings } = required;
  const message = error instanceof Error ? error.message : String(error);
  for (const mapping of mappings) {
    if (mapping.matches(error)) { response.status(mapping.status).json({ error: message, code: mapping.code }); return; }
  }
  response.status(500).json({ error: "internal error", code: "INTERNAL_ERROR" });
}
/** Select caller policy for the CMS scope and self/other-user split; pure, O(1).
 * @example settingsWritePermission({ permissions, scope: "user", callerPrincipalId, targetPrincipalId });
 */
export function settingsWritePermission(required: {
  permissions: SettingsPermissions; scope: SettingScope; callerPrincipalId: string; targetPrincipalId: string | undefined;
}): string {
  const { permissions, scope, callerPrincipalId, targetPrincipalId } = required;
  if (scope === "global") return permissions.writeGlobal;
  if (scope === "workspace") return permissions.writeWorkspace;
  return targetPrincipalId == null || targetPrincipalId === callerPrincipalId ? permissions.writeUserSelf : permissions.writeUserOther;
}
