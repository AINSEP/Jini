import { useEffect, useRef } from "react";
import { interpolate } from "@jini-ai/core/text";
import type { AdminIdentityUser } from "../../models.js";
import type { UsersPort } from "../../ports.js";
import type { UsersController, UsersOptions } from "./use-users.hooks.js";
import type { useUsersState } from "./use-users-state.hooks.js";
import { useFetchMutation as useFetchMutationDefault } from "../../kit.js";

export function useUsersPasswordLink({ users, ownPrincipalId, ownProfile, resetPasswordFor }: ReturnType<typeof useUsersState>,
  { openOwnPasswordReset, onOwnPasswordResetClosed, openResetPassword }: UsersOptions & { openResetPassword: UsersController['openResetPassword'] }) {
  /** Guards the one-shot deep-link auto-open effect below so it fires at most once per mount, even
   *  as `users`/`ownPrincipalId` keep changing identity across the renders it's waiting on (list
   *  reloads, `me()` settling). Separate from {@link openedViaDeepLinkRef}, which tracks a DIFFERENT
   *  question ("should closing the dialog navigate away") over the dialog's own open/close lifetime
   *  — this one is "has the auto-open already been attempted", which must stay true forever once it
   *  fires, including after the dialog this effect opened has since been closed. */
  const deepLinkAttemptedRef = useRef(false);
  /** Set true exactly when this effect opens the dialog, cleared by the close-effect below the first
   *  time it observes `resetPasswordFor` go back to `null`. Read there to decide whether to navigate
   *  — an operator resetting a DIFFERENT row's password from the ordinary row menu, or cancelling a
   *  normal reset, must not also get shoved to `/users`. */
  const openedViaDeepLinkRef = useRef(false);
  useEffect(() => {
    // `ownProfile` is derived from exactly `users`/`ownPrincipalId` (see `selectCaller`), so it is
    // `null` until both have settled and the caller's own row is in the roster.
    if (!openOwnPasswordReset || deepLinkAttemptedRef.current || !ownProfile) return;
    deepLinkAttemptedRef.current = true;
    openedViaDeepLinkRef.current = true;
    openResetPassword(ownProfile);
  }, [openOwnPasswordReset, users, ownPrincipalId]);

  useEffect(() => {
    if (resetPasswordFor !== null || !openedViaDeepLinkRef.current) return;
    openedViaDeepLinkRef.current = false;
    onOwnPasswordResetClosed?.();
  }, [resetPasswordFor, onOwnPasswordResetClosed]);

}

export function useUsersResetMutation({ port }: { port: UsersPort }, { useFetchMutation = useFetchMutationDefault }: { useFetchMutation?: typeof useFetchMutationDefault } = {}) {
  // No `invalidates` — matches the pre-migration `confirmResetPassword`, which never called
  // `reload()` either (a password reset changes nothing the users table shows).
  const resetPasswordMutation = useFetchMutation({
    run: ({ input }: { input: { principalId: string; password: string } }) => port.resetUserPassword(input),
  });

  return resetPasswordMutation;
}

export function createUsersOpenResetAction({ state }: { state: ReturnType<typeof useUsersState> }, _optional: Record<string, never> = {}) {
  const { rowCapabilities, toggleSavingId, resetPassword, setNewPassword, setResetPasswordFor } = state;
  /** Opens the reset-password dialog for `user` — the `RowMenu` item's `onSelect`. Guards against
   *  opening a second one while a toggle or a previous reset is still in flight, same discipline
   *  packages/admin/src/redirects/react/hooks/RedirectsPage.hooks.ts uses for its own `RowMenu` items (no per-item `disabled` on `RowMenu` itself). */
  function openResetPassword(user: AdminIdentityUser) {
    if (!rowCapabilities(user).canResetPassword) return;
    if (toggleSavingId || resetPassword.saving) return;
    resetPassword.setError(null);
    setNewPassword("");
    setResetPasswordFor(user);
  }

  return openResetPassword;
}

export function createUsersConfirmResetAction({ state, resetPasswordMutation }: { state: ReturnType<typeof useUsersState>; resetPasswordMutation: ReturnType<typeof useUsersResetMutation> },
  { passwordResetNotice }: Pick<UsersOptions, 'passwordResetNotice'> = {}) {
  const { resetPasswordFor, newPassword, rowCapabilities, resetPassword, ownPrincipalId, translate, setNotice, setResetPasswordFor, setNewPassword, describeError } = state;
  async function confirmResetPassword() {
    if (!resetPasswordFor || !newPassword || !rowCapabilities(resetPasswordFor).canResetPassword) return;
    // Dialog stays open on failure (unlike the Disable/Delete-style dialogs elsewhere in this app,
    // which close either way) — closing would discard the password the operator just typed for no
    // reason; there's nothing sensitive left on screen once they retry or cancel. `resetPasswordFor`/
    // `newPassword` are therefore only cleared in the success path below, never as a `finally`.
    await resetPassword.run({ action: async () => {
      await resetPasswordMutation.mutate({ input: { principalId: resetPasswordFor.principalId, password: newPassword } });
      // A self-reset (own row, deep-linked or from the ordinary row menu — see `ownPrincipalId`'s
      // own doc comment) gets the "sign in again" notice instead of the per-username one: the reset
      // just revoked the CALLER'S OWN session, so the next request 401s and the host app's `src/App.hooks.ts` sends
      // them to the login screen — the generic notice naming a DIFFERENT user would be misleading
      // here, since it's actually their own sign-in that just ended.
      setNotice(
        resetPasswordFor.principalId === ownPrincipalId
          ? translate("Password changed. Sign in again with your new password.")
          : passwordResetNotice?.({ username: resetPasswordFor.username }) ?? interpolate({
              template: translate('Password reset for "{username}" — every active session for this user was revoked.'),
              vars: { username: resetPasswordFor.username },
            }),
      );
      setResetPasswordFor(null);
      setNewPassword("");
    }, describeError: (e) => describeError(e, translate("failed to reset password")) });
  }

  return confirmResetPassword;
}
