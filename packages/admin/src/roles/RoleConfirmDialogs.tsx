import { ConfirmDialog } from "../react/index.js";

import type { AdminPolicy, AdminRole } from "@jini-ai/core/contracts/site/user-management-react";
import { type PendingPermissionRemove } from "./hooks/use-roles.hooks.js";
import { roleDeleteBodyParts, policyDeleteBodyParts, permissionRemoveBodyParts } from "./i18n/roles-sentence-parts.js";


interface RoleDeleteDialogProps {
  pendingRoleDelete: AdminRole | null;
  setPendingRoleDelete: (role: AdminRole | null) => void;
  rowSavingId: string | null;
  onDeleteRole: () => Promise<void>;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
  locale: string;
}

/** The role-delete confirm dialog — extracted from `Roles` verbatim. */
export function RoleDeleteDialog({ pendingRoleDelete, setPendingRoleDelete, rowSavingId, onDeleteRole, t, locale }: RoleDeleteDialogProps) {
  const { prefix, suffix } = roleDeleteBodyParts({ locale });
  return (
    <ConfirmDialog
      open={pendingRoleDelete !== null}
      agentHandle="roles-delete-role"
      title={t({ key: "Delete role?" })}
      body={
        pendingRoleDelete ? (
          <p>
            {prefix}
            {pendingRoleDelete.name}
            {suffix}
          </p>
        ) : null
      }
      confirmLabel={t({ key: "Delete" })}
      destructive
      pending={pendingRoleDelete !== null && rowSavingId === pendingRoleDelete.id}
      onConfirm={onDeleteRole}
      onCancel={() => setPendingRoleDelete(null)}
    />
  );
}

interface PolicyDeleteDialogProps {
  pendingPolicyDelete: AdminPolicy | null;
  setPendingPolicyDelete: (policy: AdminPolicy | null) => void;
  rowSavingId: string | null;
  onDeletePolicy: () => Promise<void>;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
  locale: string;
}

/** The policy-delete confirm dialog — extracted from `Roles` verbatim. */
export function PolicyDeleteDialog({ pendingPolicyDelete, setPendingPolicyDelete, rowSavingId, onDeletePolicy, t, locale }: PolicyDeleteDialogProps) {
  const { prefix, suffix } = policyDeleteBodyParts({ locale });
  return (
    <ConfirmDialog
      open={pendingPolicyDelete !== null}
      agentHandle="roles-delete-policy"
      title={t({ key: "Delete policy?" })}
      body={
        pendingPolicyDelete ? (
          <p>
            {prefix}
            {pendingPolicyDelete.name}
            {suffix}
          </p>
        ) : null
      }
      confirmLabel={t({ key: "Delete" })}
      destructive
      pending={pendingPolicyDelete !== null && rowSavingId === pendingPolicyDelete.id}
      onConfirm={onDeletePolicy}
      onCancel={() => setPendingPolicyDelete(null)}
    />
  );
}

interface PermissionRemoveDialogProps {
  pendingPermissionRemove: PendingPermissionRemove | null;
  setPendingPermissionRemove: (target: PendingPermissionRemove | null) => void;
  removingPermissionId: string | null;
  onConfirmRemovePermission: () => Promise<void>;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
  locale: string;
}

/** The permission-remove confirm dialog (C1) — same "own the whole sentence per locale" shape as
 *  {@link RoleDeleteDialog}/{@link PolicyDeleteDialog}, `tone="warning"` rather than `destructive`
 *  because the action is reversible (an owner can re-add the permission), matching Users' Disable.
 *  See `use-roles.hooks.ts`'s `pendingPermissionRemove` doc comment for the lockout analysis this
 *  dialog exists to cover. */
export function PermissionRemoveDialog({
  pendingPermissionRemove,
  setPendingPermissionRemove,
  removingPermissionId,
  onConfirmRemovePermission,
  t,
  locale,
}: PermissionRemoveDialogProps) {
  const { prefix, suffix } = permissionRemoveBodyParts({ locale });
  const pending = pendingPermissionRemove;
  return (
    <ConfirmDialog
      open={pending !== null}
      agentHandle="roles-remove-permission"
      title={t({ key: "Remove permission?" })}
      body={
        pending ? (
          <p>
            {prefix}
            <code>{pending.row.permission}</code>
            {pending.row.resourceType ? ` (${pending.row.resourceType})` : ""}
            {suffix}
          </p>
        ) : null
      }
      confirmLabel={t({ key: "Remove" })}
      tone="warning"
      pending={pending !== null && removingPermissionId === pending.row.id}
      onConfirm={onConfirmRemovePermission}
      onCancel={() => setPendingPermissionRemove(null)}
    />
  );
}
