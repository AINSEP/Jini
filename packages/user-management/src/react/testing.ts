import type { AdminUser, AdminIdentityUser, AdminRole, AdminPolicy, AdminPolicyPermission, AdminMember } from "./models.js";
import type { LoginPort, UsersPort, RolesPort, MembersPort } from "./ports.js";


const FAKE_USER: AdminUser = { id: "fake-user-1", username: "fake-admin" };

export interface FakeLoginPortOptions {

  user?: AdminUser | undefined;

  loginError?: Error | undefined;
}

export function createFakeLoginPort(_required: Record<string, never>, options: FakeLoginPortOptions = {}): LoginPort {
  return {
    async login() {
      if (options.loginError) throw options.loginError;
      return { user: options.user ?? FAKE_USER };
    },
  };
}



const FAKE_WORKSPACE_ID = "fake-ws";

function fakeUser(overrides: Partial<AdminIdentityUser> = {}): AdminIdentityUser {
  return {
    principalId: overrides.principalId ?? "fake-user-1",
    workspaceId: FAKE_WORKSPACE_ID,
    username: "fake",
    status: "active",
    createdAt: new Date(0).toISOString(),
    roleIds: [],
    policyIds: [],
    ...overrides,
  };
}

export interface FakeUsersPortOptions {
  users?: AdminIdentityUser[] | undefined;
  roles?: AdminRole[] | undefined;
  policies?: AdminPolicy[] | undefined;

  meId?: string | undefined;

  canManageUserTrash?: boolean | undefined;

  createUserError?: Error | undefined;

  updateUserError?: Error | undefined;

  toggleStatusError?: Error | undefined;

  resetPasswordError?: Error | undefined;

  assignRoleError?: Error | undefined;

  attachPolicyError?: Error | undefined;

  deleteUserError?: Error | undefined;
}

export function createFakeUsersPort(_required: Record<string, never>, options: FakeUsersPortOptions = {}): UsersPort & {

  readonly users: AdminIdentityUser[];
} {
  const users = [...(options.users ?? [])];
  const roles = [...(options.roles ?? [])];
  const policies = [...(options.policies ?? [])];

  function requireUser(principalId: string): AdminIdentityUser {
    const found = users.find((u) => u.principalId === principalId);
    if (!found) throw new Error(`fake user not found: ${principalId}`);
    return found;
  }

  function replaceUser(updated: AdminIdentityUser): AdminIdentityUser {
    const index = users.findIndex((u) => u.principalId === updated.principalId);
    users[index] = updated;
    return updated;
  }

  const meId = options.meId ?? users[0]?.principalId ?? "fake-user-1";
  const canManageUserTrash = options.canManageUserTrash ?? true;

  return {
    users,
    async me() {
      return { user: { id: meId }, canManageUserTrash };
    },
    async listUsers() {
      return { users: [...users] };
    },
    async listRoles() {
      return { roles: [...roles] };
    },
    async listPolicies() {
      return { policies: [...policies] };
    },
    async createUser(input, opts) {
      if (options.createUserError) throw options.createUserError;
      const created = fakeUser({
        principalId: `fake-user-${users.length + 1}`,
        username: input.username,
        email: opts?.email,
      });
      users.push(created);
      return { user: created };
    },
    async updateUser(target, opts) {
      if (options.updateUserError) throw options.updateUserError;
      const current = requireUser(target.principalId);
      return { user: replaceUser({ ...current, ...opts }) };
    },
    async disableUser({ principalId }) {
      if (options.toggleStatusError) throw options.toggleStatusError;
      const current = requireUser(principalId);
      return { user: replaceUser({ ...current, status: "disabled" }) };
    },
    async enableUser({ principalId }) {
      if (options.toggleStatusError) throw options.toggleStatusError;
      const current = requireUser(principalId);
      return { user: replaceUser({ ...current, status: "active" }) };
    },
    async resetUserPassword() {
      if (options.resetPasswordError) throw options.resetPasswordError;
    },
    async assignRole(input) {
      if (options.assignRoleError) throw options.assignRoleError;
      const current = requireUser(input.principalId);
      replaceUser({ ...current, roleIds: [...current.roleIds, input.roleId] });
      return { assignment: {} };
    },
    async attachPolicy(input) {
      if (options.attachPolicyError) throw options.attachPolicyError;
      const current = requireUser(input.principalId);
      replaceUser({ ...current, policyIds: [...current.policyIds, input.policyId] });
      return { attachment: {} };
    },
    async deleteUser({ principalId }) {
      if (options.deleteUserError) throw options.deleteUserError;
      requireUser(principalId);

      const index = users.findIndex((u) => u.principalId === principalId);
      users.splice(index, 1);
    },
  };
}





function fakeRole(overrides: Partial<AdminRole> = {}): AdminRole {
  return {
    id: overrides.id ?? "fake-role-1",
    workspaceId: FAKE_WORKSPACE_ID,
    name: "Fake role",
    isBuiltin: false,
    ...overrides,
  };
}

function fakePolicy(overrides: Partial<AdminPolicy> = {}): AdminPolicy {
  return {
    id: overrides.id ?? "fake-policy-1",
    workspaceId: FAKE_WORKSPACE_ID,
    name: "Fake policy",
    isBuiltin: false,
    isFrozen: false,
    ...overrides,
  };
}

export interface FakeRolesPortOptions {
  roles?: AdminRole[] | undefined;
  policies?: AdminPolicy[] | undefined;

  createRoleError?: Error | undefined;

  updateRoleError?: Error | undefined;

  deleteRoleError?: Error | undefined;

  createPolicyError?: Error | undefined;

  updatePolicyError?: Error | undefined;

  deletePolicyError?: Error | undefined;

  writePermissionError?: Error | undefined;

  listPermissionsError?: Error | undefined;

  removePermissionError?: Error | undefined;

  initialPolicyPermissions?: AdminPolicyPermission[] | undefined;
}

export function createFakeRolesPort(_required: Record<string, never>, options: FakeRolesPortOptions = {}): RolesPort & {

  readonly roles: AdminRole[];

  readonly policies: AdminPolicy[];

  readonly policyPermissions: AdminPolicyPermission[];
} {
  const roles = [...(options.roles ?? [])];
  const policies = [...(options.policies ?? [])];
  const policyPermissions = [...(options.initialPolicyPermissions ?? [])];

  function requireRole(roleId: string): AdminRole {
    const found = roles.find((r) => r.id === roleId);
    if (!found) throw new Error(`fake role not found: ${roleId}`);
    return found;
  }

  function requirePolicy(policyId: string): AdminPolicy {
    const found = policies.find((p) => p.id === policyId);
    if (!found) throw new Error(`fake policy not found: ${policyId}`);
    return found;
  }

  return {
    roles,
    policies,
    policyPermissions,
    async listRoles() {
      return { roles: [...roles] };
    },
    async listPolicies() {
      return { policies: [...policies] };
    },
    async createRole({ name }) {
      if (options.createRoleError) throw options.createRoleError;
      const created = fakeRole({ id: `fake-role-${roles.length + 1}`, name });
      roles.push(created);
      return { role: created };
    },
    async updateRole(input) {
      if (options.updateRoleError) throw options.updateRoleError;
      const index = roles.findIndex((r) => r.id === input.roleId);
      if (index < 0) throw new Error(`fake role not found: ${input.roleId}`);
      const updated = { ...roles[index]!, name: input.name };
      roles[index] = updated;
      return { role: updated };
    },
    async deleteRole({ roleId }) {
      if (options.deleteRoleError) throw options.deleteRoleError;
      requireRole(roleId);
      const index = roles.findIndex((r) => r.id === roleId);
      roles.splice(index, 1);
    },
    async createPolicy(input, opts) {
      if (options.createPolicyError) throw options.createPolicyError;
      const created = fakePolicy({
        id: `fake-policy-${policies.length + 1}`,
        name: input.name,
        description: opts?.description,
      });
      policies.push(created);
      return { policy: created };
    },
    async updatePolicy(target, opts) {
      if (options.updatePolicyError) throw options.updatePolicyError;
      const index = policies.findIndex((p) => p.id === target.policyId);
      if (index < 0) throw new Error(`fake policy not found: ${target.policyId}`);
      const current = policies[index]!;
      // Optional updates must retain the required name when it is omitted or undefined.
      const updated = { ...current, ...opts, name: opts?.name ?? current.name };
      policies[index] = updated;
      return { policy: updated };
    },
    async deletePolicy({ policyId }) {
      if (options.deletePolicyError) throw options.deletePolicyError;
      requirePolicy(policyId);
      const index = policies.findIndex((p) => p.id === policyId);
      policies.splice(index, 1);
    },
    async writePolicyPermission(input, opts) {
      if (options.writePermissionError) throw options.writePermissionError;
      requirePolicy(input.policyId);
      const created = {
        id: `fake-perm-${policyPermissions.length + 1}`,
        workspaceId: FAKE_WORKSPACE_ID,
        policyId: input.policyId,
        permission: input.permission,
        resourceType: opts?.resourceType ?? null,
        constraintJson: null,
      };
      policyPermissions.push(created);
      return { policyPermission: created };
    },
    async listPolicyPermissions({ policyId }) {
      if (options.listPermissionsError) throw options.listPermissionsError;
      requirePolicy(policyId);
      return { policyPermissions: policyPermissions.filter((row) => row.policyId === policyId) };
    },
    async removePolicyPermission(input) {
      if (options.removePermissionError) throw options.removePermissionError;
      requirePolicy(input.policyId);

      const index = policyPermissions.findIndex(
        (row) => row.id === input.policyPermissionId && row.policyId === input.policyId,
      );
      if (index < 0) {
        throw new Error(
          `policy permission '${input.policyPermissionId}' was not found on policy '${input.policyId}'`,
        );
      }
      policyPermissions.splice(index, 1);
    },
  };
}



export interface FakeMembersPortOptions {
  members?: AdminMember[] | undefined;
}

export function createFakeMembersPort(_required: Record<string, never>, options: FakeMembersPortOptions = {}): MembersPort & {

  readonly members: AdminMember[];

  readonly magicLinkRequests: string[];
} {
  const members = [...(options.members ?? [])];
  const magicLinkRequests: string[] = [];

  function findOrThrow(id: string): AdminMember {
    const member = members.find((m) => m.id === id);
    if (!member) throw new Error(`fake member not found: ${id}`);
    return member;
  }

  return {
    members,
    magicLinkRequests,

    async listMembers() {
      return { members: [...members] };
    },

    async getMember({ id }) {
      return { member: findOrThrow(id) };
    },

    async disableMember({ id }) {
      const index = members.findIndex((m) => m.id === id);
      if (index < 0) throw new Error(`fake member not found: ${id}`);
      const updated: AdminMember = { ...members[index]!, status: "disabled" };
      members[index] = updated;
      return { member: updated };
    },

    async requestMemberMagicLink({ email }) {
      magicLinkRequests.push(email);
      return { delivered: true };
    },
  };
}
