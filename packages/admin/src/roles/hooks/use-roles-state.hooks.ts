import { useRef, useState } from "react";
import type { AdminPolicyPermission, AdminRole, AdminPolicy } from "@jini-ai/core/contracts/site/user-management-react";
import { useFetchQuery } from "../../react/kit.js";
import { KEYS } from "../rules.js";
import { describeApiError } from "../rules.js";
import { t } from "../roles-i18n.js";
import type { useRoles, PendingPermissionRemove } from "./use-roles.hooks.js";

export function useRolesState(
  { deps }:
    { deps: Parameters<typeof useRoles>[0] },
  _optional: Record<string, never> = {},
) {
  const { port, errors, useAdminLocale } = deps;
  const locale = useAdminLocale();
  const boundT = ({ key }: { key: string }, _optional: Record<string, never> = {}): string => t({ locale: locale, key: key });

  const list = useFetchQuery({
    key: KEYS.list,
    fetch: async () => {
      const [r, p] = await Promise.all([port.listRoles({}), port.listPolicies({})]);
      return { roles: r.roles, policies: p.policies };
    },
  });
  const roles = list.data?.roles ?? null;
  const policies = list.data?.policies ?? null;
  const error = list.error ? describeApiError({ e: list.error, fallback: t({ locale: locale, key: "failed to load roles/policies" }), locale, errors }) : null;

  const [rowError, setRowError] = useState<string | null>(null);

  const [roleName, setRoleName] = useState("");
  const [policyName, setPolicyName] = useState("");
  const [policyDescription, setPolicyDescription] = useState("");

  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingRoleName, setEditingRoleName] = useState("");
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [editingPolicyName, setEditingPolicyName] = useState("");
  const [editingPolicyDescription, setEditingPolicyDescription] = useState("");
  const [rowSavingId, setRowSavingId] = useState<string | null>(null);

  const [permissionPolicyId, setPermissionPolicyId] = useState<string | null>(null);
  const [permissionInput, setPermissionInput] = useState("");
  const [resourceTypeInput, setResourceTypeInput] = useState("");
  const [permissionRows, setPermissionRows] = useState<AdminPolicyPermission[]>([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [removingPermissionId, setRemovingPermissionId] = useState<string | null>(null);
  // Monotonic per-call id (same shape as `use-theme-explore.hooks.ts`'s `renameSettlement` /
  // `use-themes.hooks.ts`'s `activateSettlement`/`downloadSettlement`, though this ref is NOT itself
  // extracted into `useSettlementGeneration` — see that hook's own doc for why): `togglePermissionForm`
  // (opening a different policy) and `onWritePermission`/`onRemovePermission` (their own trailing
  // refresh) all funnel into `loadPermissions` with no guard against a SECOND call — for a DIFFERENT
  // policy — starting before the first settles, and network completion order does not have to match
  // start order. Minted synchronously at the top of `loadPermissions` so two loads started back to
  // back always mint in the order they started even though both are async — a stale settlement
  // (checked before every state write below, not just the success path, since an out-of-order
  // FAILURE would otherwise resurrect a stale error over a newer load's real outcome — `rowError` is
  // one shared field across every action in this hook) is dropped instead of overwriting whichever
  // policy's rows the operator is actually looking at now.
  const permissionsGenerationRef = useRef(0);
  // C2 (N1 fix) — which policy's panel is actually open right now, so `onWritePermission`'s and
  // `onRemovePermission`'s trailing `loadPermissions(policyId)` can tell "the operator switched to a
  // DIFFERENT policy's panel while my write was in flight" apart from "still on the same panel".
  // `permissionsGenerationRef` cannot express this: the trailing refresh mints the NEWEST generation
  // by construction (it starts after the write that preceded it), so it always wins even when the
  // panel has moved on — that was the actual bug (see the trailing-refresh call sites below). A ref
  // holding the CURRENTLY open policy id is an equality check ("is the panel still on policy X"),
  // not an ordering check ("was this the latest call") — same "activeEntityRef" idiom as
  // `use-widget-instance-editor`'s `activeEntityRef` and `use-term-detail-panel`'s
  // `activeTermIdRef`. Written only by `togglePermissionForm`.
  const permissionPolicyIdRef = useRef<string | null>(null);

  // The row a `RowMenu` "Delete" selection is asking to confirm — `null` when the dialog is
  // closed. `ConfirmDialog` stays mounted unconditionally below (see its own doc comment on why);
  // this is what drives its `open` prop. Separate state per table since a role and a policy delete
  // are independent operations with their own copy, not because anything shares data between them.
  const [pendingRoleDelete, setPendingRoleDelete] = useState<AdminRole | null>(null);
  const [pendingPolicyDelete, setPendingPolicyDelete] = useState<AdminPolicy | null>(null);
  const [pendingPermissionRemove, setPendingPermissionRemove] = useState<PendingPermissionRemove | null>(null);
  return {
    port, errors, locale, boundT, roles, policies, error, rowError, setRowError, roleName, setRoleName, policyName, setPolicyName, policyDescription,
    setPolicyDescription, editingRoleId, setEditingRoleId, editingRoleName, setEditingRoleName, editingPolicyId, setEditingPolicyId, editingPolicyName,
    setEditingPolicyName, editingPolicyDescription, setEditingPolicyDescription, rowSavingId, setRowSavingId, permissionPolicyId, setPermissionPolicyId,
    permissionInput, setPermissionInput, resourceTypeInput, setResourceTypeInput, permissionRows, setPermissionRows, permissionsLoading, setPermissionsLoading,
    removingPermissionId, setRemovingPermissionId, permissionsGenerationRef, permissionPolicyIdRef, pendingRoleDelete, setPendingRoleDelete, pendingPolicyDelete,
    setPendingPolicyDelete, pendingPermissionRemove, setPendingPermissionRemove,
  };
}
