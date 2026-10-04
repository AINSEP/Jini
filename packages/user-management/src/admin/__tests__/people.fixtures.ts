import type { AdminOperator, AdminMember, RoleRecord, PolicyRecord } from '../models.js';
import { createMemoryUsersApi, createMemoryUsersSafety, createMemoryMembersApi, createMemoryAuthApi } from '../adapters/memory.js';
export const owner: AdminOperator = { principalId: 'owner', workspaceId: 'w', username: 'owner', status: 'active', createdAt: '2026-01-01', roleIds: [], policyIds: [] };
export const alice: AdminOperator = { ...owner, principalId: 'alice', username: 'alice', email: 'alice@example.test' };
export const bob: AdminOperator = { ...alice, principalId: 'bob', username: 'bob' };
export const role: RoleRecord = { id: 'r', workspaceId: 'w', name: 'Writer', isBuiltin: false };
export const policy: PolicyRecord = { id: 'p', workspaceId: 'w', name: 'Read', isBuiltin: false, isFrozen: false };
export const member: AdminMember = { id: 'm', workspaceId: 'w', email: 'member@example.test', name: 'Member', status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-01', version: 1 };
export const member2: AdminMember = { ...member, id: 'n', email: 'next@example.test' };
export function fixtures({ permissions = ['*'], callerId = 'owner', trash = true }: { permissions?: string[]; callerId?: string; trash?: boolean } = {}) {
  const api = createMemoryUsersApi({ workspaceId: 'w' }, { permissions, users: [owner, alice, bob], roles: [role], policies: [policy],
    caller: { user: { id: callerId, username: callerId }, canManageUserTrash: trash }, ownerPrincipalIds: ['owner'], seededOwnerPrincipalId: 'owner',
    rolePermissions: { r: ['content.read'] }, policyPermissions: { p: ['content.read'] } });
  const safety = createMemoryUsersSafety({ principalIds: ['owner', 'alice', 'bob'], ownerPrincipalIds: ['owner'], seededOwnerPrincipalId: 'owner' });
  return { api, safety };
}
export function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export function memberApi(permissions = ['member.manage']) { return createMemoryMembersApi({ workspaceId: 'w' }, { permissions, members: [member, member2] }); }
export function authApi() { return createMemoryAuthApi({ accounts: [{ user: { id: 'owner', username: 'admin' }, password: 'secret' }] }); }
