import type { AdminUser, AdminIdentityUser, AdminRole, AdminPolicy, AdminPolicyPermission, AdminMember } from "./models.js";

export interface LoginPort {
  login(credentials: { username: string; password: string }): Promise<{ user: AdminUser }>;
}


export interface UsersPort {
  listUsers(required: Record<string, never>): Promise<{ users: AdminIdentityUser[] }>;

  me(required: Record<string, never>): Promise<{ user: { id: string }; canManageUserTrash: boolean }>;
  listRoles(required: Record<string, never>): Promise<{ roles: AdminRole[] }>;
  listPolicies(required: Record<string, never>): Promise<{ policies: AdminPolicy[] }>;
  createUser(
    input: { username: string; password: string },
    options?: { email?: string  | undefined},
  ): Promise<{ user: AdminIdentityUser }>;
  updateUser(
    target: { principalId: string },
    options?: { email?: string  | undefined},
  ): Promise<{ user: AdminIdentityUser }>;
  disableUser(required: { principalId: string }): Promise<{ user: AdminIdentityUser }>;
  enableUser(required: { principalId: string }): Promise<{ user: AdminIdentityUser }>;
  resetUserPassword(input: { principalId: string; password: string }): Promise<void>;
  assignRole(input: { principalId: string; roleId: string }): Promise<{ assignment: unknown }>;
  attachPolicy(input: { principalId: string; policyId: string }): Promise<{ attachment: unknown }>;

  deleteUser(required: { principalId: string }): Promise<void>;
}


export interface RolesPort {
  listRoles(required: Record<string, never>): Promise<{ roles: AdminRole[] }>;
  listPolicies(required: Record<string, never>): Promise<{ policies: AdminPolicy[] }>;
  createRole(required: { name: string }): Promise<{ role: AdminRole }>;
  updateRole(input: { roleId: string; name: string }): Promise<{ role: AdminRole }>;
  deleteRole(required: { roleId: string }): Promise<void>;
  createPolicy(input: { name: string }, options?: { description?: string  | undefined}): Promise<{ policy: AdminPolicy }>;
  updatePolicy(
    target: { policyId: string },
    options?: { name?: string | undefined; description?: string  | undefined},
  ): Promise<{ policy: AdminPolicy }>;
  deletePolicy(required: { policyId: string }): Promise<void>;
  writePolicyPermission(
    input: { policyId: string; permission: string },
    options?: { resourceType?: string  | undefined},
  ): Promise<{ policyPermission: unknown }>;

  listPolicyPermissions(required: { policyId: string }): Promise<{ policyPermissions: AdminPolicyPermission[] }>;
  removePolicyPermission(input: { policyId: string; policyPermissionId: string }): Promise<void>;
}


export interface MembersPort {
  listMembers(required: Record<string, never>): Promise<{ members: AdminMember[] }>;
  getMember(required: { id: string }): Promise<{ member: AdminMember }>;
  disableMember(required: { id: string }): Promise<{ member: AdminMember }>;
  requestMemberMagicLink(input: { email: string }): Promise<{ delivered: true }>;
}


/** Compose once per host/workspace. Screens never choose an HTTP transport. */
export interface IdentityAdminPort extends LoginPort, UsersPort, RolesPort, MembersPort {}

/** The host owns event topics; subscribe binds only the current members scope. */
export interface IdentityRefreshPort {
  subscribe(required: { onRefresh: () => void }): () => void;
}
