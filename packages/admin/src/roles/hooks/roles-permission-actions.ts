import { describeApiError } from "../rules.js";
import { t } from "../roles-i18n.js";
import type { useRolesState } from "./use-roles-state.hooks.js";
import type { useRolesMutations } from "./use-roles-mutations.hooks.js";

export function createPermissionWriter(
  {
    permissionInput, permissionsGenerationRef, setRowSavingId, setRowError, writePermissionMutation, resourceTypeInput, setPermissionInput, setResourceTypeInput,
    permissionPolicyIdRef, loadPermissions, locale, errors,
  }:
    Pick<ReturnType<typeof useRolesState>, "permissionInput" | "permissionsGenerationRef" | "setRowSavingId" | "setRowError" | "resourceTypeInput"
    | "setPermissionInput" | "setResourceTypeInput" | "permissionPolicyIdRef" | "locale" | "errors"> &
    Pick<ReturnType<typeof useRolesMutations>, "writePermissionMutation"> &
    Pick<ReturnType<typeof createPermissionLoader>, "loadPermissions">
) {
  /** 2026-09-05 fix, same bug class as `onSaveRole`/`onDeleteRole` above: nothing gates opening a
   *  DIFFERENT policy's permission form (`togglePermissionForm`) while a write for the previously
   *  open one is still in flight. `permissionInput`/`resourceTypeInput` are cleared on success
   *  unconditionally — captured here as `generationAtStart` (`permissionsGenerationRef`, bumped by
   *  every `loadPermissions` call, i.e. every panel open) before the write starts, so a stale
   *  write's success can tell "the operator is still on the policy this write was for" apart from
   *  "they've since switched panels and typed a NEW, unrelated value" and skip clearing in the
   *  latter case — otherwise it would erase whatever the operator typed for the policy they
   *  actually have open now. `rowSavingId`'s reset (matching `onSaveRole`'s identical fix) is a
   *  functional update keyed on this call's own `policyId` for the same reason. */
  async function onWritePermission({ policyId }: { policyId: string }, _optional: Record<string, never> = {}) {
    if (!permissionInput) return;
    const generationAtStart = permissionsGenerationRef.current;
    setRowSavingId(policyId);
    setRowError(null);
    try {
      await writePermissionMutation.mutate({ input: { policyId, permission: permissionInput, resourceType: resourceTypeInput || undefined } });
      if (permissionsGenerationRef.current === generationAtStart) {
        setPermissionInput("");
        setResourceTypeInput("");
      }
      // The row the write just created has to appear in the list, or its Remove button would not
      // exist until the form was closed and re-opened. Refresh only while the panel is still on
      // THIS policy (C2/N1 fix, same guard and reasoning as `onRemovePermission` above) — this
      // trailing call always mints the newest generation, so `loadPermissions`'s OWN generation
      // guard cannot tell "superseded by a different policy's open" apart from "just the latest
      // load for this one"; only `permissionPolicyIdRef`'s equality check can.
      if (permissionPolicyIdRef.current === policyId) await loadPermissions({ policyId });
    } catch (e) {
      setRowError(describeApiError({ e, fallback: t({ locale: locale, key: "failed to add permission" }), locale, errors }));
    } finally {
      setRowSavingId((current) => (current === policyId ? null : current));
    }
  }
  return { onWritePermission };
}

export function createPermissionRemovalActions(
  {
    setRemovingPermissionId, setRowError, removePermissionMutation, permissionPolicyIdRef, loadPermissions, locale, errors, pendingPermissionRemove,
    setPendingPermissionRemove,
  }:
    Pick<ReturnType<typeof useRolesState>, "setRemovingPermissionId" | "setRowError" | "permissionPolicyIdRef" | "locale" | "errors" | "pendingPermissionRemove"
    | "setPendingPermissionRemove"> &
    Pick<ReturnType<typeof useRolesMutations>, "removePermissionMutation"> &
    Pick<ReturnType<typeof createPermissionLoader>, "loadPermissions">
) {
  async function onRemovePermission({ policyId, policyPermissionId }: { policyId: string; policyPermissionId: string }, _optional: Record<string, never> = {}) {
    setRemovingPermissionId(policyPermissionId);
    setRowError(null);
    try {
      await removePermissionMutation.mutate({ input: { policyId, policyPermissionId } });
      // Refresh only while the panel is still on THIS policy (C2/N1 fix) — see
      // `permissionPolicyIdRef`'s doc comment above. `loadPermissions`'s generation guard orders
      // same-policy loads against each other; it does not protect against a newer call for a
      // DIFFERENT policy, and this trailing call always mints the newest generation by
      // construction, so it used to win even after the operator moved to another policy's panel.
      if (permissionPolicyIdRef.current === policyId) await loadPermissions({ policyId });
    } catch (e) {
      setRowError(describeApiError({ e, fallback: t({ locale: locale, key: "failed to remove permission" }), locale, errors }));
    } finally {
      // Keyed functional update (same fix class as `runRowDelete`'s `setRowSavingId` above):
      // nothing gates starting a removal on a SECOND row while this one is still in flight, so an
      // unconditional reset would clear a still-in-flight newer removal's own busy indicator.
      setRemovingPermissionId((current) => (current === policyPermissionId ? null : current));
    }
  }

  /** C1 — the Remove button no longer calls {@link onRemovePermission} directly; it stages the
   *  target row here and a shell `ConfirmDialog` calls this to actually remove it. Clears the
   *  pending selection in `finally` regardless of outcome (a failure surfaces through `rowError`,
   *  same as every other row action), keyed on the row's own id so a stale confirm settling after
   *  the operator has already opened a DIFFERENT row's confirmation does not dismiss it — same
   *  guard shape as `onDeleteRole`/`onDeletePolicy`'s `clearPending`. */
  async function onConfirmRemovePermission() {
    if (!pendingPermissionRemove) return;
    const target = pendingPermissionRemove;
    try {
      await onRemovePermission({ policyId: target.policyId, policyPermissionId: target.row.id });
    } finally {
      setPendingPermissionRemove((current) => (current?.row.id === target.row.id ? null : current));
    }
  }
  return { onRemovePermission, onConfirmRemovePermission };
}

export function createPermissionLoader(
  {
    permissionsGenerationRef, setPermissionsLoading, port, setPermissionRows, setRowError, locale, errors, setPermissionInput, setResourceTypeInput,
    permissionPolicyIdRef, setPermissionPolicyId,
  }:
    Pick<ReturnType<typeof useRolesState>, "permissionsGenerationRef" | "setPermissionsLoading" | "port" | "setPermissionRows" | "setRowError" | "locale" | "errors"
    | "setPermissionInput" | "setResourceTypeInput" | "permissionPolicyIdRef" | "setPermissionPolicyId">
) {
  /** Refresh the open form's permission list. Failures land in `rowError` like every other row
   *  action rather than throwing — a list that cannot load must not take the form down with it. */
  async function loadPermissions({ policyId }: { policyId: string }, _optional: Record<string, never> = {}) {
    permissionsGenerationRef.current += 1;
    const generation = permissionsGenerationRef.current;
    setPermissionsLoading(true);
    try {
      const { policyPermissions } = await port.listPolicyPermissions({ policyId });
      // Superseded by a newer load started after this one — that later call owns
      // `permissionRows` now, and applying this stale result would let whichever policy's load
      // happens to settle LAST win regardless of which panel is actually open. See
      // `permissionsGenerationRef`'s doc comment above.
      if (permissionsGenerationRef.current !== generation) return;
      setPermissionRows(policyPermissions);
    } catch (e) {
      if (permissionsGenerationRef.current !== generation) return;
      setPermissionRows([]);
      setRowError(describeApiError({ e, fallback: t({ locale: locale, key: "failed to load permissions" }), locale, errors }));
    } finally {
      if (permissionsGenerationRef.current !== generation) return;
      setPermissionsLoading(false);
    }
  }

  // No side effects inside the `setPermissionPolicyId` updater (2026-09-20 fix, C2/N1): React 18
  // Strict Mode double-invokes a functional `setState` updater in dev, so the old shape (this
  // function's body used to live inside that updater) fired `loadPermissions` twice per open. The
  // updater is now a pure `current === policyId` read; every side effect (the ref write, the row
  // clear, the load) runs once, in the function body, after the updater has been called.
  function togglePermissionForm({ policyId }: { policyId: string }, _optional: Record<string, never> = {}) {
    setRowError(null);
    setPermissionInput("");
    setResourceTypeInput("");
    const closing = permissionPolicyIdRef.current === policyId;
    permissionPolicyIdRef.current = closing ? null : policyId;
    setPermissionPolicyId(permissionPolicyIdRef.current);
    // Clear first either way, so a re-open never flashes the previous policy's permissions.
    setPermissionRows([]);
    if (!closing) void loadPermissions({ policyId });
  }
  return { loadPermissions, togglePermissionForm };
}
