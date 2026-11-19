import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { AdminIdentityUser } from "../../models.js";
import type { useUsersState } from "./use-users-state.hooks.js";

/** The shape `onAssignRole`/`onAttachPolicy` both repeat: set the shared `grantSaving`/`grantError`
 *  pair, run one mutation, do a success-only side effect, and clear saving in a `finally` — the
 *  "whole-hook" complexity view (brief §2) rolls every closure inside a hook into one score, so two
 *  near-identical blocks count against `useUsers` even though `grantError`/`grantSaving` are
 *  deliberately NOT a fit for `useAsyncAction` (see that file's own header: shared across three
 *  handlers on purpose, not one action's own slot — `onSaveEmail` is the third, kept separate below
 *  since it tracks its OWN `emailSaving`). Reproducing the shared-state shape as a local top-level
 *  helper — rather than importing the generic primitive — collapses the two call sites without
 *  forcing that mismatch onto them. `mutate` itself `invalidates: [KEYS.list]`, replacing the
 *  pre-migration `reload()` call this helper used to make explicitly.
 *
 *  `onSuccess` (2026-09-05 fix, same bug class as `use-roles.hooks.ts`'s `onSaveRole`/
 *  `onWritePermission`): nothing gates opening a DIFFERENT user's Manage panel
 *  (`toggleExpanded`) while a grant for the previously expanded one is still in flight, and
 *  `onSuccess` clears `pendingRoleId`/`pendingPolicyId` — a shared field, not keyed by principal.
 *  `toggleGenerationRef` (bumped once per `toggleExpanded` call, regardless of which panel — see
 *  that function) lets a stale grant tell whether the operator switched panels at ALL while it was
 *  in flight, independent of which principal is currently expanded: comparing against the panel's
 *  OWN identity would wrongly refuse a grant issued before any panel was ever expanded (a
 *  legitimate, already-certified call shape), where `expandedId` never gets set to begin with.
 *  `onSuccess` is skipped only when a switch actually happened since this call started — otherwise
 *  a stale grant's success would erase a NEW, unrelated selection the operator has since made for
 *  the panel they actually have open now. */
async function runGrantMutation({ toggleGenerationRef, mutate, onSuccess, setGrantSaving, setGrantError, describeError }: {
  toggleGenerationRef: { current: number };
  mutate: () => Promise<unknown>;
  onSuccess: () => void;
  setGrantSaving: Dispatch<SetStateAction<boolean>>;
  setGrantError: Dispatch<SetStateAction<string | null>>;
  describeError: (e: unknown) => string;
}): Promise<void> {
  // Read synchronously, before the first `await` — the same instant both callers used to read and
  // pass in themselves, so this is still the generation this call STARTED under.
  const generationAtStart = toggleGenerationRef.current;
  setGrantSaving(true);
  setGrantError(null);
  try {
    await mutate();
    if (toggleGenerationRef.current === generationAtStart) onSuccess();
  } catch (e) {
    // Same generation check as the success branch above (C8, plan-access.md §8, N3): a stale
    // failure must not paint onto a DIFFERENT user's panel the operator has since opened.
    if (toggleGenerationRef.current === generationAtStart) setGrantError(describeError(e));
  } finally {
    // Guarded the same way — a stale call's `finally` must not clear a NEWER call's own saving
    // flag. `toggleExpanded` resets `grantSaving` itself when it bumps the generation, so a panel
    // switch still leaves the new panel un-stuck even though this skip means THIS call no longer
    // clears it.
    if (toggleGenerationRef.current === generationAtStart) setGrantSaving(false);
  }
}

export function createUsersCreateAction(state: ReturnType<typeof useUsersState>) {
  const { createUser, createUserMutation, username, password, email, setUsername, setEmail, setPassword, setFormOpen, describeError, translate } = state;
  async function onCreate(e: FormEvent) {
    e.preventDefault();
    await createUser.run({ action: async () => {
      await createUserMutation.mutate({ input: { username, password, email: email || undefined } });
      setUsername("");
      setEmail("");
      setPassword("");
      setFormOpen(false);
    }, describeError: (e) => describeError(e, translate("failed to create user")) });
  }

  return onCreate;
}

export function createUsersPanelActions(state: ReturnType<typeof useUsersState>) {
  const { setGrantError, setGrantSaving, setPendingRoleId, setPendingPolicyId, setEditEmail, toggleGenerationRef, setExpandedId, updateEmailMutation, editEmail, describeError, translate } = state;
  function toggleExpanded(user: AdminIdentityUser) {
    setGrantError(null);
    // A still-in-flight grant for the panel being LEFT can no longer clear this itself
    // (`runGrantMutation`'s `finally` now skips a stale call's own generation) — reset it here so
    // the newly opened panel never inherits a stuck "saving" indicator from the old one.
    setGrantSaving(false);
    setPendingRoleId("");
    setPendingPolicyId("");
    setEditEmail(user.email ?? "");
    toggleGenerationRef.current += 1;
    setExpandedId((current) => (current === user.principalId ? null : user.principalId));
  }

  // `onSaveEmail` was left out of the `runGrantMutation` fold above on purpose: it tracks its OWN
  // `emailSaving` flag rather than the shared `grantSaving` `onAssignRole`/`onAttachPolicy` use, so
  // routing it through the same helper would mean passing a no-op in place of `setGrantSaving` —
  // extraction for the sake of a shared call site, not a shared shape. Left hand-rolled; `emailSaving`
  // now derives from `updateEmailMutation.status` since (unlike `grantSaving`) it was already this
  // one mutation's own dedicated flag.
  async function onSaveEmail({ principalId }: { principalId: string }) {
    setGrantError(null);
    try {
      await updateEmailMutation.mutate({ input: { principalId, email: editEmail } });
    } catch (e) {
      setGrantError(describeError(e, translate("failed to update email")));
    }
  }
  const emailSaving = updateEmailMutation.status === "pending";

  return { toggleExpanded, onSaveEmail, emailSaving };
}

export function createUsersGrantActions(state: ReturnType<typeof useUsersState>) {
  const { pendingRoleId, pendingPolicyId, toggleGenerationRef, assignRoleMutation, attachPolicyMutation, setPendingRoleId, setPendingPolicyId, setGrantSaving, setGrantError, describeError, translate } = state;
  async function onAssignRole({ principalId }: { principalId: string }) {
    if (!pendingRoleId) return;
    await runGrantMutation({
      toggleGenerationRef,
      mutate: () => assignRoleMutation.mutate({ input: { principalId, roleId: pendingRoleId } }),
      onSuccess: () => setPendingRoleId(""),
      setGrantSaving,
      setGrantError,
      describeError: (e) => describeError(e, translate("failed to assign role")),
    });
  }

  async function onAttachPolicy({ principalId }: { principalId: string }) {
    if (!pendingPolicyId) return;
    await runGrantMutation({
      toggleGenerationRef,
      mutate: () => attachPolicyMutation.mutate({ input: { principalId, policyId: pendingPolicyId } }),
      onSuccess: () => setPendingPolicyId(""),
      setGrantSaving,
      setGrantError,
      describeError: (e) => describeError(e, translate("failed to attach policy")),
    });
  }

  return { onAssignRole, onAttachPolicy };
}
