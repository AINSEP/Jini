import { nowIso as kernelNowIso } from "../primitives/index.js";
import type { JsonValue, UUID } from "../primitives/index.js";
import { ForbiddenError, SettingsRevisionConflictError } from "./errors.js";
import type { SettingsRepoPort } from "./ports.js";
import type { SettingScope } from "./types.js";
import { type SetValueRequired, type resolveScopedDefinitionOrThrow } from './write-values.js';
import { deriveRequiredPermission, type SettingsWriteServiceDeps } from './write-service.js';
/**
 * Every non-global write must land in the workspace it was AUTHORIZED against.
 *
 * `authorize()` is called with `authWorkspaceId` while the value row and revision are written with
 * `input.workspaceId`. Nothing forces the two to match unless this guard runs — a caller that
 * constructs the input directly (rather than through a route that validates the body against the
 * ambient workspace) could otherwise pass a mismatched target and have the write land in a
 * workspace neither `authorize()` call was actually evaluated against.
 *
 * A host's HTTP routes should reject a mismatched body id at the route layer (the real fix, closer
 * to the request). This is the backstop: it holds for every internal caller that constructs the
 * input directly, and makes a future caller incapable of reintroducing the gap.
 *
 * `ForbiddenError` rather than a validation error because the condition is exactly "you are not
 * authorized to write to that workspace".
 *
 * `scope: "global"` is exempt: the platform partition has no workspace, and `set`/`clear` already
 * force `workspaceId: null` on that path.
 */
export function assertTargetWorkspaceMatchesAuth(input: {
  scope: SettingScope;
  workspaceId?: UUID | undefined;
  authWorkspaceId: UUID;
  callerPrincipalId: UUID;
}): void {
  if (input.scope === "global") return;
  if (input.workspaceId === undefined) return;
  if (input.workspaceId === input.authWorkspaceId) return;
  throw new ForbiddenError(
    `principal '${input.callerPrincipalId}' authorized against workspace '${input.authWorkspaceId}' ` +
      `but the write targets workspace '${input.workspaceId}'`
  );
}

/** Optional concurrency guard shared by `set` and `clear`. */
export interface SettingsValueWriteOptions {
  /** Compare the addressed layer's stored seq, including cleared rows; 0 means no stored row.
   * Omission preserves unconditional writes. Defaults, inherited values and definition revisions
   * do not count. A mismatch throws SettingsRevisionConflictError and rolls back the write.
   */
  readonly expectedRevisionSeq?: number | undefined;
}

/**
 * Check the addressed value after appendRevision has taken the ledger lock. On Postgres, a read
 * before that lock can see the same old seq in two READ COMMITTED transactions and lose an update.
 * The caller's enclosing transaction rolls the appended revision back on conflict.
 * @complexity At most one scoped value read; no reads when the option is omitted.
 */
/** The one stored value the write addresses, at its own scope. */
function readAddressedValue(
  { repo, settingId, input }: { repo: SettingsRepoPort; settingId: UUID; input: Pick<SetValueRequired["input"], "scope" | "workspaceId" | "principalId" | "callerPrincipalId"> },
): ReturnType<SettingsRepoPort["getGlobalValue"]> {
  if (input.scope === "global") return repo.getGlobalValue(settingId);
  if (input.scope === "workspace") return repo.getWorkspaceValue({ workspaceId: input.workspaceId!, settingId });
  return repo.getUserValue({ workspaceId: input.workspaceId!, principalId: input.principalId ?? input.callerPrincipalId, settingId });
}

async function assertExpectedRevision(
  required: { repo: SettingsRepoPort; settingId: UUID; input: Pick<SetValueRequired["input"], "scope" | "workspaceId" | "principalId" | "callerPrincipalId"> },
  optional: SettingsValueWriteOptions = {},
): Promise<void> {
  if (optional.expectedRevisionSeq === undefined) return;
  const { repo, settingId, input } = required;
  const current = await readAddressedValue({ repo, settingId, input });
  const actualRevisionSeq = current?.seq ?? 0;
  if (actualRevisionSeq !== optional.expectedRevisionSeq) {
    throw new SettingsRevisionConflictError({ expectedRevisionSeq: optional.expectedRevisionSeq, actualRevisionSeq });
  }
}

type ValueWriteInput = Pick<SetValueRequired["input"], "scope" | "workspaceId" | "principalId" | "callerPrincipalId" | "authWorkspaceId">;

/** The permission a caller needs for this target, derived from scope and who is being written for. */
export function derivePermissionFor({ input }: { input: ValueWriteInput }): string {
  return deriveRequiredPermission({
    scope: input.scope,
    targetPrincipalId: input.principalId,
    callerPrincipalId: input.callerPrincipalId,
  });
}

/** Authorize the caller in the ambient workspace; the target workspace must match it. Refusal throws. */
export async function authorizeValueWrite(
  { deps, input, permission }: { deps: SettingsWriteServiceDeps; input: ValueWriteInput; permission: string },
): Promise<void> {
  const authWorkspaceId = input.authWorkspaceId ?? input.workspaceId ?? input.callerPrincipalId;
  assertTargetWorkspaceMatchesAuth({ ...input, authWorkspaceId });
  const authResult = await deps.authorize({
    principalId: input.callerPrincipalId,
    permission,
    workspaceId: authWorkspaceId,
    entityType: "setting-value",
  });
  if (!authResult.allowed) {
    throw new ForbiddenError(
      `principal '${input.callerPrincipalId}' is not authorized for '${permission}' (${authResult.reason})`
    );
  }
}

/** Append the ledger revision, check the concurrency guard, then save the addressed layer's row. */
export async function writeValueRevision(
  { deps, input, definition, optional, change }: {
    deps: SettingsWriteServiceDeps;
    input: ValueWriteInput & { namespace: string; key: string };
    definition: Awaited<ReturnType<typeof resolveScopedDefinitionOrThrow>>;
    optional: SettingsValueWriteOptions;
    change: { op: "set" | "clear"; afterJson: JsonValue | null; valueJson: JsonValue | null; state: "set" | "cleared" };
  },
): Promise<{ revisionSeq: number }> {
  const now = kernelNowIso({ clock: deps.clock });
  const revisionSeq = await deps.repo.appendRevision({
    entityKind: "value",
    settingId: definition.settingId,
    scope: input.scope,
    workspaceId: input.scope === "global" ? null : (input.workspaceId ?? null),
    principalId: input.scope === "user" ? (input.principalId ?? input.callerPrincipalId) : null,
    op: change.op,
    beforeJson: null,
    afterJson: change.afterJson,
    defVersion: definition.version,
    actor: input.callerPrincipalId,
    originPluginId: null,
    changeSetId: null,
    createdAt: now,
  });

  await assertExpectedRevision({ repo: deps.repo, settingId: definition.settingId, input }, optional);

  const base = {
    settingId: definition.settingId,
    scope: input.scope,
    valueJson: change.valueJson,
    state: change.state,
    defVersion: definition.version,
    seq: revisionSeq,
    updatedBy: input.callerPrincipalId,
    updatedAt: now,
    originPluginId: null,
  };

  if (input.scope === "global") {
    await deps.repo.saveGlobalValue({ ...base, workspaceId: null, principalId: null });
  } else if (input.scope === "workspace") {
    await deps.repo.saveWorkspaceValue({ ...base, workspaceId: input.workspaceId ?? null, principalId: null });
  } else {
    await deps.repo.saveUserValue({
      ...base,
      workspaceId: input.workspaceId ?? null,
      principalId: input.principalId ?? input.callerPrincipalId,
    });
  }
  return { revisionSeq };
}
