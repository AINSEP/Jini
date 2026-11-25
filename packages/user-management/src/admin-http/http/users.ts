import type { PolicyRecord, PrincipalRecord, RoleRecord, UserRecord } from "../../core/types.js";

/**
 * @file Admin-facing user/role/policy response DTOs (same split as the admin members DTO helper).
 *
 * Purpose:
 * Maps internal identity records to what the admin API/UI may see.
 * Deliberately excludes `UserRecord.passwordHash` (INV-05: raw/hashed
 * secrets never leave the server) — `AdminUserResponse` has no field for it,
 * so there is nothing to accidentally forward. Role/policy assignments are
 * returned as bare id arrays (`roleIds`/`policyIds`) rather than resolved
 * names: the admin UI already fetches the full roles/policies lists to
 * populate its pickers, so resolving names here would be a redundant N+1
 * `findById` fan-out per user for data the client already has.
 */

/** Admin-facing shape of a user (principal + credential row, grants as id references).
 *  Optional fields admit `undefined` because Jini compiles with `exactOptionalPropertyTypes`; JSON drops
 *  an `undefined` field, so the wire body is unchanged from the host original. */
export interface AdminUserResponse {
  principalId: string;
  workspaceId: string;
  username: string;
  email?: string | undefined;
  status: PrincipalRecord["status"];
  createdAt: string;
  lastLoginAt?: string | undefined;
  roleIds: string[];
  policyIds: string[];
  /** Editor basis for the profile fields: send it back as `expectedVersion` on PATCH. */
  version: number;
}

/** Admin-facing shape of a role. */
export interface AdminRoleResponse {
  id: string;
  workspaceId: string;
  name: string;
  isBuiltin: boolean;
  /** Editor basis: send it back as `expectedVersion` on PATCH. */
  version: number;
}

/** Admin-facing shape of a policy. */
export interface AdminPolicyResponse {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | undefined;
  isBuiltin: boolean;
  isFrozen: boolean;
  /** Editor basis: send it back as `expectedVersion` on PATCH. */
  version: number;
}

/**
 * Serialize a `(PrincipalRecord, UserRecord)` pair plus its grant id lists to
 * `AdminUserResponse`. Both records must share the same `principalId`
 * (CREATE_USER's atomicity guarantee, see `grant-service.ts`) — this
 * function does not itself re-validate that pairing, it trusts the caller
 * fetched them together.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function toAdminUserResponse(required: {
  principal: PrincipalRecord;
  user: UserRecord;
  roleIds: string[];
  policyIds: string[];
}): AdminUserResponse {
  const { principal, user, roleIds, policyIds } = required;
  return {
    version: user.version,
    principalId: principal.id,
    workspaceId: principal.workspaceId,
    username: user.username,
    email: user.email,
    status: principal.status,
    createdAt: principal.createdAt,
    lastLoginAt: user.lastLoginAt,
    roleIds,
    policyIds,
  };
}

/** Serialize a `RoleRecord` to `AdminRoleResponse`. @complexity O(1). @overallScore 100 */
export function toAdminRoleResponse(role: RoleRecord): AdminRoleResponse {
  return { id: role.id, workspaceId: role.workspaceId, name: role.name, isBuiltin: role.isBuiltin, version: role.version };
}

/** Serialize a `PolicyRecord` to `AdminPolicyResponse`. @complexity O(1). @overallScore 100 */
export function toAdminPolicyResponse(policy: PolicyRecord): AdminPolicyResponse {
  return {
    id: policy.id,
    workspaceId: policy.workspaceId,
    name: policy.name,
    description: policy.description,
    isBuiltin: policy.isBuiltin,
    isFrozen: policy.isFrozen,
    version: policy.version,
  };
}
