/**
 * @file User-management admin seam types shared with hosts: the browser-facing administration DTOs,
 * the Users/Roles/Members screen ports and the owner TOTP/passkey ports. Moved from
 * `@jini-ai/user-management` (`react/models.ts`, `react/ports.ts`, `react/auth/*`, `core/types.ts`),
 * which re-exports them. Types only (XP4): the screen controllers stay in the package because they
 * carry React state setters.
 */

/** WebAuthn ceremony JSON shared by server issuance and browser execution. */
export type PasskeyOptions = { challenge: string; [key: string]: unknown };

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
  /** Host refusal for accounts whose bootstrap identity cannot safely follow a rename yet. */
  canRename?: boolean | undefined;
  roleIds: string[];
  policyIds: string[];
}

export interface AdminRole {
  id: string;
  workspaceId: string;
  name: string;
  isBuiltin: boolean;
  /** The row's compare-and-set version; an editor sends the one it loaded back as `expectedVersion`. */
  version: number;
}

export interface AdminPolicy {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | undefined;
  isBuiltin: boolean;
  isFrozen: boolean;
  /** The row's compare-and-set version; an editor sends the one it loaded back as `expectedVersion`. */
  version: number;
}

/** One permission row written onto a policy (OQ-10). Mirrors `identity`'s `PolicyPermissionRecord`
 *  — the shape `GET policies/:policyId/permissions` returns. `id` is what
 *  {@link RolesPort.removePolicyPermission} deletes by; nothing else in the admin exposed it, which
 *  is why a policy's permission set used to be append-only from this UI. */
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

/** One screen loads users, roles and policies together, so splitting the port would leave full-screen fakes with the same dependencies. */
export interface UsersPort {
  listUsers(required: Record<string, never>): Promise<{ users: AdminIdentityUser[] }>;

  me(required: Record<string, never>): Promise<{ user: { id: string }; canManageUserTrash: boolean; effectivePermissions?: string[] | undefined }>;
  listRoles(required: Record<string, never>): Promise<{ roles: AdminRole[] }>;
  listPolicies(required: Record<string, never>): Promise<{ policies: AdminPolicy[] }>;
  createUser(
    input: { username: string; password: string },
    options?: { email?: string  | undefined},
  ): Promise<{ user: AdminIdentityUser }>;
  updateUser(
    target: { principalId: string },
    options?: { email?: string | undefined; username?: string | undefined },
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
  /** `expectedVersion` is the version of the row the editor loaded; a stale one is refused with `409 VERSION_CONFLICT`. */
  updateRole(input: { roleId: string; name: string; expectedVersion?: number | undefined }): Promise<{ role: AdminRole }>;
  deleteRole(required: { roleId: string }): Promise<void>;
  createPolicy(input: { name: string }, options?: { description?: string  | undefined}): Promise<{ policy: AdminPolicy }>;
  updatePolicy(
    target: { policyId: string },
    options?: { name?: string | undefined; description?: string  | undefined; expectedVersion?: number | undefined },
  ): Promise<{ policy: AdminPolicy }>;
  deletePolicy(required: { policyId: string }): Promise<void>;
  writePolicyPermission(
    input: { policyId: string; permission: string },
    options?: { resourceType?: string  | undefined},
  ): Promise<{ policyPermission: unknown }>;

  listPolicyPermissions(required: { policyId: string }): Promise<{ policyPermissions: AdminPolicyPermission[] }>;
  removePolicyPermission(input: { policyId: string; policyPermissionId: string }): Promise<void>;
}


/** Pure error formatting stays outside the Members port. */
export interface MembersPort {
  listMembers(required: Record<string, never>): Promise<{ members: AdminMember[] }>;
  getMember(required: { id: string }): Promise<{ member: AdminMember }>;
  disableMember(required: { id: string }): Promise<{ member: AdminMember }>;
  requestMemberMagicLink(input: { email: string }): Promise<{ delivered: true }>;
}

export interface TotpSettingsPort {
  status(): Promise<{ isOwner: boolean; available: boolean; enrolled: boolean }>;
  enroll(input: { password: string; code?: string }): Promise<{ pendingToken: string; secret: string; uri: string }>;
  confirm(input: { pendingToken: string; code: string }): Promise<void>;
  remove(input: { password: string; code: string }): Promise<void>;
}

type Started = { pendingToken: string; options: PasskeyOptions };
type Finish = { pendingToken: string; response: unknown };
export interface PasskeySignInPort {
  begin(input: { pendingToken: string }): Promise<Started>;
  complete(input: Finish): Promise<void>;
}
export interface PasskeySettingsPort {
  status(): Promise<{ isOwner: boolean; credentials: { id: string }[] }>;
  enroll(input: { password: string; code: string }): Promise<Started>;
  confirm(input: Finish): Promise<void>;
  remove(input: { id: string; password: string; code: string }): Promise<void>;
}
