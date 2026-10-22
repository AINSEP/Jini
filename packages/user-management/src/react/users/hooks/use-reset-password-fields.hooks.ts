import { useEffect, useState } from "react";

import type { AdminIdentityUser } from "../../models.js";

/**
 * @file The reset-password dialog's own confirm-field and reveal-toggle state — client-side only,
 * never sent to the server (`use-users.hooks.ts`'s `resetPasswordMutation` still posts only
 * `principalId`/`password`). Split out of `Users.tsx` because this is one dialog's own ephemeral UI
 * concern, not part of the screen-wide `UsersController` `use-users.hooks.ts` already owns, so it
 * gets its own small hook rather than growing that one further. No `-port.hooks.ts`/
 * `-dependencies.hooks.ts` pair — this hook does no I/O of its own.
 */

export interface ResetPasswordFieldsInput {
  /** Which user the dialog is open for — `null` when closed. Only `principalId` is read (see
   *  `useResetPasswordFields`'s own doc comment for why). */
  resetPasswordFor: AdminIdentityUser | null;
  /** The dialog's own "New password" value, owned by `use-users.hooks.ts` — passed in so this hook
   *  can derive `mismatch` without `UserResetPasswordDialog` having to compare the two fields itself. */
  newPassword: string;
}

export interface ResetPasswordFieldsController {
  /** The typed confirmation value. Never read by anything outside this dialog — it exists only to
   *  be compared against `newPassword`, and is discarded (never becomes part of the request body). */
  confirmPassword: string;
  setConfirmPassword: (value: string) => void;
  /** True whenever `newPassword` and `confirmPassword` differ, including while `confirmPassword` is
   *  still empty. `UserResetPasswordDialog` uses this to block the confirm action and to choose
   *  which message occupies its single error slot. */
  mismatch: boolean;
  showNewPassword: boolean;
  toggleShowNewPassword: () => void;
  showConfirmPassword: boolean;
  toggleShowConfirmPassword: () => void;
}

/**
 * Owns the "Confirm new password" field and both fields' independent reveal toggles.
 *
 * Resets `confirmPassword` and both reveal flags to their defaults on every open transition —
 * keyed on `resetPasswordFor?.principalId` rather than the `user` object's own identity, so a
 * reopen of the SAME user (e.g. Cancel, then "Reset password" again from the row menu) still
 * resets even if the `users` list query happens to hand back the same object reference. This is
 * also why closing the dialog (`principalId` going back to `null`) resets these fields too: there
 * is no user-visible difference between "reset on close" and "reset on open" for a dialog that is
 * unmounted-in-effect (`ConfirmDialog` stays in the DOM but hidden) between the two.
 *
 * @param input - `resetPasswordFor` (open/closed + which user) and the sibling `newPassword` value.
 * @returns The confirm field's value/setter, the derived `mismatch` flag, and both reveal toggles.
 * @complexity Time/space: O(1) — fixed number of state cells, no iteration.
 */
export function useResetPasswordFields({ resetPasswordFor, newPassword }: ResetPasswordFieldsInput, _optional: Record<string, never> = {}): ResetPasswordFieldsController {
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    setConfirmPassword("");
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  }, [resetPasswordFor?.principalId]);

  return {
    confirmPassword,
    setConfirmPassword,
    mismatch: newPassword !== confirmPassword,
    showNewPassword,
    toggleShowNewPassword: () => setShowNewPassword((visible) => !visible),
    showConfirmPassword,
    toggleShowConfirmPassword: () => setShowConfirmPassword((visible) => !visible),
  };
}
