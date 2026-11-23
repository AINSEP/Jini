export interface AdminRole {
  id: string;
  workspaceId: string;
  name: string;
  isBuiltin: boolean;
}

export interface AdminPolicy {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  isBuiltin: boolean;
  isFrozen: boolean;
}

/** One permission row written onto a policy (OQ-10). Mirrors `identity`'s `PolicyPermissionRecord`
 *  — the shape `GET policies/:policyId/permissions` returns. `id` is what
 *  {@link adminApi.removePolicyPermission} deletes by; nothing else in the admin exposed it, which
 *  is why a policy's permission set used to be append-only from this UI. */
export interface AdminPolicyPermission {
  id: string;
  workspaceId: string;
  policyId: string;
  permission: string;
  resourceType?: string | null;
  constraintJson?: string | null;
}
