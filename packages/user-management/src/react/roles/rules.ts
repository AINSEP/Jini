import type { AdminIdentityUser, AdminRole, AdminPolicy, AdminMember } from "../models.js";
import type { Translate } from "@jini-ai/ui/panel-kit";
import { describeIdentityError } from "../errors.js";
import type { RowMenuItem } from "@jini-ai/admin/react";

import type { QueryKey } from "@jini-ai/ui/panel-kit";

export const KEYS = {
  list: ["roles-and-policies"] as QueryKey,
};

const STATIC_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  FORBIDDEN: "You do not have permission to do that.",
  RESOURCE_CONFLICT: "It is still in use — remove that assignment/attachment first.",
  PERMISSION_UNKNOWN: "That permission is not recognized.",
  GRANT_EXCEEDS_ISSUER: "You cannot grant a permission you do not hold.",
};

export function describeApiError({ error, fallback, translate }: { error: unknown; fallback: string; translate: Translate }): string {
  return describeIdentityError({ error, fallback, translate }, { messages: STATIC_ERROR_MESSAGES });
}

export interface RoleRowMenuHandlers {
  onRename: (role: AdminRole) => void;
  onDelete: (role: AdminRole) => void;
}

export function roleMenuItems({ role, handlers, translate }: { role: AdminRole; handlers: RoleRowMenuHandlers; translate: Translate }): RowMenuItem[] {
  return [
    { key: "rename", label: translate("Rename"), onSelect: () => handlers.onRename(role) },
    { key: "delete", label: translate("Delete"), destructive: true, onSelect: () => handlers.onDelete(role) },
  ];
}

export interface PolicyRowMenuHandlers {
  onRename: (policy: AdminPolicy) => void;
  onTogglePermissionForm: (required: { policyId: string }) => void;
  onDelete: (policy: AdminPolicy) => void;
}

export function policyMenuItems({ policy, permissionPolicyId, handlers, translate }: {
 policy: AdminPolicy; permissionPolicyId: string | null; handlers: PolicyRowMenuHandlers; translate: Translate;
}): RowMenuItem[] {
  return [
    { key: "rename", label: translate("Rename"), onSelect: () => handlers.onRename(policy) },
    {
      key: "permission",
      label: permissionPolicyId === policy.id ? translate("Close") : translate("Add permission"),
      onSelect: () => handlers.onTogglePermissionForm({ policyId: policy.id }),
    },
    { key: "delete", label: translate("Delete"), destructive: true, onSelect: () => handlers.onDelete(policy) },
  ];
}
