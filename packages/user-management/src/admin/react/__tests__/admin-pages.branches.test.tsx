import { Suspense } from 'react';
import type { ReactElement } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEventFactory from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { createAdmin } from '@jini-ai/admin/core/module';
import type { AdminInstance } from '@jini-ai/admin/core/module';
import { KitProvider } from '@jini-ai/ui-kit/react';
import { users, members, auth, roles } from '../index.js';
import { useAuthScope } from '../hooks/AuthBinding.hooks.js';
import { useMembersScope } from '../hooks/MembersBinding.hooks.js';
import { useRolesScope } from '../hooks/RolesBinding.hooks.js';
import { useUsersScope } from '../hooks/UsersBinding.hooks.js';
import { useAuthTab } from '../hooks/LoginPage.hooks.js';
import { useUsersView } from '../hooks/UsersPage.hooks.js';
import { createMemoryMembersApi, createMemoryRolesApi } from '../../adapters/memory.js';
import type { MembersApiPort, RolesApiPort, UsersApiPort } from '../../ports.js';
import { fixtures, memberApi, authApi } from '../../__tests__/people.fixtures.js';

const userEvent = userEventFactory.setup({ delay: null });

async function settle(content: ReactElement) {
  let rendered!: ReturnType<typeof render>;
  await act(async () => { rendered = render(content); await vi.dynamicImportSettled(); });
  await act(async () => { await vi.dynamicImportSettled(); });
  return rendered;
}

/** A host-supplied admin whose description omits every page: scoped ports still resolve. */
function withoutPageDescriptions(admin: AdminInstance): AdminInstance {
  return { ...admin, describe: () => ({ ...admin.describe(), pages: [] }) };
}

function Grants({ read }: { read: () => { permissions: readonly string[] } }) {
  return <output>{`grants:${read().permissions.join(',') || 'none'}`}</output>;
}

describe('admin bindings fail closed', () => {
  it('grant nothing when the admin does not describe the bound page', async () => {
    const usersFeature = users({}), membersFeature = members({}), authFeature = auth({}), rolesFeature = roles({});
    const ports = fixtures();
    const admin = createAdmin({ modules: [usersFeature, membersFeature, authFeature, rolesFeature], ports: {
      usersApi: ports.api, usersSafety: ports.safety, membersApi: memberApi(), authApi: authApi(),
      rolesApi: { listRoles: vi.fn(), listPolicies: vi.fn() } as never,
    } }, { permissions: ['*'] });
    expect(admin.describe().pages.map((p) => p.grants)).toEqual([['*'], ['*'], ['*'], ['*']]);
    const blind = withoutPageDescriptions(admin);
    render(<>
      <usersFeature.react.Provider admin={blind}><Grants read={() => useUsersScope({})}/></usersFeature.react.Provider>
      <membersFeature.react.Provider admin={blind}><Grants read={() => useMembersScope({})}/></membersFeature.react.Provider>
      <authFeature.react.Provider admin={blind}><Grants read={() => useAuthScope({})}/></authFeature.react.Provider>
      <rolesFeature.react.Provider admin={blind}><Grants read={() => useRolesScope({})}/></rolesFeature.react.Provider>
    </>);
    expect(screen.getAllByRole('status').map((el) => el.textContent)).toEqual(['grants:none', 'grants:none', 'grants:none', 'grants:none']);
  });

  it('refuses to render scope and view consumers outside their providers', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cases: Array<[() => unknown, string]> = [
      [() => useUsersScope({}), 'Users admin scope is unavailable.'],
      [() => useMembersScope({}), 'Members admin scope is unavailable.'],
      [() => useAuthScope({}), 'Auth admin scope is unavailable.'],
      [() => useRolesScope({}), 'Roles admin scope is unavailable.'],
      [() => useAuthTab({}), 'Login controller unavailable.'],
      [() => useUsersView({}), 'Users controller unavailable.'],
    ];
    for (const [hook, message] of cases) {
      function Consumer() { hook(); return null; }
      expect(() => render(<Consumer/>)).toThrow(message);
    }
    errors.mockRestore();
  });
});

async function mountAuth({ title, initialUsername, hidden = false, withTab = true }: { title?: string; initialUsername?: string; hidden?: boolean; withTab?: boolean } = {}) {
  const feature = auth({}), api = authApi(), onLogin = vi.fn();
  const admin = createAdmin({ modules: [feature], ports: { authApi: api } });
  const { Page, tabs } = feature.react.pages.auth;
  const description = { ...admin.describe().pages[0]!, ...(hidden ? { visible: false } : {}) };
  const rendered = await settle(<KitProvider needs={[feature.kitNeeds]} guard="off"><feature.react.Provider admin={admin}><Suspense fallback="Loading…">
    <Page tabs={withTab ? tabs : {}} description={description} onLogin={onLogin}
      {...(title === undefined ? {} : { title })} {...(initialUsername === undefined ? {} : { initialUsername })}/>
  </Suspense></feature.react.Provider></KitProvider>);
  return { ...rendered, onLogin };
}

describe('login page', () => {
  it('reports itself unavailable when the host hides the page', async () => {
    await mountAuth({ hidden: true });
    expect(screen.getByText('Login is unavailable.')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('uses the host title and prefilled username, and lets the operator edit the username before signing in', async () => {
    const { onLogin } = await mountAuth({ title: 'Acme console', initialUsername: 'adm' });
    expect(screen.getByRole('heading', { name: 'Acme console' })).toBeInTheDocument();
    const username = await screen.findByRole('textbox', { name: 'Username' });
    expect(username).toHaveValue('adm');
    await userEvent.type(username, 'in');
    await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ username: 'admin' }) })));
  });

  it('renders the shell without a form when the host supplies no auth tab', async () => {
    await mountAuth({ withTab: false });
    expect(screen.getByRole('heading', { name: 'Sign in to your workspace' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Username' })).toBeNull();
  });
});

async function mountMembers({ api, hidden = false }: { api: MembersApiPort; hidden?: boolean }) {
  const feature = members({});
  const admin = createAdmin({ modules: [feature], ports: { membersApi: api } }, { permissions: ['member.manage'] });
  const { Page, tabs } = feature.react.pages.members;
  const description = { ...admin.describe().pages[0]!, ...(hidden ? { visible: false } : {}) };
  return settle(<KitProvider needs={[feature.kitNeeds]} guard="off"><feature.react.Provider admin={admin}><Suspense fallback="Loading…">
    <Page tabs={tabs} description={description}/></Suspense></feature.react.Provider></KitProvider>);
}

describe('members page', () => {
  it('reports itself unavailable when the host hides the page', async () => {
    await mountMembers({ api: memberApi(), hidden: true });
    expect(screen.getByText('Members administration is unavailable.')).toBeInTheDocument();
  });

  it('shows a load failure with a retry that recovers the roster', async () => {
    const real = memberApi();
    const api: MembersApiPort = { ...real, listMembers: vi.fn(real.listMembers).mockRejectedValueOnce(new Error('roster offline')) };
    await mountMembers({ api });
    const alert = await screen.findByText('roster offline');
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('member@example.test')).toBeInTheDocument();
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(api.listMembers).toHaveBeenCalledTimes(2);
  });

  it('shows the empty-state notice when nobody has registered', async () => {
    await mountMembers({ api: createMemoryMembersApi({ workspaceId: 'w' }, { permissions: ['member.manage'], members: [] }) });
    expect(await screen.findByText('No members yet. Registered members will show up here.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

async function mountUsers({ api, withTab = true }: { api?: UsersApiPort; withTab?: boolean } = {}) {
  const feature = users({}), ports = fixtures();
  const port = api ?? ports.api;
  const admin = createAdmin({ modules: [feature], ports: { usersApi: port, usersSafety: ports.safety } }, { permissions: ['*'] });
  const { Page, tabs } = feature.react.pages.users;
  const rendered = await settle(<KitProvider needs={[feature.kitNeeds]} guard="off"><feature.react.Provider admin={admin}><Suspense fallback="Loading…">
    <Page tabs={withTab ? tabs : {}} description={admin.describe().pages[0]!}/></Suspense></feature.react.Provider></KitProvider>);
  return { ...rendered, api: port };
}

describe('users page', () => {
  it('shows a load failure with a retry that recovers the list', async () => {
    const real = fixtures().api;
    const api: UsersApiPort = { ...real, listUsers: vi.fn(real.listUsers).mockRejectedValueOnce(new Error('directory offline')) };
    await mountUsers({ api });
    const alert = await screen.findByText('directory offline');
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(await screen.findByText('alice')).toBeInTheDocument();
  });

  it('renders the loaded shell without a tab when the host supplies none', async () => {
    await mountUsers({ withTab: false });
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Users' })).toBeNull();
  });

  it('keeps the create form open with the server error when creating a user fails', async () => {
    const real = fixtures().api;
    const api: UsersApiPort = { ...real, createUser: vi.fn(async () => { throw new Error('username already taken'); }) };
    await mountUsers({ api });
    await userEvent.click(await screen.findByRole('button', { name: 'New user' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Username' }), 'alice');
    await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }));
    expect(await screen.findByText('username already taken')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create user' })).toBeInTheDocument();
  });

  it('shows the empty-state notice when no operators exist', async () => {
    const real = fixtures().api;
    const api: UsersApiPort = { ...real, listUsers: vi.fn(async () => ({ users: [] })) };
    await mountUsers({ api });
    expect(await screen.findByText('No users yet. Create your first operator account to get started.')).toBeInTheDocument();
  });
});

const authors = { id: 'r', workspaceId: 'w', name: 'Authors', isBuiltin: false };
const readers = { id: 'p', workspaceId: 'w', name: 'Readers', description: 'Read things', isBuiltin: false, isFrozen: false };
async function mountRoles({ permissions, api }: { permissions: string[]; api: RolesApiPort }) {
  const feature = roles({});
  const admin = createAdmin({ modules: [feature], ports: { rolesApi: api } }, { permissions });
  const { Page, tabs } = feature.react.pages.roles;
  return settle(<KitProvider needs={[feature.kitNeeds]} guard="off"><feature.react.Provider admin={admin}><Suspense fallback="Loading…">
    <Page tabs={tabs} description={admin.describe().pages[0]!}/></Suspense></feature.react.Provider></KitProvider>);
}
function rolesApi() {
  return createMemoryRolesApi({ workspaceId: 'w' }, { permissions: ['role.manage', 'content.read'], roles: [authors], policies: [readers] });
}
async function showPolicies() {
  await userEvent.click(await screen.findByRole('tab', { name: 'Policies' }));
  await act(async () => { await vi.dynamicImportSettled(); });
  await screen.findByText('Readers');
}

describe('roles and policies tabs', () => {
  it('keeps the role form with the server error when creating a role fails', async () => {
    const api: RolesApiPort = { ...rolesApi(), createRole: vi.fn(async () => { throw new Error('role name reserved'); }) };
    await mountRoles({ permissions: ['role.manage'], api });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Role name' }), 'Owner');
    await userEvent.click(screen.getByRole('button', { name: 'Create role' }));
    expect(await screen.findByText('role name reserved')).toBeInTheDocument();
  });

  it('cancels an inline role rename without writing', async () => {
    const api = rolesApi();
    await mountRoles({ permissions: ['role.manage'], api });
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for role "Authors"' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Role new name' }), ' draft');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'Role new name' })).toBeNull();
    expect((await api.listRoles({})).roles.map((r) => r.name)).toEqual(['Authors']);
  });

  it('keeps the policy form with the server error when creating a policy fails', async () => {
    const api: RolesApiPort = { ...rolesApi(), createPolicy: vi.fn(async () => { throw new Error('policy quota reached'); }) };
    await mountRoles({ permissions: ['role.manage'], api });
    await showPolicies();
    await userEvent.type(screen.getByRole('textbox', { name: 'Policy name' }), 'Extra');
    await userEvent.click(screen.getByRole('button', { name: 'Create policy' }));
    expect(await screen.findByText('policy quota reached')).toBeInTheDocument();
  });

  it('renames a policy and its description inline, and cancel discards a second edit', async () => {
    const api = rolesApi();
    await mountRoles({ permissions: ['role.manage'], api });
    await showPolicies();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for policy "Readers"' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const name = screen.getByRole('textbox', { name: 'Policy new name' });
    await userEvent.clear(name); await userEvent.type(name, 'Viewers');
    const description = screen.getByRole('textbox', { name: 'Policy new description' });
    await userEvent.clear(description); await userEvent.type(description, 'View only');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Viewers');
    expect((await api.listPolicies({})).policies[0]).toMatchObject({ name: 'Viewers', description: 'View only' });
    await userEvent.click(screen.getByRole('button', { name: 'Actions for policy "Viewers"' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'Policy new name' })).toBeNull();
  });

  it('lists an unscoped permission without a resource type and offers no removal to read-only viewers', async () => {
    const api = rolesApi();
    await api.writePolicyPermission({ policyId: 'p', permission: 'content.read' });
    await mountRoles({ permissions: [], api });
    await showPolicies();
    await userEvent.click(screen.getByRole('button', { name: 'View permissions' }));
    const permission = await screen.findByText('content.read');
    expect(permission.closest('li')?.textContent).toBe('content.read');
    expect(screen.queryByRole('button', { name: 'Remove permission content.read' })).toBeNull();
  });
});
