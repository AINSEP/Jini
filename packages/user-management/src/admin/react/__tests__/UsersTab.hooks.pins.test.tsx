import type { ReactNode } from 'react';
import { renderHook, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { UsersViewContext } from '../hooks/UsersPage.hooks.js';
import { useUserRow, useUsersConfirmation } from '../hooks/UsersTab.hooks.js';
import { createUsersController } from '../../controllers/users.controller.js';
import type { UsersController } from '../../controllers/users.controller.js';
import type { UserAction, UsersState } from '../../models.js';
import { fixtures, alice } from '../../__tests__/people.fixtures.js';

afterEach(cleanup);

// A real controller with its decision (allowed) and effects replaced by spies, so each test
// controls exactly which actions the row may offer and observes which effect a handler fires.
function harness({ allow = [], state = {} }: { allow?: readonly UserAction[]; state?: Partial<UsersState> } = {}) {
  const ports = fixtures();
  const real = createUsersController({ api: ports.api, safety: ports.safety }, { permissions: ['*'] });
  const allowed = vi.fn(({ action }: { principalId: string; action: UserAction }) => allow.includes(action));
  const controller: UsersController = { ...real, allowed, toggleExpanded: vi.fn(), requestDestructive: vi.fn(), enableUser: vi.fn(async () => true), savePanel: vi.fn(async () => true),
    confirmDestructive: vi.fn(async () => true), cancelDestructive: vi.fn(), setDraft: vi.fn(), togglePasswordVisible: vi.fn() };
  const value = { controller, state: { ...real.getSnapshot({}), ...state }, permissions: ['*'] };
  const wrapper = ({ children }: { children: ReactNode }) => <UsersViewContext.Provider value={value}>{children}</UsersViewContext.Provider>;
  return { controller, allowed, wrapper };
}

describe('useUserRow (pins)', () => {
  it.each<[readonly UserAction[], string[], boolean]>([
    [[], [], false],
    [['email'], ['manage'], true],
    [['grants'], ['manage'], true],
    [['enable'], ['enable'], false],
    [['disable', 'reset'], ['disable', 'reset'], false],
    [['email', 'grants', 'disable', 'enable', 'reset', 'delete'], ['manage', 'disable', 'enable', 'reset', 'delete'], true],
  ])('allowed %j offers %j (expandable: %s)', (allow, ids, canExpand) => {
    const { wrapper } = harness({ allow });
    const { result } = renderHook(() => useUserRow({ user: alice }), { wrapper });
    expect(result.current.items.map(i => i.id)).toEqual(ids);
    expect(result.current.canExpand).toBe(canExpand);
    expect([result.current.canEmail, result.current.canGrants]).toEqual([allow.includes('email'), allow.includes('grants')]);
  });

  it('asks the controller once per action, for this user, in a fixed order', () => {
    const { wrapper, allowed } = harness();
    renderHook(() => useUserRow({ user: alice }), { wrapper });
    expect(allowed.mock.calls.map(([a]) => a)).toEqual(['email', 'grants', 'disable', 'enable', 'reset', 'delete'].map(action => ({ principalId: 'alice', action })));
  });

  it('labels every menu item', () => {
    const { wrapper } = harness({ allow: ['email', 'disable', 'enable', 'reset', 'delete'] });
    const { result } = renderHook(() => useUserRow({ user: alice }), { wrapper });
    expect(result.current.items.map(i => i.label)).toEqual(['Manage', 'Disable', 'Enable', 'Reset password', 'Delete']);
  });

  it('each menu item fires its own controller effect for this user', () => {
    const { wrapper, controller } = harness({ allow: ['email', 'disable', 'enable', 'reset', 'delete'] });
    const { result } = renderHook(() => useUserRow({ user: alice }), { wrapper });
    for (const item of result.current.items) item.onPress({});
    expect(vi.mocked(controller.toggleExpanded).mock.calls).toEqual([[{ principalId: 'alice' }]]);
    expect(vi.mocked(controller.enableUser).mock.calls).toEqual([[{ principalId: 'alice' }]]);
    expect(vi.mocked(controller.requestDestructive).mock.calls).toEqual([[{ principalId: 'alice', kind: 'disable' }], [{ principalId: 'alice', kind: 'reset' }], [{ principalId: 'alice', kind: 'delete' }]]);
  });

  it('save handlers save the matching panel for this user', () => {
    const { wrapper, controller } = harness();
    const { result } = renderHook(() => useUserRow({ user: alice }), { wrapper });
    result.current.saveEmail(); result.current.assignRole(); result.current.attachPolicy();
    expect(vi.mocked(controller.savePanel).mock.calls).toEqual([[{ principalId: 'alice', kind: 'email' }], [{ principalId: 'alice', kind: 'role' }], [{ principalId: 'alice', kind: 'policy' }]]);
  });

  it('is expanded only when this user is the expanded one', () => {
    const { wrapper } = harness({ state: { expandedId: 'bob' } });
    const { result } = renderHook(() => useUserRow({ user: alice }), { wrapper });
    expect(result.current.expanded).toBe(false);
  });
});

describe('useUsersConfirmation (pins)', () => {
  it('with nothing pending the dialog is closed and uses the disable copy', () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useUsersConfirmation(), { wrapper });
    expect(result.current.confirm.open).toBe(false);
    expect(result.current.reset).toBe(false);
    expect(result.current.copy).toEqual({ title: 'Disable this user?', label: 'Disable', tone: 'warning', body: 'They will not be able to sign in until re-enabled.', consequence: 'revokes sign-in access' });
  });

  it('delete copy names the trash and its retention', () => {
    const { wrapper } = harness({ state: { pending: { kind: 'delete', user: alice } } });
    const { result } = renderHook(() => useUsersConfirmation(), { wrapper });
    expect(result.current.copy).toEqual({ title: 'Delete this user?', label: 'Move to trash', tone: 'danger',
      body: 'They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.', consequence: 'moves the user to the Trash' });
    expect(result.current.confirm).toEqual(expect.objectContaining({ open: true, title: 'Delete this user?', confirmLabel: 'Move to trash', tone: 'danger', consequence: 'moves the user to the Trash', pending: false, agentMayConfirm: false }));
  });

  it('reset copy warns about sessions', () => {
    const { wrapper } = harness({ state: { pending: { kind: 'reset', user: alice } } });
    const { result } = renderHook(() => useUsersConfirmation(), { wrapper });
    expect(result.current.reset).toBe(true);
    expect(result.current.copy).toEqual({ title: 'Reset password?', label: 'Reset password', tone: 'warning', body: 'Every active session for this user will be signed out.', consequence: 'revokes every active session' });
  });

  it('matching passwords surface the controller password error instead of a mismatch', () => {
    const { wrapper } = harness({ state: { newPassword: 'same', confirmPassword: 'same', passwordError: 'Password too short.' } });
    const { result } = renderHook(() => useUsersConfirmation(), { wrapper });
    expect([result.current.mismatch, result.current.error]).toEqual([false, 'Password too short.']);
  });

  it('a mismatch wins over the controller password error', () => {
    const { wrapper } = harness({ state: { newPassword: 'one', confirmPassword: 'two', passwordError: 'Password too short.' } });
    const { result } = renderHook(() => useUsersConfirmation(), { wrapper });
    expect([result.current.mismatch, result.current.error]).toEqual([true, 'Passwords do not match.']);
  });

  it('shown password fields are text with hide labels', () => {
    const { wrapper } = harness({ state: { showNewPassword: true, showConfirmPassword: true } });
    const { result } = renderHook(() => useUsersConfirmation(), { wrapper });
    expect([result.current.newType, result.current.confirmType, result.current.newLabel, result.current.confirmLabel]).toEqual(['text', 'text', 'Hide new password', 'Hide confirm password']);
  });

  it('handlers drive the controller: confirm, cancel, drafts and visibility toggles', async () => {
    const { wrapper, controller } = harness({ state: { pending: { kind: 'reset', user: alice }, confirming: true } });
    const { result } = renderHook(() => useUsersConfirmation(), { wrapper });
    expect(result.current.confirm.pending).toBe(true);
    await result.current.confirm.onConfirm(); result.current.confirm.onCancel();
    result.current.newPassword({ value: 'a' }); result.current.confirmPassword({ value: 'b' });
    result.current.toggleNew(); result.current.toggleConfirm();
    expect(vi.mocked(controller.confirmDestructive)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(controller.cancelDestructive)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(controller.setDraft).mock.calls).toEqual([[{ patch: { newPassword: 'a' } }], [{ patch: { confirmPassword: 'b' } }]]);
    expect(vi.mocked(controller.togglePasswordVisible).mock.calls).toEqual([[{ field: 'new' }], [{ field: 'confirm' }]]);
  });
});
