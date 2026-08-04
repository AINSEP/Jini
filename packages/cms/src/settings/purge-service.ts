import type { ClockPort, UUID } from "../core/ports.js";
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
 * the explicit, ledgered alternative that requires: `authorize()` once
 * -> enumerate every affected row -> append a redacted `op='purge'` revision
 * per row -> delete the row, all in ONE transaction. The `setting_revisions`
 * ledger itself is NEVER touched by a purge — only value rows are removed,
 * with their purge revision left behind. Repo write methods stay
 * package-private to this file and `write-service.ts`.
 *
 * Deviation from the outline's `SettingsWriteServiceDeps`: purge needs
 * neither `ids` (no new definition/value rows are created) nor `principals`
 * (REQ-13's target-principal check is a write-time guard; purge only removes
 * pre-existing rows, it never writes a new user-scope row for an unverified
 * principal) — so it declares its own smaller `PurgeServiceDeps`.
 */

export interface PurgeServiceDeps {
  repo: SettingsRepoPort;
  clock: ClockPort;
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

/**
 * The purge chokepoint: authorize `settings.definitions.manage` once ->
 * enumerate the affected rows -> append a redacted `op='purge'` revision +
 * delete, per row, all in one transaction.
 */
export async function purgeTenantSettings(
  required: PurgeTenantSettingsRequired
): Promise<{ purgedCount: number }> {
  const { deps, input } = required;

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

  const result = await deps.repo.transaction(async () => {
    const now = deps.clock.nowIso();
    let purgedCount = 0;

    if (input.principalId) {
      const userValues = await deps.repo.listUserValues({
        workspaceId: input.workspaceId,
        principalId: input.principalId,
      });
      for (const value of userValues) {
        await deps.repo.appendRevision({
          entityKind: "value",
          settingId: value.settingId,
          scope: "user",
          workspaceId: input.workspaceId,
          principalId: input.principalId,
          op: "purge",
          beforeJson: null,
          afterJson: null,
          defVersion: value.defVersion,
          actor: input.callerPrincipalId,
          originPluginId: null,
          changeSetId: null,
          createdAt: now,
        });
        await deps.repo.deleteUserValue({
          workspaceId: input.workspaceId,
          principalId: input.principalId,
          settingId: value.settingId,
        });
        purgedCount++;
      }
      return { purgedCount };
    }

    const workspaceValues = await deps.repo.listWorkspaceValues({ workspaceId: input.workspaceId });
    for (const value of workspaceValues) {
      await deps.repo.appendRevision({
        entityKind: "value",
        settingId: value.settingId,
        scope: "workspace",
        workspaceId: input.workspaceId,
        principalId: null,
        op: "purge",
        beforeJson: null,
        afterJson: null,
        defVersion: value.defVersion,
        actor: input.callerPrincipalId,
        originPluginId: null,
        changeSetId: null,
        createdAt: now,
      });
      await deps.repo.deleteWorkspaceValue({ workspaceId: input.workspaceId, settingId: value.settingId });
      purgedCount++;
    }

    const userValues = await deps.repo.listUserValuesByWorkspace({ workspaceId: input.workspaceId });
    for (const value of userValues) {
      const targetPrincipalId = value.principalId;
      if (!targetPrincipalId) continue; // defensive: every setting_values_user row carries a principal_id
      await deps.repo.appendRevision({
        entityKind: "value",
        settingId: value.settingId,
        scope: "user",
        workspaceId: input.workspaceId,
        principalId: targetPrincipalId,
        op: "purge",
        beforeJson: null,
        afterJson: null,
        defVersion: value.defVersion,
        actor: input.callerPrincipalId,
        originPluginId: null,
        changeSetId: null,
        createdAt: now,
      });
      await deps.repo.deleteUserValue({
        workspaceId: input.workspaceId,
        principalId: targetPrincipalId,
        settingId: value.settingId,
      });
      purgedCount++;
    }

    return { purgedCount };
  });

  invalidateWorkspaceSettingsCache(deps.repo, input.workspaceId, input.principalId);
  return result;
}
