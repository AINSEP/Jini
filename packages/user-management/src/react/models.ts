/** Browser-facing administration DTOs; no transport or server imports. */
export interface AdminUser {
  id: string;
  username: string;
}

export interface AdminIdentityUser {
  principalId: string;
  workspaceId: string;
  username: string;
  email?: string | undefined;
  status: "active" | "disabled";
  createdAt: string;
  lastLoginAt?: string | undefined;
  /** Server classification covers ownership granted by policy, not only named roles. */
  isOwner?: boolean | undefined;
  isProtectedAccount?: boolean | undefined;
  roleIds: string[];
  policyIds: string[];
}

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
  description?: string | undefined;
  isBuiltin: boolean;
  isFrozen: boolean;
}

export interface AdminPolicyPermission {
  id: string;
  workspaceId: string;
  policyId: string;
  permission: string;
  resourceType?: string | null | undefined;
  constraintJson?: string | null | undefined;
}

export interface AdminMember {
  id: string;
  workspaceId: string;
  email: string;
  name?: string | undefined;
  status: "pending" | "active" | "disabled";
  emailVerifiedAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
  version: number;
}

