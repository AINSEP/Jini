import type { AdminPolicy, AdminPolicyPermission, AdminRole } from "@jini-ai/core/contracts/site/user-management-react";
import { describeApiError, type RolesApiErrorPort } from "../rules.js";
import { t } from "../roles-i18n.js";
import type { RolesPort } from "@jini-ai/core/contracts/site/user-management-react";
import { createRolesController } from "./roles-controller.js";
import { createRoleActions, createPolicyActions } from "./roles-row-actions.js";
import { createPermissionLoader, createPermissionWriter, createPermissionRemovalActions } from "./roles-permission-actions.js";
import { useRolesState } from "./use-roles-state.hooks.js";
import { useRolesMutations } from "./use-roles-mutations.hooks.js";

/**
 * @file Everything the "Roles & Permissions" screen does, so `Roles.tsx` is only markup.
 *
 * Extracted verbatim — same state, same declaration order, same effect, same error strings. This
 * screen has no unit test today (`README.md`'s own note: "treat a change here as unverified until
 * you have driven it in a browser"), and it is the file this extraction pass exists for: a hook is
 * reachable from `renderHook` with no table, no `RowMenu`, and no `ConfirmDialog`.
 *
 * The doc comments below moved WITH the functions they describe, verbatim — several are decision
 * records (why delete now gates via `ConfirmDialog` instead of the two-click `ConfirmButton`) and a
 * comment separated from its code stops being read.
 *
 * `describeApiError` moved to `../rules` (it computes a value — an error string — rather than
 * rendering one); every handler below that used to call the module-level `describeApiError` now
 * calls the imported one instead, unchanged in every other respect.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts` and `features/posts/hooks/use-posts.hooks.ts`:
 * `use-<thing>.hooks.ts`. Feature-local because nothing outside `features/roles` needs it.
 *
 * `t`/`locale` (2026-08-11, standing i18n rule — a component with a hook gets a BOUND `t` from that
 * hook, not its own `useAdminLocale()`/dictionary import): this hook already called
 * `useAdminLocale()` for its own error-string translations, so exposing that SAME already-resolved
 * `locale` as a bound `t` (plus the raw value, still needed for `rules.ts`'s `roleMenuItems`/
 * `policyMenuItems` and `apps/admin/src/features/roles/roles-i18n.ts`'s several part-builder helpers, all of which take `locale`
 * directly) on the return value adds no new fetch — `Roles.tsx` used to call `useAdminLocale()` a
 * second time and rebuild its own `translateRoles(locale, key)` closure, entirely redundant with
 * the resolution this hook was already doing internally.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the combined roles+policies read is one `useFetchQuery`
 * keyed on `KEYS.list`; every write invalidates it instead of calling `reload()` by hand (see
 * `rules.ts`'s `KEYS` doc) — except `onWritePermission`, which never called `reload()` either, so it
 * stays a plain `useFetchMutation` with no `invalidates`.
 *
 * `rowSavingId`/`rowError` deliberately stay plain `useState`, NOT derived from any mutation's own
 * `status`/`error`: five independent writes (rename role, delete role, rename policy, delete policy,
 * write permission) share this ONE "which row is busy" id and one error slot, and a mutation object's
 * `status` has no way to carry "which row this particular call was for" the way a manually-set id
 * does. `createRoleMutation`/`createPolicyMutation` are the ones-per-mutation exception below — each
 * backs exactly one form, so `roleSaving`/`policySaving`/`roleError`/`policyError` derive from them
 * directly, same shape as every other migrated create form in this sweep.
 *
 * `useX(dependencies)` / `useWiredX()` conversion (2026-08-14): every `api.xxx()` call below is now
 * `port.xxx()` — see `@jini-ai/user-management/react` for the port and `roles-dependencies.hooks.ts` for
 * the real binding, the only file left that imports `lib/api` as a value for this feature. Same
 * "no ref/dep-array needed" note as `use-users.hooks.ts`'s identical section: every write here goes
 * through `useFetchMutation` (via `@jini-ai/ui/fetch-query`), which takes a fresh `run` closure every
 * render by design — there is no `useEffect([port])` in this file for `port` to be listed in wrongly.
 */

/** The permission row a Roles-screen "Remove" click is asking to confirm before it becomes a
 *  durable write — see {@link RolesController.pendingPermissionRemove}'s doc comment. */
export interface PendingPermissionRemove {
  policyId: string;
  row: AdminPolicyPermission;
}

export interface RolesController {
  roles: AdminRole[] | null;
  policies: AdminPolicy[] | null;
  error: string | null;
  rowError: string | null;

  roleName: string;
  setRoleName: (name: string) => void;
  roleSaving: boolean;
  roleError: string | null;
  onCreateRole: (e: React.FormEvent) => Promise<void>;

  policyName: string;
  setPolicyName: (name: string) => void;
  policyDescription: string;
  setPolicyDescription: (description: string) => void;
  policySaving: boolean;
  policyError: string | null;
  onCreatePolicy: (e: React.FormEvent) => Promise<void>;

  editingRoleId: string | null;
  setEditingRoleId: (roleId: string | null) => void;
  editingRoleName: string;
  setEditingRoleName: (name: string) => void;
  startEditRole: (role: AdminRole) => void;
  onSaveRole: (required: { roleId: string }, optional?: Record<string, never>) => Promise<void>;

  editingPolicyId: string | null;
  setEditingPolicyId: (policyId: string | null) => void;
  editingPolicyName: string;
  setEditingPolicyName: (name: string) => void;
  editingPolicyDescription: string;
  setEditingPolicyDescription: (description: string) => void;
  startEditPolicy: (policy: AdminPolicy) => void;
  onSavePolicy: (required: { policyId: string }, optional?: Record<string, never>) => Promise<void>;

  /** In-flight row action (rename, delete, or write-permission) — one at a time. */
  rowSavingId: string | null;

  permissionPolicyId: string | null;
  permissionInput: string;
  setPermissionInput: (permission: string) => void;
  resourceTypeInput: string;
  setResourceTypeInput: (resourceType: string) => void;
  togglePermissionForm: (required: { policyId: string }, optional?: Record<string, never>) => void;
  onWritePermission: (required: { policyId: string }, optional?: Record<string, never>) => Promise<void>;

  /** OQ-10 — the open policy's CURRENT permission rows, so the form can show what is already
   *  granted and offer each one a Remove. Empty whenever no form is open. Loaded on open (and
   *  re-loaded after a write or a removal) rather than with the policy list, because
   *  `listPolicies` does not carry permissions and only one policy's form is open at a time. */
  permissionRows: AdminPolicyPermission[];
  permissionsLoading: boolean;
  /** Which permission row has its removal in flight — drives that row's own busy label, not a
   *  page-wide spinner (same reasoning as `rowSavingId`). */
  removingPermissionId: string | null;
  onRemovePermission: (required: { policyId: string; policyPermissionId: string }, optional?: Record<string, never>) => Promise<void>;

  /** The permission row a Remove click is asking to confirm — `null` when the dialog is closed.
   *  Same "ConfirmDialog stays mounted, this drives its `open` prop" shape as `pendingRoleDelete`/
   *  `pendingPolicyDelete` above. Removing a permission from a policy that is currently attached to
   *  someone changes their live authority immediately, and there is no undo route open to anyone
   *  but an owner — see this file's header note on OQ-10/C1 for the lockout analysis that ruled a
   *  server-side guard unnecessary here (INV-06 + INV-08 already prevent a workspace lockout); this
   *  dialog exists for the one risk that IS reachable, a one-click self-demotion. */
  pendingPermissionRemove: PendingPermissionRemove | null;
  setPendingPermissionRemove: (target: PendingPermissionRemove | null) => void;
  onConfirmRemovePermission: () => Promise<void>;

  /** The role a `RowMenu` "Delete" selection is asking to confirm — `null` when the dialog is
   *  closed. `ConfirmDialog` stays mounted unconditionally below (see its own doc comment on why);
   *  this is what drives its `open` prop. Separate state per table since a role and a policy delete
   *  are independent operations with their own copy, not because anything shares data between them. */
  pendingRoleDelete: AdminRole | null;
  setPendingRoleDelete: (role: AdminRole | null) => void;
  onDeleteRole: () => Promise<void>;

  pendingPolicyDelete: AdminPolicy | null;
  setPendingPolicyDelete: (policy: AdminPolicy | null) => void;
  onDeletePolicy: () => Promise<void>;

  /** Bound translator — `key` already resolved against the caller's locale, so `Roles.tsx` never
   *  imports `useAdminLocale`/`roles-i18n` itself. See this file's header. */
  t: (required: { key: string }, optional?: Record<string, never>) => string;
  /** Raw resolved locale — `rules.ts`'s row-menu builders and `apps/admin/src/features/roles/roles-i18n.ts`'s part-builder
   *  helpers take `locale` directly rather than a bound translator. See this file's header. */
  locale: string;
}

/** What `useRoles` needs injected from outside — see this file's header for the conversion note. */
export interface RolesDependencies {
  port: RolesPort;
  /** The host's admin HTTP error class and default describer, for `rules.ts`'s `describeApiError`. */
  errors: RolesApiErrorPort;
  /** The host's locale hook — REQUIRED, called once per render for the bound `t`/`locale`. */
  useAdminLocale: () => string;
}

/**
 * Everything the "Roles & Permissions" screen does — full state, effects, and every server write, as
 * one hook so `Roles.tsx` stays a pure render of whatever this returns. See this file's header for
 * the `useFetchQuery`/`useFetchMutation` migration and the `port` injection it now also carries.
 *
 * @param deps - Injected collaborators; production callers get these from {@link useWiredRoles}.
 * @returns The full `RolesController` the view renders from — see that interface for every field.
 */
export function useRoles(deps: RolesDependencies, _optional: Record<string, never> = {}): RolesController {
  const {
    port, errors, locale, boundT, roles, policies, error, rowError, setRowError, roleName, setRoleName, policyName, setPolicyName, policyDescription,
    setPolicyDescription, editingRoleId, setEditingRoleId, editingRoleName, setEditingRoleName, editingPolicyId, setEditingPolicyId, editingPolicyName,
    setEditingPolicyName, editingPolicyDescription, setEditingPolicyDescription, rowSavingId, setRowSavingId, permissionPolicyId, setPermissionPolicyId,
    permissionInput, setPermissionInput, resourceTypeInput, setResourceTypeInput, permissionRows, setPermissionRows, permissionsLoading, setPermissionsLoading,
    removingPermissionId, setRemovingPermissionId, permissionsGenerationRef, permissionPolicyIdRef, pendingRoleDelete, setPendingRoleDelete, pendingPolicyDelete,
    setPendingPolicyDelete, pendingPermissionRemove, setPendingPermissionRemove,
  } = useRolesState({ deps });
  const {
    createRoleMutation, createPolicyMutation, saveRoleMutation, deleteRoleMutation, savePolicyMutation, deletePolicyMutation, writePermissionMutation,
    removePermissionMutation,
  } = useRolesMutations({ port });
  const { onCreateRole, onCreatePolicy, startEditRole, onSaveRole, onDeleteRole } = createRoleActions({
    createRoleMutation, roleName, setRoleName, createPolicyMutation, policyName, policyDescription, setPolicyName, setPolicyDescription, setRowError,
    setEditingRoleId, setEditingRoleName, setRowSavingId, saveRoleMutation, editingRoleName, locale, errors, pendingRoleDelete, deleteRoleMutation, setPendingRoleDelete,
  });
  const { startEditPolicy, onSavePolicy, onDeletePolicy } = createPolicyActions({
    setRowError, setEditingPolicyId, setEditingPolicyName, setEditingPolicyDescription, setRowSavingId, savePolicyMutation, editingPolicyName,
    editingPolicyDescription, locale, errors, pendingPolicyDelete, deletePolicyMutation, setPendingPolicyDelete,
  });
  const { loadPermissions, togglePermissionForm } = createPermissionLoader({
    permissionsGenerationRef, setPermissionsLoading, port, setPermissionRows, setRowError, locale, errors, setPermissionInput, setResourceTypeInput,
    permissionPolicyIdRef, setPermissionPolicyId,
  });
  const { onRemovePermission, onConfirmRemovePermission } = createPermissionRemovalActions({
    setRemovingPermissionId, setRowError, removePermissionMutation, permissionPolicyIdRef, loadPermissions, locale, errors, pendingPermissionRemove,
    setPendingPermissionRemove,
  });
  const { onWritePermission } = createPermissionWriter({
    permissionInput, permissionsGenerationRef, setRowSavingId, setRowError, writePermissionMutation, resourceTypeInput, setPermissionInput, setResourceTypeInput,
    permissionPolicyIdRef, loadPermissions, locale, errors,
  });

  const roleSaving = createRoleMutation.status === "pending";
  const roleError = createRoleMutation.error ? describeApiError({ e: createRoleMutation.error, fallback: t({ locale: locale, key: "failed to create role" }), locale, errors }) : null;
  const policySaving = createPolicyMutation.status === "pending";
  const policyError = createPolicyMutation.error
    ? describeApiError({ e: createPolicyMutation.error, fallback: t({ locale: locale, key: "failed to create policy" }), locale, errors })
    : null;
  return createRolesController({
    roles, policies, error, rowError, roleName, setRoleName, roleSaving, roleError, onCreateRole, policyName, setPolicyName, policyDescription,
    setPolicyDescription, policySaving, policyError, onCreatePolicy, editingRoleId, setEditingRoleId, editingRoleName, setEditingRoleName, startEditRole,
    onSaveRole, editingPolicyId, setEditingPolicyId, editingPolicyName, setEditingPolicyName, editingPolicyDescription, setEditingPolicyDescription,
    startEditPolicy, onSavePolicy, rowSavingId, permissionPolicyId, permissionInput, setPermissionInput, resourceTypeInput, setResourceTypeInput,
    togglePermissionForm, onWritePermission, permissionRows, permissionsLoading, removingPermissionId, onRemovePermission, pendingPermissionRemove,
    setPendingPermissionRemove, onConfirmRemovePermission, pendingRoleDelete, setPendingRoleDelete, onDeleteRole, pendingPolicyDelete,
    setPendingPolicyDelete, onDeletePolicy, boundT, locale,
  });
}
