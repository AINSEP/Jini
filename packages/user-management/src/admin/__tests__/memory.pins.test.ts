/** Branch pins for the in-memory fakes in `../adapters/memory.ts`, written before refactoring them. */
import { describe, expect, it, vi } from 'vitest';
import { createMemoryAuthApi, createMemoryMembersApi, createMemoryRolesApi, createMemoryUsersApi, createMemoryUsersSafety } from '../adapters/memory.js';
import type { AdminMember, AdminOperator, PolicyPermissionRecord, PolicyRecord, RoleRecord } from '../models.js';

const role: RoleRecord = { id: 'r', workspaceId: 'w', name: 'Writer', isBuiltin: false };
const builtinRole: RoleRecord = { id: 'rb', workspaceId: 'w', name: 'Admin', isBuiltin: true };
const policy: PolicyRecord = { id: 'p', workspaceId: 'w', name: 'Read', isBuiltin: false, isFrozen: false };
const grant: PolicyPermissionRecord = { id: 'g', workspaceId: 'w', policyId: 'p', permission: 'content.read', resourceType: null, constraintJson: null };
const owner: AdminOperator = { principalId: 'owner', workspaceId: 'w', username: 'owner', status: 'active', createdAt: '2026-01-01', roleIds: [], policyIds: [] };
const alice: AdminOperator = { ...owner, principalId: 'alice', username: 'Alice' };
const member: AdminMember = { id: 'm', workspaceId: 'w', email: 'member@example.test', status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-01', version: 1 };

function aborted() { const c = new AbortController(); c.abort(); return { signal: c.signal }; }
function rolesErr(code: string, message: string) { return { name: 'RolesApiError', code, message }; }
function peopleErr(code: string, message: string) { return { name: 'PeopleApiError', code, message }; }

describe('createMemoryRolesApi seeding (pin)', () => {
  it('keeps only same-workspace roles, policies and grants, as snapshots', async () => {
    const seededGrant = { ...grant };
    const api = createMemoryRolesApi({ workspaceId: 'w' }, { roles: [role, { ...role, id: 'x', workspaceId: 'other' }],
      policies: [policy, { ...policy, id: 'y', workspaceId: 'other' }], policyPermissions: [seededGrant, { ...grant, id: 'z', workspaceId: 'other' }] });
    seededGrant.permission = 'tampered';
    expect((await api.listRoles({})).roles).toEqual([role]);
    expect((await api.listPolicies({})).policies).toEqual([policy]);
    expect((await api.listPolicyPermissions({ policyId: 'p' })).policyPermissions).toEqual([grant]);
  });

  it('starts empty and grant-less when no options are passed', async () => {
    const api = createMemoryRolesApi({ workspaceId: 'w' });
    expect(await api.listRoles({})).toEqual({ roles: [] });
    expect(await api.listPolicies({})).toEqual({ policies: [] });
    await expect(api.createRole({ name: 'x' })).rejects.toMatchObject(rolesErr('FORBIDDEN', 'Missing role.manage.'));
  });

  it('returns copies so callers cannot mutate stored records', async () => {
    const api = createMemoryRolesApi({ workspaceId: 'w' }, { roles: [role], policies: [policy], policyPermissions: [grant] });
    (await api.listRoles({})).roles[0]!.name = 'mutated';
    (await api.listPolicies({})).policies[0]!.name = 'mutated';
    (await api.listPolicyPermissions({ policyId: 'p' })).policyPermissions[0]!.permission = 'mutated';
    expect((await api.listRoles({})).roles[0]!.name).toBe('Writer');
    expect((await api.listPolicies({})).policies[0]!.name).toBe('Read');
    expect((await api.listPolicyPermissions({ policyId: 'p' })).policyPermissions[0]!.permission).toBe('content.read');
  });

  it('skips generated ids already taken by seeded records', async () => {
    const api = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['*'], roles: [{ ...role, id: 'memory-1', name: 'a' }],
      policies: [{ ...policy, id: 'memory-2' }], policyPermissions: [{ ...grant, id: 'memory-3', policyId: 'memory-2' }] });
    expect((await api.createRole({ name: 'b' })).role.id).toBe('memory-4');
  });
});

describe('createMemoryRolesApi operations (pin)', () => {
  const manager = () => createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['role.manage', 'content.read'], roles: [role, builtinRole], policies: [policy], policyPermissions: [grant] });

  it('honours an aborted signal on reads and writes before doing anything', async () => {
    const api = manager();
    await expect(api.listRoles({}, aborted())).rejects.toMatchObject({ name: 'AbortError' });
    await expect(api.listPolicies({}, aborted())).rejects.toMatchObject({ name: 'AbortError' });
    await expect(api.listPolicyPermissions({ policyId: 'p' }, aborted())).rejects.toMatchObject({ name: 'AbortError' });
    await expect(api.createRole({ name: 'x' }, aborted())).rejects.toMatchObject({ name: 'AbortError' });
    expect((await api.listRoles({})).roles).toHaveLength(2);
  });

  it('trims and NFC-normalizes names and rejects blank ones', async () => {
    const api = manager();
    expect((await api.createRole({ name: '  Café ' })).role).toEqual({ id: 'memory-1', workspaceId: 'w', name: 'Café', isBuiltin: false });
    await expect(api.createRole({ name: ' \t ' })).rejects.toMatchObject(rolesErr('VALIDATION_ERROR', 'Name is required.'));
  });

  it('updates a role, allowing its own name in another case but not a sibling name', async () => {
    const api = manager();
    expect((await api.updateRole({ roleId: 'r', name: 'WRITER' })).role).toEqual({ ...role, name: 'WRITER' });
    await expect(api.updateRole({ roleId: 'r', name: 'admin' })).rejects.toMatchObject(rolesErr('RESOURCE_CONFLICT', 'Name already exists.'));
    await expect(api.updateRole({ roleId: 'rb', name: 'New' })).rejects.toMatchObject(rolesErr('VALIDATION_ERROR', 'Built-in role is immutable.'));
    await expect(api.updateRole({ roleId: 'missing', name: 'New' })).rejects.toMatchObject(rolesErr('RESOURCE_NOT_FOUND', 'Role not found.'));
  });

  it('deletes an unreferenced custom role', async () => {
    const api = manager();
    await api.deleteRole({ roleId: 'r' });
    expect((await api.listRoles({})).roles.map(r => r.id)).toEqual(['rb']);
  });

  it('creates policies with and without a description', async () => {
    const api = manager();
    expect((await api.createPolicy({ name: 'Plain' })).policy).toEqual({ id: 'memory-1', workspaceId: 'w', name: 'Plain', isBuiltin: false, isFrozen: false });
    expect((await api.createPolicy({ name: 'Doc' }, { description: '' })).policy).toEqual({ id: 'memory-2', workspaceId: 'w', name: 'Doc', isBuiltin: false, isFrozen: false, description: '' });
    await expect(api.createPolicy({ name: 'read' })).rejects.toMatchObject(rolesErr('RESOURCE_CONFLICT', 'Name already exists.'));
  });

  it('updates a policy name, description or both, and requires at least one', async () => {
    const api = manager();
    await expect(api.updatePolicy({ policyId: 'p' })).rejects.toMatchObject(rolesErr('VALIDATION_ERROR', 'At least one of name or description is required.'));
    expect((await api.updatePolicy({ policyId: 'p' }, { description: 'why' })).policy).toEqual({ ...policy, description: 'why' });
    expect((await api.updatePolicy({ policyId: 'p' }, { name: ' Reader ' })).policy).toEqual({ ...policy, name: 'Reader', description: 'why' });
    await expect(api.updatePolicy({ policyId: 'missing' }, { name: 'x' })).rejects.toMatchObject(rolesErr('RESOURCE_NOT_FOUND', 'Policy not found.'));
  });

  it('refuses frozen and built-in policies', async () => {
    const api = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['*'], policies: [{ ...policy, isFrozen: true }, { ...policy, id: 'b', name: 'B', isBuiltin: true }] });
    const immutable = rolesErr('VALIDATION_ERROR', 'Built-in or frozen policy is immutable.');
    await expect(api.updatePolicy({ policyId: 'p' }, { name: 'x' })).rejects.toMatchObject(immutable);
    await expect(api.deletePolicy({ policyId: 'b' })).rejects.toMatchObject(immutable);
    await expect(api.writePolicyPermission({ policyId: 'b', permission: 'content.read' })).rejects.toMatchObject(immutable);
    await expect(api.removePolicyPermission({ policyId: 'p', policyPermissionId: 'g' })).rejects.toMatchObject(immutable);
  });

  it('deletes a policy together with only its own grants', async () => {
    const api = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['*'], policies: [policy, { ...policy, id: 'q', name: 'Q' }],
      policyPermissions: [grant, { ...grant, id: 'g2' }, { ...grant, id: 'h', policyId: 'q' }] });
    await api.deletePolicy({ policyId: 'p' });
    expect((await api.listPolicies({})).policies.map(p => p.id)).toEqual(['q']);
    expect((await api.listPolicyPermissions({ policyId: 'q' })).policyPermissions.map(p => p.id)).toEqual(['h']);
    await expect(api.listPolicyPermissions({ policyId: 'p' })).rejects.toMatchObject(rolesErr('RESOURCE_NOT_FOUND', 'Policy not found.'));
  });

  it('writes grants held exactly or through the wildcard, normalizing an empty resource type to null', async () => {
    const exact = manager();
    expect((await exact.writePolicyPermission({ policyId: 'p', permission: 'content.read' }, { resourceType: '' })).policyPermission)
      .toEqual({ id: 'memory-1', workspaceId: 'w', policyId: 'p', permission: 'content.read', resourceType: null, constraintJson: null });
    const wildcard = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['*'], policies: [policy] });
    expect((await wildcard.writePolicyPermission({ policyId: 'p', permission: 'user.manage' })).policyPermission.resourceType).toBeNull();
    await expect(exact.writePolicyPermission({ policyId: 'p', permission: 'user.manage' })).rejects.toMatchObject(rolesErr('GRANT_EXCEEDS_ISSUER', 'Grant exceeds issuer.'));
  });

  it('checks a custom catalog before issuer authority', async () => {
    const api = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['*'], catalog: ['custom.only'], policies: [policy] });
    await expect(api.writePolicyPermission({ policyId: 'p', permission: 'content.read' })).rejects.toMatchObject(rolesErr('PERMISSION_UNKNOWN', 'Unrecognized permission.'));
    expect((await api.writePolicyPermission({ policyId: 'p', permission: 'custom.only' }, { resourceType: 'page' })).policyPermission.resourceType).toBe('page');
  });

  it('removes a grant only from the policy that owns it', async () => {
    const api = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['*'], policies: [policy, { ...policy, id: 'q', name: 'Q' }], policyPermissions: [grant] });
    const notFound = rolesErr('RESOURCE_NOT_FOUND', 'Permission not found on this policy.');
    await expect(api.removePolicyPermission({ policyId: 'q', policyPermissionId: 'g' })).rejects.toMatchObject(notFound);
    await expect(api.removePolicyPermission({ policyId: 'p', policyPermissionId: 'missing' })).rejects.toMatchObject(notFound);
    await api.removePolicyPermission({ policyId: 'p', policyPermissionId: 'g' });
    expect((await api.listPolicyPermissions({ policyId: 'p' })).policyPermissions).toEqual([]);
  });
});

describe('createMemoryUsersSafety (pin)', () => {
  it('reports owner, operator and unknown, and exposes the seeded owner', () => {
    const safety = createMemoryUsersSafety({ principalIds: ['a', 'b'], ownerPrincipalIds: ['a', 'ghost'], seededOwnerPrincipalId: 'a' });
    expect(safety.seededOwnerPrincipalId).toBe('a');
    expect(['a', 'b', 'ghost'].map(principalId => safety.ownerStatus({ principalId }))).toEqual(['owner', 'operator', 'unknown']);
  });
});

describe('createMemoryUsersApi (pin)', () => {
  const full = (extra: Parameters<typeof createMemoryUsersApi>[1] = {}) => createMemoryUsersApi({ workspaceId: 'w' }, {
    permissions: ['*'], users: [owner, alice], roles: [role], policies: [policy], ownerPrincipalIds: ['owner'], seededOwnerPrincipalId: 'owner',
    caller: { user: { id: 'owner', username: 'owner' }, canManageUserTrash: true }, ...extra });

  it('defaults to an empty workspace and a grant-less placeholder caller', async () => {
    const api = createMemoryUsersApi({ workspaceId: 'w' });
    expect(await api.me({})).toEqual({ user: { id: 'memory-caller', username: 'caller' }, canManageUserTrash: false });
    expect(await api.listUsers({})).toEqual({ users: [] });
    expect(await api.listRoles({})).toEqual({ roles: [] });
    expect(await api.listPolicies({})).toEqual({ policies: [] });
    await expect(api.createUser({ username: 'x', password: 'y' })).rejects.toMatchObject(peopleErr('FORBIDDEN', 'Missing user.manage.'));
  });

  it('filters foreign roles and policies and honours an aborted signal on reads', async () => {
    const api = full({ roles: [role, { ...role, id: 'x', workspaceId: 'other' }], policies: [policy, { ...policy, id: 'y', workspaceId: 'other' }] });
    expect((await api.listRoles({})).roles).toEqual([role]);
    expect((await api.listPolicies({})).policies).toEqual([policy]);
    for (const read of [() => api.listUsers({}, aborted()), () => api.listRoles({}, aborted()), () => api.listPolicies({}, aborted()), () => api.me({}, aborted())])
      await expect(read()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('returns a structured clone of the caller', async () => {
    const api = full();
    const me = await api.me({});
    me.user.id = 'mutated';
    expect((await api.me({})).user.id).toBe('owner');
  });

  it('creates users with normalized names, skipped ids and an optional email', async () => {
    const api = full({ users: [owner, { ...alice, principalId: 'memory-user-1' }] });
    expect((await api.createUser({ username: '  NewOne ', password: 'pw' })).user).toEqual({ principalId: 'memory-user-2', workspaceId: 'w', username: 'newone',
      status: 'active', createdAt: '1970-01-01T00:00:00.000Z', roleIds: [], policyIds: [] });
    expect((await api.createUser({ username: 'mailed', password: 'pw' }, { email: 'm@example.test' })).user.email).toBe('m@example.test');
  });

  it('validates usernames, passwords and uniqueness on create', async () => {
    const api = full();
    await expect(api.createUser({ username: '   ', password: 'pw' })).rejects.toMatchObject(peopleErr('VALIDATION_ERROR', 'Username is required.'));
    const badPassword = peopleErr('VALIDATION_ERROR', 'Password must be present and no more than 512 characters.');
    await expect(api.createUser({ username: 'a', password: '' })).rejects.toMatchObject(badPassword);
    await expect(api.createUser({ username: 'a', password: 'x'.repeat(513) })).rejects.toMatchObject(badPassword);
    // Length counts code points, so 512 astral characters (1024 UTF-16 units) still fit.
    expect((await api.createUser({ username: 'astral', password: '\u{1F600}'.repeat(512) })).user.username).toBe('astral');
    await expect(api.createUser({ username: 'ALICE', password: 'pw' })).rejects.toMatchObject(peopleErr('RESOURCE_CONFLICT', 'Username already exists.'));
  });

  it('refuses writes to unknown users and honours an aborted signal first', async () => {
    const api = full();
    await expect(api.updateUser({ principalId: 'ghost' })).rejects.toMatchObject(peopleErr('RESOURCE_NOT_FOUND', 'User not found.'));
    await expect(api.updateUser({ principalId: 'ghost' }, aborted())).rejects.toMatchObject({ name: 'AbortError' });
    await expect(api.createUser({ username: 'a', password: 'b' }, aborted())).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('updates email only when one is passed', async () => {
    const api = full();
    expect((await api.updateUser({ principalId: 'alice' })).user).toEqual(alice);
    expect((await api.updateUser({ principalId: 'alice' }, { email: 'a@example.test' })).user.email).toBe('a@example.test');
  });

  it('denies a write the rules refuse with FORBIDDEN', async () => {
    const api = full({ permissions: ['member.manage'] });
    await expect(api.disableUser({ principalId: 'alice' })).rejects.toMatchObject(peopleErr('FORBIDDEN', 'Mutation denied.'));
  });

  it('disables and re-enables an operator', async () => {
    const api = full();
    expect((await api.disableUser({ principalId: 'alice' })).user.status).toBe('disabled');
    expect((await api.enableUser({ principalId: 'alice' })).user.status).toBe('active');
  });

  it('keeps the last active owner on disable and delete, but not when another owner is active', async () => {
    const required = peopleErr('OWNER_REQUIRED', 'The workspace must keep at least one active owner.');
    const coOwner: AdminOperator = { ...owner, principalId: 'co', username: 'co' };
    // The seeded owner itself can never be disabled, so the last-owner guard is reached through a co-owner.
    const lastOwner = full({ users: [owner, coOwner], ownerPrincipalIds: ['co'] });
    await expect(lastOwner.disableUser({ principalId: 'co' })).rejects.toMatchObject(required);
    await expect(lastOwner.deleteUser({ principalId: 'co' })).rejects.toMatchObject(required);
    const twoOwners = full({ users: [owner, coOwner], ownerPrincipalIds: ['owner', 'co'] });
    expect((await twoOwners.disableUser({ principalId: 'co' })).user.status).toBe('disabled');
    const deletable = full({ users: [owner, coOwner], ownerPrincipalIds: ['owner', 'co'] });
    await deletable.deleteUser({ principalId: 'co' });
    expect((await deletable.listUsers({})).users.map(u => u.principalId)).toEqual(['owner']);
  });

  it('refuses deleting yourself before consulting the rules', async () => {
    const api = full({ caller: { user: { id: 'alice', username: 'alice' } }, permissions: [] });
    await expect(api.deleteUser({ principalId: 'alice' })).rejects.toMatchObject(peopleErr('SELF_DELETE', 'You cannot delete your own account.'));
  });

  it('resets passwords through the host callback after validating the new password', async () => {
    const onPasswordReset = vi.fn();
    const api = full({ onPasswordReset });
    await api.resetUserPassword({ principalId: 'alice', password: 'fresh' });
    expect(onPasswordReset).toHaveBeenCalledWith({ principalId: 'alice', password: 'fresh' });
    await expect(api.resetUserPassword({ principalId: 'alice', password: '' })).rejects.toMatchObject(peopleErr('VALIDATION_ERROR', 'Password must be present and no more than 512 characters.'));
    expect(onPasswordReset).toHaveBeenCalledTimes(1);
    await full().resetUserPassword({ principalId: 'alice', password: 'no-callback' });
  });

  it('assigns roles and attaches policies once, refusing unknown ids', async () => {
    const api = full();
    await api.assignRole({ principalId: 'alice', roleId: 'r' });
    expect(await api.assignRole({ principalId: 'alice', roleId: 'r' })).toEqual({ assignment: { principalId: 'alice', roleId: 'r' } });
    await api.attachPolicy({ principalId: 'alice', policyId: 'p' });
    expect(await api.attachPolicy({ principalId: 'alice', policyId: 'p' })).toEqual({ attachment: { principalId: 'alice', policyId: 'p' } });
    const stored = (await api.listUsers({})).users.find(u => u.principalId === 'alice')!;
    expect([stored.roleIds, stored.policyIds]).toEqual([['r'], ['p']]);
    await expect(api.assignRole({ principalId: 'alice', roleId: 'nope' })).rejects.toMatchObject(peopleErr('RESOURCE_NOT_FOUND', 'Role not found.'));
    await expect(api.attachPolicy({ principalId: 'alice', policyId: 'nope' })).rejects.toMatchObject(peopleErr('RESOURCE_NOT_FOUND', 'Policy not found.'));
  });

  it('clamps non-wildcard issuers to known grant contents they fully hold', async () => {
    const exceeds = peopleErr('GRANT_EXCEEDS_ISSUER', 'Grant exceeds issuer.');
    const scoped = (extra: Parameters<typeof createMemoryUsersApi>[1]) => full({ permissions: ['role.manage', 'content.read'], ...extra });
    await expect(scoped({}).assignRole({ principalId: 'alice', roleId: 'r' })).rejects.toMatchObject(exceeds);
    await expect(scoped({}).attachPolicy({ principalId: 'alice', policyId: 'p' })).rejects.toMatchObject(exceeds);
    await expect(scoped({ rolePermissions: { r: ['content.read', 'user.manage'] } }).assignRole({ principalId: 'alice', roleId: 'r' })).rejects.toMatchObject(exceeds);
    await scoped({ rolePermissions: { r: ['content.read'] } }).assignRole({ principalId: 'alice', roleId: 'r' });
    await scoped({ policyPermissions: { p: [] } }).attachPolicy({ principalId: 'alice', policyId: 'p' });
  });

  it('checks Trash and existence before permission, so a grant-less caller learns user state (reported, not fixed)', async () => {
    // A caller with no grants gets RESOURCE_NOT_FOUND / USER_IN_TRASH instead of FORBIDDEN,
    // which distinguishes unknown, trashed and live principal ids.
    const api = full();
    await api.deleteUser({ principalId: 'alice' });
    const nobody = full({ permissions: [], caller: { user: { id: 'x', username: 'x' } } });
    await expect(nobody.updateUser({ principalId: 'ghost' })).rejects.toMatchObject(peopleErr('RESOURCE_NOT_FOUND', 'User not found.'));
    await expect(nobody.updateUser({ principalId: 'alice' })).rejects.toMatchObject(peopleErr('FORBIDDEN', 'Mutation denied.'));
    await expect(api.updateUser({ principalId: 'alice' })).rejects.toMatchObject(peopleErr('USER_IN_TRASH', 'This user is in the Trash; restore them first.'));
  });
});

describe('createMemoryMembersApi (pin)', () => {
  const rows = ['c', 'a', 'b', 'd'].map(id => ({ ...member, id }));
  const api = (permissions: string[] = ['member.manage']) => createMemoryMembersApi({ workspaceId: 'w' }, { permissions, members: [...rows, { ...member, id: 'f', workspaceId: 'other' }] });
  const ids = async (o: { afterId?: string; limit?: number }) => (await api().listMembers({}, o)).members.map(m => m.id);

  it('lists same-workspace members sorted by id with a cursor and a sane limit', async () => {
    expect(await ids({})).toEqual(['a', 'b', 'c', 'd']);
    expect(await ids({ afterId: 'b' })).toEqual(['c', 'd']);
    expect(await ids({ limit: 2.9 })).toEqual(['a', 'b']);
    for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(await ids({ limit })).toEqual(['a', 'b', 'c', 'd']);
    expect(await createMemoryMembersApi({ workspaceId: 'w' }).listMembers({})).toEqual({ members: [] });
  });

  it('caps an unset limit at 100 members', async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ ...member, id: `m${String(i).padStart(3, '0')}` }));
    expect((await createMemoryMembersApi({ workspaceId: 'w' }, { members: many }).listMembers({})).members).toHaveLength(100);
  });

  it('gets a member or reports it missing, and honours an aborted signal', async () => {
    expect((await api().getMember({ id: 'a' })).member.id).toBe('a');
    await expect(api().getMember({ id: 'zz' })).rejects.toMatchObject(peopleErr('RESOURCE_NOT_FOUND', 'Member not found.'));
    await expect(api().getMember({ id: 'a' }, aborted())).rejects.toMatchObject({ name: 'AbortError' });
    await expect(api().listMembers({}, aborted())).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('serves member reads without member.manage (reported, not fixed)', async () => {
    // Only writes are gated in the fake; a grant-less caller can enumerate members and their emails.
    expect((await api([]).listMembers({})).members).toHaveLength(4);
    expect((await api([]).getMember({ id: 'a' })).member.email).toBe('member@example.test');
  });

  it('disables idempotently, bumping version once', async () => {
    const a = api();
    expect((await a.disableMember({ id: 'a' })).member).toEqual({ ...member, id: 'a', status: 'disabled', version: 2, updatedAt: '1970-01-01T00:00:00.000Z' });
    expect((await a.disableMember({ id: 'a' })).member.version).toBe(2);
    await expect(a.disableMember({ id: 'zz' })).rejects.toMatchObject(peopleErr('RESOURCE_NOT_FOUND', 'Member not found.'));
  });

  it('gates writes on member.manage or the wildcard', async () => {
    const forbidden = peopleErr('FORBIDDEN', 'Missing member.manage.');
    await expect(api(['user.manage']).disableMember({ id: 'a' })).rejects.toMatchObject(forbidden);
    await expect(api([]).requestMemberMagicLink({ email: 'a@b.co' })).rejects.toMatchObject(forbidden);
    expect((await api(['*']).disableMember({ id: 'a' })).member.status).toBe('disabled');
    await expect(api().disableMember({ id: 'a' }, aborted())).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('accepts a trimmed plausible email for magic links and refuses others', async () => {
    expect(await api().requestMemberMagicLink({ email: '  a@b.co ' })).toEqual({ delivered: true });
    for (const email of ['', 'a@b', 'a b@c.d', '@b.co', 'a@@b.co'])
      await expect(api().requestMemberMagicLink({ email })).rejects.toMatchObject(peopleErr('VALIDATION_ERROR', 'Invalid email.'));
  });
});

describe('createMemoryAuthApi (pin)', () => {
  const password = ['s', 'e', 'c', 'r', 'e', 't'].join('');
  const auth = () => createMemoryAuthApi({ accounts: [{ user: { id: 'a', username: 'Admin' }, password }, { user: { id: 'd', username: 'off' }, password, disabled: true }] });
  const invalid = peopleErr('UNAUTHENTICATED', 'invalid username or password');

  it('logs in by trimmed, case-insensitive username and returns a copy', async () => {
    const api = auth();
    const first = await api.login({ username: '  ADMIN ', password });
    expect(first).toEqual({ user: { id: 'a', username: 'Admin' } });
    first.user.id = 'mutated';
    expect((await api.login({ username: 'admin', password })).user.id).toBe('a');
  });

  it('refuses wrong, empty, unknown and disabled credentials with one message', async () => {
    await expect(auth().login({ username: 'admin', password: 'wrong' })).rejects.toMatchObject(invalid);
    await expect(auth().login({ username: 'admin', password: '' })).rejects.toMatchObject(invalid);
    await expect(auth().login({ username: 'nobody', password })).rejects.toMatchObject(invalid);
    await expect(auth().login({ username: 'off', password })).rejects.toMatchObject(invalid);
    await expect(auth().login({ username: 'admin', password }, aborted())).rejects.toMatchObject({ name: 'AbortError' });
  });
});
