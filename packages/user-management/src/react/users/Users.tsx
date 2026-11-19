import { useId, type Dispatch, type FormEvent, type SetStateAction } from "react";
import type { AdminPolicy, AdminRole } from "../models.js";
import { InfoTip, SecretInput } from "../kit.js";
import { agentHandle } from "@jini-ai/core/agent-handles";

import { UsersTable, type UserManageController } from "./UsersTable.js";
import { UsersDialogs } from "./UsersDialogs.js";
import { useUsers, type UsersController, type UsersDependencies, type UsersOptions } from "./hooks/use-users.hooks.js";
import type { ReactNode } from "react";

import type { useResetPasswordFields } from "./hooks/use-reset-password-fields.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file Admin "Users" screen (SPEC-006 §3 human grant-writing transitions + 0.6.0 CRUD-completion
 * amendment) — markup only.
 *
 * State and API calls live in `hooks/use-users.hooks.ts`; the row-menu logic and the
 * server-error-message overrides live in `rules.ts`. What stays here is what actually renders: the
 * form, the table, and the two dialogs.
 *
 * Mirrors `features/integrations/Integrations.tsx`'s fetch/loading/error/form/table shape.
 * Lists operator users, creates new ones (`CREATE_USER`), and grants roles/
 * policies to an existing user (`ASSIGN_ROLE`/`ATTACH_POLICY`) via an
 * inline expandable "Manage" row. Role/policy *creation* is out of
 * this screen's UI (no `CREATE_ROLE`/`CREATE_POLICY` form here) — the API
 * client exposes `api.createRole`/`api.createPolicy` for the Roles &
 * Permissions screen to reuse.
 *
 * 0.6.0: the same expandable row also carries `UPDATE_USER` (email),
 * `RESET_USER_PASSWORD`, and a quick `DISABLE_PRINCIPAL`/`ENABLE_PRINCIPAL` toggle.
 *
 * Row actions (audit follow-up): all three of the above — Disable/Enable, Manage (opens the
 * expandable row), Reset password — now live behind a single three-dot `RowMenu`, matching
 * `Posts.tsx`/`Pages.tsx`'s row-action shape rather than a row of separate buttons.
 *
 * Delete-user plan v2 (2026-09-24): a fourth "Delete" item joins the menu, shown only when the
 * signed-in caller may manage the user Trash (owner or the built-in `admin` role — OWNER DECISION
 * 2026-09-24, `use-users.hooks.ts`'s `canManageUserTrash`). It moves the target to the Trash
 * (disabled, sessions revoked, restorable there for 60 days) rather than hard-deleting it — see
 * `UserDeleteDialog`'s own doc comment.
 *
 * Complexity-ceiling pass (2026-08-06): `Users` and its row-map closure both scored over the
 * ceiling (19/16 and 11/11 respectively). Split into four top-level, individually-testable
 * functions below — `NewUserForm`, `UsersTable`/`UserRow`, `UserDisableDialog`/`UserDeleteDialog`,
 * `UserResetPasswordDialog` — following `Taxonomy.tsx`'s existing convention of sibling top-level
 * function components in the same file rather than nested closures (a nested `const` inside
 * `Users` would not have moved any branching out of `Users`' own scope). `Users` itself is now a
 * thin composition of those, none of them exported, so no test does anything `Users.tsx`
 * didn't already support — see `__tests__/Users.unit.test.tsx`/`Users.crud.unit.test.tsx` for the
 * full-render tests these were extracted underneath (unchanged), plus new
 * `packages/user-management/src/react/users/__tests__/Users.coverage.test.tsx` for direct component-level tests of each piece.
 *
 * Second complexity pass (lot L182a): `UserRow` was back at cyclomatic 16 and `Users` at 11. The
 * row's cells and its menu-item wiring moved to `UserRowParts.tsx` (`UserNameCell`,
 * `UserStatusCell`, `UserGrantCells`, `userRowMenuItemsFor`), and the Manage panel's controller
 * assembly moved out of `Users`' JSX into `userManageController` below. Markup is unchanged.
 *
 * Reset-password confirm + reveal (typo-catching pass): `UserResetPasswordDialog` gained a second
 * field ("Confirm new password") and an independent show/hide toggle per field, both driven by the
 * new `hooks/use-reset-password-fields.hooks.ts` (confirm-field state and both reveal flags are
 * purely local/ephemeral — never sent to the server, so they don't belong in `use-users.hooks.ts`'s
 * screen-wide `UsersController`). The confirm-vs-server-error display conflict is resolved by giving
 * the two states one shared slot with a fixed precedence — a live mismatch always wins over a stale
 * `passwordError` from a previous attempt — rather than trying to show both at once or inventing a
 * second error line; see `UserResetPasswordDialog`'s own body for the exact ternary. `RevealablePasswordField`
 * is the shared field+toggle shape both new inputs use, following this file's own `GrantSelect`
 * precedent for a shape used twice.
 */
/**
 * What a host-supplied `useUsersHook` is called with: `useUsers`' own inputs, except that `translate`
 * may be absent. `Users` reads its copy from the controller the hook returns (`controller.translate`),
 * never from this prop, so a host hook that builds its own controller has no use for it.
 */
export type UsersHookDependencies = Omit<UsersDependencies, "translate"> & { translate?: Translate | undefined };
/** A host replacement for {@link useUsers} that does not need `translate` (see {@link UsersHookDependencies}). */
export type UsersHook = (dependencies: UsersHookDependencies, options?: UsersOptions) => UsersController;

/** Every `Users` prop except the hook/`translate` pair (see {@link UsersProps}). */
export interface UsersBaseProps extends Omit<UsersDependencies, "translate">, UsersOptions {
  useFields?: typeof useResetPasswordFields;
  /** The host owns localization of protocol status/role labels. */
  renderServerLabel?: ((required: { value: string }) => ReactNode) | undefined;
}

/**
 * `translate` is only ever forwarded to the hook, so it is required exactly when the default
 * {@link useUsers} (or a hook typed like it) runs, and optional when the host supplies a
 * {@link UsersHook} that does not read it — instead of a dead `translate={key => key}` stub.
 */
export type UsersProps = UsersBaseProps & (
  | { useUsersHook?: typeof useUsers | undefined; translate: Translate }
  | { useUsersHook: UsersHook; translate?: Translate | undefined }
);

interface NewUserFormProps {
  username: string;
  setUsername: Dispatch<SetStateAction<string>>;
  email: string;
  setEmail: Dispatch<SetStateAction<string>>;
  password: string;
  setPassword: Dispatch<SetStateAction<string>>;
  saving: boolean;
  formError: string | null;
  onCreate: (e: FormEvent) => Promise<void>;
  t: (key: string) => string;
}

/** The "New user" form — extracted from `Users` verbatim; own scope for `formError`/`saving`. */
function NewUserForm({ username, setUsername, email, setEmail, password, setPassword, saving, formError, onCreate, t }: NewUserFormProps) {
  return (
    <form onSubmit={onCreate} className="notice integrations-form form-measure">
      {formError ? <span className="save-error">{formError}</span> : null}
      <label>
        {t("Username")}
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          {...agentHandle({ handle: "users-new-username" }, { role: "field", label: "The new user's username" })}
        />
      </label>
      <label>
        {t("Email (optional)")}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          {...agentHandle({ handle: "users-new-email" }, { role: "field", label: "The new user's email address" })}
        />
      </label>
      <NewUserPasswordField password={password} setPassword={setPassword} t={t} />
      <button
        type="submit"
        disabled={saving}
        {...agentHandle({ handle: "users-new-submit" }, { role: "button", label: "Create this operator account" })}
      >
        {saving ? t("Creating…") : t("Create user")}
      </button>
    </form>
  );
}

interface UsersPageHeaderProps {
  formOpen: boolean;
  setFormOpen: Dispatch<SetStateAction<boolean>>;
  t: (key: string) => string;
}

/** The page title plus the "New user"/"Cancel" toggle button — extracted from `Users` verbatim so
 *  its two `formOpen` ternaries (class, label) count against this function, not `Users`'. */
function UsersPageHeader({ formOpen, setFormOpen, t }: UsersPageHeaderProps) {
  return (
    <div
      className="page-header"
      {...agentHandle({ handle: "users-header" }, { role: "region", label: "Users header — page title and the New user button" })}
    >
      <div className="page-header-text">
        <p className="page-kicker">{t("People")}</p>
        <h1 className="page-title">
          {t("Users")}
          {/* Owner ask (2026-09-24): there's no "forgot password" self-service flow yet, so a
              locked-out user relies on an admin resetting their password from this page (see
              `UserRow`'s `RowMenu` — Reset password lives there, not as a standalone header
              button, which is why this sits on the page title instead of "next to" that action).
              Reset behavior itself is unchanged. Reuses the shared `InfoTip` — already this app's
              "ⓘ opens an explanation, keyboard-/focus-reachable, Escape closes without losing
              focus" convention (see `ThemePagesTab.tsx`'s locked-row usage) — rather than a new
              bespoke popover. */}
          <InfoTip
            label={t(
              "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.",
            )}
            agentHandle="users-reset-password-info"
          />
        </h1>
        <p className="page-description">
          {t("Operator accounts with access to this admin — assign roles and policies, or disable access.")}
        </p>
      </div>
      <div className="page-actions">
        {/* Same toggle button throughout — reads "New user" (the page's one primary action) when
            closed, "Cancel" (a dismiss, not a create) once the form is open, so the tone follows
            the label instead of a second button competing with the form's own "Create user". */}
        <button
          className={formOpen ? "btn-secondary" : undefined}
          onClick={() => setFormOpen((v) => !v)}
          {...agentHandle({ handle: "users-new-toggle" }, { role: "button", label: "Open or close the new-user form" })}
        >
          {formOpen ? t("Cancel") : t("New user")}
        </button>
      </div>
    </div>
  );
}

interface UsersNoticesProps {
  toggleError: string | null;
  notice: string | null;
}

/** The Disable/Enable-toggle error banner and the reset-password success notice — extracted from
 *  `Users` verbatim. `Users` was still cyc 10 (over the tightened <=9/<=9 bar) with these two
 *  independent ternaries inline; moving them out is the same "extract to a top-level function"
 *  rule the rest of this pass follows. */
function UsersNotices({ toggleError, notice }: UsersNoticesProps) {
  return (
    <>
      {toggleError ? <div className="notice error">{toggleError}</div> : null}
      {notice ? <div className="notice">{notice}</div> : null}
    </>
  );
}

/** Assembles the expanded "Manage" panel's {@link UserManageController} from the screen-wide
 *  controller — extracted from `Users`' JSX in the complexity-ceiling pass (lot L182a) so its two
 *  `canGrant` ternaries count against this function, not `Users`. `roles`/`policies` are the
 *  already-loaded (non-null) lists `Users` narrowed before rendering the table. Without `canGrant`
 *  both grants are `null`, so the panel renders no grant controls. */
function userManageController({ controller, roles, policies }: {
  controller: UsersController; roles: AdminRole[]; policies: AdminPolicy[];
}): UserManageController {
  const { canGrant } = controller;
  return {
    error: controller.grantError,
    saving: controller.grantSaving,
    email: { value: controller.editEmail, set: controller.setEditEmail, saving: controller.emailSaving, save: controller.onSaveEmail },
    roleGrant: canGrant
      ? { options: roles, pendingId: controller.pendingRoleId, setPendingId: controller.setPendingRoleId, submit: controller.onAssignRole }
      : null,
    policyGrant: canGrant
      ? { options: policies, pendingId: controller.pendingPolicyId, setPendingId: controller.setPendingPolicyId, submit: controller.onAttachPolicy }
      : null,
  };
}

export function Users({ useUsersHook = useUsers, useFields, port, translate: injectedTranslate, queryScope,
  openOwnPasswordReset, onOwnPasswordResetClosed, passwordResetNotice, renderServerLabel }: UsersProps) {
  // The dependency cast is sound only through the `UsersProps` union: whenever
  // `useUsersHook` is omitted or typed as `useUsers`, `translate` is required, so the default hook
  // never runs without it. TypeScript cannot correlate the two destructured props itself.
  const dependencies = { port, translate: injectedTranslate, queryScope } as UsersDependencies;
  const controller = useUsersHook(dependencies, { openOwnPasswordReset, onOwnPasswordResetClosed, passwordResetNotice });
  const { users, roles, policies, error, t } = controller;
  if (error) return <div className="notice error">{error}</div>;
  if (!users || !roles || !policies) return <div className="notice">{t("Loading users…")}</div>;
  return (
    <div className="page">
      <UsersPageHeader formOpen={controller.formOpen} setFormOpen={controller.setFormOpen} t={t} />
      {controller.formOpen ? <NewUserForm {...controller} /> : null}
      <UsersNotices toggleError={controller.toggleError} notice={controller.notice} />
      <UsersTable users={users} ownPrincipalId={controller.ownProfile?.principalId} roles={roles} policies={policies}
        showGrants={controller.canGrant} actions={{
          expandedId: controller.expandedId, toggleExpanded: controller.toggleExpanded, savingId: controller.toggleSavingId,
          requestDisable: controller.requestDisable, toggleStatus: controller.onToggleStatus, openResetPassword: controller.openResetPassword,
          renameUserHandler: controller.renameUserHandler, canDelete: controller.canManageUserTrash,
          rowCapabilities: controller.rowCapabilities, requestDelete: controller.requestDelete,
        }} manage={userManageController({ controller, roles, policies })} t={t} translate={controller.translate} renderServerLabel={renderServerLabel} />
      <UsersDialogs controller={controller} {...(useFields ? { useFields } : {})} />
    </div>
  );
}

function NewUserPasswordField({ password, setPassword, t }: Pick<NewUserFormProps, 'password' | 'setPassword' | 't'>) {
  const passwordInputId = useId();
  return <>
      {/* A sibling label keeps the eye toggle's "Show password" name out of the input's own
          accessible name, and keeps the interactive toggle outside the label. */}
      <div>
        <label htmlFor={passwordInputId}>{t("Password")}</label>
        {/* `autoComplete="new-password"`, NOT `"off"` — Chrome deliberately ignores `off` on
            credential-shaped fields (a long-standing intentional decision, not a bug). Without
            this, this form's `type="email"` input right above reads to Chrome as a login pair, and
            Chrome offered to fill the logged-in ADMIN's own saved email/password into a form meant
            to create a DIFFERENT user. `new-password` is the value Chrome/Safari/Firefox actually
            honor for "this is an account-creation field, not a saved login" — matching this repo's
            own corrected precedent on `security/AccessTokensTab.tsx`'s token field (commit
            `fc64f2d9`, superseding an earlier `autoComplete="off"` attempt that did not work).
            Known trade-off, not fixed here: Chrome may now offer to GENERATE a password on this
            field — a suggestion popup, not a silently wrong value. */}
        <SecretInput
          label={t("Password")}
          toggleLabels={{ show: t("Show password"), hide: t("Hide password") }}
          id={passwordInputId}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={1}
          {...agentHandle({ handle: "users-new-password" }, {
            role: "field",
            label: "The new user's password — a credential field, so only a human can fill it",
          })}
        />
      </div>
  </>;
}
