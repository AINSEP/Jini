import type { RoleRecord, PolicyRecord, PolicyPermissionRecord } from './models.js';
export interface RolesCallOptions {
    readonly signal?: AbortSignal;
}
export interface RolesApiPort {
    listRoles(required: Record<string, never>, optional?: RolesCallOptions): Promise<{
        roles: RoleRecord[];
    }>;
    listPolicies(required: Record<string, never>, optional?: RolesCallOptions): Promise<{
        policies: PolicyRecord[];
    }>;
    createRole(required: {
        name: string;
    }, optional?: RolesCallOptions): Promise<{
        role: RoleRecord;
    }>;
    updateRole(required: {
        roleId: string;
        name: string;
    }, optional?: RolesCallOptions): Promise<{
        role: RoleRecord;
    }>;
    deleteRole(required: {
        roleId: string;
    }, optional?: RolesCallOptions): Promise<void>;
    createPolicy(required: {
        name: string;
    }, optional?: RolesCallOptions & {
        description?: string;
    }): Promise<{
        policy: PolicyRecord;
    }>;
    updatePolicy(required: {
        policyId: string;
    }, optional?: RolesCallOptions & {
        name?: string;
        description?: string;
    }): Promise<{
        policy: PolicyRecord;
    }>;
    deletePolicy(required: {
        policyId: string;
    }, optional?: RolesCallOptions): Promise<void>;
    listPolicyPermissions(required: {
        policyId: string;
    }, optional?: RolesCallOptions): Promise<{
        policyPermissions: PolicyPermissionRecord[];
    }>;
    writePolicyPermission(required: {
        policyId: string;
        permission: string;
    }, optional?: RolesCallOptions & {
        resourceType?: string;
    }): Promise<{
        policyPermission: PolicyPermissionRecord;
    }>;
    removePolicyPermission(required: {
        policyId: string;
        policyPermissionId: string;
    }, optional?: RolesCallOptions): Promise<void>;
}
/** Transport authenticates and applies a host API prefix. Server authorization is mandatory. */
export interface RolesHttpTransport {
    request<T>(required: {
        path: string;
        method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
        body?: Readonly<Record<string, unknown>>;
    }, optional?: RolesCallOptions): Promise<T>;
}
export class RolesApiError extends Error {
    readonly code: string;
    constructor(required: {
        code: string;
        message: string;
    }, optional: ErrorOptions = {}) {
        super(required.message, optional);
        this.name = 'RolesApiError';
        this.code = required.code;
    }
}

export interface UsersApiPort {
  listUsers(required: Record<string, never>, optional?: RolesCallOptions): Promise<{ users: import('./models.js').AdminOperator[] }>;
  listRoles(required: Record<string, never>, optional?: RolesCallOptions): Promise<{ roles: RoleRecord[] }>;
  listPolicies(required: Record<string, never>, optional?: RolesCallOptions): Promise<{ policies: PolicyRecord[] }>;
  me(required: Record<string, never>, optional?: RolesCallOptions): Promise<import('./models.js').CallerInfo>;
  createUser(required: { username: string; password: string }, optional?: RolesCallOptions & { email?: string }): Promise<{ user: import('./models.js').AdminOperator }>;
  updateUser(required: { principalId: string }, optional?: RolesCallOptions & { email?: string }): Promise<{ user: import('./models.js').AdminOperator }>;
  disableUser(required: { principalId: string }, optional?: RolesCallOptions): Promise<{ user: import('./models.js').AdminOperator }>;
  enableUser(required: { principalId: string }, optional?: RolesCallOptions): Promise<{ user: import('./models.js').AdminOperator }>;
  resetUserPassword(required: { principalId: string; password: string }, optional?: RolesCallOptions): Promise<void>;
  assignRole(required: { principalId: string; roleId: string }, optional?: RolesCallOptions): Promise<{ assignment: unknown }>;
  attachPolicy(required: { principalId: string; policyId: string }, optional?: RolesCallOptions): Promise<{ attachment: unknown }>;
  deleteUser(required: { principalId: string }, optional?: RolesCallOptions): Promise<void>;
}
/** Effective wildcard ownership cannot be guessed from a role's display name. The host supplies
 * an authoritative, current classification; missing or unresolved data always denies writes. */
export interface UsersSafetyPort {
  ownerStatus(required: { principalId: string }, optional?: Record<string, never>): 'owner' | 'operator' | 'unknown';
  readonly seededOwnerPrincipalId: string | null;
}
export interface MembersApiPort {
  listMembers(required: Record<string, never>, optional?: RolesCallOptions & { afterId?: string; limit?: number }): Promise<{ members: import('./models.js').AdminMember[] }>;
  getMember(required: { id: string }, optional?: RolesCallOptions): Promise<{ member: import('./models.js').AdminMember }>;
  disableMember(required: { id: string }, optional?: RolesCallOptions): Promise<{ member: import('./models.js').AdminMember }>;
  requestMemberMagicLink(required: { email: string }, optional?: RolesCallOptions & { redirectPath?: string }): Promise<{ delivered: true }>;
}
/** The host scopes notifications before calling onRefresh, and owns event topic names. */
export interface MembersRefreshPort {
  subscribe(required: { onRefresh: () => void }, optional?: Record<string, never>): () => void;
}
export interface AuthApiPort {
  login(required: { username: string; password: string }, optional?: RolesCallOptions): Promise<{ user: import('./models.js').AdminAccount }>;
}
export class PeopleApiError extends Error {
  readonly code: string;
  constructor(required: { code: string; message: string }, optional: ErrorOptions = {}) {
    super(required.message, optional); this.name = 'PeopleApiError'; this.code = required.code;
  }
}
