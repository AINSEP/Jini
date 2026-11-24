import type { AdminPolicy, AdminRole } from "@jini-ai/core/contracts/site/user-management-react";
import { TabBar } from "../react/kit.js";
import type { RolesController as RolesHookController } from "./hooks/use-roles.hooks.js";
import { resolveRolesTabId, resolveRolesTabs, type RolesTabId } from "./Roles.hooks.js";
import { rolesDescriptionParts } from "./i18n/roles-sentence-parts.js";
import { RolesSection } from "./RolesSection.js";
import { PoliciesSection } from "./PoliciesSection.js";
import { RoleDeleteDialog, PolicyDeleteDialog, PermissionRemoveDialog } from "./RoleConfirmDialogs.js";

/**
 * @file "Roles & Permissions" screen (SPEC-006 + 0.6.0 CRUD-completion amendment) — the
 * `/admin/roles` route. Markup only.
 *
 * State and API calls live in `hooks/use-roles.hooks.ts`; the row-menu logic and the
 * `RESOURCE_CONFLICT`-etc. error copy live in `rules.ts`.
 *
 * Lists roles and policies, creates new ones (`CREATE_ROLE`/`CREATE_POLICY`), and (0.6.0) renames
 * (`UPDATE_ROLE`/`UPDATE_POLICY`), deletes (`DELETE_ROLE`/`DELETE_POLICY`), and — for policies —
 * writes a permission onto a custom policy (`WRITE_POLICY_PERMISSION`, closing the gap this
 * screen's own prior header comment flagged: "granting individual permission strings to a custom
 * policy has no admin route yet"). Every mutating action here is a plain button/inline form, no
 * dedicated edit mode — matches this screen's existing utilitarian style. Role/policy -> user grant
 * assignment stays on `Users.tsx`'s "Manage" row, not duplicated here. Built-in rows never show
 * rename/delete controls (the backend refuses them anyway, INV-06 — hiding the control avoids a
 * guaranteed-failing click).
 *
 * Scope note (RESOLVED 2026-08-24, was OQ-10): removing a single permission from a policy used to
 * have no transition, so the only way to shrink a policy's permission set was delete (only when
 * unused) + recreate — a dead end for a referenced policy, which INV-09 refuses to delete.
 * `REMOVE_POLICY_PERMISSION` closes that. The same inline panel that adds a permission now also
 * lists the policy's current ones and offers each a Remove; listing them at all is new too, since
 * `AdminPolicy` carries no permissions field and nothing previously exposed a row id. (2026-09-20,
 * C1): each Remove now asks first, via a shell `ConfirmDialog`, before the write goes through.
 *
 * Complexity-ceiling pass (2026-08-06): `Roles` and its policy-row map closure both scored over
 * the ceiling (18/10 and 13/13 — one over-sized "Policies" table section reported as two separate
 * numbers, per the brief for this pass). Split into `RolesSection`, `PoliciesSection`/`PolicyRow`,
 * and the two delete dialogs, same top-level-function convention `Users.tsx`/`Taxonomy.tsx` use —
 * a nested closure would not have moved any branching out of `Roles`' own scope, only a sibling
 * function does.
 *
 * ## Tabs (2026-09-06)
 *
 * The two sections are now two `?tab=` tabs on the shared `@jini-ai/ui/tab-strip`, the same primitive
 * `Deployment.tsx`, `Sites.tsx`, `Themes.tsx`, `Security.tsx`, `SourceControl.tsx` and
 * `Database.tsx` already use — the tab shell was ALREADY extracted, so this screen reuses it
 * rather than becoming another implementation. Why two tabs, and the case AGAINST them that was
 * checked first, are in `Roles.hooks.tsx`'s header. Both labels reuse the existing section
 * headings' i18n keys, so the conversion adds no new copy strings.
 *
 * `RolesSection` and `PoliciesSection` are untouched; `RolesTab`/`PoliciesTab` below are thin
 * wrappers holding the prop assembly that used to sit inline in `Roles`'s JSX. Three things stay
 * on the SHELL rather than moving into a panel, each for a stated reason: the page header, the
 * `rowError` banner (set by both sections — `useWiredRoles` keeps one `rowSavingId`/`rowError`
 * pair for roles and policies alike), and both delete dialogs (a confirm dialog is an overlay over
 * the whole page, and its pending state is shell state).
 */



export interface RolesProps {
  /** The `?tab=` query value from `panels.tsx`'s `roles` route (`URLSearchParams.get` returns
   *  `null` when the param is absent). Guarded by `resolveRolesTabId`, so a stale link or a typo
   *  opens the Roles list rather than a blank panel. */
  tabId?: string | null;
  /** The screen's controller hook — REQUIRED: the host binds it (a wrapper that
   *  composes `useRoles` with the host's live port, error port and locale hook); tests pass a fake. The
   *  same seam convention `@jini-ai/ui`'s `CustomSelect` uses for `useCustomSelect`. */
  useRolesHook: () => RolesHookController;
  /** The host's `?tab=` navigation, bound to the tab strip's `onChange`. */
  goToTab: (required: { tabId: string }) => void;
  /** The host's route to the users screen, linked from the page description. */
  usersHref: string;
}

/** Everything the two tab panels read, which is simply what `useWiredRoles()` returns — the same
 *  `ReturnType<typeof ...>` shape `Sites.tsx`'s own `sitesTabPanel` takes, rather than a
 *  hand-maintained mirror of a thirty-field controller that would drift the first time the hook
 *  grows a field. */
type RolesController = ReturnType<RolesProps["useRolesHook"]>;

/**
 * The "Roles" tab panel — `RolesSection` with the five controller fields it needs, assembled here
 * rather than in `Roles`'s own JSX.
 *
 * The assembly is a straight relocation of what `Roles` used to write inline; nothing about the
 * props changed. It lives in its own component so the two panels can be selected by a flat
 * dispatcher below without `Roles` carrying either branch, which is what the ESLint gate scores.
 * `roles` is non-null by the time this renders — `Roles` returns its loading notice above — so
 * it arrives as its own, already-narrowed prop.
 */
function RolesTab({ controller, roles }: { controller: RolesController; roles: AdminRole[] }) {
  const c = controller;
  return (
    <RolesSection
      roles={roles}
      create={{
        name: c.roleName,
        setName: c.setRoleName,
        saving: c.roleSaving,
        error: c.roleError,
        submit: c.onCreateRole,
      }}
      row={{
        editingId: c.editingRoleId,
        setEditingId: c.setEditingRoleId,
        draftName: c.editingRoleName,
        setDraftName: c.setEditingRoleName,
        startRename: c.startEditRole,
        saveRename: c.onSaveRole,
        savingId: c.rowSavingId,
        requestDelete: c.setPendingRoleDelete,
      }}
      t={c.t}
      locale={c.locale}
    />
  );
}

/** The "Policies" tab panel — `PoliciesSection` with its three controller groups, relocated
 *  verbatim from `Roles`'s own JSX for the same reason {@link RolesTab} documents. */
function PoliciesTab({ controller, policies }: { controller: RolesController; policies: AdminPolicy[] }) {
  const c = controller;
  return (
    <PoliciesSection
      policies={policies}
      create={{
        name: c.policyName,
        setName: c.setPolicyName,
        description: c.policyDescription,
        setDescription: c.setPolicyDescription,
        saving: c.policySaving,
        error: c.policyError,
        submit: c.onCreatePolicy,
      }}
      row={{
        editingId: c.editingPolicyId,
        setEditingId: c.setEditingPolicyId,
        draftName: c.editingPolicyName,
        setDraftName: c.setEditingPolicyName,
        draftDescription: c.editingPolicyDescription,
        setDraftDescription: c.setEditingPolicyDescription,
        startRename: c.startEditPolicy,
        saveRename: c.onSavePolicy,
        savingId: c.rowSavingId,
        requestDelete: c.setPendingPolicyDelete,
      }}
      permission={{
        openForPolicyId: c.permissionPolicyId,
        permission: c.permissionInput,
        setPermission: c.setPermissionInput,
        resourceType: c.resourceTypeInput,
        setResourceType: c.setResourceTypeInput,
        toggleForm: c.togglePermissionForm,
        write: c.onWritePermission,
        rows: c.permissionRows,
        loading: c.permissionsLoading,
        removingId: c.removingPermissionId,
        requestRemove: c.setPendingPermissionRemove,
      }}
      t={c.t}
      locale={c.locale}
    />
  );
}

/** Dispatches the one active tab's panel as a flat if-chain — a plain function rather than a
 *  ternary written directly in `Roles`'s JSX, which would be counted against that component's own
 *  complexity. Same split `Deployment.tsx`'s `deploymentTabPanel` and `Sites.tsx`'s `sitesTabPanel`
 *  make for the identical gate.
 *  @complexity O(1) — two mutually exclusive branches, no iteration. */
function rolesTabPanel(
  { activeTabId, controller, lists }: { activeTabId: RolesTabId; controller: RolesController; lists: { roles: AdminRole[]; policies: AdminPolicy[] } },
  _options: Record<string, never> = {},
) {
  if (activeTabId === "policies") return <PoliciesTab controller={controller} policies={lists.policies} />;
  return <RolesTab controller={controller} roles={lists.roles} />;
}

export function Roles({ tabId, useRolesHook, goToTab, usersHref }: RolesProps) {
  // ONE call, destructured from its result — `useRolesHook()` must not be invoked a second time
  // for the shell's own fields, which would run the whole hook (and its fetches and state) twice
  // per render. The forty-odd per-section fields this used to destructure are read by `RolesTab`/
  // `PoliciesTab` off `controller` directly now, so only what the shell itself renders is named
  // here: the two lists it guards on, the page-level banners, and the two delete dialogs.
  const controller = useRolesHook();
  const {
    roles,
    policies,
    error,
    rowError,
    rowSavingId,
    pendingRoleDelete,
    setPendingRoleDelete,
    onDeleteRole,
    pendingPolicyDelete,
    setPendingPolicyDelete,
    onDeletePolicy,
    pendingPermissionRemove,
    setPendingPermissionRemove,
    removingPermissionId,
    onConfirmRemovePermission,
    t,
    locale,
  } = controller;
  const { prefix: descriptionPrefix, linkLabel: descriptionLinkLabel, suffix: descriptionSuffix } =
    rolesDescriptionParts({ locale });

  if (error) return <div className="jini-notice jini-notice-error">{error}</div>;
  if (!roles || !policies) return <div className="jini-notice">{t({ key: "Loading roles & permissions…" })}</div>;

  const activeTabId = resolveRolesTabId({ tabId: tabId });

  return (
    <div className="jini-page">
      <div className="jini-page-header">
        <div className="jini-page-header-text">
          <p className="jini-page-kicker">{t({ key: "People" })}</p>
          <h1 className="jini-page-title">{t({ key: "Roles & Permissions" })}</h1>
          <p className="jini-page-description">
            {descriptionPrefix}
            <a href={usersHref}>{descriptionLinkLabel}</a>
            {descriptionSuffix}
          </p>
        </div>
      </div>
      {/* The row-error banner stays on the SHELL, above the tab strip: `rowError` is set by BOTH
          sections' row actions (`useWiredRoles` keeps one `rowSavingId`/`rowError` pair for roles
          and policies alike), so it does not belong to either panel. */}
      {rowError ? <div className="jini-notice jini-notice-error">{rowError}</div> : null}

      <TabBar
        ariaLabel={t({ key: "Roles & Permissions" })}
        tabs={resolveRolesTabs({ t: (key) => t({ key }) })}
        activeId={activeTabId}
        onChange={(tabId) => goToTab({ tabId })}
        containerHandle="roles-tab-bar"
      />
      {rolesTabPanel({ activeTabId: activeTabId, controller: controller, lists: { roles, policies } })}

      <RoleDeleteDialog
        pendingRoleDelete={pendingRoleDelete}
        setPendingRoleDelete={setPendingRoleDelete}
        rowSavingId={rowSavingId}
        t={t}
        locale={locale}
        onDeleteRole={onDeleteRole}
      />
      <PolicyDeleteDialog
        pendingPolicyDelete={pendingPolicyDelete}
        setPendingPolicyDelete={setPendingPolicyDelete}
        rowSavingId={rowSavingId}
        t={t}
        locale={locale}
        onDeletePolicy={onDeletePolicy}
      />
      <PermissionRemoveDialog
        pendingPermissionRemove={pendingPermissionRemove}
        setPendingPermissionRemove={setPendingPermissionRemove}
        removingPermissionId={removingPermissionId}
        onConfirmRemovePermission={onConfirmRemovePermission}
        t={t}
        locale={locale}
      />
    </div>
  );
}
