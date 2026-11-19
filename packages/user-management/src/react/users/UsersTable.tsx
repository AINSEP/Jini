import type { Dispatch, SetStateAction } from 'react';
import type { Translate } from '@jini-ai/core/text';
import { agentHandle, buildAgentListHandles } from '@jini-ai/core/agent-handles';
import type { AdminIdentityUser, AdminRole, AdminPolicy } from '../models.js';
import { RowMenu, InfoTip } from '../kit.js';
import { grantOptionLabel, type UserAccountCapabilities } from './rules.js';
import { UserGrantCells, UserNameCell, UserStatusCell, userRowMenuItemsFor } from './UserRowParts.js';
import type { UsersController } from './hooks/use-users.hooks.js';
import type { UsersProps } from './Users.js';

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
          <UserManageEmailEditor principalId={principalId} manage={manage} t={t} />
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
  renameUserHandler?: UsersController["renameUserHandler"];
  /** Delete-user plan v2 (2026-09-24): whether the row's `RowMenu` should carry a "Delete" item at
   *  all — see `use-users.hooks.ts`'s `canManageUserTrash` doc comment for where this comes from. */
  canDelete: boolean;
  rowCapabilities?: (user: AdminIdentityUser) => UserAccountCapabilities;
  requestDelete: (user: AdminIdentityUser) => void;
}

export interface UserRowProps {
  user: AdminIdentityUser;
  isOwn?: boolean;
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
function UserRow({ user, isOwn, roleById, policyById, showGrants, actions, manage, agentBase, t, translate, renderServerLabel }: UserRowProps) {
  const expanded = actions.expandedId === user.principalId;
  return (
    <>
      <tr aria-current={isOwn ? "true" : undefined}>
        <UserNameCell user={user} isOwn={isOwn} expanded={expanded} onToggle={actions.toggleExpanded} agentBase={agentBase} t={t} />
        <td>{user.email ?? <span className="muted-cell">—</span>}</td>
        <UserStatusCell status={user.status} t={t} renderServerLabel={renderServerLabel} />
        {showGrants ? (
          <UserGrantCells user={user} roleById={roleById} policyById={policyById} t={t} translate={translate} renderServerLabel={renderServerLabel} />
        ) : null}
        <td>
          {/* Matches Posts.tsx/Pages.tsx's three-dot RowMenu shape — Disable/Enable,
              Manage, and Reset password all live in the menu; there is no standalone
              button left in this column. See `rules.ts`'s `userRowMenuItems` doc comment
              for why "Manage" keeps a static label instead of alternating with "Close". */}
          <RowMenu
            triggerLabel={`${t("Actions for user")} "${user.username}"`}
            agentHandle={`${agentBase}-menu`}
            items={userRowMenuItemsFor({ user, actions, translate })}
          />
        </td>
      </tr>
      {expanded ? (
        <UserManagePanel principalId={user.principalId} manage={manage} t={t} colSpan={showGrants ? 6 : 4} />
      ) : null}
    </>
  );
}

export interface UsersTableProps {
  users: AdminIdentityUser[];
  ownPrincipalId?: string | undefined;
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
export function UsersTable({ users, ownPrincipalId, roles, policies, showGrants, actions, manage, t, translate, renderServerLabel }: UsersTableProps) {
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
        <UsersTableHeader showGrants={showGrants} t={t} />
        <tbody>
          {users.map((user, index) => (
            <UserRow key={user.principalId} user={user} isOwn={user.principalId === ownPrincipalId}
              roleById={roleById} policyById={policyById} showGrants={showGrants} actions={actions} manage={manage}
              agentBase={rowHandles[index]!} t={t} translate={translate} renderServerLabel={renderServerLabel} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsersTableHeader({ showGrants, t }: { showGrants: boolean; t: (key: string) => string }) {
  return (
        <thead>
          <tr>
            <th>{t("Username")}</th>
            <th>{t("Email")}</th>
            <th>{t("Status")}</th>
            {showGrants ? (
              <>
                <th data-label={t("Roles")}>
                  {t("Roles")}
                  {/* Built-in grants are defined in server/seed.ts. */}
                  <InfoTip
                    triggerLabel={t("About roles")}
                    label={[
                      t("• Owner — full control, including users and site keys."),
                      t("• Admin — manage content, settings, site keys, and roles within their permissions."),
                      t("• Editor — edit, publish, and delete content; upload, edit, and trash media; switch themes."),
                      t("• Viewer — read content, changes, and plugin information."),
                    ].join("\n")}
                  />
                </th>
                <th>{t("Policies")}</th>
              </>
            ) : null}
            <th>{t("More")}</th>
          </tr>
        </thead>
  );
}
function UserManageEmailEditor({ principalId, manage, t }: Pick<UserManagePanelProps, 'principalId' | 'manage' | 't'>) {
  return (
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
  );
}
