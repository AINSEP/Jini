import { PeopleApiError, RolesApiError } from '../ports.js';
import { encodeListCursor, pageFromArray } from '@jini-ai/core/list-page';
import type { RolesApiPort, RolesCallOptions, UsersApiPort, UsersSafetyPort, MembersApiPort, AuthApiPort } from '../ports.js';
import type { RoleRecord, PolicyRecord, PolicyPermissionRecord, AdminOperator, AdminMember, AdminAccount, CallerInfo, UserAction } from '../models.js';
import { BUILTIN_PERMISSIONS } from '../../core/builtin-permissions.js';
import { canManageRoles } from '../rules.js';
import { hasAdminGrant, userActionAllowed } from '../people.rules.js';
/** Seed records that belong to this fake's workspace; every other workspace is invisible. */
function inWorkspace<T extends { workspaceId: string }>(records: readonly T[] | undefined, workspaceId: string): T[] {
    return (records ?? []).filter(r => r.workspaceId === workspaceId);
}
function check(o: RolesCallOptions) { o.signal?.throwIfAborted(); }
/** Unknown ids deliberately fail closed: they are neither owner nor operator. */
function ownership({ known, owners, principalId }: { known: { has(id: string): boolean }; owners: ReadonlySet<string>; principalId: string }) {
    if (!known.has(principalId)) {
        return 'unknown' as const;
    }

    return owners.has(principalId) ? 'owner' as const : 'operator' as const;
}
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
/** Seed data and guards shared by the role, policy and permission operations of one fake. */
interface RolesCtx {
    readonly workspaceId: string;
    readonly options: MemoryRolesOptions;
    readonly grants: readonly string[];
    readonly catalog: Set<string>;
    readonly roles: Map<string, RoleRecord>;
    readonly policies: Map<string, PolicyRecord>;
    readonly permissions: Map<string, PolicyPermissionRecord>;
    id(): string;
    write(o: RolesCallOptions): void;
    name(v: string): string;
    unique<T extends { id: string; name: string }>(map: Map<string, T>, n: string, except?: string): void;
    getPolicy(policyId: string): PolicyRecord;
    editableRole(roleId: string): RoleRecord;
    editablePolicy(policyId: string): PolicyRecord;
}
const failRoles = ({ code, message }: { code: string; message: string }): never => { throw new RolesApiError({ code, message }); };

function createRolesCtx({ workspaceId, options }: {
  workspaceId: string;
  options: MemoryRolesOptions;
}): RolesCtx {
    const grants = Object.freeze([...(options.permissions ?? [])]), catalog = new Set(options.catalog ?? BUILTIN_PERMISSIONS.map(p => p.id));
    const roles = new Map(inWorkspace(options.roles, workspaceId).map(r => [r.id, { ...r }]));
    const policies = new Map(inWorkspace(options.policies, workspaceId).map(p => [p.id, { ...p }]));
    const permissions = new Map(inWorkspace(options.policyPermissions, workspaceId).map(p => [p.id, { ...p }]));
    let sequence = 0;
    const getRole = (roleId: string) => roles.get(roleId) ?? failRoles({ code: 'RESOURCE_NOT_FOUND', message: 'Role not found.' });
    const getPolicy = (policyId: string) => policies.get(policyId) ?? failRoles({ code: 'RESOURCE_NOT_FOUND', message: 'Policy not found.' });
    return {
        workspaceId, options, grants, catalog, roles, policies, permissions, getPolicy,
        id() {
            let next: string; do {
                ++sequence;
                next = `memory-${sequence}`;
            } while (roles.has(next) || policies.has(next) || permissions.has(next)); return next;
        },
        write(o) {
            check(o); if (!canManageRoles({ permissions: grants })) {
                failRoles({ code: 'FORBIDDEN', message: 'Missing role.manage.' });
            }
        },
        name(v) {
            const n = v.trim().normalize('NFC'); if (!n) {
                failRoles({ code: 'VALIDATION_ERROR', message: 'Name is required.' });
            }
            return n;
        },
        unique(map, n, except) {
            if ([...map.values()].some(r => r.id !== except && r.name.toLowerCase() === n.toLowerCase())) {
                failRoles({ code: 'RESOURCE_CONFLICT', message: 'Name already exists.' });
            }
        },
        editableRole(roleId) {
            const r = getRole(roleId); if (r.isBuiltin) {
                failRoles({ code: 'VALIDATION_ERROR', message: 'Built-in role is immutable.' });
            }
            return r;
        },
        editablePolicy(policyId) {
            const p = getPolicy(policyId); if (p.isBuiltin || p.isFrozen) {
                failRoles({ code: 'VALIDATION_ERROR', message: 'Built-in or frozen policy is immutable.' });
            }
            return p;
        },
    };
}

function roleOperations(ctx: RolesCtx): Pick<RolesApiPort, 'listRoles' | 'createRole' | 'updateRole' | 'deleteRole'> {
    const { roles, workspaceId, options } = ctx;
    return {
        async listRoles(_r, o = {}) { check(o); return { roles: [...roles.values()].map(r => ({ ...r })) }; },
        async createRole(r, o = {}) { ctx.write(o); const n = ctx.name(r.name); ctx.unique(roles, n); const role = { id: ctx.id(), workspaceId, name: n, isBuiltin: false, version: 1 }; roles.set(role.id, role); return { role: { ...role } }; },
        async updateRole(r, o = {}) { ctx.write(o); const old = ctx.editableRole(r.roleId), n = ctx.name(r.name); ctx.unique(roles, n, old.id); const role = { ...old, name: n, version: old.version + 1 }; roles.set(role.id, role); return { role: { ...role } }; },
        async deleteRole(r, o = {}) {
            ctx.write(o); ctx.editableRole(r.roleId); if (options.referencedRoleIds?.includes(r.roleId)) {
                failRoles({ code: 'RESOURCE_CONFLICT', message: 'Role is still assigned.' });
            }
            roles.delete(r.roleId);
        },
    };
}

function policyOperations(ctx: RolesCtx): Pick<RolesApiPort, 'listPolicies' | 'createPolicy' | 'updatePolicy' | 'deletePolicy'> {
    const { policies, permissions, workspaceId, options } = ctx;
    return {
        async listPolicies(_r, o = {}) { check(o); return { policies: [...policies.values()].map(p => ({ ...p })) }; },
        async createPolicy(r, o = {}) { ctx.write(o); const n = ctx.name(r.name); ctx.unique(policies, n); const policy: PolicyRecord = { version: 1, id: ctx.id(), workspaceId, name: n, isBuiltin: false, isFrozen: false, ...(o.description !== undefined ? { description: o.description } : {}) }; policies.set(policy.id, policy); return { policy: { ...policy } }; },
        async updatePolicy(r, o = {}) {
            ctx.write(o); const old = ctx.editablePolicy(r.policyId); if (o.name === undefined && o.description === undefined) {
                failRoles({ code: 'VALIDATION_ERROR', message: 'At least one of name or description is required.' });
            }
            const n = o.name === undefined ? old.name : ctx.name(o.name); ctx.unique(policies, n, old.id); const policy = { ...old, name: n, version: old.version + 1, ...(o.description !== undefined ? { description: o.description } : {}) }; policies.set(policy.id, policy); return { policy: { ...policy } };
        },
        async deletePolicy(r, o = {}) {
            ctx.write(o); ctx.editablePolicy(r.policyId); if (options.referencedPolicyIds?.includes(r.policyId)) {
                failRoles({ code: 'RESOURCE_CONFLICT', message: 'Policy is still attached.' });
            }
            policies.delete(r.policyId); for (const p of permissions.values()) {
                if (p.policyId === r.policyId) {
                    permissions.delete(p.id);
                }

            }
        },
    };
}

function permissionOperations(ctx: RolesCtx): Pick<RolesApiPort, 'listPolicyPermissions' | 'writePolicyPermission' | 'removePolicyPermission'> {
    const { permissions, workspaceId, catalog, grants } = ctx;
    return {
        async listPolicyPermissions(r, o = {}) { check(o); ctx.getPolicy(r.policyId); return { policyPermissions: [...permissions.values()].filter(p => p.policyId === r.policyId).map(p => ({ ...p })) }; },
        async writePolicyPermission(r, o = {}) {
            ctx.write(o);
            ctx.editablePolicy(r.policyId);
            if (!catalog.has(r.permission)) {
                failRoles({ code: 'PERMISSION_UNKNOWN', message: 'Unrecognized permission.' });
            }

            if (!hasAdminGrant({ permissions: grants, permission: r.permission })) {
                failRoles({ code: 'GRANT_EXCEEDS_ISSUER', message: 'Grant exceeds issuer.' });
            }

            const resourceType = o.resourceType || null;
            const policyPermission: PolicyPermissionRecord = { id: ctx.id(), workspaceId, policyId: r.policyId, permission: r.permission, resourceType, constraintJson: null };
            permissions.set(policyPermission.id, policyPermission);
            return { policyPermission: { ...policyPermission } };
        },
        async removePolicyPermission(r, o = {}) {
            ctx.write(o); ctx.editablePolicy(r.policyId); const p = permissions.get(r.policyPermissionId); if (!p || p.policyId !== r.policyId) {
                failRoles({ code: 'RESOURCE_NOT_FOUND', message: 'Permission not found on this policy.' });
            }
            permissions.delete(r.policyPermissionId);
        },
    };
}

/** Isolated fake of the server wire contract, including immutable and issuer guards.
 * It is not a production authorizer or a persistent identity repository. */
export function createMemoryRolesApi({ workspaceId }: {
    workspaceId: string;
}, options: MemoryRolesOptions = {}): RolesApiPort {
    const ctx = createRolesCtx({ workspaceId, options });
    return { ...roleOperations(ctx), ...policyOperations(ctx), ...permissionOperations(ctx) };
}
/** Complete fake ownership data. Production hosts must resolve effective unconstrained wildcard
 * grants, never role display names. Unknown ids deliberately fail closed. */
export function createMemoryUsersSafety({ principalIds, ownerPrincipalIds, seededOwnerPrincipalId }: {
    principalIds: readonly string[]; ownerPrincipalIds: readonly string[]; seededOwnerPrincipalId: string | null;
}, _optional: Record<string, never> = {}): UsersSafetyPort {
    const known = new Set(principalIds), owners = new Set(ownerPrincipalIds);
    return { seededOwnerPrincipalId, ownerStatus: r => ownership({ known, owners, principalId: r.principalId }) };
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
function clone(u: AdminOperator): AdminOperator { return { ...u, roleIds: [...u.roleIds], policyIds: [...u.policyIds] }; }

function createMemoryUsersContext(workspaceId: string, options: MemoryUsersOptions) {
    const grants = Object.freeze([...(options.permissions ?? [])]);
    const users = new Map(inWorkspace(options.users, workspaceId).map(u => [u.principalId, clone(u)]));
    const roles = inWorkspace(options.roles, workspaceId).map(r => ({ ...r }));
    const policies = inWorkspace(options.policies, workspaceId).map(p => ({ ...p }));
    const owners = new Set(options.ownerPrincipalIds ?? []), trash = new Set<string>();
    const caller: CallerInfo = options.caller ? structuredClone(options.caller) : { user: { id: 'memory-caller', username: 'caller' }, canManageUserTrash: false };
    const safety: UsersSafetyPort = { seededOwnerPrincipalId: options.seededOwnerPrincipalId ?? null, ownerStatus: r => ownership({ known: users, owners, principalId: r.principalId }) };
    const fail = (code: string, message: string): never => { throw new PeopleApiError({ code, message }); };
    const get = (id: string) => users.get(id) ?? fail('RESOURCE_NOT_FOUND', 'User not found.');
    let sequence = 0;
    const nextPrincipalId = () => {
        let principalId: string; do { ++sequence; principalId = `memory-user-${sequence}`; } while (users.has(principalId));
        return principalId;
    };
    return { workspaceId, options, grants, users, roles, policies, owners, trash, caller, safety, fail, get, nextPrincipalId };
}

type MemoryUsersContext = ReturnType<typeof createMemoryUsersContext>;

function memoryUserWriter(ctx: MemoryUsersContext) {
    const { get, trash, caller, grants, safety, fail } = ctx;
    return function write(id: string, action: UserAction, o: RolesCallOptions) {
        check(o); const user = get(id);
        if (trash.has(id)) {
            fail('USER_IN_TRASH', 'This user is in the Trash; restore them first.');
        }

        if (action === 'delete' && id === caller.user.id) {
            fail('SELF_DELETE', 'You cannot delete your own account.');
        }

        if (!userActionAllowed({ user, action, permissions: grants, caller, safety })) {
            fail('FORBIDDEN', 'Mutation denied.');
        }

        return user;
    };
}

function memoryUserPassword(ctx: MemoryUsersContext) {
    const { fail } = ctx;
    const password = (value: string) => {
        if (!value || [...value].length > 512) {
            fail('VALIDATION_ERROR', 'Password must be present and no more than 512 characters.');
        }
    };
    return password;
}

function memoryOwnerGuard(ctx: MemoryUsersContext) {
    const { users, owners, fail } = ctx;
    /** Disabling or deleting an active owner must leave another active owner behind. */
    function keepAnotherActiveOwner(u: AdminOperator, _optional: Record<string, never> = {}): void {
        if (u.status === 'active' && owners.has(u.principalId) && [...users.values()].filter(v => v.status === 'active' && owners.has(v.principalId)).length <= 1) {
            fail('OWNER_REQUIRED', 'The workspace must keep at least one active owner.');
        }

    }
    return keepAnotherActiveOwner;
}

function memoryGrantClamp(ctx: MemoryUsersContext) {
    const { grants, fail } = ctx;
    function clamp(contents: readonly string[] | undefined) {
        if (grants.includes('*')) {
            return;
        }
        if (!contents || contents.some(p => !grants.includes(p))) {
            fail('GRANT_EXCEEDS_ISSUER', 'Grant exceeds issuer.');
        }
    }
    return clamp;
}

function memoryUserReads(ctx: MemoryUsersContext): Pick<UsersApiPort, 'listUsers' | 'listRoles' | 'listPolicies' | 'me'> {
    const { users, trash, roles, policies, caller } = ctx;
    return {
        async listUsers(_r, o = {}) { check(o); return { users: [...users.values()].filter(u => !trash.has(u.principalId)).map(clone) }; },
        async listRoles(_r, o = {}) { check(o); return { roles: roles.map(r => ({ ...r })) }; },
        async listPolicies(_r, o = {}) { check(o); return { policies: policies.map(p => ({ ...p })) }; },
        async me(_r, o = {}) { check(o); return structuredClone(caller); },
    };
}

function memoryUserCreation(ctx: MemoryUsersContext): Pick<UsersApiPort, 'createUser'> {
    const { grants, fail, users, trash, workspaceId, nextPrincipalId } = ctx;
    const password = memoryUserPassword(ctx);
    return {
        async createUser(r, o = {}) {
            check(o); if (!hasAdminGrant({ permissions: grants, permission: 'user.manage' })) {
                fail('FORBIDDEN', 'Missing user.manage.');
            }

            const username = r.username.trim().normalize('NFC').toLowerCase(); if (!username) {
                fail('VALIDATION_ERROR', 'Username is required.');
            }
            password(r.password);
            const existing = [...users.values()].find(u => u.username.normalize('NFC').toLowerCase() === username);
            if (existing) {
                fail(trash.has(existing.principalId) ? 'USERNAME_IN_TRASH' : 'RESOURCE_CONFLICT', 'Username already exists.');
            }

            const principalId = nextPrincipalId();
            const user: AdminOperator = { principalId, workspaceId, username, status: 'active', createdAt: new Date(0).toISOString(), roleIds: [], policyIds: [], ...(o.email !== undefined ? { email: o.email } : {}) };
            users.set(principalId, user); return { user: clone(user) };
        },
    };
}

function memoryUserChanges(ctx: MemoryUsersContext): Pick<UsersApiPort, 'updateUser' | 'disableUser' | 'enableUser' | 'resetUserPassword' | 'deleteUser'> {
    const { users, trash, options } = ctx;
    const write = memoryUserWriter(ctx), password = memoryUserPassword(ctx), keepAnotherActiveOwner = memoryOwnerGuard(ctx);
    return {
        async updateUser(r, o = {}) { const u = write(r.principalId, 'email', o); const user = { ...u, ...(o.email !== undefined ? { email: o.email } : {}) }; users.set(u.principalId, user); return { user: clone(user) }; },
        async disableUser(r, o = {}) {
            const u = write(r.principalId, 'disable', o);
            keepAnotherActiveOwner(u);
            const user = { ...u, status: 'disabled' as const }; users.set(u.principalId, user); return { user: clone(user) };
        },
        async enableUser(r, o = {}) { const u = write(r.principalId, 'enable', o); const user = { ...u, status: 'active' as const }; users.set(u.principalId, user); return { user: clone(user) }; },
        async resetUserPassword(r, o = {}) { write(r.principalId, 'reset', o); password(r.password); options.onPasswordReset?.(r); },
        async deleteUser(r, o = {}) { const u = write(r.principalId, 'delete', o); keepAnotherActiveOwner(u); users.set(u.principalId, { ...u, status: 'disabled' }); trash.add(u.principalId); },
    };
}

function memoryUserGrants(ctx: MemoryUsersContext): Pick<UsersApiPort, 'assignRole' | 'attachPolicy'> {
    const { users, roles, policies, options, fail } = ctx;
    const write = memoryUserWriter(ctx), clamp = memoryGrantClamp(ctx);
    return {
        async assignRole(r, o = {}) {
            const u = write(r.principalId, 'grants', o); if (!roles.some(v => v.id === r.roleId)) {
                fail('RESOURCE_NOT_FOUND', 'Role not found.');
            }
            clamp(options.rolePermissions?.[r.roleId]); users.set(u.principalId, { ...u, roleIds: [...new Set([...u.roleIds, r.roleId])] }); return { assignment: { principalId: u.principalId, roleId: r.roleId } };
        },
        async attachPolicy(r, o = {}) {
            const u = write(r.principalId, 'grants', o); if (!policies.some(v => v.id === r.policyId)) {
                fail('RESOURCE_NOT_FOUND', 'Policy not found.');
            }
            clamp(options.policyPermissions?.[r.policyId]); users.set(u.principalId, { ...u, policyIds: [...new Set([...u.policyIds, r.policyId])] }); return { attachment: { principalId: u.principalId, policyId: r.policyId } };
        },
    };
}

/** Fake wire backend only: no persistent password storage, real sessions, audit or Trash service. */
export function createMemoryUsersApi({ workspaceId }: { workspaceId: string }, options: MemoryUsersOptions = {}): UsersApiPort {
    const ctx = createMemoryUsersContext(workspaceId, options);
    const reads = memoryUserReads(ctx), creation = memoryUserCreation(ctx), changes = memoryUserChanges(ctx), grants = memoryUserGrants(ctx);
    return {
        ...reads, ...creation,
        updateUser: changes.updateUser, disableUser: changes.disableUser, enableUser: changes.enableUser, resetUserPassword: changes.resetUserPassword,
        ...grants, deleteUser: changes.deleteUser,
    };
}
export function createMemoryMembersApi({ workspaceId }: { workspaceId: string }, { members = [], permissions = [] }: { members?: readonly AdminMember[]; permissions?: readonly string[] } = {}): MembersApiPort {
    const grants = Object.freeze([...permissions]);
    const rows = new Map(inWorkspace(members, workspaceId).map(m => [m.id, { ...m }]));
    const fail = (code: string, message: string): never => { throw new PeopleApiError({ code, message }); };
    const gate = (o: RolesCallOptions) => {
        check(o); if (!hasAdminGrant({ permissions: grants, permission: 'member.manage' })) {
            fail('FORBIDDEN', 'Missing member.manage.');
        }
    };
    const get = (id: string) => rows.get(id) ?? fail('RESOURCE_NOT_FOUND', 'Member not found.');
    return {
        /** Page scoped members by ID; return fresh copies and reject invalid cursor input.
         * @complexity O(n log n) time and O(n) space for n members; no I/O.
         */
        async listMembers(_r, o = {}) {
            check(o);
            if (o.afterId !== undefined && o.cursor != null) fail('VALIDATION_ERROR', 'Pass cursor or afterId, not both.');
            const limit = Math.min(o.limit !== undefined && Number.isFinite(o.limit) && o.limit > 0 ? Math.floor(o.limit) : 100, 100);
            const cursor = o.afterId === undefined ? o.cursor ?? null : encodeListCursor({ position: [o.afterId] });
            const page = pageFromArray({ rows: [...rows.values()], limit, cursor, positionOf: m => [m.id], shape: ['string'] });
            return { members: page.items.map(m => ({ ...m })), nextCursor: page.nextCursor };
        },
        async getMember(r, o = {}) { check(o); return { member: { ...get(r.id) } }; },
        async disableMember(r, o = {}) { gate(o); const old = get(r.id); const member = old.status === 'disabled' ? old : { ...old, status: 'disabled' as const, version: old.version + 1, updatedAt: new Date(0).toISOString() }; rows.set(member.id, member); return { member: { ...member } }; },
        async requestMemberMagicLink(r, o = {}) {
            gate(o); const address = /^[^\s@]+@([^\s@]+)$/.exec(r.email.trim()); if (!address || !address[1]!.slice(1, -1).includes('.')) {
                fail('VALIDATION_ERROR', 'Invalid email.');
            }
            return { delivered: true };
        },
    };
}
/** Deterministic credential fake; production hashing/session policy stays in the server entry. */
export function createMemoryAuthApi({ accounts }: { accounts: readonly { user: AdminAccount; password: string; disabled?: boolean }[] }, _optional: Record<string, never> = {}): AuthApiPort {
    const rows = accounts.map(a => ({ ...a, user: { ...a.user } }));
    return {
        async login(r, o = {}) {
            check(o); const found = rows.find(a => a.user.username.normalize('NFC').toLowerCase() === r.username.trim().normalize('NFC').toLowerCase()); if (!r.password || !found || found.disabled || found.password !== r.password) {
                throw new PeopleApiError({ code: 'UNAUTHENTICATED', message: 'invalid username or password' });
            }
            return { user: { ...found.user } };
        }
    };
}
