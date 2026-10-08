import { Fragment, type Dispatch, type FormEvent, type SetStateAction } from "react";
import type { AdminIdentityUser, AdminPolicy, AdminRole } from "../models.js";
import { RowMenu, ConfirmDialog } from "@jini-ai/admin/react";
import { agentHandle } from "@jini-ai/agentic";
import { buildAgentListHandles } from "@jini-ai/ui/panel-kit";

import { formatGrantLabel, grantOptionLabel, userRowMenuItems, isOwnerAccount, type UserAccountCapabilities } from "./rules.js";
import { useUsers, type UsersDependencies, type UsersOptions } from "./hooks/use-users.hooks.js";
import type { ReactNode } from "react";
import type { Translate } from "@jini-ai/ui/panel-kit";
import { InfoTip } from "@jini-ai/ui/admin-widgets";
import { useResetPasswordFields } from "./hooks/use-reset-password-fields.hooks.js";

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
 * `__tests__/users-components.unit.test.tsx` for direct component-level tests of each piece.
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
export interface UsersProps extends UsersDependencies, UsersOptions {
  useUsersHook?: typeof useUsers | undefined;
  /** The host owns localization of protocol status/role labels. */
  renderServerLabel?: ((required: { value: string }) => ReactNode) | undefined;
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
      <label>
        {t("Password")}
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
        <input
          type="password"
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
      </label>
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

/** The subset of `AdminRole`/`AdminPolicy` a grant `<select>` actually renders. Named rather than
 *  taking the full records, so the shared control below cannot come to depend on anything a role has
 *  and a policy does not. */
export interface GrantOption {
  id: string;
  name: string;
  isBuiltin: boolean;
}

/** One "pick something, then grant it to this user" control. Both grants on the Manage panel are
 *  this same shape, which is what lets them share {@link GrantSelect} instead of being two
 *  near-identical blocks whose props had to be threaded separately. */
export interface GrantSelectController {
  options: GrantOption[];
  /** The id currently selected in the `<select>`, or `""` for the placeholder row. */
  pendingId: string;
  setPendingId: Dispatch<SetStateAction<string>>;
  submit: (required: { principalId: string }) => Promise<void>;
}

/**
 * Everything the expanded "Manage" panel needs, as one object.
 *
 * Replaces the fifteen loose state/setter/callback props this panel used to take and `UserRow` used
 * to relay through an `Omit<UserManagePanelProps, "principalId">` rest spread. The grouping is by
 * interaction, not by convenience: the email editor and the two grants are three independent
 * controls that happen to share one error line and one in-flight flag, and saying so in the type is
 * what lets a test build a Manage panel without also standing up a row, a table, and a page.
 */
export interface UserManageController {
  /** The one error line the whole panel shares — any of the three writes can set it. */
  error: string | null;
  /** Shared by both grants: the panel issues one grant at a time. */
  saving: boolean;
  email: {
    value: string;
    set: Dispatch<SetStateAction<string>>;
    saving: boolean;
    save: (required: { principalId: string }) => Promise<void>;
  };
  /** `null` when the caller may not read roles/policies (`UsersController.canGrant`): no grant controls. */
  roleGrant: GrantSelectController | null;
  policyGrant: GrantSelectController | null;
}

interface GrantSelectProps {
  principalId: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  grant: GrantSelectController;
  saving: boolean;
  /** Distinct handle base for this grant — `UserManagePanel` renders this component twice (role,
   *  policy), so a fixed name would collide (only one Manage panel is ever open at a time, but a
   *  hardcoded handle in a shared component still means two call sites publish the SAME handle —
   *  the exact trap this workstream's shared-component convention exists to avoid). */
  agentBase: string;
  t: (key: string) => string;
}

/** The select-plus-button both grants render. */
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
            label: `${label} — set with page.select_option, not click`,
          })}
        >
          <option value="">{placeholder}</option>
          {grant.options.map((option) => (
            <option key={option.id} value={option.id}>
              {grantOptionLabel({ option, translate: t })}
              {option.isBuiltin ? ` ${t("(built-in)")}` : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!grant.pendingId || saving}
          onClick={() => grant.submit({ principalId })}
          {...agentHandle({ handle: `${agentBase}-submit` }, { role: "button", label: `${submitLabel} the selected option to this user` })}
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
  /** The table's column count, so the panel row spans it exactly (fewer without Roles/Policies). */
  colSpan?: number;
}

/** The expanded "Manage" row's contents (email edit, role/policy grant forms).
 *
 *  Exported so a test can drive it with a hand-built {@link UserManageController} — the seam only
 *  counts as one if something other than `Users` can supply it. */
export function UserManagePanel({ principalId, manage, t, colSpan = 6 }: UserManagePanelProps) {
  return (
    <tr>
      <td colSpan={colSpan}>
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
                {...agentHandle({ handle: "user-manage-email" }, { role: "field", label: "This user's email address" })}
              />
              <button
                type="button"
                disabled={manage.email.saving}
                onClick={() => manage.email.save({ principalId })}
                {...agentHandle({ handle: "user-manage-email-save" }, { role: "button", label: "Save this user's email address" })}
              >
                {manage.email.saving ? t("Saving…") : t("Save email")}
              </button>
            </span>
          </label>
          {manage.roleGrant ? (
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
          ) : null}
          {manage.policyGrant ? (
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
          ) : null}
        </div>
      </td>
    </tr>
  );
}

/** A user row's own affordances — expand/collapse and the three menu actions. Distinct from
 *  {@link UserManageController}, which describes what the expanded panel does once it is open. */
export interface UserRowActionsController {
  expandedId: string | null;
  toggleExpanded: (user: AdminIdentityUser) => void;
  /** Which row has a status write in flight — drives that row's disabled menu item only. */
  savingId: string | null;
  requestDisable: (user: AdminIdentityUser) => void;
  toggleStatus: (user: AdminIdentityUser) => Promise<void>;
  openResetPassword: (user: AdminIdentityUser) => void;
  /** Delete-user plan v2 (2026-09-24): whether the row's `RowMenu` should carry a "Delete" item at
   *  all — see `use-users.hooks.ts`'s `canManageUserTrash` doc comment for where this comes from. */
  canDelete: boolean;
  rowCapabilities?: (user: AdminIdentityUser) => UserAccountCapabilities;
  requestDelete: (user: AdminIdentityUser) => void;
}

export interface UserRowProps {
  user: AdminIdentityUser;
  roleById: ReadonlyMap<string, AdminRole>;
  policyById: ReadonlyMap<string, AdminPolicy>;
  /** Whether the Roles/Policies cells render — see {@link UsersTableProps.showGrants}. */
  showGrants: boolean;
  actions: UserRowActionsController;
  manage: UserManageController;
  /** This row's own distinct handle base — computed once, across every rendered row, by
   *  `UsersTable` (via `buildAgentListHandles`); see `Taxonomy.tsx`'s `NewTermForm.agentBase` for
   *  why a per-instance uniqueness search does not work here. */
  agentBase: string;
  t: (key: string) => string;
  translate: Translate;
  renderServerLabel?: UsersProps["renderServerLabel"];
}

/** One user's row plus its optional expanded "Manage" row. `key` lives on the `<UserRow>` element at
 *  the call site, not inside here, since this is no longer the array-mapping callback itself. */
function UserRow({ user, roleById, policyById, showGrants, actions, manage, agentBase, t, translate, renderServerLabel }: UserRowProps) {
  const roleLabel = formatGrantLabel({ ids: user.roleIds, byId: roleById, translate });
  const policyLabel = formatGrantLabel({ ids: user.policyIds, byId: policyById });
  return (
    <>
      <tr>
        <td>
          {/* Two affordances, one behavior: this and the RowMenu's "Manage" item both
              call `toggleExpanded` directly rather than duplicating its logic. A real
              `<button>`, not `<a href="#">` — this doesn't navigate anywhere, it only
              toggles the panel below, and an anchor with no real target is its own
              accessibility smell. The visible text is the username itself, so the
              accessible name already identifies which user this manages — no need for a
              separate "Manage user ..." label duplicating what's already legible.
              `aria-expanded` mirrors `Members.tsx`'s identical email-toggle-button
              convention for the same shape of control. */}
          <button
            type="button"
            className="link-button"
            onClick={() => actions.toggleExpanded(user)}
            aria-expanded={actions.expandedId === user.principalId}
            {...agentHandle({ handle: `${agentBase}-manage` }, {
              role: "button",
              label: "Open this user's Manage panel — edit email, assign a role, attach a policy",
            })}
          >
            {user.username}
          </button>
          {isOwnerAccount({ user, roles: roleById }) ? <span className="status">{t("Owner")}</span> : null}
        </td>
        <td>{user.email ?? <span className="muted-cell">—</span>}</td>
        <td>
          <span className={`status status-${user.status}`}>{renderServerLabel?.({ value: user.status }) ?? t(user.status)}</span>
        </td>
        {showGrants ? (
          <>
            <td>{roleLabel !== null ? (renderServerLabel?.({ value: roleLabel }) ?? roleLabel) : <span className="muted-cell">{t("none")}</span>}</td>
            <td>{policyLabel !== null ? policyLabel : <span className="muted-cell">{t("none")}</span>}</td>
          </>
        ) : null}
        <td>
          {/* Matches Posts.tsx/Pages.tsx's three-dot RowMenu shape — Disable/Enable,
              Manage, and Reset password all live in the menu; there is no standalone
              button left in this column. See `rules.ts`'s `userRowMenuItems` doc comment
              for why "Manage" keeps a static label instead of alternating with "Close". */}
          <RowMenu
            triggerLabel={`${t("Actions for user")} "${user.username}"`}
            agentHandle={`${agentBase}-menu`}
            items={userRowMenuItems({
              user, toggleSaving: actions.savingId === user.principalId,
              handlers: {
                onRequestDisable: actions.requestDisable,
                onEnable: (u) => void actions.toggleStatus(u),
                onManage: actions.toggleExpanded,
                onResetPassword: actions.openResetPassword,
                onRequestDelete: actions.requestDelete,
              }, translate, canDelete: actions.canDelete,
              capabilities: actions.rowCapabilities?.(user) ?? actions.canDelete,
            })}
          />
        </td>
      </tr>
      {actions.expandedId === user.principalId ? (
        <UserManagePanel principalId={user.principalId} manage={manage} t={t} colSpan={showGrants ? 6 : 4} />
      ) : null}
    </>
  );
}

export interface UsersTableProps {
  users: AdminIdentityUser[];
  /** The full records, for the Roles/Policies label columns. The grant selects get their own
   *  `options` through `manage`, so neither consumer has to reach into the other's props. */
  roles: AdminRole[];
  policies: AdminPolicy[];
  /** `UsersController.canGrant`: without `role.manage` there are no names to resolve grant ids
   *  against, so the Roles/Policies columns are left out rather than showing raw ids. */
  showGrants: boolean;
  actions: UserRowActionsController;
  manage: UserManageController;
  t: (key: string) => string;
  translate: Translate;
  renderServerLabel?: UsersProps["renderServerLabel"];
}

/** The users table, or the empty state. Builds the role/policy lookup maps once per render rather
 *  than once per row. */
function UsersTable({ users, roles, policies, showGrants, actions, manage, t, translate, renderServerLabel }: UsersTableProps) {
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

  // Not `useMemo`d: computed after the empty-state early return above, so a `useMemo` here would
  // need hoisting above it to keep hook order stable across renders — same constraint `Media.tsx`
  // documents for its own post-early-return computation. Not worth that indirection: these three
  // maps/handles are a single O(n) pass each over one operator's own users/roles/policies (already
  // built once per render rather than once per row, per this function's own doc comment above).
  const roleById = new Map<string, AdminRole>(roles.map((role) => [role.id, role]));
  const policyById = new Map<string, AdminPolicy>(policies.map((policy) => [policy.id, policy]));
  // Principal ids are stable and unique, so they disambiguate one row's Manage toggle from
  // another's — same reasoning as every other list on this workstream.
  const rowHandles = buildAgentListHandles({ prefix: "users-row", ids: users.map((user) => user.principalId) });

  return (
    <div className="table-scroll">
      <table className="list-table">
        <thead>
          <tr>
            <th>{t("Username")}</th>
            <th>{t("Email")}</th>
            <th>{t("Status")}</th>
            {showGrants ? (
              <>
                <th>{t("Roles")}</th>
                <th>{t("Policies")}</th>
              </>
            ) : null}
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
                showGrants={showGrants}
                actions={actions}
                manage={manage}
                agentBase={rowHandles[index]!}
                t={t}
                translate={translate}
        renderServerLabel={renderServerLabel}
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

/** Open-eye glyph — standard "reveal" affordance, shown while a `RevealablePasswordField` is
 *  hidden (click to show). House stroke-icon convention (`viewBox="0 0 18 18"`, `fill="none"`,
 *  `stroke="currentColor"`, `strokeWidth={1.5}`, `aria-hidden`) — same shape `Media.tsx`'s
 *  `PlaceholderIcon`/`ExpandIcon`/`CloseIcon` and `nav.ts`'s panel icons use throughout this app. */
function EyeIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M1.5 9S4.5 4 9 4s7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5Z" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="2" />
    </svg>
  );
}

/** Same glyph with a slash through it — standard "hide" affordance, shown while the field is
 *  currently revealed (click to hide). */
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
 *  not a text "Show"/"Hide" link): the accessible name still flips between "Show password"/"Hide
 *  password" via `aria-label` (screen reader), and `aria-pressed` mirrors `visible` so assistive
 *  tech gets the same on/off signal a text label would have given.
 *
 *  The input's inline `flex`/`minWidth` override neutralizes `styles.css`'s `.field input { width:
 *  100% }` fighting the toggle button for room inside the `.editor-actions` row below — an inline
 *  style wins on specificity without adding a new class to a stylesheet this feature doesn't own. */
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
        <button
          type="button"
          className="link-button"
          aria-label={toggleLabel}
          aria-pressed={visible}
          title={toggleLabel}
          onClick={onToggleVisible}
          {...agentHandle({ handle: `${agentBase}-reveal` }, { role: "button", label: `Show or hide the ${label.toLowerCase()} field's characters` })}
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
  /** Injectable seam for the confirm-field + reveal-toggle state. Defaults to the real
   *  {@link useResetPasswordFields}. */
  useFields?: typeof useResetPasswordFields;
}

/** Resolves `useFields` to the real hook when no override is passed, because ESLint's
 *  cyclomatic-complexity rule counts a default parameter value evaluated inside a function's OWN
 *  body as one of that function's own branches; a call out to a separately-scoped resolver does
 *  not. */
function resolveResetPasswordFieldsHook(
  override: typeof useResetPasswordFields | undefined,
): typeof useResetPasswordFields {
  return override ?? useResetPasswordFields;
}

/** The reset-password dialog — extracted from `Users` verbatim, since extended with the confirm
 *  field and both reveal toggles (see this file's header). */
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

  /** Blocks the reset entirely when the two fields disagree — a mismatch never reaches
   *  `confirmResetPassword`/the server. The inline message below is driven by the same `mismatch`
   *  value, so it is already visible by the time a blocked click can happen; there is nothing
   *  further to surface here. */
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

export function Users({ useUsersHook = useUsers, port, translate: injectedTranslate, queryScope,
  openOwnPasswordReset, onOwnPasswordResetClosed, passwordResetNotice, renderServerLabel }: UsersProps) {
  const {
    users,
    roles,
    policies,
    canGrant,
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
    rowCapabilities,
    confirmingDelete,
    setConfirmingDelete,
    requestDelete,
    deleteSaving,
    confirmDelete,

    t,
    translate,
  } = useUsersHook({ port, translate: injectedTranslate, queryScope }, {
    openOwnPasswordReset, onOwnPasswordResetClosed, passwordResetNotice,
  });

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
        showGrants={canGrant}
        actions={{
          expandedId,
          toggleExpanded,
          savingId: toggleSavingId,
          requestDisable,
          toggleStatus: onToggleStatus,
          openResetPassword,
          canDelete: canManageUserTrash,
          rowCapabilities,
          requestDelete,
        }}
        manage={{
          error: grantError,
          saving: grantSaving,
          email: { value: editEmail, set: setEditEmail, saving: emailSaving, save: onSaveEmail },
          roleGrant: canGrant
            ? { options: roles, pendingId: pendingRoleId, setPendingId: setPendingRoleId, submit: onAssignRole }
            : null,
          policyGrant: canGrant
            ? { options: policies, pendingId: pendingPolicyId, setPendingId: setPendingPolicyId, submit: onAttachPolicy }
            : null,
        }}
        t={t}
        translate={translate}
        renderServerLabel={renderServerLabel}
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
