import type { Translate } from "@jini-ai/ui/panel-kit";
import { Fragment, type Dispatch, type FormEvent, type SetStateAction } from "react";
import type { AdminIdentityUser, AdminPolicy, AdminRole } from "../models.js";
import { RowMenu, ConfirmDialog } from "@jini-ai/admin/react";
import { agentHandle } from "@jini-ai/agentic";
import { buildAgentListHandles } from "@jini-ai/ui/panel-kit";

import { formatGrantLabel, userRowMenuItems } from "./rules.js";
import { useUsers, type UsersDependencies, type UsersOptions } from "./hooks/use-users.hooks.js";
import { InfoTip } from "@jini-ai/ui/admin-widgets";
import { useResetPasswordFields } from "./hooks/use-reset-password-fields.hooks.js";

export interface UsersProps extends UsersDependencies, UsersOptions {

  useUsersHook?: typeof useUsers | undefined;

  openOwnPasswordReset?: boolean | undefined;
}

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
          {...agentHandle({ handle: "users-new-username" }, { role: "field", label: t("The new user's username") })}
        />
      </label>
      <label>
        {t("Email (optional)")}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          {...agentHandle({ handle: "users-new-email" }, { role: "field", label: t("The new user's email address") })}
        />
      </label>
      <label>
        {t("Password")}
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={1}
          {...agentHandle({ handle: "users-new-password" }, {
            role: "field",
            label: t("The new user's password — a credential field, so only a human can fill it"),
          })}
        />
      </label>
      <button
        type="submit"
        disabled={saving}
        {...agentHandle({ handle: "users-new-submit" }, { role: "button", label: t("Create this operator account") })}
      >
        {saving ? t("Creating…") : t("Create user")}
      </button>
    </form>
  );
}

export interface GrantOption {
  id: string;
  name: string;
  isBuiltin: boolean;
}

export interface GrantSelectController {
  options: GrantOption[];

  pendingId: string;
  setPendingId: Dispatch<SetStateAction<string>>;
  submit: (required: { principalId: string }) => Promise<void>;
}

export interface UserManageController {

  error: string | null;

  saving: boolean;
  email: {
    value: string;
    set: Dispatch<SetStateAction<string>>;
    saving: boolean;
    save: (required: { principalId: string }) => Promise<void>;
  };
  roleGrant: GrantSelectController;
  policyGrant: GrantSelectController;
}

interface GrantSelectProps {
  principalId: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  grant: GrantSelectController;
  saving: boolean;

  agentBase: string;
  t: (key: string) => string;
}

function GrantSelect({ principalId, label, placeholder, submitLabel, grant, saving, agentBase, t }: GrantSelectProps) {
  return (
    <label>
      {label}
      <span className="editor-actions">
        <select
          value={grant.pendingId}
          onChange={(e) => grant.setPendingId(e.target.value)}
          {...agentHandle({ handle: `${agentBase}-select` }, {
            role: "field",
            label: t(`${label} — set with page.select_option, not click`),
          })}
        >
          <option value="">{placeholder}</option>
          {grant.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
              {option.isBuiltin ? ` ${t("(built-in)")}` : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!grant.pendingId || saving}
          onClick={() => grant.submit({ principalId })}
          {...agentHandle({ handle: `${agentBase}-submit` }, { role: "button", label: t(`${submitLabel} the selected option to this user`) })}
        >
          {saving ? t("Saving…") : submitLabel}
        </button>
      </span>
    </label>
  );
}

export interface UserManagePanelProps {
  principalId: string;
  manage: UserManageController;
  t: (key: string) => string;
}

export function UserManagePanel({ principalId, manage, t }: UserManagePanelProps) {
  return (
    <tr>
      <td colSpan={6}>
        <div className="notice integrations-form">
          {manage.error ? <span className="save-error">{manage.error}</span> : null}
          <label>
            {t("Email")}
            <span className="editor-actions">
              <input
                type="email"
                value={manage.email.value}
                onChange={(e) => manage.email.set(e.target.value)}
                placeholder={t("(none)")}
                {...agentHandle({ handle: "user-manage-email" }, { role: "field", label: t("This user's email address") })}
              />
              <button
                type="button"
                disabled={manage.email.saving}
                onClick={() => manage.email.save({ principalId })}
                {...agentHandle({ handle: "user-manage-email-save" }, { role: "button", label: t("Save this user's email address") })}
              >
                {manage.email.saving ? t("Saving…") : t("Save email")}
              </button>
            </span>
          </label>
          <GrantSelect
            principalId={principalId}
            label={t("Assign role")}
            placeholder={t("Select a role…")}
            submitLabel={t("Assign")}
            grant={manage.roleGrant}
            saving={manage.saving}
            agentBase="user-manage-role"
            t={t}
          />
          <GrantSelect
            principalId={principalId}
            label={t("Attach policy")}
            placeholder={t("Select a policy…")}
            submitLabel={t("Attach")}
            grant={manage.policyGrant}
            saving={manage.saving}
            agentBase="user-manage-policy"
            t={t}
          />
        </div>
      </td>
    </tr>
  );
}

export interface UserRowActionsController {
  expandedId: string | null;
  toggleExpanded: (user: AdminIdentityUser) => void;

  savingId: string | null;
  requestDisable: (user: AdminIdentityUser) => void;
  toggleStatus: (user: AdminIdentityUser) => Promise<void>;
  openResetPassword: (user: AdminIdentityUser) => void;

  canDelete: boolean;
  requestDelete: (user: AdminIdentityUser) => void;
}

export interface UserRowProps {
  user: AdminIdentityUser;
  roleById: ReadonlyMap<string, AdminRole>;
  policyById: ReadonlyMap<string, AdminPolicy>;
  actions: UserRowActionsController;
  manage: UserManageController;

  agentBase: string;
  t: (key: string) => string;
  translate: Translate;
}

function UserRow({ user, roleById, policyById, actions, manage, agentBase, t, translate }: UserRowProps) {
  const roleLabel = formatGrantLabel({ ids: user.roleIds, byId: roleById });
  const policyLabel = formatGrantLabel({ ids: user.policyIds, byId: policyById });
  return (
    <>
      <tr>
        <td>
              <button
            type="button"
            className="link-button"
            onClick={() => actions.toggleExpanded(user)}
            aria-expanded={actions.expandedId === user.principalId}
            {...agentHandle({ handle: `${agentBase}-manage` }, {
              role: "button",
              label: t("Open this user's Manage panel — edit email, assign a role, attach a policy"),
            })}
          >
            {user.username}
          </button>
        </td>
        <td>{user.email ?? <span className="muted-cell">—</span>}</td>
        <td>
          <span className={`status status-${user.status}`}>{t(user.status)}</span>
        </td>
        <td>{roleLabel !== null ? t(roleLabel) : <span className="muted-cell">{t("none")}</span>}</td>
        <td>{policyLabel !== null ? policyLabel : <span className="muted-cell">{t("none")}</span>}</td>
        <td>
              <RowMenu
            triggerLabel={`${t("Actions for user")} "${user.username}"`}
            agentHandle={`${agentBase}-menu`}
            items={userRowMenuItems({
              user,
              toggleSaving: actions.savingId === user.principalId,
              handlers: {
                onRequestDisable: actions.requestDisable,
                onEnable: (u) => void actions.toggleStatus(u),
                onManage: actions.toggleExpanded,
                onResetPassword: actions.openResetPassword,
                onRequestDelete: actions.requestDelete,
              },
              translate,
              canDelete: actions.canDelete,
            })}
          />
        </td>
      </tr>
      {actions.expandedId === user.principalId ? (
        <UserManagePanel principalId={user.principalId} manage={manage} t={t} />
      ) : null}
    </>
  );
}

export interface UsersTableProps {
  users: AdminIdentityUser[];

  roles: AdminRole[];
  policies: AdminPolicy[];
  actions: UserRowActionsController;
  manage: UserManageController;
  t: (key: string) => string;
  translate: Translate;
}

function UsersTable({ users, roles, policies, actions, manage, t, translate }: UsersTableProps) {
  if (users.length === 0) {
    return (
      <div className="card">
        <div className="empty-state">
          <p>{t("No users yet.")}</p>
          <p className="page-description">{t("Create your first operator account to get started.")}</p>
        </div>
      </div>
    );
  }

  const roleById = new Map<string, AdminRole>(roles.map((role) => [role.id, role]));
  const policyById = new Map<string, AdminPolicy>(policies.map((policy) => [policy.id, policy]));

  const rowHandles = buildAgentListHandles({ prefix: "users-row", ids: users.map((user) => user.principalId) });

  return (
    <div className="table-scroll">
      <table className="list-table">
        <thead>
          <tr>
            <th>{t("Username")}</th>
            <th>{t("Email")}</th>
            <th>{t("Status")}</th>
            <th>{t("Roles")}</th>
            <th>{t("Policies")}</th>
            <th>{t("More")}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user, index) => (
            <Fragment key={user.principalId}>
              <UserRow
                user={user}
                roleById={roleById}
                policyById={policyById}
                actions={actions}
                manage={manage}
                agentBase={rowHandles[index]!}
                t={t}
                translate={translate}
              />
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface UserDisableDialogProps {
  confirmingDisable: AdminIdentityUser | null;
  setConfirmingDisable: Dispatch<SetStateAction<AdminIdentityUser | null>>;
  toggleSavingId: string | null;
  confirmDisable: () => Promise<void>;
  t: (key: string) => string;
}

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

function EyeIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M1.5 9S4.5 4 9 4s7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5Z" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M1.5 9S4.5 4 9 4s7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5Z" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="2" />
      <path d="M3 3 15 15" strokeLinecap="round" />
    </svg>
  );
}

interface RevealablePasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggleVisible: () => void;

  agentBase: string;
  t: (key: string) => string;
}

function RevealablePasswordField({ id, label, value, onChange, visible, onToggleVisible, agentBase, t }: RevealablePasswordFieldProps) {
  const toggleLabel = visible ? t("Hide password") : t("Show password");
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <span className="editor-actions">
        <input
          id={id}
          type={visible ? "text" : "password"}

          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ flex: "1 1 auto", minWidth: 0 }}
          {...agentHandle({ handle: agentBase }, {
            role: "field",
            label: t(`${label} — a credential field, so only a human can fill it`),
          })}
        />
        <button
          type="button"
          className="link-button"
          aria-label={toggleLabel}
          aria-pressed={visible}
          title={toggleLabel}
          onClick={onToggleVisible}
          {...agentHandle({ handle: `${agentBase}-reveal` }, { role: "button", label: t(`Show or hide the ${label.toLowerCase()} field's characters`) })}
        >
          <span style={{ display: "inline-flex", width: 16, height: 16 }}>{visible ? <EyeOffIcon /> : <EyeIcon />}</span>
        </button>
      </span>
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

  useFields?: typeof useResetPasswordFields | undefined;
}

function resolveResetPasswordFieldsHook(
  override: typeof useResetPasswordFields | undefined,
): typeof useResetPasswordFields {
  return override ?? useResetPasswordFields;
}

function UserResetPasswordDialog({
  resetPasswordFor,
  setResetPasswordFor,
  newPassword,
  setNewPassword,
  passwordError,
  setPasswordError,
  passwordSaving,
  confirmResetPassword,
  t,
  useFields: useFieldsProp,
}: UserResetPasswordDialogProps) {
  const useFields = resolveResetPasswordFieldsHook(useFieldsProp);
  const fields = useFields({ resetPasswordFor, newPassword });

  function handleConfirm() {
    if (fields.mismatch) return;
    void confirmResetPassword();
  }

  return (
    <ConfirmDialog
      cancelLabel={t("Cancel")}
      open={resetPasswordFor !== null}
      agentHandle="users-reset-password"
      title={t("Reset password?")}
      body={
        resetPasswordFor ? (
          <>
            <p>
              {t("Set a new password for")} &quot;{resetPasswordFor.username}&quot;.{" "}
              {t("Every active session for this user will be signed out.")}
            </p>
            <RevealablePasswordField
              id="users-reset-password-input"
              label={t("New password")}
              value={newPassword}
              onChange={setNewPassword}
              visible={fields.showNewPassword}
              onToggleVisible={fields.toggleShowNewPassword}
              agentBase="users-reset-password"
              t={t}
            />
            <RevealablePasswordField
              id="users-reset-password-confirm-input"
              label={t("Confirm new password")}
              value={fields.confirmPassword}
              onChange={fields.setConfirmPassword}
              visible={fields.showConfirmPassword}
              onToggleVisible={fields.toggleShowConfirmPassword}

              agentBase="users-reset-password-retype"
              t={t}
            />
            {fields.mismatch ? (
              <p className="save-error" role="alert">
                {t("Passwords do not match.")}
              </p>
            ) : passwordError ? (
              <p className="save-error" role="alert">
                {passwordError}
              </p>
            ) : null}
          </>
        ) : null
      }
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

interface UsersPageHeaderProps {
  formOpen: boolean;
  setFormOpen: Dispatch<SetStateAction<boolean>>;
  t: (key: string) => string;
}

function UsersPageHeader({ formOpen, setFormOpen, t }: UsersPageHeaderProps) {
  return (
    <div
      className="page-header"
      {...agentHandle({ handle: "users-header" }, { role: "region", label: t("Users header — page title and the New user button") })}
    >
      <div className="page-header-text">
        <p className="page-kicker">{t("People")}</p>
        <h1 className="page-title">
          {t("Users")}
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
        <button
          className={formOpen ? "btn-secondary" : undefined}
          onClick={() => setFormOpen((v) => !v)}
          {...agentHandle({ handle: "users-new-toggle" }, { role: "button", label: t("Open or close the new-user form") })}
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

function UsersNotices({ toggleError, notice }: UsersNoticesProps) {
  return (
    <>
      {toggleError ? <div className="notice error">{toggleError}</div> : null}
      {notice ? <div className="notice">{notice}</div> : null}
    </>
  );
}

export function Users({ useUsersHook = useUsers, port, translate: injectedTranslate, queryScope, openOwnPasswordReset, onOwnPasswordResetClosed }: UsersProps) {
  const {
    users,
    roles,
    policies,
    error,

    formOpen,
    setFormOpen,
    username,
    setUsername,
    email,
    setEmail,
    password,
    setPassword,
    saving,
    formError,
    onCreate,

    expandedId,
    toggleExpanded,
    pendingRoleId,
    setPendingRoleId,
    pendingPolicyId,
    setPendingPolicyId,
    grantSaving,
    grantError,
    onAssignRole,
    onAttachPolicy,

    editEmail,
    setEditEmail,
    emailSaving,
    onSaveEmail,

    toggleSavingId,
    toggleError,
    notice,

    confirmingDisable,
    setConfirmingDisable,
    requestDisable,
    confirmDisable,
    onToggleStatus,

    resetPasswordFor,
    setResetPasswordFor,
    newPassword,
    setNewPassword,
    passwordSaving,
    passwordError,
    setPasswordError,
    openResetPassword,
    confirmResetPassword,

    canManageUserTrash,
    confirmingDelete,
    setConfirmingDelete,
    requestDelete,
    deleteSaving,
    confirmDelete,

    t,
    translate,
  } = useUsersHook({ port, translate: injectedTranslate, queryScope }, { openOwnPasswordReset, onOwnPasswordResetClosed });

  if (error) return <div className="notice error">{error}</div>;
  if (!users || !roles || !policies) return <div className="notice">{t("Loading users…")}</div>;

  return (
    <div className="page">
      <UsersPageHeader formOpen={formOpen} setFormOpen={setFormOpen} t={t} />

      {formOpen ? (
        <NewUserForm
          username={username}
          setUsername={setUsername}
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          saving={saving}
          formError={formError}
          onCreate={onCreate}
          t={t}
        />
      ) : null}

      <UsersNotices toggleError={toggleError} notice={notice} />

      <UsersTable
        users={users}
        roles={roles}
        policies={policies}
        actions={{
          expandedId,
          toggleExpanded,
          savingId: toggleSavingId,
          requestDisable,
          toggleStatus: onToggleStatus,
          openResetPassword,
          canDelete: canManageUserTrash,
          requestDelete,
        }}
        manage={{
          error: grantError,
          saving: grantSaving,
          email: { value: editEmail, set: setEditEmail, saving: emailSaving, save: onSaveEmail },
          roleGrant: {
            options: roles,
            pendingId: pendingRoleId,
            setPendingId: setPendingRoleId,
            submit: onAssignRole,
          },
          policyGrant: {
            options: policies,
            pendingId: pendingPolicyId,
            setPendingId: setPendingPolicyId,
            submit: onAttachPolicy,
          },
        }}
        t={t}
        translate={translate}
      />

      <UserDisableDialog
        confirmingDisable={confirmingDisable}
        setConfirmingDisable={setConfirmingDisable}
        toggleSavingId={toggleSavingId}
        confirmDisable={confirmDisable}
        t={t}
      />
      <UserDeleteDialog
        confirmingDelete={confirmingDelete}
        setConfirmingDelete={setConfirmingDelete}
        deleteSaving={deleteSaving}
        confirmDelete={confirmDelete}
        t={t}
      />
      <UserResetPasswordDialog
        resetPasswordFor={resetPasswordFor}
        setResetPasswordFor={setResetPasswordFor}
        newPassword={newPassword}
        setNewPassword={setNewPassword}
        passwordError={passwordError}
        setPasswordError={setPasswordError}
        passwordSaving={passwordSaving}
        confirmResetPassword={confirmResetPassword}
        t={t}
      />
    </div>
  );
}
