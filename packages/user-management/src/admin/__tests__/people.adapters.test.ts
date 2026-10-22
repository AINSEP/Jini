import { describe, expect, it, vi } from 'vitest';
import { createHttpUsersApi, createHttpMembersApi, createHttpAuthApi } from '../adapters/http.js';
import { createMemoryUsersApi, createMemoryMembersApi, createMemoryAuthApi } from '../adapters/memory.js';
import { runUsersApiConformance, runMembersApiConformance, runAuthApiConformance } from '../conformance/index.js';
import { fixtures, member, alice, owner, role, policy } from './people.fixtures.js';
import type { RolesHttpTransport } from '../ports.js';
describe('people HTTP wire contracts', () => {
  it('matches all 12 users routes, encodes ids and preserves envelopes, bodies, errors and cancellation', async () => {
    const request = vi.fn().mockResolvedValue({ envelope: 'unchanged' }), transport: RolesHttpTransport = { request };
    const api = createHttpUsersApi({ transport, workspaceId: 'w/a' }, { basePath: '/api/workspaces/', authPath: '/api/auth/' });
    const abort = new AbortController(), o = { signal: abort.signal };
    expect(await api.listUsers({}, o)).toEqual({ envelope: 'unchanged' }); await api.listRoles({}); await api.listPolicies({}); await api.me({});
    await api.createUser({ username: 'alice', password: 'secret' }, { ...o, email: '' }); await api.updateUser({ principalId: 'u/x' }, { email: '' });
    await api.disableUser({ principalId: 'u/x' }); await api.enableUser({ principalId: 'u/x' }); await api.resetUserPassword({ principalId: 'u/x', password: 'replacement' });
    await api.assignRole({ principalId: 'u/x', roleId: 'r' }); await api.attachPolicy({ principalId: 'u/x', policyId: 'p' }); await api.deleteUser({ principalId: 'u/x' });
    const root = '/api/workspaces/w%2Fa', user = `${root}/users/u%2Fx`;
    expect(request.mock.calls.map(c => c[0])).toEqual([
      { path: `${root}/users`, method: 'GET' }, { path: `${root}/roles`, method: 'GET' }, { path: `${root}/policies`, method: 'GET' }, { path: '/api/auth/me', method: 'GET' },
      { path: `${root}/users`, method: 'POST', body: { username: 'alice', password: 'secret', email: '' } }, { path: user, method: 'PATCH', body: { email: '' } },
      { path: `${user}/disable`, method: 'POST' }, { path: `${user}/enable`, method: 'POST' }, { path: `${user}/reset-password`, method: 'POST', body: { password: 'replacement' } },
      { path: `${user}/roles`, method: 'POST', body: { roleId: 'r' } }, { path: `${user}/policies`, method: 'POST', body: { policyId: 'p' } }, { path: user, method: 'DELETE' },
    ]);
    expect(request.mock.calls[0]![1]).toEqual(o); await api.updateUser({ principalId: 'u/x' }); expect(request.mock.lastCall![0].body).toEqual({});
    const error = { code: 'OWNER_REQUIRED' }; request.mockRejectedValueOnce(error); await expect(api.disableUser({ principalId: 'owner' })).rejects.toBe(error);
    abort.abort(); await expect(api.createUser({ username: 'no', password: 'no' }, o)).rejects.toMatchObject({ name: 'AbortError' }); expect(request).toHaveBeenCalledTimes(14);
  });
  it('matches members detail, disable-only removal, pagination and constant link response; login is unscoped', async () => {
    const request = vi.fn().mockResolvedValue({ delivered: true }), transport: RolesHttpTransport = { request };
    const api = createHttpMembersApi({ transport, workspaceId: 'w' });
    await api.listMembers({}, { afterId: 'm/x', limit: 12 }); await api.getMember({ id: 'm/x' }); await api.disableMember({ id: 'm/x' });
    expect(await api.requestMemberMagicLink({ email: 'member@example.test' }, { redirectPath: '/account' })).toEqual({ delivered: true });
    const auth = createHttpAuthApi({ transport }); await auth.login({ username: 'admin', password: 'secret' });
    expect(request.mock.calls.map(c => c[0])).toEqual([
      { path: '/workspaces/w/members?afterId=m%2Fx&limit=12', method: 'GET' }, { path: '/workspaces/w/members/m%2Fx', method: 'GET' },
      { path: '/workspaces/w/members/m%2Fx/disable', method: 'POST' }, { path: '/workspaces/w/members/request-magic-link', method: 'POST', body: { email: 'member@example.test', redirectPath: '/account' } },
      { path: '/auth/login', method: 'POST', body: { username: 'admin', password: 'secret' } },
    ]);
  });
});
it('runs all users, members and login conformance checks against isolated memory ports', async () => {
  const { api } = fixtures(); const u = await runUsersApiConformance({ api }, { prefix: 'conformance-operator', roleId: 'r', policyId: 'p' });
  expect(u.failed).toEqual([]); expect(u.passed).toHaveLength(10);
  const m = await runMembersApiConformance({ api: createMemoryMembersApi({ workspaceId: 'w' }, { permissions: ['member.manage'], members: [member] }), memberId: 'm' }); expect(m.failed).toEqual([]); expect(m.passed).toHaveLength(5);
  const a = await runAuthApiConformance({ api: createMemoryAuthApi({ accounts: [{ user: { id: 'a', username: 'admin' }, password: 'secret' }] }), credentials: { username: 'admin', password: 'secret' }, expectedUserId: 'a' }); expect(a.failed).toEqual([]); expect(a.passed).toHaveLength(3);
});
it('memory independently denies member-only operator actions, owner writes, self-delete and issuer excess', async () => {
  const memberOnly = fixtures({ permissions: ['member.manage'], callerId: 'alice', trash: false }).api;
  await expect(memberOnly.createUser({ username: 'intruder', password: 'secret' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(memberOnly.updateUser({ principalId: 'owner' }, { email: 'bad' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const manager = fixtures({ permissions: ['user.manage', 'role.manage'], callerId: 'alice' }).api;
  await expect(manager.resetUserPassword({ principalId: 'owner', password: 'takeover' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(manager.deleteUser({ principalId: 'alice' })).rejects.toMatchObject({ code: 'SELF_DELETE' });
  await expect(manager.assignRole({ principalId: 'bob', roleId: 'r' })).rejects.toMatchObject({ code: 'GRANT_EXCEEDS_ISSUER' });
  const foreign = createMemoryUsersApi({ workspaceId: 'other' }, { permissions: ['*'], users: [owner, alice], roles: [role], policies: [policy] }); expect((await foreign.listUsers({})).users).toEqual([]);
});
it('memory deletes to Trash and reports username reservations while member disable remains idempotent', async () => {
  const { api } = fixtures(); await api.deleteUser({ principalId: 'alice' });
  expect((await api.listUsers({})).users.some(u => u.principalId === 'alice')).toBe(false);
  await expect(api.enableUser({ principalId: 'alice' })).rejects.toMatchObject({ code: 'USER_IN_TRASH' });
  await expect(api.createUser({ username: 'ALICE', password: 'secret' })).rejects.toMatchObject({ code: 'USERNAME_IN_TRASH' });
});
