import type { SettingScope, SettingDefinitionRecord } from "./types.js";
import type { SetValueRequired, ClearValueRequired } from "./write-values.js";
import type { ResetNamespaceRequired } from "./write-reset.js";
import type { ChangeFeedViewer, ChangeFeedBatch } from "./change-feed.js";

export type Authorize = (required: {
  principalId: string; workspaceId: string; permission: string; entityType: string;
}) => Promise<{ allowed: boolean; reason: string }>;
export interface SettingsPermissions {
  read: string;
  readRaw: string;
  readDefinitions: string;
  readOtherUser: string;
  manageDefinitions: string;
  writeGlobal: string;
  writeWorkspace: string;
  writeUserSelf: string;
  writeUserOther: string;
  reset: Record<SettingScope, string>;
}
export type EffectiveSettingRow = { key: string; value: unknown; sourceLayer: string; defVersion: number };
export type RawSetting = { key: string; global: unknown; workspace: unknown; user: unknown; default: unknown };
export type DefinitionResult = { applied: Array<{ key: string; op: string; status: string }> } | { unknownOp: string };
export interface SettingsService {
  listDefinitions(required: { workspaceId: string }): Promise<SettingDefinitionRecord[]>;
  effective(required: { namespace: string; workspaceId: string; principalId: string | undefined }): Promise<EffectiveSettingRow[]>;
  raw(required: { namespace: string; key: string; workspaceId: string; principalId: string | undefined }): Promise<RawSetting | null>;
  set(required: SetValueRequired["input"]): Promise<{ value: unknown; revisionSeq: number }>;
  clear(required: ClearValueRequired["input"]): Promise<{ revisionSeq: number }>;
  reset(required: ResetNamespaceRequired["input"]): Promise<{ clearedCount: number; revisionSeqs: number[] }>;
  definitions(required: { items: readonly unknown[]; callerPrincipalId: string; authWorkspaceId: string }): Promise<DefinitionResult>;
}
export interface SettingsChangeFeed {
  head(required: Record<string, never>): Promise<number>;
  /** Cursor advances across invisible rows. The emitted id MUST use batch.cursor, never head. */
  collect(required: { sinceSeq: number; limit: number; viewer: ChangeFeedViewer }): Promise<ChangeFeedBatch & { examinedCount: number }>;
}
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
