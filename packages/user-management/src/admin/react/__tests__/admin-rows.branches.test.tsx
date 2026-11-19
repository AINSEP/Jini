import { MemberRow } from '../components/MemberRow.js';
import { RoleRow } from '../components/RoleRow.js';
import { PolicyRow } from '../components/PolicyRow.js';
import { PermissionPanel } from '../components/PermissionPanel.js';
import { MembersConfirmation } from '../components/MembersConfirmation.js';
import { UsersConfirmation } from '../components/UsersConfirmation.js';
import { MembersViewContext, useMemberRow } from '../hooks/MembersPage.hooks.js';
import { useUserRow, useUsersConfirmation } from '../hooks/UsersTab.hooks.js';
import { useRoleRow } from '../hooks/RolesTab.hooks.js';
import { usePolicyRow } from '../hooks/PoliciesTab.hooks.js';
import { createMembersController } from '../../controllers/members.controller.js';
import { member, memberApi } from '../../__tests__/people.fixtures.js';
import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEventFactory from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { KitProvider } from '@jini-ai/ui-kit/react';
import { users as usersFeature } from '../index.js';
import { createUsersController } from '../../controllers/users.controller.js';
import { createRolesController } from '../../controllers/roles.controller.js';
import { createMemoryUsersApi, createMemoryUsersSafety, createMemoryRolesApi } from '../../adapters/memory.js';
import type { UsersApiPort } from '../../ports.js';
import { UsersViewContext } from '../hooks/UsersPage.hooks.js';
import { RolesViewContext } from '../hooks/RolesPage.hooks.js';
import { useRolesTab } from '../hooks/RolesTab.hooks.js';
import { UserRow } from '../components/UserRow.js';
import { owner, alice, bob, role, policy } from '../../__tests__/people.fixtures.js';

const userEvent = userEventFactory.setup({ delay: null });

describe('useRolesTab', () => {
  it('offers no rows before the roles load, then the loaded roles', async () => {
    const api = createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['role.manage'], roles: [role] });
    const controller = createRolesController({ api }, { permissions: ['role.manage'] });
    function Harness({ children }: { children: ReactNode }) {
      const state = useSyncExternalStore((listener) => controller.subscribe({ listener }), () => controller.getSnapshot());
      return <RolesViewContext.Provider value={{ controller, state, canManage: true }}>{children}</RolesViewContext.Provider>;
    }
    const { result } = renderHook(() => useRolesTab(), { wrapper: Harness });
    expect(result.current.rows).toEqual([]);
    await act(async () => { await controller.load({}); });
    expect(result.current.rows.map((r) => r.name)).toEqual(['Writer']);
  });
});

async function mountRow({ permissions, api: override }: { permissions: string[]; api?: (api: UsersApiPort) => UsersApiPort }) {
  const base = createMemoryUsersApi({ workspaceId: 'w' }, { permissions: ['*'], users: [owner, alice, bob], roles: [role], policies: [policy],
    caller: { user: { id: 'owner', username: 'owner' }, canManageUserTrash: true }, ownerPrincipalIds: ['owner'], seededOwnerPrincipalId: 'owner' });
  const api = override ? override(base) : base;
  const safety = createMemoryUsersSafety({ principalIds: ['owner', 'alice', 'bob'], ownerPrincipalIds: ['owner'], seededOwnerPrincipalId: 'owner' });
  const controller = createUsersController({ api, safety }, { permissions });
  await act(async () => { await controller.load({}); await controller.loadCaller({}); });
  function Harness() {
    const state = useSyncExternalStore((listener) => controller.subscribe({ listener }), () => controller.getSnapshot({}));
    return <UsersViewContext.Provider value={{ controller, state, permissions }}>
      <table><tbody><UserRow user={state.users!.find((u) => u.principalId === 'alice')!}/></tbody></table>
    </UsersViewContext.Provider>;
  }
  render(<KitProvider needs={[usersFeature({}).kitNeeds]} guard="off"><Harness/></KitProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'alice' }));
  return { controller };
}

describe('UserRow management panel', () => {
  it('shows only the email editor to a user manager without role.manage', async () => {
    await mountRow({ permissions: ['user.manage'] });
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Assign role' })).toBeNull();
  });

  it('shows only grant controls to a role manager, and the grant failure inside the panel', async () => {
    await mountRow({ permissions: ['role.manage'], api: (api) => ({ ...api, assignRole: async () => { throw new Error('grant exceeds issuer'); } }) });
    expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Assign role' }), 'r');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(await screen.findByText('grant exceeds issuer')).toBeInTheDocument();
  });
});


describe('injected admin row and dialog views', () => {
  it('renders an injected member detail and forwards its toggle action', async () => {
    const controller = createMembersController({ api: memberApi() }, { permissions: [] });
    const wrapper = ({ children }: { children: ReactNode }) => <MembersViewContext.Provider value={{
      controller, state: controller.getSnapshot(), canManage: false,
    }}>{children}</MembersViewContext.Provider>;
    const { result } = renderHook(() => useMemberRow({ member }), { wrapper });
    const toggle = vi.fn();
    render(<KitProvider guard="off"><table><tbody><MemberRow member={member} useMemberRowHook={() => ({
      ...result.current, expanded: true, detail: { ...member, id: 'injected-member' }, verified: 'injected verification', toggle,
    })} /></tbody></table></KitProvider>);
    expect(screen.getByText('injected-member')).toBeVisible();
    expect(screen.getByText('injected verification')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: member.email }));
    expect(toggle).toHaveBeenCalledWith({});
  });
  it('renders injected role and policy edit states and preserves draft payloads', async () => {
    const controller = createRolesController({ api: createMemoryRolesApi({ workspaceId: 'w' }) }, { permissions: [] });
    const wrapper = ({ children }: { children: ReactNode }) => <RolesViewContext.Provider value={{
      controller, state: controller.getSnapshot(), canManage: true,
    }}>{children}</RolesViewContext.Provider>;
    const roleView = renderHook(() => useRoleRow({ role }), { wrapper });
    const policyView = renderHook(() => usePolicyRow({ policy }), { wrapper });
    const changeRole = vi.fn(), changePolicy = vi.fn();
    render(<KitProvider guard="off"><table><tbody>
      <RoleRow role={role} useRoleRowHook={() => ({ ...roleView.result.current, editing: true, draft: 'Injected role', changeName: changeRole })} />
      <PolicyRow policy={policy} usePolicyRowHook={() => ({ ...policyView.result.current, editing: true, draft: 'Injected policy', changeName: changePolicy })} />
    </tbody></table></KitProvider>);
    await userEvent.type(screen.getByRole('textbox', { name: 'Role new name' }), 'x');
    await userEvent.type(screen.getByRole('textbox', { name: 'Policy new name' }), 'y');
    expect(changeRole).toHaveBeenCalledWith({ value: 'Injected rolex' });
    expect(changePolicy).toHaveBeenCalledWith({ value: 'Injected policyy' });
  });
  it('renders the injected permission row and forwards its remove action', async () => {
    const requestRemove = vi.fn();
    render(<KitProvider guard="off"><PermissionPanel policy={policy} usePermissionPanelHook={() => ({
      editable: true, loading: false, empty: false, rows: [{ id: 'p1', permission: 'injected.write', resourceType: '',
        pending: false, removeLabel: 'Remove injected permission', requestRemove }],
      permission: '', resourceType: '', pending: false, addDisabled: true, changePermission() {}, changeResourceType() {}, submit() {},
    })} /></KitProvider>);
    expect(screen.getByText('injected.write')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Remove injected permission' }));
    expect(requestRemove).toHaveBeenCalledWith({});
  });
  it('renders an injected expanded user email editor and forwards its value', async () => {
    const api = createMemoryUsersApi({ workspaceId: 'w' });
    const controller = createUsersController({ api, safety: createMemoryUsersSafety({ principalIds: [] }) }, { permissions: [] });
    const wrapper = ({ children }: { children: ReactNode }) => <UsersViewContext.Provider value={{
      controller, state: controller.getSnapshot({}), permissions: [],
    }}>{children}</UsersViewContext.Provider>;
    const { result } = renderHook(() => useUserRow({ user: alice }), { wrapper });
    const email = vi.fn();
    render(<KitProvider guard="off"><table><tbody><UserRow user={alice} useUserRowHook={() => ({
      ...result.current, expanded: true, canEmail: true, email, s: { ...result.current.s, editEmail: 'injected@example.test' },
    })} /></tbody></table></KitProvider>);
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'x');
    expect(email).toHaveBeenCalledWith({ value: 'injected@example.testx' });
  });
  it('renders the injected members confirmation and uses its cancel callback', async () => {
    const onCancel = vi.fn();
    render(<KitProvider guard="off"><MembersConfirmation useMembersConfirmationHook={() => ({
      open: true, title: 'Injected member confirmation', body: 'Injected body', confirmLabel: 'Confirm', tone: 'warning',
      consequence: 'fixture effect', pending: false, agentMayConfirm: false, async onConfirm() {}, onCancel,
    })} /></KitProvider>);
    expect(screen.getByRole('alertdialog', { name: 'Injected member confirmation' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledWith({});
  });
  it('renders the injected users confirmation title', () => {
    const controller = createUsersController({ api: createMemoryUsersApi({ workspaceId: 'w' }),
      safety: createMemoryUsersSafety({ principalIds: [] }) }, { permissions: [] });
    const wrapper = ({ children }: { children: ReactNode }) => <UsersViewContext.Provider value={{
      controller, state: controller.getSnapshot({}), permissions: [],
    }}>{children}</UsersViewContext.Provider>;
    const { result } = renderHook(() => useUsersConfirmation({}), { wrapper });
    render(<KitProvider guard="off"><UsersConfirmation useUsersConfirmationHook={() => ({
      ...result.current, confirm: { ...result.current.confirm, open: true, title: 'Injected users confirmation' },
    })} /></KitProvider>);
    expect(screen.getByRole('alertdialog', { name: 'Injected users confirmation' })).toBeVisible();
  });
});
