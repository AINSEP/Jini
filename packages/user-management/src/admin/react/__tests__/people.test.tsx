import { Suspense, StrictMode } from 'react';
import type { ReactElement } from 'react';
import { act, render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEventFactory from '@testing-library/user-event';
const userEvent = userEventFactory.setup({ delay: null });
import { describe, it, expect, vi } from 'vitest';
import { createAdmin } from '@jini-ai/admin/core/module';
import { KitProvider, Button, createKit } from '@jini-ai/ui-kit/react';
import type { ResolvedKit, ConfirmViewProps } from '@jini-ai/ui-kit/react';
import { users, members, auth } from '../index.js';
import type { UsersApiPort, MembersApiPort, AuthApiPort } from '../../ports.js';
import { createMemoryUsersSafety } from '../../adapters/memory.js';
import { fixtures, memberApi, authApi, deferred } from '../../__tests__/people.fixtures.js';
async function settle(content: ReactElement) {
  let rendered!: ReturnType<typeof render>;
  await act(async () => { rendered = render(content); await vi.dynamicImportSettled(); });
  await act(async () => { await vi.dynamicImportSettled(); });
  return rendered;
}
async function mountUsers({ permissions = ['*'], callerId = 'owner', api, kit, strict = false, deepLink = false, closed, unknown = false, omit = false }: {
  permissions?: string[]; callerId?: string; api?: UsersApiPort; kit?: ResolvedKit; strict?: boolean; deepLink?: boolean; closed?: () => void; unknown?: boolean; omit?: boolean;
} = {}) {
  const feature = users({}), ports = fixtures({ permissions: ['*'], callerId, trash: permissions.length > 0 });
  const safety = unknown ? createMemoryUsersSafety({ principalIds: [], ownerPrincipalIds: [], seededOwnerPrincipalId: null }) : ports.safety;
  const admin = createAdmin({ modules: [feature], ports: { usersApi: api ?? ports.api, usersSafety: safety } }, { permissions, ...(omit ? { omit: ['users.users.users'] as const } : {}) });
  const { Page, tabs } = feature.react.pages.users;
  const content = <KitProvider needs={[feature.kitNeeds]} guard="off" {...(kit ? { kit } : {})}><feature.react.Provider admin={admin}><Suspense fallback="Loading…"><Page tabs={tabs} description={admin.describe().pages[0]!} openOwnPasswordReset={deepLink} {...(closed ? { onOwnPasswordResetClosed: closed } : {})}/></Suspense></feature.react.Provider></KitProvider>;
  return { ...await settle(strict ? <StrictMode>{content}</StrictMode> : content), admin, api: api ?? ports.api };
}
async function mountMembers({ permissions = ['member.manage'], api, kit }: { permissions?: string[]; api?: MembersApiPort; kit?: ResolvedKit } = {}) {
  const feature = members({}), port = api ?? memberApi();
  const admin = createAdmin({ modules: [feature], ports: { membersApi: port } }, { permissions });
  const { Page, tabs } = feature.react.pages.members;
  return { ...await settle(<KitProvider needs={[feature.kitNeeds]} guard="off" {...(kit ? { kit } : {})}><feature.react.Provider admin={admin}><Suspense fallback="Loading…"><Page tabs={tabs} description={admin.describe().pages[0]!}/></Suspense></feature.react.Provider></KitProvider>), api: port, admin };
}
async function mountAuth({ api = authApi(), onLogin = vi.fn() }: { api?: AuthApiPort; onLogin?: ReturnType<typeof vi.fn> } = {}) {
  const feature = auth({}), admin = createAdmin({ modules: [feature], ports: { authApi: api } });
  const { Page, tabs } = feature.react.pages.auth;
  return { ...await settle(<KitProvider needs={[feature.kitNeeds]} guard="off"><feature.react.Provider admin={admin}><Suspense fallback="Loading…"><Page tabs={tabs} description={admin.describe().pages[0]!} onLogin={onLogin}/></Suspense></feature.react.Provider></KitProvider>), api, onLogin, admin };
}
async function menu(username = 'alice') { await userEvent.click(await screen.findByRole('button', { name: `Actions for user "${username}"` })); }
async function action(name: string, username = 'alice') { await menu(username); await userEvent.click(screen.getByRole('menuitem', { name })); }
async function confirm() { const dialog = screen.getByRole('alertdialog'); await userEvent.click(within(dialog).getByRole('button', { name: /^(Disable|Move to trash|Reset password) —/ })); }
function HouseConfirm({ controller: c }: ConfirmViewProps) {
  return c.open ? <div {...c.frameAttrs}><h2 {...c.titleAttrs}>{c.title}</h2><p>House confirmation</p>{c.body}<Button {...c.cancel}>House cancel</Button><Button {...c.confirm}>House confirm</Button></div> : null;
}
describe('composable users screen', () => {
  it('renders read-only with no grants, and hides all writes for unresolved owner classifications', async () => {
    const view = await mountUsers({ permissions: [] }); await screen.findByText('alice');
    expect(screen.getByText(/Read-only/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'New user' })).toBeNull(); expect(screen.queryByRole('button', { name: /Actions for user/ })).toBeNull();
    view.unmount(); const unknown = await mountUsers({ unknown: true }); await screen.findByText('alice');
    expect(screen.queryByRole('button', { name: /Actions for user/ })).toBeNull(); expect(screen.getByText(/Unresolved owner status/)).toBeInTheDocument(); unknown.unmount();
  });
  it('member.manage cannot touch operators while user/role managers cannot modify the owner', async () => {
    const readonly = await mountUsers({ permissions: ['member.manage'], callerId: 'outside' }); await screen.findByText('owner');
    expect(screen.queryByRole('button', { name: /Actions for user/ })).toBeNull(); readonly.unmount();
    await mountUsers({ permissions: ['user.manage', 'role.manage'], callerId: 'alice' }); await screen.findByText('owner');
    expect(screen.queryByRole('button', { name: 'Actions for user "owner"' })).toBeNull(); expect(screen.getByRole('button', { name: 'Actions for user "bob"' })).toBeInTheDocument();
  });
  it('owner can manage/reset own credentials but never disable or trash the seeded owner', async () => {
    await mountUsers(); await menu('owner'); expect(screen.getByRole('menuitem', { name: 'Manage' })).toBeInTheDocument(); expect(screen.getByRole('menuitem', { name: 'Reset password' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Disable' })).toBeNull(); expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });
  it('creates an operator with new-password autocomplete and manages email and grants', async () => {
    const { api } = await mountUsers(); await screen.findByRole('button', { name: 'New user' }); await userEvent.click(screen.getByRole('button', { name: 'New user' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Username' }), 'carol'); const password = screen.getByLabelText('Password', { exact: true }); expect(password).toHaveAttribute('autocomplete', 'new-password');
    await userEvent.type(password, 'secret'); await userEvent.click(screen.getByRole('button', { name: 'Create user' })); await screen.findByText('carol');
    await action('Manage'); await userEvent.clear(screen.getByRole('textbox', { name: 'Email' })); await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'updated@example.test'); await userEvent.click(screen.getByRole('button', { name: 'Save email' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save email' })).not.toBeDisabled());
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Assign role' }), 'r'); await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Assign' })).not.toHaveAttribute('aria-busy', 'true'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Attach policy' }), 'p'); await userEvent.click(screen.getByRole('button', { name: 'Attach' }));
    await waitFor(async () => expect((await api.listUsers({})).users.find(u => u.principalId === 'alice')!.policyIds).toEqual(['p']));
    const alice = (await api.listUsers({})).users.find(u => u.principalId === 'alice')!; expect(alice.email).toBe('updated@example.test'); expect(alice.roleIds).toEqual(['r']);
  });
  it('cancels disable, then confirms it; enable stays immediate and deletion uses Trash copy', async () => {
    const { api } = await mountUsers(); await action('Disable'); const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Cancel/ })); expect((await api.listUsers({})).users.find(u => u.principalId === 'alice')!.status).toBe('active');
    await action('Disable'); await confirm(); await waitFor(async () => expect((await api.listUsers({})).users.find(u => u.principalId === 'alice')!.status).toBe('disabled'));
    await action('Enable'); await waitFor(async () => expect((await api.listUsers({})).users.find(u => u.principalId === 'alice')!.status).toBe('active')); expect(screen.queryByRole('alertdialog')).toBeNull();
    await action('Delete'); expect(screen.getByText(/deleted permanently after 60 days/)).toBeInTheDocument(); expect((await api.listUsers({})).users.some(u => u.principalId === 'alice')).toBe(true);
    await confirm(); await waitFor(() => expect(screen.queryByText('alice')).toBeNull());
  });
  it('reset guards mismatch, preserves failures and reveals independently with autocomplete intact', async () => {
    const ports = fixtures(), reset = vi.spyOn(ports.api, 'resetUserPassword').mockRejectedValueOnce(new Error('try again'));
    await mountUsers({ api: ports.api }); await action('Reset password'); const first = screen.getByLabelText('New password', { exact: true }), second = screen.getByLabelText('Confirm new password');
    await userEvent.type(first, 'replacement'); await userEvent.type(second, 'wrong'); await confirm(); expect(reset).not.toHaveBeenCalled(); expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show new password' })); expect(first).toHaveAttribute('type', 'text'); expect(first).toHaveAttribute('autocomplete', 'new-password'); expect(second).toHaveAttribute('type', 'password');
    await userEvent.clear(second); await userEvent.type(second, 'replacement'); await confirm(); expect(screen.getByText('try again')).toBeInTheDocument(); expect(first).toHaveValue('replacement');
    await confirm(); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(reset).toHaveBeenLastCalledWith({ principalId: 'alice', password: 'replacement' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await action('Reset password'); expect(screen.getByLabelText('New password', { exact: true })).toHaveValue(''); expect(screen.getByLabelText('New password', { exact: true })).toHaveAttribute('type', 'password');
  });
  it('deep-links to own reset once and uses an overridable, guarded confirmation', async () => {
    const closed = vi.fn(), kit = createKit({ components: { ConfirmDialog: HouseConfirm } }, { guard: 'off' });
    const { api } = await mountUsers({ deepLink: true, closed, kit }); await screen.findByText('House confirmation');
    await userEvent.type(screen.getByLabelText('New password', { exact: true }), 'rotated'); await userEvent.type(screen.getByLabelText('Confirm new password'), 'rotated'); await confirm();
    await waitFor(() => expect(closed).toHaveBeenCalledTimes(1)); expect(screen.getByText('Password changed. Sign in again with your new password.')).toBeInTheDocument();
    await action('Delete'); await screen.findByText('House confirmation'); await confirm(); await waitFor(async () => expect((await api.listUsers({})).users.some(u => u.principalId === 'alice')).toBe(false));
  });
  it('blocks duplicate confirm and dismissal while pending, and aborts StrictMode controllers', async () => {
    const ports = fixtures(), pending = deferred<void>(); const del = vi.spyOn(ports.api, 'deleteUser').mockImplementation(() => pending.promise); const list = vi.spyOn(ports.api, 'listUsers');
    const view = await mountUsers({ api: ports.api, strict: true }); await action('Delete'); const dialog = screen.getByRole('alertdialog'), button = within(dialog).getByRole('button', { name: /^Move to trash —/ });
    fireEvent.click(button); fireEvent.click(button); fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/ })); expect(del).toHaveBeenCalledTimes(1); expect(screen.getByRole('alertdialog')).toBeInTheDocument(); expect(button).toBeDisabled();
    await act(async () => { pending.resolve(); await pending.promise; }); view.unmount(); expect(list.mock.calls.every(c => c[1]!.signal!.aborted)).toBe(true);
  });
  it('does not render omitted users tab content', async () => { await mountUsers({ omit: true }); expect(screen.queryByRole('button', { name: 'New user' })).toBeNull(); });
});
describe('composable members and login', () => {
  it('members render read-only without grants and details remain readable', async () => {
    await mountMembers({ permissions: [] }); await userEvent.click(await screen.findByRole('button', { name: 'member@example.test' })); await screen.findByText('not verified'); expect(screen.getByText(/Read-only/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: /Actions for member/ })).toBeNull();
  });
  it('resends immediately, cancels removal, then uses a host override for confirmed disable', async () => {
    const kit = createKit({ components: { ConfirmDialog: HouseConfirm } }, { guard: 'off' }), { api } = await mountMembers({ kit });
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for member "member@example.test"' })); await userEvent.click(screen.getByRole('menuitem', { name: 'Resend sign-in link' })); await screen.findByText('Sign-in link sent.'); expect(screen.queryByRole('alertdialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for member "member@example.test"' })); await userEvent.click(screen.getByRole('menuitem', { name: 'Disable' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Cancel/ })); expect((await api.getMember({ id: 'm' })).member.status).toBe('active');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for member "member@example.test"' })); await userEvent.click(screen.getByRole('menuitem', { name: 'Disable' })); await screen.findByText('House confirmation'); await confirm(); await screen.findByText('Member disabled.'); expect((await api.getMember({ id: 'm' })).member.status).toBe('disabled');
  });
  it('login works before any grants, reports failure and invokes the host on successful credentials', async () => {
    const { onLogin } = await mountAuth(); const password = await screen.findByLabelText('Password'); expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('admin'); expect(password).toHaveAttribute('autocomplete', 'current-password');
    await userEvent.type(password, 'wrong'); await userEvent.click(screen.getByRole('button', { name: 'Sign in' })); await screen.findByText('invalid username or password'); expect(onLogin).not.toHaveBeenCalled();
    await userEvent.clear(password); await userEvent.type(password, 'secret'); await userEvent.click(screen.getByRole('button', { name: 'Sign in' })); await waitFor(() => expect(onLogin).toHaveBeenCalledWith({ user: { id: 'owner', username: 'admin' } })); expect(password).toHaveValue('');
  });
});
