import { describe, expect, it, vi } from 'vitest';
import { createUsersController } from '../controllers/users.controller.js';
import { PeopleApiError } from '../ports.js';
import type { UsersApiPort } from '../ports.js';
import type { UsersState } from '../models.js';
import { fixtures, alice, deferred } from './people.fixtures.js';

const FORBIDDEN = 'You do not have permission to do that.';
async function users({ permissions = ['*'], callerId = 'owner', overrides = {} }: { permissions?: string[]; callerId?: string; overrides?: Partial<UsersApiPort> } = {}) {
  const ports = fixtures({ permissions, callerId, trash: permissions.length > 0 });
  // Overrides patch the memory port in place, so a vi.spyOn(base, …) after setup still observes calls.
  const api: UsersApiPort = Object.assign(ports.api, overrides);
  const c = createUsersController({ api, safety: ports.safety }, { permissions });
  await Promise.all([c.load({}), c.loadCaller({})]);
  return { c, base: ports.api, api, safety: ports.safety };
}
/** setDraft forwards its patch unfiltered: a Partial<UsersState> is structurally a Partial<UsersDraft>.
 * This is the only route by which busy/pending fields change under an in-flight write. */
const forcePatch = (patch: Partial<UsersState>) => patch;

describe('users controller savePanel pins', () => {
  it('refuses a panel that is not expanded', async () => {
    const update = vi.fn<UsersApiPort['updateUser']>();
    const { c } = await users({ overrides: { updateUser: update } });
    expect(await c.savePanel({ principalId: 'alice', kind: 'email' })).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(c.getSnapshot({}).rowError).toBeNull();
    c.dispose({});
  });
  it('refuses while a grant save is in flight', async () => {
    const gate = deferred<{ assignment: unknown }>();
    const assign = vi.fn<UsersApiPort['assignRole']>(() => gate.promise);
    const { c } = await users({ overrides: { assignRole: assign } });
    c.toggleExpanded({ principalId: 'alice' });
    c.setDraft({ patch: { pendingRoleId: 'r' } });
    const first = c.savePanel({ principalId: 'alice', kind: 'role' });
    expect(c.getSnapshot({}).grantSaving).toBe(true);
    expect(await c.savePanel({ principalId: 'alice', kind: 'email' })).toBe(false);
    gate.resolve({ assignment: {} });
    expect(await first).toBe(true);
    expect(assign).toHaveBeenCalledTimes(1);
    c.dispose({});
  });
  it('refuses email edits without user.manage and reports forbidden', async () => {
    const update = vi.fn<UsersApiPort['updateUser']>();
    const { c } = await users({ permissions: ['role.manage'], callerId: 'alice', overrides: { updateUser: update } });
    c.toggleExpanded({ principalId: 'bob' });
    expect(await c.savePanel({ principalId: 'bob', kind: 'email' })).toBe(false);
    expect(c.getSnapshot({}).rowError).toBe(FORBIDDEN);
    expect(update).not.toHaveBeenCalled();
    c.dispose({});
  });
  it.each([['role'], ['policy']] as const)('refuses %s grants without role.manage and reports forbidden', async (kind) => {
    const { c } = await users({ permissions: ['user.manage'], callerId: 'alice' });
    c.toggleExpanded({ principalId: 'bob' });
    c.setDraft({ patch: { pendingRoleId: 'r', pendingPolicyId: 'p' } });
    expect(await c.savePanel({ principalId: 'bob', kind })).toBe(false);
    expect(c.getSnapshot({}).rowError).toBe(FORBIDDEN);
    c.dispose({});
  });
  it('refuses while a destructive confirmation is in flight', async () => {
    const gate = deferred<{ user: typeof alice }>();
    const update = vi.fn<UsersApiPort['updateUser']>();
    const { c } = await users({ overrides: { updateUser: update, disableUser: () => gate.promise } });
    c.toggleExpanded({ principalId: 'alice' });
    c.requestDestructive({ principalId: 'bob', kind: 'disable' });
    const confirm = c.confirmDestructive({});
    expect(await c.savePanel({ principalId: 'alice', kind: 'email' })).toBe(false);
    expect(c.getSnapshot({}).rowError).toBe(FORBIDDEN);
    expect(update).not.toHaveBeenCalled();
    gate.resolve({ user: alice });
    await confirm;
    c.dispose({});
  });
  it('refuses after dispose', async () => {
    const update = vi.fn<UsersApiPort['updateUser']>();
    const { c } = await users({ overrides: { updateUser: update } });
    c.toggleExpanded({ principalId: 'alice' });
    c.dispose({});
    expect(await c.savePanel({ principalId: 'alice', kind: 'email' })).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
  it.each([['role'], ['policy']] as const)('refuses an empty %s selection silently', async (kind) => {
    const { c } = await users();
    c.toggleExpanded({ principalId: 'alice' });
    // The other kind's selection is set: only the matching field gates the save.
    c.setDraft({ patch: kind === 'role' ? { pendingPolicyId: 'p' } : { pendingRoleId: 'r' } });
    expect(await c.savePanel({ principalId: 'alice', kind })).toBe(false);
    expect(c.getSnapshot({})).toMatchObject({ rowError: null, grantSaving: false });
    c.dispose({});
  });
  it('saves the email draft, keeps the email field, reloads and returns true', async () => {
    const { c, base } = await users();
    const update = vi.spyOn(base, 'updateUser');
    c.toggleExpanded({ principalId: 'alice' });
    expect(c.getSnapshot({}).editEmail).toBe('alice@example.test');
    c.setDraft({ patch: { editEmail: 'new@example.test', pendingRoleId: 'r' } });
    expect(await c.savePanel({ principalId: 'alice', kind: 'email' })).toBe(true);
    expect(update.mock.calls[0]![0]).toEqual({ principalId: 'alice' });
    expect(update.mock.calls[0]![1]).toMatchObject({ email: 'new@example.test' });
    expect(c.getSnapshot({})).toMatchObject({ editEmail: 'new@example.test', pendingRoleId: 'r', grantSaving: false, grantError: null });
    expect(c.getSnapshot({}).users!.find(u => u.principalId === 'alice')!.email).toBe('new@example.test');
    c.dispose({});
  });
  it('assigns a role, clears only the role selection and returns true', async () => {
    const { c, base } = await users();
    const assign = vi.spyOn(base, 'assignRole');
    c.toggleExpanded({ principalId: 'alice' });
    c.setDraft({ patch: { pendingRoleId: 'r', pendingPolicyId: 'p' } });
    expect(await c.savePanel({ principalId: 'alice', kind: 'role' })).toBe(true);
    expect(assign.mock.calls[0]![0]).toEqual({ principalId: 'alice', roleId: 'r' });
    expect(c.getSnapshot({})).toMatchObject({ pendingRoleId: '', pendingPolicyId: 'p' });
    c.dispose({});
  });
  it('attaches a policy, clears only the policy selection and returns true', async () => {
    const { c, base } = await users();
    const attach = vi.spyOn(base, 'attachPolicy');
    c.toggleExpanded({ principalId: 'alice' });
    c.setDraft({ patch: { pendingRoleId: 'r', pendingPolicyId: 'p' } });
    expect(await c.savePanel({ principalId: 'alice', kind: 'policy' })).toBe(true);
    expect(attach.mock.calls[0]![0]).toEqual({ principalId: 'alice', policyId: 'p' });
    expect(c.getSnapshot({})).toMatchObject({ pendingRoleId: 'r', pendingPolicyId: '' });
    c.dispose({});
  });
  it('keeps a selection edited during the save', async () => {
    const gate = deferred<{ attachment: unknown }>();
    const { c } = await users({ overrides: { attachPolicy: () => gate.promise } });
    c.toggleExpanded({ principalId: 'alice' });
    c.setDraft({ patch: { pendingPolicyId: 'p' } });
    const pending = c.savePanel({ principalId: 'alice', kind: 'policy' });
    c.setDraft({ patch: { pendingPolicyId: 'p' } });
    gate.resolve({ attachment: {} });
    expect(await pending).toBe(true);
    expect(c.getSnapshot({}).pendingPolicyId).toBe('p');
    c.dispose({});
  });
  it('a stale success after close/reopen of the same row keeps the new panel state', async () => {
    const gate = deferred<{ attachment: unknown }>();
    const { c } = await users({ overrides: { attachPolicy: () => gate.promise } });
    c.toggleExpanded({ principalId: 'alice' });
    c.setDraft({ patch: { pendingPolicyId: 'p' } });
    const pending = c.savePanel({ principalId: 'alice', kind: 'policy' });
    c.toggleExpanded({ principalId: 'alice' });
    c.toggleExpanded({ principalId: 'alice' });
    gate.resolve({ attachment: {} });
    expect(await pending).toBe(true);
    expect(c.getSnapshot({})).toMatchObject({ expandedId: 'alice', grantSaving: false });
    c.dispose({});
  });
  it.each([
    ['email', 'updateUser', 'failed to update email'],
    ['role', 'assignRole', 'failed to assign role'],
    ['policy', 'attachPolicy', 'failed to attach policy'],
  ] as const)('a failed %s save reports its fallback and returns false', async (kind, method, message) => {
    const { c } = await users({ overrides: { [method]: async () => { throw { opaque: true }; } } });
    c.toggleExpanded({ principalId: 'alice' });
    c.setDraft({ patch: { pendingRoleId: 'r', pendingPolicyId: 'p' } });
    expect(await c.savePanel({ principalId: 'alice', kind })).toBe(false);
    expect(c.getSnapshot({})).toMatchObject({ grantError: message, grantSaving: false, pendingRoleId: 'r', pendingPolicyId: 'p' });
    c.dispose({});
  });
  it('maps a coded failure to its copy', async () => {
    const { c } = await users({ overrides: { assignRole: async () => { throw new PeopleApiError({ code: 'GRANT_EXCEEDS_ISSUER', message: 'x' }); } } });
    c.toggleExpanded({ principalId: 'alice' });
    c.setDraft({ patch: { pendingRoleId: 'r' } });
    expect(await c.savePanel({ principalId: 'alice', kind: 'role' })).toBe(false);
    expect(c.getSnapshot({}).grantError).toBe('You cannot grant a permission you do not hold.');
    c.dispose({});
  });
  it('returns false when disposed during the save', async () => {
    const gate = deferred<{ user: typeof alice }>();
    const { c } = await users({ overrides: { updateUser: () => gate.promise } });
    c.toggleExpanded({ principalId: 'alice' });
    const pending = c.savePanel({ principalId: 'alice', kind: 'email' });
    c.dispose({});
    gate.resolve({ user: alice });
    expect(await pending).toBe(false);
  });
});

describe('users controller confirmDestructive pins', () => {
  it('refuses with nothing pending', async () => {
    const { c } = await users();
    expect(await c.confirmDestructive({})).toBe(false);
    c.dispose({});
  });
  it('refuses while a row write is in flight', async () => {
    const gate = deferred<{ user: typeof alice }>();
    const { c, base } = await users({ overrides: { enableUser: () => gate.promise } });
    await base.disableUser({ principalId: 'bob' });
    await c.load({});
    const disable = vi.spyOn(base, 'disableUser');
    c.requestDestructive({ principalId: 'alice', kind: 'disable' });
    const enabling = c.enableUser({ principalId: 'bob' });
    expect(c.getSnapshot({}).rowSavingId).toBe('bob');
    expect(await c.confirmDestructive({})).toBe(false);
    expect(disable).not.toHaveBeenCalled();
    gate.resolve({ user: alice });
    await enabling;
    c.dispose({});
  });
  it('refuses when the pending action is no longer allowed and reports forbidden', async () => {
    const { c, base } = await users();
    c.requestDestructive({ principalId: 'alice', kind: 'disable' });
    await base.disableUser({ principalId: 'alice' });
    await c.load({});
    const disable = vi.spyOn(base, 'disableUser');
    expect(await c.confirmDestructive({})).toBe(false);
    expect(c.getSnapshot({}).rowError).toBe(FORBIDDEN);
    expect(disable).not.toHaveBeenCalled();
    c.dispose({});
  });
  it('refuses after dispose', async () => {
    const disable = vi.fn<UsersApiPort['disableUser']>();
    const { c } = await users({ overrides: { disableUser: disable } });
    c.requestDestructive({ principalId: 'alice', kind: 'disable' });
    c.dispose({});
    expect(await c.confirmDestructive({})).toBe(false);
    expect(disable).not.toHaveBeenCalled();
  });
  it.each([
    ['empty', { newPassword: '', confirmPassword: '' }],
    ['mismatched', { newPassword: 'abc', confirmPassword: 'abd' }],
  ] as const)('refuses a reset with an %s password pair, silently', async (_name, patch) => {
    const reset = vi.fn<UsersApiPort['resetUserPassword']>();
    const { c } = await users({ overrides: { resetUserPassword: reset } });
    c.requestDestructive({ principalId: 'alice', kind: 'reset' });
    c.setDraft({ patch });
    expect(await c.confirmDestructive({})).toBe(false);
    expect(reset).not.toHaveBeenCalled();
    expect(c.getSnapshot({})).toMatchObject({ rowError: null, passwordError: null, confirming: false });
    c.dispose({});
  });
  it('resets another user, reports the revocation notice, does not reload and closes', async () => {
    const { c, base } = await users();
    const reset = vi.spyOn(base, 'resetUserPassword'), list = vi.spyOn(base, 'listUsers');
    c.requestDestructive({ principalId: 'alice', kind: 'reset' });
    c.setDraft({ patch: { newPassword: 'pw', confirmPassword: 'pw' } });
    c.togglePasswordVisible({ field: 'confirm' });
    expect(await c.confirmDestructive({})).toBe(true);
    expect(reset).toHaveBeenCalledWith({ principalId: 'alice', password: 'pw' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(list).not.toHaveBeenCalled();
    expect(c.getSnapshot({})).toMatchObject({
      notice: 'Password reset for "alice" — every active session for this user was revoked.',
      pending: null, newPassword: '', confirmPassword: '', showConfirmPassword: false, confirming: false,
    });
    c.dispose({});
  });
  it('a failed reset keeps the dialog and typed credential open for retry', async () => {
    const { c } = await users({ overrides: { resetUserPassword: async () => { throw { opaque: true }; } } });
    c.requestDestructive({ principalId: 'alice', kind: 'reset' });
    c.setDraft({ patch: { newPassword: 'pw', confirmPassword: 'pw' } });
    expect(await c.confirmDestructive({})).toBe(false);
    expect(c.getSnapshot({})).toMatchObject({ passwordError: 'failed to reset password', rowError: null, newPassword: 'pw', confirming: false });
    expect(c.getSnapshot({}).pending!.kind).toBe('reset');
    c.dispose({});
  });
  it.each([['disable', 'disableUser'], ['delete', 'deleteUser']] as const)('confirms %s, reloads and closes', async (kind, method) => {
    const { c, base } = await users();
    const write = vi.spyOn(base, method), list = vi.spyOn(base, 'listUsers');
    c.requestDestructive({ principalId: 'alice', kind });
    expect(await c.confirmDestructive({})).toBe(true);
    expect(write).toHaveBeenCalledWith({ principalId: 'alice' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(list).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot({})).toMatchObject({ pending: null, confirming: false, rowError: null });
    c.dispose({});
  });
  it.each([['disable', 'disableUser'], ['delete', 'deleteUser']] as const)('a failed %s reports its fallback and closes', async (kind, method) => {
    const { c } = await users({ overrides: { [method]: async () => { throw { opaque: true }; } } });
    c.requestDestructive({ principalId: 'alice', kind });
    expect(await c.confirmDestructive({})).toBe(false);
    expect(c.getSnapshot({})).toMatchObject({ rowError: `failed to ${kind} user`, pending: null, confirming: false, passwordError: null });
    c.dispose({});
  });
  it('rejects a duplicate confirmation while one is in flight', async () => {
    const gate = deferred<void>();
    const del = vi.fn<UsersApiPort['deleteUser']>(() => gate.promise);
    const { c } = await users({ overrides: { deleteUser: del } });
    c.requestDestructive({ principalId: 'alice', kind: 'delete' });
    const first = c.confirmDestructive({});
    expect(await c.confirmDestructive({})).toBe(false);
    // Short-circuits on `confirming` before the permission gate, so no forbidden copy appears.
    expect(c.getSnapshot({}).rowError).toBeNull();
    gate.resolve();
    expect(await first).toBe(true);
    expect(del).toHaveBeenCalledTimes(1);
    c.dispose({});
  });
  it('returns false and leaves the frozen snapshot when disposed during the write', async () => {
    const gate = deferred<{ user: typeof alice }>();
    const closed = vi.fn();
    const ports = fixtures();
    const c = createUsersController({ api: { ...ports.api, disableUser: () => gate.promise }, safety: ports.safety }, { permissions: ['*'], onOwnPasswordResetClosed: closed });
    await Promise.all([c.load({}), c.loadCaller({})]);
    c.requestDestructive({ principalId: 'alice', kind: 'disable' });
    const pending = c.confirmDestructive({});
    c.dispose({});
    const frozen = c.getSnapshot({});
    gate.resolve({ user: alice });
    expect(await pending).toBe(false);
    expect(c.getSnapshot({})).toBe(frozen);
    expect(closed).not.toHaveBeenCalled();
  });
  it('keeps a replaced pending target when the old confirmation settles', async () => {
    const gate = deferred<{ user: typeof alice }>();
    const { c } = await users({ overrides: { disableUser: () => gate.promise } });
    c.requestDestructive({ principalId: 'alice', kind: 'disable' });
    const pending = c.confirmDestructive({});
    const replacement = Object.freeze({ kind: 'delete' as const, user: alice });
    c.setDraft({ patch: forcePatch({ pending: replacement }) });
    gate.resolve({ user: alice });
    expect(await pending).toBe(true);
    expect(c.getSnapshot({})).toMatchObject({ pending: replacement, confirming: false });
    c.dispose({});
  });
});

describe('users controller remaining pins', () => {
  it('requestDestructive refuses while a row saves and when not allowed', async () => {
    const gate = deferred<{ user: typeof alice }>();
    const { c, base } = await users({ overrides: { enableUser: () => gate.promise } });
    await base.disableUser({ principalId: 'bob' });
    await c.load({});
    const enabling = c.enableUser({ principalId: 'bob' });
    c.requestDestructive({ principalId: 'alice', kind: 'disable' });
    expect(c.getSnapshot({}).pending).toBeNull();
    gate.resolve({ user: alice });
    await enabling;
    c.requestDestructive({ principalId: 'owner', kind: 'disable' });
    expect(c.getSnapshot({})).toMatchObject({ pending: null, rowError: FORBIDDEN });
    c.requestDestructive({ principalId: 'nobody', kind: 'disable' });
    expect(c.getSnapshot({}).pending).toBeNull();
    c.dispose({});
  });
  it('enableUser reports failure and refuses a non-disabled user', async () => {
    const { c, base } = await users({ overrides: { enableUser: async () => { throw { opaque: true }; } } });
    expect(await c.enableUser({ principalId: 'alice' })).toBe(false);
    expect(c.getSnapshot({}).rowError).toBe(FORBIDDEN);
    await base.disableUser({ principalId: 'alice' });
    await c.load({});
    expect(await c.enableUser({ principalId: 'alice' })).toBe(false);
    expect(c.getSnapshot({})).toMatchObject({ rowError: 'failed to change status', rowSavingId: null });
    c.dispose({});
  });
  it('enableUser leaves a foreign busy row alone when it settles', async () => {
    const gate = deferred<{ user: typeof alice }>();
    const { c, base } = await users({ overrides: { enableUser: () => gate.promise } });
    await base.disableUser({ principalId: 'alice' });
    await c.load({});
    const pending = c.enableUser({ principalId: 'alice' });
    c.setDraft({ patch: forcePatch({ rowSavingId: 'other' }) });
    gate.resolve({ user: alice });
    expect(await pending).toBe(true);
    expect(c.getSnapshot({}).rowSavingId).toBe('other');
    c.dispose({});
  });
  it('createUser omits an empty email, keeps a newer draft, reports failure and refuses without grant', async () => {
    const gate = deferred<{ user: typeof alice }>();
    const { c, base } = await users({ overrides: { createUser: () => gate.promise } });
    const create = vi.fn<UsersApiPort['createUser']>(() => gate.promise);
    const c2 = createUsersController({ api: { ...base, createUser: create }, safety: (await users()).safety }, { permissions: ['user.manage'] });
    c2.setDraft({ patch: { username: 'u', password: 'p' } });
    c2.setFormOpen({ open: true });
    const pending = c2.createUser({});
    expect(await c2.createUser({})).toBe(false);
    c2.setDraft({ patch: { username: 'u2' } });
    gate.resolve({ user: alice });
    expect(await pending).toBe(true);
    expect(Object.keys(create.mock.calls[0]![1]!)).toEqual(['signal']);
    expect(c2.getSnapshot({})).toMatchObject({ username: 'u2', formOpen: true, saving: false });
    c2.setDraft({ patch: { email: 'e@example.test' } });
    await c2.createUser({});
    expect(create.mock.calls[1]![1]).toMatchObject({ email: 'e@example.test' });
    expect(c2.getSnapshot({})).toMatchObject({ username: '', email: '', password: '', formOpen: false });
    const failing = createUsersController({ api: { ...base, createUser: async () => { throw { opaque: true }; } }, safety: (await users()).safety }, { permissions: ['*'] });
    expect(await failing.createUser({})).toBe(false);
    expect(failing.getSnapshot({}).formError).toBe('failed to create user');
    const denied = createUsersController({ api: base, safety: (await users()).safety }, { permissions: ['role.manage'] });
    expect(await denied.createUser({})).toBe(false);
    expect(denied.getSnapshot({}).saving).toBe(false);
    c.dispose({}); c2.dispose({}); failing.dispose({}); denied.dispose({});
    expect(await c2.createUser({})).toBe(false);
  });
  it('loadCaller ignores an invalid identity, copies effective permissions and is inert after dispose', async () => {
    for (const user of [undefined, { id: 7, username: 'x' }, { id: '', username: 'x' }]) {
      const ports = fixtures();
      // Malformed-input fixture: the server reply is untrusted, so the identity may be absent or mistyped.
      const me = (async () => ({ user, canManageUserTrash: true })) as unknown as UsersApiPort['me'];
      const c = createUsersController({ api: { ...ports.api, me }, safety: ports.safety }, { permissions: ['*'] });
      await c.loadCaller({});
      expect(c.getSnapshot({}).caller).toBeNull();
      c.dispose({});
    }
    const ports = fixtures();
    const c = createUsersController({ api: { ...ports.api, me: async () => ({ user: { id: 'owner', username: 'owner' }, effectivePermissions: ['a'], canManageUserTrash: 'yes' as unknown as boolean }) }, safety: ports.safety });
    await c.loadCaller({});
    expect(c.getSnapshot({}).caller).toEqual({ user: { id: 'owner', username: 'owner' }, canManageUserTrash: false, effectivePermissions: ['a'] });
    await c.loadCaller({});
    c.dispose({});
    const me = vi.spyOn(ports.api, 'me');
    const late = createUsersController(ports);
    late.dispose({});
    await late.loadCaller({});
    expect(me).not.toHaveBeenCalled();
    const gate = deferred<{ user: { id: string; username: string } }>();
    const racing = createUsersController({ api: { ...ports.api, me: () => gate.promise }, safety: ports.safety });
    const loading = racing.loadCaller({});
    racing.dispose({});
    gate.resolve({ user: { id: 'owner', username: 'owner' } });
    await loading;
    expect(racing.getSnapshot({}).caller).toBeNull();
  });
  it('load reports a current failure, drops a stale failure and is inert after dispose', async () => {
    const ports = fixtures();
    const first = deferred<{ users: typeof alice[] }>();
    const list = vi.spyOn(ports.api, 'listUsers').mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('down'));
    const c = createUsersController(ports);
    const stale = c.load({});
    await c.load({});
    expect(c.getSnapshot({}).error).toBe('down');
    first.reject(new Error('stale'));
    await stale;
    expect(c.getSnapshot({}).error).toBe('down');
    c.dispose({});
    await c.load({});
    expect(list).toHaveBeenCalledTimes(2);
  });
  it('deep link opens only once, only for the caller, and only when allowed', async () => {
    const ports = fixtures({ callerId: 'ghost' });
    const closed = vi.fn();
    const ghost = createUsersController(ports, { permissions: ['*'], openOwnPasswordReset: true, onOwnPasswordResetClosed: closed });
    await ghost.load({});
    await ghost.loadCaller({});
    expect(ghost.getSnapshot({}).pending).toBeNull();
    ghost.dispose({});
    const denied = fixtures({ permissions: [], callerId: 'alice', trash: false });
    const c = createUsersController(denied, { openOwnPasswordReset: true, onOwnPasswordResetClosed: closed });
    await c.loadCaller({});
    await c.load({});
    expect(c.getSnapshot({}).pending).toBeNull();
    await c.load({});
    c.dispose({});
    const own = fixtures({ callerId: 'alice' });
    const opened = createUsersController(own, { permissions: ['*'], openOwnPasswordReset: true, onOwnPasswordResetClosed: closed });
    await Promise.all([opened.load({}), opened.loadCaller({})]);
    expect(opened.getSnapshot({}).pending).toMatchObject({ kind: 'reset', user: { principalId: 'alice' } });
    opened.cancelDestructive({});
    expect(closed).toHaveBeenCalledTimes(1);
    opened.cancelDestructive({});
    expect(closed).toHaveBeenCalledTimes(1);
    await opened.load({});
    expect(opened.getSnapshot({}).pending).toBeNull();
    opened.dispose({});
    const silent = createUsersController(fixtures({ callerId: 'alice' }), { permissions: ['*'], openOwnPasswordReset: true });
    await Promise.all([silent.load({}), silent.loadCaller({})]);
    silent.cancelDestructive({});
    expect(silent.getSnapshot({}).pending).toBeNull();
    silent.dispose({});
  });
  it('cancel is blocked while confirming; toggles, visibility and dispose clear secrets', async () => {
    const gate = deferred<void>();
    const { c } = await users({ overrides: { resetUserPassword: () => gate.promise } });
    c.toggleExpanded({ principalId: 'nobody' });
    expect(c.getSnapshot({}).expandedId).toBeNull();
    c.toggleExpanded({ principalId: 'owner' });
    expect(c.getSnapshot({}).editEmail).toBe('');
    c.toggleExpanded({ principalId: 'owner' });
    expect(c.getSnapshot({}).expandedId).toBeNull();
    c.requestDestructive({ principalId: 'alice', kind: 'reset' });
    c.setDraft({ patch: { newPassword: 'pw', confirmPassword: 'pw', password: 'secret' } });
    c.togglePasswordVisible({ field: 'new' });
    c.togglePasswordVisible({ field: 'confirm' });
    expect(c.getSnapshot({})).toMatchObject({ showNewPassword: true, showConfirmPassword: true });
    const pending = c.confirmDestructive({});
    c.cancelDestructive({});
    expect(c.getSnapshot({}).pending).not.toBeNull();
    c.dispose({});
    expect(c.getSnapshot({})).toMatchObject({ password: '', newPassword: '', confirmPassword: '', pending: null });
    c.toggleExpanded({ principalId: 'alice' });
    expect(c.getSnapshot({}).expandedId).toBeNull();
    gate.resolve();
    expect(await pending).toBe(false);
  });
});
