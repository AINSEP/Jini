import { nowIso as kernelNowIso } from "../primitives/index.js";
import type { Clock, UUID } from "../primitives/index.js";
import { ForbiddenError } from "./errors.js";
import type { SettingsRepoPort } from "./ports.js";
import { invalidateWorkspaceSettingsCache } from "./settings.js";
import type { AuthorizeFn } from "./write-service.js";

/**
 * @file `purgeTenantSettings` — the ledgered tenant/principal purge chokepoint.
 *
 * Purpose:
 * A host's value-table FKs (`setting_values_workspace`/`_user` -> `workspaces`)
 * are typically `ON DELETE RESTRICT`, not `CASCADE` — a raw workspace delete
 * cannot silently drop value rows without a ledgered revision. This module is
 * the explicit, ledgered alternative that requires: `authorize` once
 * -> enumerate every affected row -> append a redacted `op='purge'` revision
 * per row -> delete the row, all in ONE transaction. The `setting_revisions`
 * ledger itself is NEVER touched by a purge — only value rows are removed,
 * with their purge revision left behind. Repo write methods stay
 * package-private to this file and `write-service.ts`.
 *
 * Deviation from the outline's `SettingsWriteServiceDeps`: purge needs
 * neither `ids` (no new definition/value rows are created) nor `principals`
 * ( target-principal check is a write-time guard; purge only removes
 * pre-existing rows, it never writes a new user-scope row for an unverified
 * principal) — so it declares its own smaller `PurgeServiceDeps`.
 * See docs/decisions/DR-003-settings-ledger-invariants.md.
 */

export interface PurgeServiceDeps {
  repo: SettingsRepoPort;
  clock: Clock;
  authorize: AuthorizeFn;
}

export interface PurgeTenantSettingsRequired {
  deps: PurgeServiceDeps;
  input: {
    workspaceId: UUID;
    /**
     * Omitted -> full tenant teardown: every `setting_values_workspace` row
     * for the workspace AND every `setting_values_user` row for every
     * principal in the workspace.
     * Present -> scope the purge to one principal's `setting_values_user`
     * rows only (GDPR single-subject erasure) — workspace-scope values and
     * every other principal's rows are left untouched.
     */
    principalId?: UUID;
    callerPrincipalId: UUID;
  };
}

type PurgeContext = { deps: PurgeServiceDeps; input: PurgeTenantSettingsRequired["input"] };

/** Authorize `settings.definitions.manage` once for the whole purge; refusal throws before any read. */
async function assertPurgeAuthorized({ deps, input }: PurgeContext): Promise<void> {
  const authResult = await deps.authorize({
    principalId: input.callerPrincipalId,
    permission: "settings.definitions.manage",
    workspaceId: input.workspaceId,
    entityType: "setting-workspace",
    entityId: input.workspaceId,
  });
  if (!authResult.allowed) {
    throw new ForbiddenError(
      `principal '${input.callerPrincipalId}' is not authorized for 'settings.definitions.manage' (${authResult.reason})`
    );
  }
}

/** Records the redacted revision before its corresponding value is deleted. */
type AppendPurgeRevision = (
  required: { scope: "user" | "workspace"; principalId: string | null; value: { settingId: string; defVersion: number } },
) => Promise<unknown>;

function purgeRevisionAppender({ deps, input }: PurgeContext): AppendPurgeRevision {
  const now = kernelNowIso({ clock: deps.clock });
  return ({ scope, principalId, value }) => deps.repo.appendRevision({
    entityKind: "value", settingId: value.settingId, scope, workspaceId: input.workspaceId,
    principalId, op: "purge", beforeJson: null, afterJson: null, defVersion: value.defVersion,
    actor: input.callerPrincipalId, originPluginId: null, changeSetId: null, createdAt: now,
  });
}

/** Single-subject erasure: one principal's user-scope rows only; returns the purged row count. */
async function purgeOnePrincipal(
  { deps, input, principalId }: PurgeContext & { principalId: UUID }, appendPurgeRevision: AppendPurgeRevision,
): Promise<number> {
  const userValues = await deps.repo.listUserValues({
    workspaceId: input.workspaceId,
    principalId: principalId,
  });
  for (const value of userValues) {
    await appendPurgeRevision({ scope: "user", principalId: principalId, value });
    await deps.repo.deleteUserValue({
      workspaceId: input.workspaceId,
      principalId: principalId,
      settingId: value.settingId,
    });
  }
  return userValues.length;
}

/** Full tenant teardown: every workspace-scope row, then every principal's user-scope row. */
async function purgeWholeTenant({ deps, input }: PurgeContext, appendPurgeRevision: AppendPurgeRevision): Promise<number> {
  let purgedCount = 0;
  const workspaceValues = await deps.repo.listWorkspaceValues({ workspaceId: input.workspaceId });
  for (const value of workspaceValues) {
    await appendPurgeRevision({ scope: "workspace", principalId: null, value });
    await deps.repo.deleteWorkspaceValue({ workspaceId: input.workspaceId, settingId: value.settingId });
    purgedCount++;
  }

  const userValues = await deps.repo.listUserValuesByWorkspace({ workspaceId: input.workspaceId });
  for (const value of userValues) {
    const targetPrincipalId = value.principalId;
    if (!targetPrincipalId) continue; // defensive: every setting_values_user row carries a principal_id
    await appendPurgeRevision({ scope: "user", principalId: targetPrincipalId, value });
    await deps.repo.deleteUserValue({
      workspaceId: input.workspaceId,
      principalId: targetPrincipalId,
      settingId: value.settingId,
    });
    purgedCount++;
  }
  return purgedCount;
}

/**
 * The purge chokepoint: authorize `settings.definitions.manage` once ->
 * enumerate the affected rows -> append a redacted `op='purge'` revision +
 * delete, per row, all in one transaction.
 */
export async function purgeTenantSettings(
  required: PurgeTenantSettingsRequired
): Promise<{ purgedCount: number }> {
  const { deps, input } = required;
  await assertPurgeAuthorized({ deps, input });

  const result = await deps.repo.transaction(async () => {
    const appendPurgeRevision = purgeRevisionAppender({ deps, input });
    const purgedCount = input.principalId
      ? await purgeOnePrincipal({ deps, input, principalId: input.principalId }, appendPurgeRevision)
      : await purgeWholeTenant({ deps, input }, appendPurgeRevision);
    return { purgedCount };
  });

  invalidateWorkspaceSettingsCache({ repo: deps.repo, workspaceId: input.workspaceId }, { principalId: input.principalId });
  return result;
}
