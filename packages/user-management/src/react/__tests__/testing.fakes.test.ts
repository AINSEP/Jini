import { describe, expect, it } from 'vitest';
import { createFakeMembersPort, createFakeRolesPort, createFakeUsersPort } from '../testing.js';
import type { AdminMember, AdminPolicy, AdminRole } from '../models.js';

// The fakes ship as a public `./react/testing` entry, so consumers rely on them behaving like the
// real ports: mutations are visible through the list calls, unknown ids reject, and each
// configured error rejects only its own operation.

const policy: AdminPolicy = { id: 'p1', workspaceId: 'ws', name: 'Editors', isBuiltin: false, isFrozen: false };
const role: AdminRole = { id: 'r1', workspaceId: 'ws', name: 'Reviewer', isBuiltin: false };

describe('createFakeRolesPort', () => {
  it('starts empty when no seed data is supplied', async () => {
    const port = createFakeRolesPort({});
    await expect(port.listRoles({})).resolves.toEqual({ roles: [] });
    await expect(port.listPolicies({})).resolves.toEqual({ policies: [] });
    expect(port.policyPermissions).toEqual([]);
  });

  it('creates, renames and deletes roles, observable through listRoles', async () => {
    const port = createFakeRolesPort({}, { roles: [role] });
    const { role: created } = await port.createRole({ name: 'Auditor' });
    expect(created).toEqual({ id: 'fake-role-2', workspaceId: 'fake-ws', name: 'Auditor', isBuiltin: false });
    const { role: renamed } = await port.updateRole({ roleId: 'r1', name: 'Lead reviewer' });
    expect(renamed).toEqual({ ...role, name: 'Lead reviewer' });
    await port.deleteRole({ roleId: 'fake-role-2' });
    expect((await port.listRoles({})).roles).toEqual([{ ...role, name: 'Lead reviewer' }]);
  });

  it('rejects updates and deletes of unknown roles without mutating the list', async () => {
    const port = createFakeRolesPort({}, { roles: [role] });
    await expect(port.updateRole({ roleId: 'missing', name: 'x' })).rejects.toThrow('fake role not found: missing');
    await expect(port.deleteRole({ roleId: 'missing' })).rejects.toThrow('fake role not found: missing');
    expect(port.roles).toEqual([role]);
  });

  it('creates policies with an optional description, updates keep the name when omitted, and deletes', async () => {
    const port = createFakeRolesPort({}, { policies: [policy] });
    const { policy: created } = await port.createPolicy({ name: 'Viewers' }, { description: 'read only' });
    expect(created).toEqual({ id: 'fake-policy-2', workspaceId: 'fake-ws', name: 'Viewers', description: 'read only', isBuiltin: false, isFrozen: false });
    const { policy: described } = await port.updatePolicy({ policyId: 'p1' }, { description: 'can edit' });
    expect(described).toEqual({ ...policy, description: 'can edit' });
    const { policy: renamed } = await port.updatePolicy({ policyId: 'p1' }, { name: 'Writers' });
    expect(renamed.name).toBe('Writers');
    await port.deletePolicy({ policyId: 'fake-policy-2' });
    expect((await port.listPolicies({})).policies.map((p) => p.id)).toEqual(['p1']);
  });

  it('rejects policy updates and deletes for unknown ids', async () => {
    const port = createFakeRolesPort({}, { policies: [policy] });
    await expect(port.updatePolicy({ policyId: 'nope' })).rejects.toThrow('fake policy not found: nope');
    await expect(port.deletePolicy({ policyId: 'nope' })).rejects.toThrow('fake policy not found: nope');
  });

  it('writes, lists per policy and removes policy permissions', async () => {
    const other: AdminPolicy = { ...policy, id: 'p2' };
    const port = createFakeRolesPort({}, { policies: [policy, other] });
    const { policyPermission: scoped } = await port.writePolicyPermission({ policyId: 'p1', permission: 'content.write' }, { resourceType: 'doc' });
    expect(scoped).toEqual({ id: 'fake-perm-1', workspaceId: 'fake-ws', policyId: 'p1', permission: 'content.write', resourceType: 'doc', constraintJson: null });
    await port.writePolicyPermission({ policyId: 'p1', permission: 'content.read' });
    await port.writePolicyPermission({ policyId: 'p2', permission: 'billing.read' });
    const listed = (await port.listPolicyPermissions({ policyId: 'p1' })).policyPermissions;
    expect(listed.map((row) => [row.permission, row.resourceType])).toEqual([['content.write', 'doc'], ['content.read', null]]);
    await port.removePolicyPermission({ policyId: 'p1', policyPermissionId: 'fake-perm-1' });
    expect((await port.listPolicyPermissions({ policyId: 'p1' })).policyPermissions.map((row) => row.id)).toEqual(['fake-perm-2']);
  });

  it('refuses to remove a permission through the wrong policy, and rejects unknown policies', async () => {
    const other: AdminPolicy = { ...policy, id: 'p2' };
    const port = createFakeRolesPort({}, { policies: [policy, other], initialPolicyPermissions: [
      { id: 'perm-a', workspaceId: 'ws', policyId: 'p1', permission: 'x', resourceType: null, constraintJson: null },
    ] });
    await expect(port.removePolicyPermission({ policyId: 'p2', policyPermissionId: 'perm-a' }))
      .rejects.toThrow("policy permission 'perm-a' was not found on policy 'p2'");
    expect(port.policyPermissions).toHaveLength(1);
    await expect(port.writePolicyPermission({ policyId: 'ghost', permission: 'x' })).rejects.toThrow('fake policy not found: ghost');
    await expect(port.listPolicyPermissions({ policyId: 'ghost' })).rejects.toThrow('fake policy not found: ghost');
    await expect(port.removePolicyPermission({ policyId: 'ghost', policyPermissionId: 'perm-a' })).rejects.toThrow('fake policy not found: ghost');
  });

  it('rejects each operation with its configured error and leaves state untouched', async () => {
    const err = (name: string) => new Error(`${name} failed`);
    const port = createFakeRolesPort({}, {
      roles: [role], policies: [policy],
      createRoleError: err('createRole'), updateRoleError: err('updateRole'), deleteRoleError: err('deleteRole'),
      createPolicyError: err('createPolicy'), updatePolicyError: err('updatePolicy'), deletePolicyError: err('deletePolicy'),
      writePermissionError: err('writePermission'), listPermissionsError: err('listPermissions'), removePermissionError: err('removePermission'),
    });
    await expect(port.createRole({ name: 'x' })).rejects.toThrow('createRole failed');
    await expect(port.updateRole({ roleId: 'r1', name: 'x' })).rejects.toThrow('updateRole failed');
    await expect(port.deleteRole({ roleId: 'r1' })).rejects.toThrow('deleteRole failed');
    await expect(port.createPolicy({ name: 'x' })).rejects.toThrow('createPolicy failed');
    await expect(port.updatePolicy({ policyId: 'p1' }, { name: 'x' })).rejects.toThrow('updatePolicy failed');
    await expect(port.deletePolicy({ policyId: 'p1' })).rejects.toThrow('deletePolicy failed');
    await expect(port.writePolicyPermission({ policyId: 'p1', permission: 'x' })).rejects.toThrow('writePermission failed');
    await expect(port.listPolicyPermissions({ policyId: 'p1' })).rejects.toThrow('listPermissions failed');
    await expect(port.removePolicyPermission({ policyId: 'p1', policyPermissionId: 'x' })).rejects.toThrow('removePermission failed');
    expect(port.roles).toEqual([role]);
    expect(port.policies).toEqual([policy]);
  });
});

describe('createFakeUsersPort', () => {
  it('rejects status toggles for unknown principals and surfaces the configured toggle error on enable', async () => {
    const port = createFakeUsersPort({});
    await expect(port.disableUser({ principalId: 'ghost' })).rejects.toThrow('fake user not found: ghost');
    await expect(port.enableUser({ principalId: 'ghost' })).rejects.toThrow('fake user not found: ghost');
    const failing = createFakeUsersPort({}, { toggleStatusError: new Error('toggle refused') });
    await expect(failing.enableUser({ principalId: 'ghost' })).rejects.toThrow('toggle refused');
  });

  it('gives created users sequential ids', async () => {
    const port = createFakeUsersPort({});
    const { user: first } = await port.createUser({ username: 'a', password: 'pw' });
    const { user: second } = await port.createUser({ username: 'b', password: 'pw' }, { email: 'b@example.test' });
    expect([first.principalId, second.principalId]).toEqual(['fake-user-1', 'fake-user-2']);
    expect(second.email).toBe('b@example.test');
  });
});

describe('createFakeMembersPort', () => {
  it('returns known members and rejects unknown ids on read', async () => {
    const member = { id: 'm1', email: 'm@example.test', status: 'active' } as AdminMember;
    const port = createFakeMembersPort({}, { members: [member] });
    await expect(port.getMember({ id: 'm1' })).resolves.toEqual({ member });
    await expect(port.getMember({ id: 'nope' })).rejects.toThrow('fake member not found: nope');
    await expect(port.disableMember({ id: 'nope' })).rejects.toThrow('fake member not found: nope');
    expect(port.members).toEqual([member]);
  });
});
