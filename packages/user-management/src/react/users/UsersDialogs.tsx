import type { Dispatch, SetStateAction } from 'react';
import type { AdminIdentityUser } from '../models.js';
import { ConfirmDialog, SecretInput } from '../kit.js';
import { agentHandle } from '@jini-ai/core/agent-handles';
import { createResetPasswordConfirmHandler, useResetPasswordFields } from './hooks/use-reset-password-fields.hooks.js';
import type { UsersController } from './hooks/use-users.hooks.js';
import { ChangeUsernameDialog } from './ChangeUsernameDialog.js';

interface UserDisableDialogProps {
  confirmingDisable: AdminIdentityUser | null;
  setConfirmingDisable: Dispatch<SetStateAction<AdminIdentityUser | null>>;
  toggleSavingId: string | null;
  confirmDisable: () => Promise<void>;
  t: (key: string) => string;
}

/** The Disable confirm dialog — extracted from `Users` verbatim. */
function UserDisableDialog({ confirmingDisable, setConfirmingDisable, toggleSavingId, confirmDisable, t }: UserDisableDialogProps) {
  return (
    <ConfirmDialog
      cancelLabel={t("Cancel")}
      open={confirmingDisable !== null}
      agentHandle="users-disable"
      title={t("Disable this user?")}
      body={
        confirmingDisable ? (
          <p>
            {t("Disable")} &quot;{confirmingDisable.username}&quot;? {t("They will not be able to sign in until re-enabled.")}
          </p>
        ) : null
      }
      confirmLabel={t("Disable")}
      tone="warning"
      pending={confirmingDisable !== null && toggleSavingId === confirmingDisable.principalId}
      onConfirm={confirmDisable}
      onCancel={() => setConfirmingDisable(null)}
    />
  );
}

interface UserDeleteDialogProps {
  confirmingDelete: AdminIdentityUser | null;
  setConfirmingDelete: Dispatch<SetStateAction<AdminIdentityUser | null>>;
  deleteSaving: boolean;
  confirmDelete: () => Promise<void>;
  t: (key: string) => string;
}

/** The Delete confirm dialog (delete-user plan v2, 2026-09-24) — mirrors {@link UserDisableDialog}'s
 *  shape exactly (own props, own state), naming the Trash rather than a permanent removal since
 *  that is what "Delete" now does here (decisions 2/7 of the plan). */
function UserDeleteDialog({ confirmingDelete, setConfirmingDelete, deleteSaving, confirmDelete, t }: UserDeleteDialogProps) {
  return (
    <ConfirmDialog
      cancelLabel={t("Cancel")}
      open={confirmingDelete !== null}
      agentHandle="users-delete"
      title={t("Delete this user?")}
      body={
        confirmingDelete ? (
          <p>
            {t("Delete")} &quot;{confirmingDelete.username}&quot;?{" "}
            {t(
              "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.",
            )}
          </p>
        ) : null
      }
      confirmLabel={t("Move to trash")}
      tone="danger"
      pending={deleteSaving}
      onConfirm={confirmDelete}
      onCancel={() => setConfirmingDelete(null)}
    />
  );
}

interface RevealablePasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
  /** Distinct handle base — `UserResetPasswordDialog` renders this twice (new password, confirm),
   *  so a fixed name would collide, same reasoning as `GrantSelect.agentBase` above. */
  agentBase: string;
  t: (key: string) => string;
}

/** One password input plus its own independent show/hide toggle. `UserResetPasswordDialog` renders
 *  this twice (new password, confirm new password) so each field can be revealed on its own — the
 *  whole point of the confirm field is catching a typo by eye, which a single toggle driving both
 *  fields would not let the operator do selectively. Follows this file's `GrantSelect` precedent: a
 *  shape used by more than one caller gets its own top-level function instead of staying inline
 *  twice.
 *
 *  The toggle itself is icon-only (standard eye / eye-with-slash convention, per owner request —
 *  not a text "Show"/"Hide" link): the accessible name flips between "Show <label>"/"Hide <label>"
 *  via `aria-label` (screen reader), which is the one on/off signal a text label would have given
 *  (no `aria-pressed` on top: that announced the state twice). The shared stroke icon keeps the
 *  open-eye/eye-with-slash convention without duplicating glyphs in this screen.
 *
 *  The shared `.jini-secret` wrapper gives the icon its own space: the host's `.field input {
 *  width: 100% }` must not make the input fight a sibling toggle for room. */
function RevealablePasswordField({ id, label, value, onChange, visible, onToggleVisible, agentBase, t }: RevealablePasswordFieldProps) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <SecretInput
        id={id}
        label={label}
        toggleLabels={{ show: `${t("Show")} ${label}`, hide: `${t("Hide")} ${label}` }}
        revealed={visible}
        onRevealedChange={onToggleVisible}
        toggleAttrs={agentHandle({ handle: `${agentBase}-reveal` }, { role: "button", label: `Show or hide the ${label.toLowerCase()} field's characters` })}
        // `new-password`, not `off` (Chrome ignores `off`): without it Chrome filled a saved
        // login into "New password" only. Kept while revealed as `type="text"`, too.
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: "1 1 auto", minWidth: 0 }}
        {...agentHandle({ handle: agentBase }, {
          role: "field",
          label: `${label} — a credential field, so only a human can fill it`,
        })}
      />
    </div>
  );
}

interface UserResetPasswordDialogProps {
  resetPasswordFor: AdminIdentityUser | null;
  setResetPasswordFor: Dispatch<SetStateAction<AdminIdentityUser | null>>;
  newPassword: string;
  setNewPassword: Dispatch<SetStateAction<string>>;
  passwordError: string | null;
  setPasswordError: Dispatch<SetStateAction<string | null>>;
  passwordSaving: boolean;
  confirmResetPassword: () => Promise<void>;
  t: (key: string) => string;
  /** Injectable seam for the confirm-field + reveal-toggle state. Defaults to the real
   *  {@link useResetPasswordFields}. */
  useFields?: typeof useResetPasswordFields;
}

/** The reset-password dialog — extracted from `Users` verbatim, since extended with the confirm
 *  field and both reveal toggles (see this file's header). */
function UserResetPasswordDialog({
  resetPasswordFor, setResetPasswordFor, newPassword, setNewPassword, passwordError,
  setPasswordError, passwordSaving, confirmResetPassword, t,
  useFields = useResetPasswordFields,
}: UserResetPasswordDialogProps) {
  const fields = useFields({ resetPasswordFor, newPassword });
  const displayedError = fields.mismatch ? t("Passwords do not match.") : passwordError;

  const handleConfirm = createResetPasswordConfirmHandler({ mismatch: fields.mismatch, confirmResetPassword });

  return (
    <ConfirmDialog
      cancelLabel={t("Cancel")}
      open={resetPasswordFor !== null}
      agentHandle="users-reset-password"
      title={t("Reset password?")}
      body={resetPasswordFor ? <UserResetPasswordBody resetPasswordFor={resetPasswordFor} newPassword={newPassword}
        setNewPassword={setNewPassword} passwordError={passwordError} fields={fields} displayedError={displayedError} t={t} /> : null}
      confirmLabel={t("Reset password")}
      tone="warning"
      pending={passwordSaving}
      onConfirm={handleConfirm}
      onCancel={() => {
        setResetPasswordFor(null);
        setNewPassword("");
        setPasswordError(null);
      }}
    />
  );
}

function UserResetPasswordBody({ resetPasswordFor, newPassword, setNewPassword, passwordError, fields, displayedError, t }: {
  resetPasswordFor: AdminIdentityUser; newPassword: string; setNewPassword: Dispatch<SetStateAction<string>>;
  passwordError: string | null; fields: ReturnType<typeof useResetPasswordFields>; displayedError: string | null; t: (key: string) => string;
}) {
  return (
          <>
            <p>
              {t("Set a new password for")} &quot;{resetPasswordFor.username}&quot;.{" "}
              {t("Every active session for this user will be signed out.")}
            </p>
            <RevealablePasswordField id="users-reset-password-input" label={t("New password")} value={newPassword}
              onChange={setNewPassword} visible={fields.showNewPassword} onToggleVisible={fields.toggleShowNewPassword}
              agentBase="users-reset-password" t={t} />
            <RevealablePasswordField id="users-reset-password-confirm-input" label={t("Confirm new password")}
              value={fields.confirmPassword} onChange={fields.setConfirmPassword}
              visible={fields.showConfirmPassword} onToggleVisible={fields.toggleShowConfirmPassword}
              // NOT "users-reset-password-confirm" — that string is already the dialog's own
              // ConfirmDialog Confirm button handle (`agentHandle="users-reset-password"` above,
              // `-confirm` sub-handle). Two elements answering to the same handle is a
              // page-authoring bug the page driver refuses to resolve (see
              // `dom-page-driver.ts`'s `ambiguousHandleError`), so this field gets its own name.
              agentBase="users-reset-password-retype"
              t={t}
            />
            {/* One shared slot, fixed precedence: a live mismatch always wins over a stale
                `passwordError` left over from a previous failed attempt, so the two can never be
                shown — or appear to conflict — at the same time. Once the fields agree again, the
                stale server error (if any) reappears until the next submit or Cancel clears it. */}
            {fields.mismatch || passwordError ? (
              <p className="save-error" role="alert">
                {displayedError}
              </p>
            ) : null}
          </>
  );
}

export function UsersDialogs({ controller: c, useFields }: { controller: UsersController; useFields?: typeof useResetPasswordFields }) {
  return <>
    <UserDisableDialog confirmingDisable={c.confirmingDisable} setConfirmingDisable={c.setConfirmingDisable}
      toggleSavingId={c.toggleSavingId} confirmDisable={c.confirmDisable} t={c.t} />
    <UserDeleteDialog confirmingDelete={c.confirmingDelete} setConfirmingDelete={c.setConfirmingDelete}
      deleteSaving={c.deleteSaving} confirmDelete={c.confirmDelete} t={c.t} />
    <UserResetPasswordDialog resetPasswordFor={c.resetPasswordFor} setResetPasswordFor={c.setResetPasswordFor}
      newPassword={c.newPassword} setNewPassword={c.setNewPassword} passwordError={c.passwordError} setPasswordError={c.setPasswordError}
      passwordSaving={c.passwordSaving} confirmResetPassword={c.confirmResetPassword} t={c.t} {...(useFields ? { useFields } : {})} />
    {c.changeUsername ? <ChangeUsernameDialog controller={c.changeUsername} translate={c.t} /> : null}
  </>;
}
