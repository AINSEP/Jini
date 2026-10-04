import { describe, expect, it, vi } from 'vitest';
import { createUsersController } from '../controllers/users.controller.js';
import { createMembersController } from '../controllers/members.controller.js';
import { createAuthController } from '../controllers/auth.controller.js';
import { createMemoryUsersSafety } from '../adapters/memory.js';
import { fixtures, alice, bob, member, member2, memberApi, authApi, deferred } from './people.fixtures.js';
async function users(permissions = ['*'], callerId = 'owner') { const ports = fixtures({ permissions, callerId, trash: permissions.length > 0 }); const c = createUsersController(ports, { permissions }); await Promise.all([c.load({}), c.loadCaller({})]); return { c, ...ports }; }
describe('users controller and safety', () => {
  it('loads read-only without grants and denies every mutation path', async () => {
    const { c, api } = await users([]); const spy = vi.spyOn(api, 'resetUserPassword');
    expect(c.getSnapshot({}).users).toHaveLength(3);
    for (const action of ['email', 'grants', 'disable', 'enable', 'reset', 'delete'] as const) {
      // The trash flag is independent authority: remove it explicitly for this read-only fixture.
      expect(c.allowed({ principalId: 'alice', action })).toBe(false);
    }
    c.requestDestructive({ principalId: 'alice', kind: 'reset' }); await c.confirmDestructive({});
    expect(spy).not.toHaveBeenCalled(); expect(await c.createUser({})).toBe(false); c.dispose({});
  });
  it('member.manage cannot alter other operators, retaining only self-email editing', async () => {
    const { c } = await users(['member.manage'], 'alice');
    expect(c.allowed({ principalId: 'bob', action: 'email' })).toBe(false);
    expect(c.allowed({ principalId: 'alice', action: 'reset' })).toBe(false);
    expect(c.allowed({ principalId: 'alice', action: 'email' })).toBe(true);
    c.toggleExpanded({ principalId: 'alice' }); c.setDraft({ patch: { editEmail: 'self@example.test' } });
    expect(await c.savePanel({ principalId: 'alice', kind: 'email' })).toBe(true); c.dispose({});
  });
  it('protects owners from delegated managers and unknown classifications, even with trash authority', async () => {
    const { c } = await users(['user.manage', 'role.manage'], 'alice');
    for (const action of ['email', 'grants', 'disable', 'enable', 'reset', 'delete'] as const) expect(c.allowed({ principalId: 'owner', action })).toBe(false);
    const ports = fixtures(); const unknown = createUsersController({ api: ports.api, safety: createMemoryUsersSafety({ principalIds: [], ownerPrincipalIds: [], seededOwnerPrincipalId: null }) }, { permissions: ['*'] });
    await Promise.all([unknown.load({}), unknown.loadCaller({})]);
    expect(unknown.allowed({ principalId: 'alice', action: 'reset' })).toBe(false); unknown.dispose({}); c.dispose({});
  });
  it('an unavailable safety resolver fails closed before invoking a write', async () => {
    const ports = fixtures(), c = createUsersController({ api: ports.api, safety: { seededOwnerPrincipalId: 'owner', ownerStatus: () => { throw new Error('unavailable'); } } }, { permissions: ['*'] });
    await Promise.all([c.load({}), c.loadCaller({})]); const reset = vi.spyOn(ports.api, 'resetUserPassword');
    expect(c.allowed({ principalId: 'alice', action: 'reset' })).toBe(false); c.requestDestructive({ principalId: 'alice', kind: 'reset' }); await c.confirmDestructive({}); expect(reset).not.toHaveBeenCalled(); c.dispose({});
  });
  it('confirms disable/delete, enables immediately, rejects duplicate confirm and closes after failures', async () => {
    const { c, api } = await users();
    c.requestDestructive({ principalId: 'alice', kind: 'disable' }); c.cancelDestructive({});
    expect((await api.listUsers({})).users.find(u => u.principalId === 'alice')!.status).toBe('active');
    c.requestDestructive({ principalId: 'alice', kind: 'disable' }); expect(await c.confirmDestructive({})).toBe(true);
    expect(c.getSnapshot({}).users!.find(u => u.principalId === 'alice')!.status).toBe('disabled');
    expect(await c.enableUser({ principalId: 'alice' })).toBe(true);
    const pending = deferred<void>(); const del = vi.spyOn(api, 'deleteUser').mockImplementation(async () => pending.promise);
    c.requestDestructive({ principalId: 'alice', kind: 'delete' }); const write = c.confirmDestructive({});
    expect(await c.confirmDestructive({})).toBe(false); c.cancelDestructive({}); expect(c.getSnapshot({}).pending!.kind).toBe('delete');
    pending.reject({ code: 'SELF_DELETE' }); await write;
    expect(del).toHaveBeenCalledTimes(1); expect(c.getSnapshot({}).pending).toBeNull(); expect(c.getSnapshot({}).rowError).toBe('You cannot delete your own account.'); c.dispose({});
  });
  it('checks reset equality, preserves failed drafts, resets reveal on reopen and deep-links only once', async () => {
    const ports = fixtures(); const closed = vi.fn(), reset = vi.spyOn(ports.api, 'resetUserPassword').mockRejectedValueOnce(new Error('try again'));
    const c = createUsersController(ports, { permissions: ['*'], openOwnPasswordReset: true, onOwnPasswordResetClosed: closed });
    await Promise.all([c.load({}), c.loadCaller({})]); expect(c.getSnapshot({}).pending!.user.principalId).toBe('owner');
    c.setDraft({ patch: { newPassword: 'replacement', confirmPassword: 'wrong' } });
    expect(await c.confirmDestructive({})).toBe(false); expect(reset).not.toHaveBeenCalled();
    c.setDraft({ patch: { confirmPassword: 'replacement' } }); c.togglePasswordVisible({ field: 'new' });
    expect(await c.confirmDestructive({})).toBe(false); expect(c.getSnapshot({}).newPassword).toBe('replacement'); expect(c.getSnapshot({}).passwordError).toBe('try again');
    expect(await c.confirmDestructive({})).toBe(true); expect(closed).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot({}).notice).toBe('Password changed. Sign in again with your new password.');
    await c.load({}); expect(c.getSnapshot({}).pending).toBeNull();
    c.requestDestructive({ principalId: 'owner', kind: 'reset' }); expect(c.getSnapshot({}).showNewPassword).toBe(false); expect(c.getSnapshot({}).confirmPassword).toBe(''); c.dispose({});
  });
  it('failed me resolves to no affordances and no deep-link navigation', async () => {
    const ports = fixtures(), closed = vi.fn(); vi.spyOn(ports.api, 'me').mockRejectedValue(new Error('unauthenticated'));
    const c = createUsersController(ports, { permissions: ['*'], openOwnPasswordReset: true, onOwnPasswordResetClosed: closed });
    await Promise.all([c.load({}), c.loadCaller({})]); expect(c.getSnapshot({}).caller).toBeNull(); expect(c.allowed({ principalId: 'alice', action: 'delete' })).toBe(false); expect(closed).not.toHaveBeenCalled(); c.dispose({});
  });
  it('stale grant success/failure cannot clear another panel draft or busy state', async () => {
    const { c, api } = await users(); const old = deferred<{ assignment: unknown }>(), next = deferred<{ assignment: unknown }>();
    vi.spyOn(api, 'assignRole').mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    c.toggleExpanded({ principalId: 'alice' }); c.setDraft({ patch: { pendingRoleId: 'r' } }); const a = c.savePanel({ principalId: 'alice', kind: 'role' });
    c.toggleExpanded({ principalId: 'bob' }); c.setDraft({ patch: { pendingRoleId: 'r' } }); const b = c.savePanel({ principalId: 'bob', kind: 'role' });
    old.reject(new Error('stale grant')); await a;
    expect(c.getSnapshot({}).grantError).toBeNull(); expect(c.getSnapshot({}).grantSaving).toBe(true); expect(c.getSnapshot({}).pendingRoleId).toBe('r');
    next.resolve({ assignment: {} }); await b; expect(c.getSnapshot({}).pendingRoleId).toBe(''); c.dispose({});
  });
  it('newer list results win; disposal aborts and silences late settlements', async () => {
    const ports = fixtures(), a = deferred<{ users: typeof alice[] }>(), b = deferred<{ users: typeof alice[] }>();
    const list = vi.spyOn(ports.api, 'listUsers').mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const c = createUsersController(ports); const first = c.load({}), second = c.load({}); b.resolve({ users: [bob] }); await second; a.resolve({ users: [alice] }); await first;
    expect(c.getSnapshot({}).users!.map(u => u.principalId)).toEqual(['bob']); const late = deferred<{ users: typeof alice[] }>(); list.mockReturnValueOnce(late.promise);
    const pending = c.load({}); c.dispose({}); const frozen = c.getSnapshot({}); expect(list.mock.calls.at(-1)![1]!.signal!.aborted).toBe(true);
    late.resolve({ users: [alice] }); await pending; expect(c.getSnapshot({})).toBe(frozen);
  });
});
describe('members controller', () => {
  it('read-only can view details; confirmed disable updates list and cache, resend stays immediate', async () => {
    const api = memberApi(), readonly = createMembersController({ api }); await readonly.load({}); await readonly.toggleDetail({ id: 'm' });
    expect(readonly.getSnapshot({}).detailById.m!.version).toBe(1); readonly.requestDestructive({ id: 'm' }); expect(readonly.getSnapshot({}).pending).toBeNull(); expect(await readonly.resendSignInLink({ id: 'm' })).toBe(false); readonly.dispose({});
    const c = createMembersController({ api }, { permissions: ['member.manage'] }); await c.load({}); await c.toggleDetail({ id: 'm' });
    expect(await c.resendSignInLink({ id: 'm' })).toBe(true); expect(c.stateFor({ id: 'm' }).notice).toBe('Sign-in link sent.');
    c.requestDestructive({ id: 'm' }); expect(await c.confirmDestructive({})).toBe(true); expect(c.getSnapshot({}).detailById.m!.status).toBe('disabled'); expect(c.getSnapshot({}).members![0]!.status).toBe('disabled'); c.dispose({});
  });
  it('stale detail success/failure cannot corrupt another row or a reopened row', async () => {
    const api = memberApi(), a = deferred<{ member: typeof member }>(), b = deferred<{ member: typeof member }>();
    vi.spyOn(api, 'getMember').mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const c = createMembersController({ api }); await c.load({}); const first = c.toggleDetail({ id: 'm' }), second = c.toggleDetail({ id: 'n' });
    a.reject(new Error('stale detail')); await first; expect(c.getSnapshot({}).detailError).toBeNull(); expect(c.getSnapshot({}).detailLoadingId).toBe('n');
    b.resolve({ member: member2 }); await second; expect(c.getSnapshot({}).detailById.n!.id).toBe('n');
    const stale = deferred<{ member: typeof member }>(), newer = deferred<{ member: typeof member }>(); vi.mocked(api.getMember).mockReturnValueOnce(stale.promise).mockReturnValueOnce(newer.promise);
    const old = c.toggleDetail({ id: 'm' }); await c.toggleDetail({ id: 'm' }); const current = c.toggleDetail({ id: 'm' });
    newer.resolve({ member: { ...member, version: 9 } }); await current; stale.resolve({ member }); await old;
    expect(c.getSnapshot({}).detailById.m!.version).toBe(9); c.dispose({});
  });
  it('refresh is latest-wins and unsubscribes on disposal', async () => {
    const api = memberApi(), unsub = vi.fn(); let refresh!: () => void;
    const c = createMembersController({ api }, { refresh: { subscribe: r => { refresh = r.onRefresh; return unsub; } } });
    const a = deferred<{ members: typeof member[] }>(), b = deferred<{ members: typeof member[] }>(); vi.spyOn(api, 'listMembers').mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const first = c.load({}); refresh(); b.resolve({ members: [member2] }); await b.promise; await Promise.resolve(); a.resolve({ members: [member] }); await first;
    expect(c.getSnapshot({}).members![0]!.id).toBe('n'); c.dispose({}); expect(unsub).toHaveBeenCalledTimes(1); refresh(); expect(api.listMembers).toHaveBeenCalledTimes(2);
  });
});
it('login reports exact errors, blocks duplicates, calls host only while live and clears secrets', async () => {
  const api = authApi(), onLogin = vi.fn(), c = createAuthController({ api, onLogin });
  expect(c.getSnapshot({}).username).toBe('admin'); c.setDraft({ patch: { password: 'wrong' } }); expect(await c.submit({})).toBe(false);
  expect(c.getSnapshot({}).error).toBe('invalid username or password'); c.setDraft({ patch: { password: 'secret' } }); expect(await c.submit({})).toBe(true);
  expect(onLogin).toHaveBeenCalledTimes(1); expect(onLogin).toHaveBeenCalledWith({ user: { id: 'owner', username: 'admin' } }); expect(c.getSnapshot({}).password).toBe('');
  const pending = deferred<{ user: { id: string; username: string } }>(); vi.spyOn(api, 'login').mockReturnValue(pending.promise); c.setDraft({ patch: { password: 'secret' } }); const write = c.submit({}); expect(await c.submit({})).toBe(false);
  c.dispose({}); pending.resolve({ user: { id: 'owner', username: 'admin' } }); await write; expect(onLogin).toHaveBeenCalledTimes(1); expect(c.getSnapshot({}).password).toBe('');
});
