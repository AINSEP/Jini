import { RowMenu } from "../react/components/RowMenu/RowMenu.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { AdminPolicy, AdminPolicyPermission } from "@jini-ai/core/contracts/site/user-management-react";
import { policyMenuItems } from "./rules.js";
import { type PendingPermissionRemove } from "./hooks/use-roles.hooks.js";
import { PolicyPermissionForm } from "./PolicyPermissionForm.js";


/** A policy row's own affordances — {@link RoleRowController}'s counterpart, with the extra
 *  description field a policy carries. */
export interface PolicyRowController {
  /** Which policy is mid-rename, or `null`. */
  editingId: string | null;
  setEditingId: (policyId: string | null) => void;
  draftName: string;
  setDraftName: (name: string) => void;
  draftDescription: string;
  setDraftDescription: (description: string) => void;
  startRename: (policy: AdminPolicy) => void;
  saveRename: (required: { policyId: string }, optional?: Record<string, never>) => Promise<void>;
  savingId: string | null;
  requestDelete: (policy: AdminPolicy | null) => void;
}

/** The inline "Add permission" editor: which row it is open on, its two fields, and its write.
 *  Separate from {@link PolicyRowController} because it is a different interaction on the same row —
 *  a row can be mid-rename or mid-permission, and neither controller's state means anything to the
 *  other. */
export interface PolicyPermissionController {
  /** The policy whose permission form is open, or `null` when none is. */
  openForPolicyId: string | null;
  permission: string;
  setPermission: (permission: string) => void;
  resourceType: string;
  setResourceType: (resourceType: string) => void;
  toggleForm: (required: { policyId: string }, optional?: Record<string, never>) => void;
  write: (required: { policyId: string }, optional?: Record<string, never>) => Promise<void>;
  /** The open policy's current permission rows, and the removal of one (OQ-10). Part of THIS
   *  controller rather than {@link PolicyRowController} because the list is only ever shown inside
   *  this same panel — it opens, loads, and closes with the add form. */
  rows: AdminPolicyPermission[];
  loading: boolean;
  removingId: string | null;
  /** Stages a removal for confirmation (C1) rather than removing directly — no UI path can reach
   *  the unconfirmed write once this replaces a direct `remove` callback on the component contract. */
  requestRemove: (target: PendingPermissionRemove) => void;
}

export interface PolicyRowProps {
  policy: AdminPolicy;
  row: PolicyRowController;
  permission: PolicyPermissionController;
  /** This row's own distinct handle base — computed once, across every rendered policy, by
   *  `PoliciesSection` (via `buildAgentListHandles`); see `Users.tsx`'s `UserRowProps.agentBase`
   *  for why a per-instance uniqueness search does not work here. */
  agentBase: string;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
  locale: string;
}

interface PolicyRowActionsProps {
  policy: AdminPolicy;
  row: PolicyRowController;
  permission: PolicyPermissionController;
  agentBase: string;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
  locale: string;
}

/** The "More" cell's three-way branch (built-in/frozen -> dash, mid-rename -> Save/Cancel,
 *  at-rest -> `RowMenu`) — extracted out of `PolicyRow`, which was still 13/13 after the first
 *  split pass because this cell's own branches (the `||` guard plus its two nested ternaries) were
 *  still counted in `PolicyRow`'s scope. Same "the panel, not the row, was the actual size" lesson
 *  `Users.tsx`'s `UserRow` -> `UserManagePanel` split already applied. */
function PolicyRowActions({ policy, row, permission, agentBase, t, locale }: PolicyRowActionsProps) {
  if (policy.isBuiltin || policy.isFrozen) return <span className="jini-roles-muted-cell">—</span>;
  if (row.editingId === policy.id) {
    return (
      <span className="jini-editor-actions">
        <button
          type="button"
          disabled={row.savingId === policy.id}
          onClick={() => row.saveRename({ policyId: policy.id })}
          {...agentHandle({ handle: `${agentBase}-save` }, { role: "button", label: "Save this policy's new name and description" })}
        >
          {row.savingId === policy.id ? t({ key: "Saving…" }) : t({ key: "Save" })}
        </button>
        <button
          type="button"
          onClick={() => row.setEditingId(null)}
          {...agentHandle({ handle: `${agentBase}-cancel` }, { role: "button", label: "Cancel renaming this policy" })}
        >
          {t({ key: "Cancel" })}
        </button>
      </span>
    );
  }
  return (
    <RowMenu
      triggerLabel={`${t({ key: "Actions for policy" })} "${policy.name}"`}
      agentHandle={`${agentBase}-menu`}
      items={policyMenuItems({
        policy,
        permissionPolicyId: permission.openForPolicyId,
        handlers: {
          onRename: row.startRename,
          onTogglePermissionForm: permission.toggleForm,
          onDelete: row.requestDelete,
        },
        locale,
      })}
    />
  );
}

/** One policy's row plus its optional inline "Add permission" row. `key` lives on the `<PolicyRow>`
 *  element at the call site, same convention `Users.tsx`'s `UserRow` uses.
 *
 *  Exported for the same reason as {@link RolesSection}. */
export function PolicyRow({ policy, row, permission, agentBase, t, locale }: PolicyRowProps) {
  const renaming = row.editingId === policy.id;
  return (
    <>
      <tr>
        <td>
          {renaming ? (
            <input
              value={row.draftName}
              onChange={(e) => row.setDraftName(e.target.value)}
              {...agentHandle({ handle: `${agentBase}-rename-name` }, { role: "field", label: "This policy's new name" })}
            />
          ) : (
            policy.name
          )}
        </td>
        <td>
          {renaming ? (
            <input
              value={row.draftDescription}
              onChange={(e) => row.setDraftDescription(e.target.value)}
              {...agentHandle({ handle: `${agentBase}-rename-description` }, { role: "field", label: "This policy's new description" })}
            />
          ) : (
            policy.description ?? <span className="jini-roles-muted-cell">—</span>
          )}
        </td>
        <td>
          {policy.isBuiltin ? t({ key: "Built-in" }) : t({ key: "Custom" })}
          {policy.isFrozen ? ` ${t({ key: "(frozen)" })}` : ""}
        </td>
        <td>
          <PolicyRowActions policy={policy} row={row} permission={permission} agentBase={agentBase} t={t} locale={locale} />
        </td>
      </tr>
      {permission.openForPolicyId === policy.id ? (
        <PolicyPermissionForm policyId={policy.id} savingId={row.savingId} permission={permission} t={t} />
      ) : null}
    </>
  );
}
