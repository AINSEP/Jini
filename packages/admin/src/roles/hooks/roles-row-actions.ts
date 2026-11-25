import type { Dispatch, SetStateAction } from "react";
import type { AdminPolicy, AdminRole } from "@jini-ai/core/contracts/site/user-management-react";
import { describeApiError } from "../rules.js";
import { t } from "../roles-i18n.js";
import type { useRolesState } from "./use-roles-state.hooks.js";
import type { useRolesMutations } from "./use-roles-mutations.hooks.js";

/** The shape `onDeleteRole`/`onDeletePolicy` both repeat: guard on nothing pending, set the shared
 *  `rowSavingId`/`rowError` pair keyed by the row's own id (deliberately not a fit for
 *  `useAsyncAction` — see that file's own header on why a busy-row-id, not a boolean, is a
 *  different shape), delete, and always clear both the saving flag and the pending selection in
 *  `finally` regardless of outcome. `reload()` is gone — `deleteMutation` itself `invalidates:
 *  [KEYS.list]` — this helper's job now is purely the shared busy-id/error bookkeeping. The
 *  "whole-hook" complexity view (brief §2) counts both ~10-line blocks against `useRoles` even
 *  though each is individually small under ESLint's own per-function view — `onDeletePolicy` had no
 *  test at all before the extraction pass that introduced this helper; characterisation tests were
 *  added first (`use-roles.unit.test.ts`) so this extraction has coverage to prove it behavior-
 *  preserving against.
 *
 *  `setRowSavingId`'s `finally` reset (2026-09-05 fix, same bug class as `use-sites.hooks.ts`'s
 *  `activate`/`use-themes.hooks.ts`'s `activate`/`download`/`use-theme-explore.hooks.ts`'s rename)
 *  is a functional update keyed on THIS call's own `id`, not a blind `setRowSavingId(null)`: nothing
 *  gated a second delete (on a DIFFERENT row) from starting before this one settles, so an
 *  unconditional reset would clear the busy indicator out from under a still-in-flight newer
 *  delete. `clearPending` is the caller's own responsibility to guard the same way (see
 *  `onDeleteRole`/`onDeletePolicy` below) since only the caller knows which pending-selection state
 *  it owns. */
async function runRowDelete(
  { id, mutate, setRowSavingId, setRowError, clearPending, describeError }: {
    id: string;
    mutate: (required: { input: string }) => Promise<unknown>;
    setRowSavingId: Dispatch<SetStateAction<string | null>>;
    setRowError: Dispatch<SetStateAction<string | null>>;
    clearPending: () => void;
    describeError: (e: unknown) => string;
  },
  _optional: Record<string, never> = {},
): Promise<void> {
  setRowSavingId(id);
  setRowError(null);
  try {
    await mutate({ input: id });
  } catch (e) {
    setRowError(describeError(e));
  } finally {
    setRowSavingId((current) => (current === id ? null : current));
    clearPending();
  }
}

export function createPolicyActions(
  {
    setRowError, setEditingPolicyId, setEditingPolicyName, setEditingPolicyDescription, setRowSavingId, savePolicyMutation, editingPolicyName,
    editingPolicyDescription, editingPolicyVersion, setEditingPolicyVersion, locale, errors, pendingPolicyDelete, deletePolicyMutation, setPendingPolicyDelete,
  }:
    Pick<ReturnType<typeof useRolesState>, "setRowError" | "setEditingPolicyId" | "setEditingPolicyName" | "setEditingPolicyDescription" | "setRowSavingId"
    | "editingPolicyName" | "editingPolicyDescription" | "editingPolicyVersion" | "setEditingPolicyVersion" | "locale" | "errors" | "pendingPolicyDelete" | "setPendingPolicyDelete"> &
    Pick<ReturnType<typeof useRolesMutations>, "savePolicyMutation" | "deletePolicyMutation">
) {
  function startEditPolicy(policy: AdminPolicy) {
    setRowError(null);
    setEditingPolicyId(policy.id);
    setEditingPolicyName(policy.name);
    setEditingPolicyDescription(policy.description ?? "");
    setEditingPolicyVersion(policy.version);
  }

  /** Same settle-time guard as `onSaveRole` above, keyed on `policyId` instead of `roleId` — see
   *  that function's comment for why. */
  async function onSavePolicy({ policyId }: { policyId: string }, _optional: Record<string, never> = {}) {
    setRowSavingId(policyId);
    setRowError(null);
    try {
      await savePolicyMutation.mutate({ input: { policyId, name: editingPolicyName, description: editingPolicyDescription, expectedVersion: editingPolicyVersion } });
      setEditingPolicyId((current) => (current === policyId ? null : current));
    } catch (e) {
      setRowError(describeApiError({ e, fallback: t({ locale: locale, key: "failed to update policy" }), locale, errors }));
    } finally {
      setRowSavingId((current) => (current === policyId ? null : current));
    }
  }

  /** Same `ConfirmDialog`-via-`RowMenu` swap as `onDeleteRole` above, plus the same `clearPending`
   *  settle-time guard — see that function's comments for both. */
  async function onDeletePolicy() {
    if (!pendingPolicyDelete) return;
    const policy = pendingPolicyDelete;
    await runRowDelete({
      id: policy.id,
      mutate: deletePolicyMutation.mutate,
      setRowSavingId,
      setRowError,
      clearPending: () => setPendingPolicyDelete((current) => (current?.id === policy.id ? null : current)),
      describeError: (e) => describeApiError({ e, fallback: t({ locale: locale, key: "failed to delete policy" }), locale, errors }),
    });
  }
  return { startEditPolicy, onSavePolicy, onDeletePolicy };
}

export function createRoleActions(
  {
    createRoleMutation, roleName, setRoleName, createPolicyMutation, policyName, policyDescription, setPolicyName, setPolicyDescription, setRowError,
    setEditingRoleId, setEditingRoleName, setRowSavingId, saveRoleMutation, editingRoleName, editingRoleVersion, setEditingRoleVersion, locale, errors, pendingRoleDelete, deleteRoleMutation, setPendingRoleDelete,
  }:
    Pick<ReturnType<typeof useRolesMutations>, "createRoleMutation" | "createPolicyMutation" | "saveRoleMutation" | "deleteRoleMutation"> &
    Pick<ReturnType<typeof useRolesState>, "roleName" | "setRoleName" | "policyName" | "policyDescription" | "setPolicyName" | "setPolicyDescription"
    | "setRowError" | "setEditingRoleId" | "setEditingRoleName" | "setRowSavingId" | "editingRoleName" | "editingRoleVersion" | "setEditingRoleVersion" | "locale" | "errors" | "pendingRoleDelete" | "setPendingRoleDelete">
) {
  async function onCreateRole(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createRoleMutation.mutate({ input: roleName });
      setRoleName("");
    } catch {
      // already surfaced through createRoleMutation.error -> roleError below
    }
  }
  const { onCreatePolicy } = createPolicyCreateAction({ createPolicyMutation, policyName, policyDescription, setPolicyName, setPolicyDescription });

  function startEditRole(role: AdminRole) {
    setRowError(null);
    setEditingRoleId(role.id);
    setEditingRoleName(role.name);
    setEditingRoleVersion(role.version);
  }

  /** `setEditingRoleId`/`setRowSavingId`'s settle-time writes (2026-09-05 fix, same bug class as
   *  `use-sites.hooks.ts`'s `activate`/`use-themes.hooks.ts`'s `activate`/`download`/
   *  `use-theme-explore.hooks.ts`'s rename) are functional updates keyed on THIS call's own
   *  `roleId`, not a blind `setEditingRoleId(null)`/`setRowSavingId(null)`: nothing gates a second
   *  `onSaveRole` (for a DIFFERENT role) from starting before this one settles — the operator can
   *  freely click "Edit" on another row at any time, no modal blocks it — so an unconditional reset
   *  would close a DIFFERENT, still-open and unsaved row's inline edit UI out from under the
   *  operator the moment this stale call finally settles. */
  async function onSaveRole({ roleId }: { roleId: string }, _optional: Record<string, never> = {}) {
    setRowSavingId(roleId);
    setRowError(null);
    try {
      await saveRoleMutation.mutate({ input: { roleId, name: editingRoleName, expectedVersion: editingRoleVersion } });
      setEditingRoleId((current) => (current === roleId ? null : current));
    } catch (e) {
      setRowError(describeApiError({ e, fallback: t({ locale: locale, key: "failed to rename role" }), locale, errors }));
    } finally {
      setRowSavingId((current) => (current === roleId ? null : current));
    }
  }

  /** Confirmation now gates via a `ConfirmDialog` modal, reached through `RowMenu`'s "Delete" item
   *  (`setPendingRoleDelete` below) — this row action moved off the in-place two-click
   *  `ConfirmButton` control (MSG-03 rollout) because a `RowMenu` item fires once and the menu
   *  closes immediately (`selectItem` in `RowMenu.tsx`), so there is no "stay open for a second
   *  confirm click" state for `ConfirmButton` to hold; `ConfirmDialog` is the mechanism that
   *  survives the menu closing, same as `Posts.tsx`/`Pages.tsx`'s own Delete.
   *
   *  `clearPending` (2026-09-05 fix, same reasoning as `onSaveRole`'s comment above) only clears
   *  `pendingRoleDelete` when it still names THIS call's own `role` — otherwise a stale delete
   *  settling after the operator has already opened a DIFFERENT row's delete confirmation would
   *  silently dismiss that dialog with no decision made. */
  async function onDeleteRole() {
    if (!pendingRoleDelete) return;
    const role = pendingRoleDelete;
    await runRowDelete({
      id: role.id,
      mutate: deleteRoleMutation.mutate,
      setRowSavingId,
      setRowError,
      clearPending: () => setPendingRoleDelete((current) => (current?.id === role.id ? null : current)),
      describeError: (e) => describeApiError({ e, fallback: t({ locale: locale, key: "failed to delete role" }), locale, errors }),
    });
  }
  return { onCreateRole, onCreatePolicy, startEditRole, onSaveRole, onDeleteRole };
}

function createPolicyCreateAction(
  { createPolicyMutation, policyName, policyDescription, setPolicyName, setPolicyDescription }:
    Pick<Parameters<typeof createRoleActions>[0], "createPolicyMutation" | "policyName" | "policyDescription" | "setPolicyName" | "setPolicyDescription">
) {
  async function onCreatePolicy(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createPolicyMutation.mutate({ input: { name: policyName, description: policyDescription || undefined } });
      setPolicyName("");
      setPolicyDescription("");
    } catch {
      // already surfaced through createPolicyMutation.error -> policyError below
    }
  }
  return { onCreatePolicy };
}
