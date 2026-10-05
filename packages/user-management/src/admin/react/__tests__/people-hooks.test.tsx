import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { createAdmin } from '@jini-ai/admin/core/module';
import { roles, members } from '../index.js';
import { createUsersController } from '../../controllers/users.controller.js';
import type { UsersController } from '../../controllers/users.controller.js';
import { createRolesController } from '../../controllers/roles.controller.js';
import type { RolesController } from '../../controllers/roles.controller.js';
import { createMemoryUsersApi, createMemoryUsersSafety, createMemoryRolesApi, createMemoryMembersApi } from '../../adapters/memory.js';
import type { RoleRecord, PolicyRecord } from '../../models.js';
import type { MembersRefreshPort } from '../../ports.js';
import { UsersViewContext } from '../hooks/UsersPage.hooks.js';
import { useUsersTab, useUserRow, useUsersConfirmation } from '../hooks/UsersTab.hooks.js';
import { RolesViewContext, useRolesView, useRolesPage } from '../hooks/RolesPage.hooks.js';
import { usePoliciesTab, usePolicyRow } from '../hooks/PoliciesTab.hooks.js';
import { useMembersView, useMembersPage } from '../hooks/MembersPage.hooks.js';
import { owner, alice, bob, role, policy, member, member2 } from '../../__tests__/people.fixtures.js';

// Real controllers over the in-memory adapters; the harness only republishes the controller's
// own store through the context the hooks read, the same way the page components do.
const builtinRole: RoleRecord = { id: 'rb', workspaceId: 'w', name: 'Owner', isBuiltin: true };
const builtinPolicy: PolicyRecord = { id: 'pb', workspaceId: 'w', name: 'Everything', isBuiltin: true, isFrozen: true };

async function usersHarness() {
  const api = createMemoryUsersApi({ workspaceId: 'w' }, { permissions: ['*'], users: [owner, alice, bob], roles: [role, builtinRole], policies: [policy, builtinPolicy],
    caller: { user: { id: 'owner', username: 'owner' }, canManageUserTrash: true }, ownerPrincipalIds: ['owner'], seededOwnerPrincipalId: 'owner' });
  const safety = createMemoryUsersSafety({ principalIds: ['owner', 'alice', 'bob'], ownerPrincipalIds: ['owner'], seededOwnerPrincipalId: 'owner' });
  const controller = createUsersController({ api, safety }, { permissions: ['*'] });
  function Harness({ children }: { children: ReactNode }) {
    const state = useSyncExternalStore(listener => controller.subscribe({ listener }), () => controller.getSnapshot({}));
    return <UsersViewContext.Provider value={{ controller, state, permissions: ['*'] }}>{children}</UsersViewContext.Provider>;
  }
  return { api, controller, wrapper: Harness, loaded: async () => { await act(async () => { await controller.load({}); await controller.loadCaller({}); }); } };
}

function rolesHarness({ canManage = true }: { canManage?: boolean } = {}) {
  const api = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['role.manage', 'content.read'], roles: [role], policies: [policy, builtinPolicy] });
  const controller: RolesController = createRolesController({ api }, { permissions: ['role.manage'] });
  function Harness({ children }: { children: ReactNode }) {
    const state = useSyncExternalStore(listener => controller.subscribe({ listener }), () => controller.getSnapshot());
    return <RolesViewContext.Provider value={{ controller, state, canManage }}>{children}</RolesViewContext.Provider>;
  }
  return { api, controller, wrapper: Harness, loaded: async () => { await act(async () => { await controller.load({}); }); } };
}

describe('useUsersTab', () => {
  it('opens and cancels the form, edits the draft, and submits through createUser', async () => {
    const { wrapper, loaded, api } = await usersHarness();
    const { result } = renderHook(() => useUsersTab(), { wrapper });
    await loaded();
    expect(result.current.canCreate).toBe(true);
    act(() => result.current.toggleForm());
    expect(result.current.s.formOpen).toBe(true);
    act(() => result.current.cancelForm());
    expect(result.current.s.formOpen).toBe(false);
    act(() => { result.current.username({ value: 'carol' }); result.current.email({ value: 'carol@example.test' }); result.current.password({ value: 'correct horse battery' }); });
    expect(result.current.s).toMatchObject({ username: 'carol', email: 'carol@example.test', password: 'correct horse battery' });
    const preventDefault = vi.fn();
    act(() => result.current.submit({ preventDefault } as never));
    expect(preventDefault).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.s.users?.map(u => u.username)).toContain('carol'));
    expect((await api.listUsers({})).users.find(u => u.username === 'carol')?.email).toBe('carol@example.test');
  });
});

describe('useUserRow', () => {
  it('falls back to empty role and policy lists before they load', async () => {
    const { wrapper } = await usersHarness();
    const { result } = renderHook(() => useUserRow({ user: { ...alice, roleIds: ['r'], policyIds: ['p'] } }), { wrapper });
    expect(result.current.roleOptions).toEqual([{ value: '', label: 'Select a role…' }]);
    expect(result.current.policyOptions).toEqual([{ value: '', label: 'Select a policy…' }]);
    expect(result.current.items).toEqual([]);
  });

  it('labels built-in grants, toggles the panel, and writes panel drafts', async () => {
    const { wrapper, loaded } = await usersHarness();
    const { result } = renderHook(() => useUserRow({ user: alice }), { wrapper });
    await loaded();
    expect(result.current.roleOptions.map(o => o.label)).toEqual(['Select a role…', 'Writer', 'Owner (built-in)']);
    expect(result.current.policyOptions.map(o => o.label)).toEqual(['Select a policy…', 'Read', 'Everything (built-in)']);
    expect(result.current.menuLabel).toBe('Actions for user "alice"');
    expect(result.current.items.map(i => i.id)).toEqual(['manage', 'disable', 'reset', 'delete']);
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
    act(() => { result.current.email({ value: 'new@example.test' }); result.current.role({ value: 'rb' }); result.current.policy({ value: 'pb' }); });
    expect(result.current.s).toMatchObject({ editEmail: 'new@example.test', pendingRoleId: 'rb', pendingPolicyId: 'pb' });
    act(() => result.current.items.find(i => i.id === 'manage')!.onPress({}));
    expect(result.current.expanded).toBe(false);
  });
});

describe('useUsersConfirmation', () => {
  it('describes reset, toggles both password fields, and reports a mismatch', async () => {
    const { wrapper, loaded, controller } = await usersHarness();
    const { result } = renderHook(() => useUsersConfirmation(), { wrapper });
    await loaded();
    act(() => controller.requestDestructive({ principalId: 'alice', kind: 'reset' }));
    expect(result.current.reset).toBe(true);
    expect(result.current.confirm).toMatchObject({ open: true, title: 'Reset password?', confirmLabel: 'Reset password', tone: 'warning', agentMayConfirm: false });
    expect([result.current.newType, result.current.confirmType, result.current.newLabel, result.current.confirmLabel])
      .toEqual(['password', 'password', 'Show new password', 'Show confirm password']);
    act(() => result.current.toggleConfirm());
    expect([result.current.newType, result.current.confirmType, result.current.newLabel, result.current.confirmLabel])
      .toEqual(['password', 'text', 'Show new password', 'Hide confirm password']);
    act(() => result.current.toggleNew());
    expect([result.current.newType, result.current.confirmType, result.current.newLabel, result.current.confirmLabel])
      .toEqual(['text', 'text', 'Hide new password', 'Hide confirm password']);
    act(() => { result.current.newPassword({ value: 'one' }); result.current.confirmPassword({ value: 'two' }); });
    expect(result.current.error).toBe('Passwords do not match.');
    act(() => result.current.confirm.onCancel());
    expect(result.current.confirm.open).toBe(false);
  });

  it('uses delete copy for delete and disable copy for disable', async () => {
    const { wrapper, loaded, controller } = await usersHarness();
    const { result } = renderHook(() => useUsersConfirmation(), { wrapper });
    await loaded();
    act(() => controller.requestDestructive({ principalId: 'alice', kind: 'delete' }));
    expect(result.current.copy).toMatchObject({ title: 'Delete this user?', label: 'Move to trash', tone: 'danger' });
    act(() => controller.cancelDestructive({}));
    act(() => controller.requestDestructive({ principalId: 'alice', kind: 'disable' }));
    expect(result.current.copy).toMatchObject({ title: 'Disable this user?', label: 'Disable', consequence: 'revokes sign-in access' });
    expect(result.current.mismatch).toBe(false);
  });
});

describe('usePoliciesTab', () => {
  it('shows no rows before load and creates a policy from the draft', async () => {
    const { wrapper, loaded, api } = rolesHarness();
    const { result } = renderHook(() => usePoliciesTab(), { wrapper });
    expect(result.current.rows).toEqual([]);
    await loaded();
    expect(result.current.createDisabled).toBe(true);
    act(() => { result.current.changeName({ value: 'Editors' }); result.current.changeDescription({ value: 'Edit things' }); });
    expect([result.current.name, result.current.description, result.current.createDisabled]).toEqual(['Editors', 'Edit things', false]);
    const preventDefault = vi.fn();
    act(() => result.current.submit({ preventDefault }));
    expect(preventDefault).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.rows.map(p => p.name)).toContain('Editors'));
    expect((await api.listPolicies({})).policies.find(p => p.name === 'Editors')?.description).toBe('Edit things');
  });
});

describe('usePolicyRow', () => {
  it('describes a built-in frozen policy as read-only', async () => {
    const { wrapper, loaded } = rolesHarness();
    const { result } = renderHook(() => usePolicyRow({ policy: builtinPolicy }), { wrapper });
    await loaded();
    expect(result.current).toMatchObject({ type: 'Built-in (frozen)', description: '—', editable: false, readLabel: 'View permissions' });
  });

  it('a frozen custom policy is marked frozen and is not editable', async () => {
    const { wrapper, loaded } = rolesHarness();
    const { result } = renderHook(() => usePolicyRow({ policy: { ...policy, isFrozen: true } }), { wrapper });
    await loaded();
    expect(result.current).toMatchObject({ type: 'Custom (frozen)', editable: false });
  });

  it('renames a custom policy through the menu, edits, cancels and saves', async () => {
    const { wrapper, loaded, api } = rolesHarness();
    const { result } = renderHook(() => usePolicyRow({ policy: { ...policy, description: 'Read things' } }), { wrapper });
    await loaded();
    expect(result.current).toMatchObject({ type: 'Custom', description: 'Read things', editable: true, menuLabel: 'Actions for policy "Read"' });
    act(() => result.current.menu.find(m => m.id === 'rename')!.onPress({}));
    expect([result.current.editing, result.current.draft]).toEqual([true, 'Read']);
    act(() => result.current.cancel());
    expect(result.current.editing).toBe(false);
    act(() => result.current.menu.find(m => m.id === 'rename')!.onPress({}));
    act(() => { result.current.changeName({ value: 'Readers' }); result.current.changeDescription({ value: 'Reads' }); });
    expect([result.current.draft, result.current.draftDescription, result.current.saveDisabled]).toEqual(['Readers', 'Reads', false]);
    await act(async () => { result.current.save(); });
    await waitFor(() => expect(result.current.editing).toBe(false));
    expect((await api.listPolicies({})).policies.find(p => p.id === 'p')).toMatchObject({ name: 'Readers', description: 'Reads' });
  });

  it('toggles the permission panel from the menu and the read button', async () => {
    const { wrapper, loaded } = rolesHarness();
    const { result } = renderHook(() => usePolicyRow({ policy }), { wrapper });
    await loaded();
    await act(async () => { result.current.viewPermissions(); });
    expect([result.current.open, result.current.readLabel, result.current.menu[1]!.label]).toEqual([true, 'Close permissions', 'Close']);
    await act(async () => { result.current.menu[1]!.onPress({}); });
    expect(result.current.open).toBe(false);
  });
});

describe('page scopes', () => {
  it('useRolesView and useMembersView refuse to run outside their page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useRolesView())).toThrow('Roles page controller unavailable.');
    expect(() => renderHook(() => useMembersView())).toThrow('Members controller unavailable.');
    vi.mocked(console.error).mockRestore();
  });
});

describe('useRolesPage', () => {
  function mount({ visible = true, requestedTab, onTabChange }: { visible?: boolean; requestedTab?: string; onTabChange?: (required: { tab: string }) => void } = {}) {
    const feature = roles({});
    const api = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['role.manage'], roles: [role], policies: [policy] });
    const admin = createAdmin({ modules: [feature], ports: { rolesApi: api } }, { permissions: ['role.manage'] });
    const description = { ...admin.describe().pages[0]!, visible };
    const wrapper = ({ children }: { children: ReactNode }) => <feature.react.Provider admin={admin}>{children}</feature.react.Provider>;
    const tabs = feature.react.pages.roles.tabs;
    return { api, ...renderHook(() => useRolesPage({ tabs, description, ...(requestedTab ? { requestedTab } : {}), ...(onTabChange ? { onTabChange } : {}) }), { wrapper }) };
  }

  it('a hidden page has no tabs and an empty active tab', () => {
    const { result } = mount({ visible: false });
    expect([result.current.hidden, result.current.noTabs, result.current.tab, result.current.items]).toEqual([true, true, '', []]);
  });

  it('a local tab change selects that tab and tells the host', () => {
    const onTabChange = vi.fn();
    const { result } = mount({ onTabChange });
    act(() => result.current.changeTab({ value: 'policies' }));
    expect(result.current.tab).toBe('policies');
    expect(onTabChange).toHaveBeenCalledWith({ tab: 'policies' });
  });

  it('switches tabs without a host listener and retries the load', async () => {
    const { result, api } = mount({ requestedTab: 'nowhere' });
    expect(result.current.tab).toBe('roles');
    const listRoles = vi.spyOn(api, 'listRoles');
    await waitFor(() => expect(result.current.view).not.toBeNull());
    act(() => result.current.changeTab({ value: 'policies' }));
    // requestedTab still wins over local selection, and a stale one falls back to the first tab.
    expect(result.current.tab).toBe('roles');
    const before = listRoles.mock.calls.length;
    await act(async () => { result.current.retry(); });
    expect(listRoles.mock.calls.length).toBe(before + 1);
  });
});

describe('useMembersPage', () => {
  it('passes the host refresh port to the controller and retries the load', async () => {
    const feature = members({});
    const api = createMemoryMembersApi({ workspaceId: 'w' }, { permissions: ['member.manage'], members: [member, member2] });
    const admin = createAdmin({ modules: [feature], ports: { membersApi: api } }, { permissions: ['member.manage'] });
    let onRefresh: (() => void) | undefined;
    const refresh: MembersRefreshPort = { subscribe: ({ onRefresh: listener }) => { onRefresh = listener; return () => { onRefresh = undefined; }; } };
    const listMembers = vi.spyOn(api, 'listMembers');
    const wrapper = ({ children }: { children: ReactNode }) => <feature.react.Provider admin={admin}>{children}</feature.react.Provider>;
    const { result } = renderHook(() => useMembersPage({ tabs: {}, description: admin.describe().pages[0]!, refresh }), { wrapper });
    expect(result.current.content).toBeNull();
    await waitFor(() => expect(result.current.state?.members?.map(m => m.id)).toEqual(['m', 'n']));
    expect(result.current.canManage).toBe(true);
    const before = listMembers.mock.calls.length;
    await act(async () => { onRefresh!(); });
    expect(listMembers.mock.calls.length).toBe(before + 1);
    await act(async () => { result.current.retry(); });
    expect(listMembers.mock.calls.length).toBe(before + 2);
  });
});
