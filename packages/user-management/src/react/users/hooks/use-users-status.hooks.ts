import { useState } from "react";
import type { AdminIdentityUser } from "../../models.js";
import { KEYS } from "../rules.js";
import type { UsersController } from "./use-users.hooks.js";
import type { useUsersState } from "./use-users-state.hooks.js";
import { useFetchMutation as useFetchMutationDefault } from "../../kit.js";

export function createUsersToggleAction(state: ReturnType<typeof useUsersState>) {
  const { rowCapabilities, setToggleSavingId, setToggleError, toggleStatusMutation, describeError, translate } = state;
  /** `setToggleSavingId`'s `finally` reset (2026-09-05 fix, same bug class as
   *  `use-roles.hooks.ts`'s `onSaveRole`/`runRowDelete`) is a functional update keyed on THIS call's
   *  own `principalId`: Enable fires with no confirmation gate, so two calls — on different users —
   *  can genuinely overlap, and an unconditional reset would clear the busy indicator (which
   *  `openResetPassword` below reads to refuse opening while a toggle is in flight) out from under a
   *  still-in-flight, unrelated toggle. */
  async function onToggleStatus(user: AdminIdentityUser) {
    const capabilities = rowCapabilities(user);
    if (user.status === "active" ? !capabilities.canDisable : !capabilities.canEnable) return;
    setToggleSavingId(user.principalId);
    setToggleError(null);
    try {
      await toggleStatusMutation.mutate({ input: user });
    } catch (e) {
      setToggleError(describeError(e, translate("failed to change status")));
    } finally {
      setToggleSavingId((current) => (current === user.principalId ? null : current));
    }
  }

  return onToggleStatus;
}

export function createUsersDisableActions(state: ReturnType<typeof useUsersState>, { onToggleStatus }: { onToggleStatus: UsersController['onToggleStatus'] }) {
  const { rowCapabilities, setToggleError, setConfirmingDisable, confirmingDisable } = state;
  /** Opens the Disable confirm dialog for `user` — the `RowMenu` "Disable" item's `onSelect` when
   *  the user is currently active. Was an inline closure inside the old `rowMenuItems`; named here
   *  now that the item builder itself moved to `rules.ts` and needs a callback to hand it. */
  function requestDisable(user: AdminIdentityUser) {
    if (!rowCapabilities(user).canDisable) return;
    setToggleError(null);
    setConfirmingDisable(user);
  }

  /** Confirms the Disable that `RowMenu`'s "Disable" item asked about. Closes the dialog either
   *  way (matching the host app's src/features/posts/Posts.tsx and packages/admin/src/redirects/react/pages/RedirectsPage.tsx's own Disable/Delete `ConfirmDialog` convention) — a
   *  failure surfaces via `toggleError` above the table, not by leaving the modal open.
   *
   *  2026-09-05 fix, same bug class as `use-roles.hooks.ts`'s `runRowDelete`: `setConfirmingDisable`
   *  is exposed directly on the controller, so nothing at the hook level stops the operator opening
   *  a DIFFERENT user's Disable confirmation while this one's toggle is still in flight. The close
   *  below only clears it when it still names the SAME user this call started for — otherwise a
   *  stale toggle's settlement would silently dismiss a newer, still-undecided confirmation. */
  async function confirmDisable() {
    if (!confirmingDisable) return;
    const user = confirmingDisable;
    await onToggleStatus(user);
    setConfirmingDisable((current) => (current?.principalId === user.principalId ? null : current));
  }

  return { requestDisable, confirmDisable };
}

export function useUsersDeletion(state: ReturnType<typeof useUsersState>, { useFetchMutation = useFetchMutationDefault }: { useFetchMutation?: typeof useFetchMutationDefault } = {}) {
  const { port, queryScope, rowCapabilities, setToggleError, describeError, translate } = state;
  // Delete-user plan v2 (2026-09-24), Slice 4 — mirrors Disable's request/confirm pair above with
  // its OWN state (see `confirmingDelete`'s own doc comment for why not shared). `deleteUserMutation`
  // invalidates `KEYS.list` like every other write on this screen; the route already filters a newly
  // trashed principal out of `listUsers()`, so the row disappears on the next render with no extra
  // client-side bookkeeping.
  const deleteUserMutation = useFetchMutation({
    run: ({ input: principalId }: { input: string }) => port.deleteUser({ principalId })
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });
  const [confirmingDelete, setConfirmingDelete] = useState<AdminIdentityUser | null>(null);

  function requestDelete(user: AdminIdentityUser) {
    if (!rowCapabilities(user).canDelete) return;
    setToggleError(null);
    setConfirmingDelete(user);
  }

  /** Confirms the Delete that `RowMenu`'s "Delete" item asked about. Closes the dialog either way
   *  (matching `confirmDisable`'s and the host app's src/features/posts/Posts.tsx and packages/admin/src/redirects/react/pages/RedirectsPage.tsx's own Delete `ConfirmDialog`
   *  convention) — a failure surfaces via `toggleError` above the table, not by leaving the modal
   *  open. Same stale-call guard as `confirmDisable`: only clears `confirmingDelete` when it still
   *  names the SAME user this call started for. */
  async function confirmDelete() {
    if (!confirmingDelete || !rowCapabilities(confirmingDelete).canDelete) return;
    const user = confirmingDelete;
    try {
      await deleteUserMutation.mutate({ input: user.principalId });
    } catch (e) {
      setToggleError(describeError(e, translate("failed to delete user")));
    }
    setConfirmingDelete((current) => (current?.principalId === user.principalId ? null : current));
  }

  return { deleteUserMutation, confirmingDelete, setConfirmingDelete, requestDelete, confirmDelete };
}
