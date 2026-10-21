import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEventFactory from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
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
