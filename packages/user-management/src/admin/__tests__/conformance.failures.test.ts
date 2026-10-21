import { describe, expect, it } from 'vitest';
import { createMemoryRolesApi, createMemoryMembersApi } from '../adapters/memory.js';
import { runRolesApiConformance, runUsersApiConformance, runMembersApiConformance, runAuthApiConformance } from '../conformance/index.js';
import type { AuthApiPort, MembersApiPort, RolesApiPort, UsersApiPort } from '../ports.js';
import type { AdminMember } from '../models.js';
import { fixtures, member } from './people.fixtures.js';

// A conformance suite is only useful if it rejects broken adapters. Each fake below violates the
// port contract in a specific way; the suite must name exactly the checks that catch it.

const names = (result: { failed: { name: string }[] }) => result.failed.map((f) => f.name);

describe('roles conformance rejects broken adapters', () => {
  it('reports every check when the backend is unreachable, and skips cleanup of never-created rows', async () => {
    const down = async () => { throw new Error('backend down'); };
    const api = Object.fromEntries(Object.keys(createMemoryRolesApi({ workspaceId: 'w' })).map((k) => [k, down])) as unknown as RolesApiPort;
    const result = await runRolesApiConformance({ api }, { prefix: 'x' });
    expect(result.passed).toEqual([]);
    expect(names(result)).not.toContain('cleanup role');
    expect(names(result)).not.toContain('cleanup policy');
    expect(result.failed[0]).toEqual({ name: 'create custom role', error: new Error('backend down') });
  });

  it('flags cross-policy removal, ignored aborts and failing deletes, and still attempts policy cleanup', async () => {
    const real = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['role.manage', 'content.read'] });
    const api: RolesApiPort = {
      ...real,
      createRole: (r, { signal: _ignoredSignal, ...rest } = {}) => real.createRole(r, rest),
      removePolicyPermission: async () => {},
      deletePolicy: async () => { throw new Error('delete refused'); },
    };
    const result = await runRolesApiConformance({ api }, { prefix: 'broken' });
    expect(names(result)).toEqual([
      'cross-policy removal fails closed', 'aborted writes do not persist', 'remove permission',
      'policy deletion cascades own permissions', 'cleanup policy', 'cleanup other policy',
    ]);
    expect(result.failed.map((f) => (f.error as Error).message)).toEqual([
      'removed foreign policy permission', 'abort ignored', 'removal absent', 'delete refused', 'delete refused', 'delete refused',
    ]);
  });
});

describe('roles conformance cleanup', () => {
  it('removes a policy left behind by a failed deletion check during cleanup', async () => {
    const real = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['role.manage', 'content.read'] });
    let refusals = 1;
    const api: RolesApiPort = { ...real, deletePolicy: async (r, o) => { if (refusals-- > 0) throw new Error('transient'); return real.deletePolicy(r, o); } };
    const result = await runRolesApiConformance({ api }, { prefix: 'flaky' });
    expect(names(result)).toEqual(['policy deletion cascades own permissions']);
    expect(result.passed).toContain('cleanup policy');
    expect((await real.listPolicies({})).policies).toEqual([]);
  });
});

describe('users conformance rejects broken adapters', () => {
  it('flags an adapter that ignores aborts and leaks mutable storage', async () => {
    const real = fixtures().api;
    const shared = new Map<string, Awaited<ReturnType<UsersApiPort['listUsers']>>['users'][number]>();
    const api: UsersApiPort = {
      ...real,
      listUsers: async (r, o) => { const { users } = await real.listUsers(r, o); return { users: users.map((u) => { const s = shared.get(u.principalId) ?? { ...u, roleIds: [...u.roleIds] }; shared.set(u.principalId, s); return s; }) }; },
      updateUser: (r, { signal: _ignoredSignal, ...rest } = {}) => real.updateUser(r, rest),
    };
    const result = await runUsersApiConformance({ api }, { prefix: 'leaky' });
    expect(names(result)).toEqual(['snapshot isolation', 'aborted write does not persist']);
    expect((result.failed[0]!.error as Error).message).toBe('mutable role storage exposed');
  });

  it('skips the delete step when no operator could be created', async () => {
    const real = fixtures().api;
    const api: UsersApiPort = { ...real, createUser: async () => { throw new Error('quota'); } };
    const result = await runUsersApiConformance({ api }, { prefix: 'none' });
    expect(names(result)[0]).toBe('create operator');
    expect(result.passed).not.toContain('delete moves out of roster');
    expect(names(result)).not.toContain('delete moves out of roster');
  });
});

describe('members conformance rejects broken adapters', () => {
  it('flags missing members, shared mutable rows and ignored aborts', async () => {
    const row: AdminMember = { ...member };
    const real = createMemoryMembersApi({ workspaceId: 'w' }, { permissions: ['member.manage'], members: [member] });
    const api: MembersApiPort = {
      ...real,
      listMembers: async () => ({ members: [] }),
      getMember: async () => ({ member: row }),
      disableMember: async () => { row.status = 'disabled'; return { member: row }; },
    };
    const result = await runMembersApiConformance({ api, memberId: 'm' });
    expect(names(result)).toEqual(['list and read member', 'snapshot isolation', 'aborted disable does not persist']);
    expect((result.failed[0]!.error as Error).message).toBe('member absent');
  });
});

describe('auth conformance rejects broken adapters', () => {
  it('flags an adapter that authenticates anyone as the wrong account and ignores aborts', async () => {
    const api: AuthApiPort = { login: async () => ({ user: { id: 'intruder', username: 'intruder' } }) };
    const result = await runAuthApiConformance({ api, credentials: { username: 'admin', password: 'pw' }, expectedUserId: 'admin-id' });
    expect(result.passed).toEqual([]);
    expect(result.failed.map((f) => [f.name, (f.error as Error).message])).toEqual([
      ['login returns expected account', 'wrong account'],
      ['empty password is rejected', 'empty password authenticated'],
      ['aborted login is rejected', 'abort ignored'],
    ]);
  });
});
