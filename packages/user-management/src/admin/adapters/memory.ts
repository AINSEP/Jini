import { RolesApiError } from '../ports.js';
import type { RolesApiPort, RolesCallOptions } from '../ports.js';
import type { RoleRecord, PolicyRecord, PolicyPermissionRecord } from '../models.js';
import { BUILTIN_PERMISSIONS } from '../../core/builtin-permissions.js';
import { canManageRoles } from '../rules.js';
export interface MemoryRolesOptions {
    readonly permissions?: readonly string[];
    readonly catalog?: readonly string[];
    readonly roles?: readonly RoleRecord[];
    readonly policies?: readonly PolicyRecord[];
    readonly policyPermissions?: readonly PolicyPermissionRecord[];
    /** Test host reference data: memory intentionally does not implement user assignment. */
    readonly referencedRoleIds?: readonly string[];
    readonly referencedPolicyIds?: readonly string[];
}
/** Isolated fake of the server wire contract, including immutable and issuer guards.
 * It is not a production authorizer or a persistent identity repository. */
export function createMemoryRolesApi({ workspaceId }: {
    workspaceId: string;
}, options: MemoryRolesOptions = {}): RolesApiPort {
    const grants = Object.freeze([...(options.permissions ?? [])]), catalog = new Set(options.catalog ?? BUILTIN_PERMISSIONS.map(p => p.id));
    const roles = new Map<string, RoleRecord>(), policies = new Map<string, PolicyRecord>(), permissions = new Map<string, PolicyPermissionRecord>();
    for (const r of options.roles ?? [])
        if (r.workspaceId === workspaceId)
            roles.set(r.id, { ...r });
    for (const p of options.policies ?? [])
        if (p.workspaceId === workspaceId)
            policies.set(p.id, { ...p });
    for (const p of options.policyPermissions ?? [])
        if (p.workspaceId === workspaceId)
            permissions.set(p.id, { ...p });
    let sequence = 0;
    const id = () => { let next: string; do {
        next = `memory-${++sequence}`;
    } while (roles.has(next) || policies.has(next) || permissions.has(next)); return next; };
    const fail = (code: string, message: string): never => { throw new RolesApiError({ code, message }); };
    const check = (o: RolesCallOptions) => { o.signal?.throwIfAborted(); };
    const write = (o: RolesCallOptions) => { check(o); if (!canManageRoles({ permissions: grants }))
        fail('FORBIDDEN', 'Missing role.manage.'); };
    const name = (v: string) => { const n = v.trim().normalize('NFC'); if (!n)
        fail('VALIDATION_ERROR', 'Name is required.'); return n; };
    const unique = <T extends {
        id: string;
        name: string;
    }>(map: Map<string, T>, n: string, except?: string) => { if ([...map.values()].some(r => r.id !== except && r.name.toLowerCase() === n.toLowerCase()))
        fail('RESOURCE_CONFLICT', 'Name already exists.'); };
    const getRole = (roleId: string) => roles.get(roleId) ?? fail('RESOURCE_NOT_FOUND', 'Role not found.');
    const getPolicy = (policyId: string) => policies.get(policyId) ?? fail('RESOURCE_NOT_FOUND', 'Policy not found.');
    const editableRole = (roleId: string) => { const r = getRole(roleId); if (r.isBuiltin)
        fail('VALIDATION_ERROR', 'Built-in role is immutable.'); return r; };
    const editablePolicy = (policyId: string) => { const p = getPolicy(policyId); if (p.isBuiltin || p.isFrozen)
        fail('VALIDATION_ERROR', 'Built-in or frozen policy is immutable.'); return p; };
    return {
        async listRoles(_r, o = {}) { check(o); return { roles: [...roles.values()].map(r => ({ ...r })) }; },
        async listPolicies(_r, o = {}) { check(o); return { policies: [...policies.values()].map(p => ({ ...p })) }; },
        async createRole(r, o = {}) { write(o); const n = name(r.name); unique(roles, n); const role = { id: id(), workspaceId, name: n, isBuiltin: false }; roles.set(role.id, role); return { role: { ...role } }; },
        async updateRole(r, o = {}) { write(o); const old = editableRole(r.roleId), n = name(r.name); unique(roles, n, old.id); const role = { ...old, name: n }; roles.set(role.id, role); return { role: { ...role } }; },
        async deleteRole(r, o = {}) { write(o); editableRole(r.roleId); if (options.referencedRoleIds?.includes(r.roleId))
            fail('RESOURCE_CONFLICT', 'Role is still assigned.'); roles.delete(r.roleId); },
        async createPolicy(r, o = {}) { write(o); const n = name(r.name); unique(policies, n); const policy: PolicyRecord = { id: id(), workspaceId, name: n, isBuiltin: false, isFrozen: false, ...(o.description !== undefined ? { description: o.description } : {}) }; policies.set(policy.id, policy); return { policy: { ...policy } }; },
        async updatePolicy(r, o = {}) { write(o); const old = editablePolicy(r.policyId); if (o.name === undefined && o.description === undefined)
            fail('VALIDATION_ERROR', 'At least one of name or description is required.'); const n = o.name === undefined ? old.name : name(o.name); unique(policies, n, old.id); const policy = { ...old, name: n, ...(o.description !== undefined ? { description: o.description } : {}) }; policies.set(policy.id, policy); return { policy: { ...policy } }; },
        async deletePolicy(r, o = {}) { write(o); editablePolicy(r.policyId); if (options.referencedPolicyIds?.includes(r.policyId))
            fail('RESOURCE_CONFLICT', 'Policy is still attached.'); policies.delete(r.policyId); for (const p of permissions.values())
            if (p.policyId === r.policyId)
                permissions.delete(p.id); },
        async listPolicyPermissions(r, o = {}) { check(o); getPolicy(r.policyId); return { policyPermissions: [...permissions.values()].filter(p => p.policyId === r.policyId).map(p => ({ ...p })) }; },
        async writePolicyPermission(r, o = {}) {
            write(o);
            editablePolicy(r.policyId);
            if (!catalog.has(r.permission))
                fail('PERMISSION_UNKNOWN', 'Unrecognized permission.');
            if (!grants.includes('*') && !grants.includes(r.permission))
                fail('GRANT_EXCEEDS_ISSUER', 'Grant exceeds issuer.');
            const resourceType = o.resourceType || null;
            const policyPermission: PolicyPermissionRecord = { id: id(), workspaceId, policyId: r.policyId, permission: r.permission, resourceType, constraintJson: null };
            permissions.set(policyPermission.id, policyPermission);
            return { policyPermission: { ...policyPermission } };
        },
        async removePolicyPermission(r, o = {}) { write(o); editablePolicy(r.policyId); const p = permissions.get(r.policyPermissionId); if (!p || p.policyId !== r.policyId)
            fail('RESOURCE_NOT_FOUND', 'Permission not found on this policy.'); permissions.delete(r.policyPermissionId); },
    };
}

import type { UsersApiPort, UsersSafetyPort, MembersApiPort, AuthApiPort } from '../ports.js';
import { PeopleApiError } from '../ports.js';
import type { AdminOperator, AdminMember, CallerInfo } from '../models.js';
import { hasAdminGrant, userActionAllowed } from '../people.rules.js';
/** Complete fake ownership data. Production hosts must resolve effective unconstrained wildcard
 * grants, never role display names. Unknown ids deliberately fail closed. */
export function createMemoryUsersSafety({ principalIds, ownerPrincipalIds, seededOwnerPrincipalId }: {
  principalIds: readonly string[]; ownerPrincipalIds: readonly string[]; seededOwnerPrincipalId: string | null;
}, _optional: Record<string, never> = {}): UsersSafetyPort {
  const known = new Set(principalIds), owners = new Set(ownerPrincipalIds);
  return { seededOwnerPrincipalId, ownerStatus: r => known.has(r.principalId) ? owners.has(r.principalId) ? 'owner' : 'operator' : 'unknown' };
}
export interface MemoryUsersOptions {
  readonly permissions?: readonly string[]; readonly users?: readonly AdminOperator[];
  readonly roles?: readonly RoleRecord[]; readonly policies?: readonly PolicyRecord[];
  readonly caller?: CallerInfo; readonly ownerPrincipalIds?: readonly string[];
  readonly seededOwnerPrincipalId?: string;
  /** Grant contents for issuer-clamp tests; unknown content fails closed for non-owners. */
  readonly rolePermissions?: Readonly<Record<string, readonly string[]>>;
  readonly policyPermissions?: Readonly<Record<string, readonly string[]>>;
  readonly onPasswordReset?: (required: { principalId: string; password: string }, optional?: Record<string, never>) => void;
}
/** Fake wire backend only: no persistent password storage, real sessions, audit or Trash service. */
export function createMemoryUsersApi({ workspaceId }: { workspaceId: string }, options: MemoryUsersOptions = {}): UsersApiPort {
  const grants = Object.freeze([...(options.permissions ?? [])]);
  const users = new Map((options.users ?? []).filter(u => u.workspaceId === workspaceId).map(u => [u.principalId, clone(u)]));
  const roles = (options.roles ?? []).filter(r => r.workspaceId === workspaceId).map(r => ({ ...r }));
  const policies = (options.policies ?? []).filter(p => p.workspaceId === workspaceId).map(p => ({ ...p }));
  const owners = new Set(options.ownerPrincipalIds ?? []), trash = new Set<string>();
  const caller: CallerInfo = options.caller ? structuredClone(options.caller) : { user: { id: 'memory-caller', username: 'caller' }, canManageUserTrash: false };
  const safety: UsersSafetyPort = { seededOwnerPrincipalId: options.seededOwnerPrincipalId ?? null, ownerStatus: r => users.has(r.principalId) ? owners.has(r.principalId) ? 'owner' : 'operator' : 'unknown' };
  let sequence = 0;
  function clone(u: AdminOperator): AdminOperator { return { ...u, roleIds: [...u.roleIds], policyIds: [...u.policyIds] }; }
  const fail = (code: string, message: string): never => { throw new PeopleApiError({ code, message }); };
  const check = (o: RolesCallOptions) => o.signal?.throwIfAborted();
  const get = (id: string) => users.get(id) ?? fail('RESOURCE_NOT_FOUND', 'User not found.');
  function write(id: string, action: import('../models.js').UserAction, o: RolesCallOptions) {
    check(o); const user = get(id);
    if (trash.has(id)) fail('USER_IN_TRASH', 'This user is in the Trash; restore them first.');
    if (action === 'delete' && id === caller.user.id) fail('SELF_DELETE', 'You cannot delete your own account.');
    if (!userActionAllowed({ user, action, permissions: grants, caller, safety })) fail('FORBIDDEN', 'Mutation denied.');
    return user;
  }
  const password = (value: string) => { if (!value || [...value].length > 512) fail('VALIDATION_ERROR', 'Password must be present and no more than 512 characters.'); };
  function clamp(contents: readonly string[] | undefined) { if (grants.includes('*')) return; if (!contents || contents.some(p => !grants.includes(p))) fail('GRANT_EXCEEDS_ISSUER', 'Grant exceeds issuer.'); }
  return {
    async listUsers(_r, o = {}) { check(o); return { users: [...users.values()].filter(u => !trash.has(u.principalId)).map(clone) }; },
    async listRoles(_r, o = {}) { check(o); return { roles: roles.map(r => ({ ...r })) }; },
    async listPolicies(_r, o = {}) { check(o); return { policies: policies.map(p => ({ ...p })) }; },
    async me(_r, o = {}) { check(o); return structuredClone(caller); },
    async createUser(r, o = {}) {
      check(o); if (!hasAdminGrant({ permissions: grants, permission: 'user.manage' })) fail('FORBIDDEN', 'Missing user.manage.');
      const username = r.username.trim().normalize('NFC').toLowerCase(); if (!username) fail('VALIDATION_ERROR', 'Username is required.'); password(r.password);
      const existing = [...users.values()].find(u => u.username.normalize('NFC').toLowerCase() === username);
      if (existing) fail(trash.has(existing.principalId) ? 'USERNAME_IN_TRASH' : 'RESOURCE_CONFLICT', 'Username already exists.');
      let principalId: string; do { principalId = `memory-user-${++sequence}`; } while (users.has(principalId));
      const user: AdminOperator = { principalId, workspaceId, username, status: 'active', createdAt: new Date(0).toISOString(), roleIds: [], policyIds: [], ...(o.email !== undefined ? { email: o.email } : {}) };
      users.set(principalId, user); return { user: clone(user) };
    },
    async updateUser(r, o = {}) { const u = write(r.principalId, 'email', o); const user = { ...u, ...(o.email !== undefined ? { email: o.email } : {}) }; users.set(u.principalId, user); return { user: clone(user) }; },
    async disableUser(r, o = {}) {
      const u = write(r.principalId, 'disable', o);
      if (owners.has(u.principalId) && [...users.values()].filter(v => v.status === 'active' && owners.has(v.principalId)).length <= 1) fail('OWNER_REQUIRED', 'The workspace must keep at least one active owner.');
      const user = { ...u, status: 'disabled' as const }; users.set(u.principalId, user); return { user: clone(user) };
    },
    async enableUser(r, o = {}) { const u = write(r.principalId, 'enable', o); const user = { ...u, status: 'active' as const }; users.set(u.principalId, user); return { user: clone(user) }; },
    async resetUserPassword(r, o = {}) { write(r.principalId, 'reset', o); password(r.password); options.onPasswordReset?.(r); },
    async assignRole(r, o = {}) { const u = write(r.principalId, 'grants', o); if (!roles.some(v => v.id === r.roleId)) fail('RESOURCE_NOT_FOUND', 'Role not found.'); clamp(options.rolePermissions?.[r.roleId]); users.set(u.principalId, { ...u, roleIds: [...new Set([...u.roleIds, r.roleId])] }); return { assignment: { principalId: u.principalId, roleId: r.roleId } }; },
    async attachPolicy(r, o = {}) { const u = write(r.principalId, 'grants', o); if (!policies.some(v => v.id === r.policyId)) fail('RESOURCE_NOT_FOUND', 'Policy not found.'); clamp(options.policyPermissions?.[r.policyId]); users.set(u.principalId, { ...u, policyIds: [...new Set([...u.policyIds, r.policyId])] }); return { attachment: { principalId: u.principalId, policyId: r.policyId } }; },
    async deleteUser(r, o = {}) { const u = write(r.principalId, 'delete', o); if (owners.has(u.principalId) && [...users.values()].filter(v => v.status === 'active' && owners.has(v.principalId)).length <= 1) fail('OWNER_REQUIRED', 'The workspace must keep at least one active owner.'); users.set(u.principalId, { ...u, status: 'disabled' }); trash.add(u.principalId); },
  };
}
export function createMemoryMembersApi({ workspaceId }: { workspaceId: string }, { members = [], permissions = [] }: { members?: readonly AdminMember[]; permissions?: readonly string[] } = {}): MembersApiPort {
  const grants = Object.freeze([...permissions]);
  const rows = new Map(members.filter(m => m.workspaceId === workspaceId).map(m => [m.id, { ...m }]));
  const check = (o: RolesCallOptions) => o.signal?.throwIfAborted();
  const fail = (code: string, message: string): never => { throw new PeopleApiError({ code, message }); };
  const gate = (o: RolesCallOptions) => { check(o); if (!hasAdminGrant({ permissions: grants, permission: 'member.manage' })) fail('FORBIDDEN', 'Missing member.manage.'); };
  const get = (id: string) => rows.get(id) ?? fail('RESOURCE_NOT_FOUND', 'Member not found.');
  return {
    async listMembers(_r, o = {}) { check(o); const limit = o.limit !== undefined && Number.isFinite(o.limit) && o.limit > 0 ? Math.floor(o.limit) : 100; return { members: [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)).filter(m => o.afterId === undefined || m.id > o.afterId).slice(0, limit).map(m => ({ ...m })) }; },
    async getMember(r, o = {}) { check(o); return { member: { ...get(r.id) } }; },
    async disableMember(r, o = {}) { gate(o); const old = get(r.id); const member = old.status === 'disabled' ? old : { ...old, status: 'disabled' as const, version: old.version + 1, updatedAt: new Date(0).toISOString() }; rows.set(member.id, member); return { member: { ...member } }; },
    async requestMemberMagicLink(r, o = {}) { gate(o); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim())) fail('VALIDATION_ERROR', 'Invalid email.'); return { delivered: true }; },
  };
}
/** Deterministic credential fake; production hashing/session policy stays in the server entry. */
export function createMemoryAuthApi({ accounts }: { accounts: readonly { user: import('../models.js').AdminAccount; password: string; disabled?: boolean }[] }, _optional: Record<string, never> = {}): AuthApiPort {
  const rows = accounts.map(a => ({ ...a, user: { ...a.user } }));
  return { async login(r, o = {}) { o.signal?.throwIfAborted(); const found = rows.find(a => a.user.username.normalize('NFC').toLowerCase() === r.username.trim().normalize('NFC').toLowerCase()); if (!r.password || !found || found.disabled || found.password !== r.password) throw new PeopleApiError({ code: 'UNAUTHENTICATED', message: 'invalid username or password' }); return { user: { ...found.user } }; } };
}
