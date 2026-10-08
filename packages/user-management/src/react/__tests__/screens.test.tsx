import '@testing-library/jest-dom/vitest';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FetchQueryProvider } from '@jini-ai/ui/panel-kit';
import { Login, Users, Members, useUsers, describeIdentityError } from '../index.js';
import { createFakeLoginPort, createFakeUsersPort, createFakeMembersPort } from '../testing.js';
import type { AdminIdentityUser } from '../models.js';

const translate = (key: string) => key;
const alice: AdminIdentityUser = {
  principalId: 'alice', workspaceId: 'one', username: 'alice', status: 'active',
  createdAt: '2026-01-01T00:00:00Z', roleIds: [], policyIds: [],
};

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('screen attempted network access'); })); });
afterEach(() => { vi.unstubAllGlobals(); });

test('login has caller branding, no preset operator name, and submits only through the port', async () => {
  const user = userEvent.setup();
  const port = createFakeLoginPort({}, { user: { id: 'alice', username: 'alice' } });
  const login = vi.spyOn(port, 'login');
  const onLogin = vi.fn();
  render(<Login port={port} translate={translate} productName="Example product" onLogin={onLogin} />);
  expect(screen.getByRole('heading', { name: 'Example product' })).toBeInTheDocument();
  expect(screen.getByLabelText('Username')).toHaveValue('');
  await user.type(screen.getByLabelText('Username'), 'alice');
  await user.type(screen.getByLabelText('Password'), 'secret');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(login).toHaveBeenCalledWith({ username: 'alice', password: 'secret' });
  expect(onLogin).toHaveBeenCalledWith({ id: 'alice', username: 'alice' });
  expect(fetch).not.toHaveBeenCalled();
});

test('users retain the new-password autofill protection and create through their port', async () => {
  const user = userEvent.setup();
  const port = createFakeUsersPort({}, { users: [alice] });
  const create = vi.spyOn(port, 'createUser');
  render(<FetchQueryProvider><Users port={port} translate={translate} queryScope="one" /></FetchQueryProvider>);
  await screen.findByText('alice');
  await user.click(screen.getByRole('button', { name: 'New user' }));
  expect(screen.getByLabelText('Username')).toHaveAttribute('data-agent-element', 'users-new-username');
  const password = screen.getByLabelText('Password');
  expect(password).toHaveAttribute('autocomplete', 'new-password');
  await user.type(screen.getByLabelText('Username'), 'bob');
  await user.type(password, 'secret');
  await user.click(screen.getByRole('button', { name: 'Create user' }));
  await waitFor(() => expect(create).toHaveBeenCalledWith({ username: 'bob', password: 'secret' }, { email: undefined }));
  await screen.findByText('bob');
  expect(fetch).not.toHaveBeenCalled();
});

test('member text and confirmation cancel labels use injected translation', async () => {
  const user = userEvent.setup();
  const port = createFakeMembersPort({}, { members: [{
    id: 'member', workspaceId: 'one', email: 'member@example.com', status: 'active',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', version: 1,
  }] });
  const translated = (key: string) => `translated:${key}`;
  render(<Members port={port} translate={translated} />);
  await screen.findByRole('heading', { name: 'translated:Members' });
  expect(screen.getByRole('button', { name: 'translated:Actions for member "member@example.com"' }).getAttribute('data-agent-element')).toBe('members-row-member-menu');
  await user.click(screen.getByRole('button', { name: 'translated:Actions for member "member@example.com"' }));
  await user.click(screen.getByRole('menuitem', { name: 'translated:Disable' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('button', { name: 'translated:Cancel' })).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

test('two host scopes sharing a provider cannot see each other’s user cache', async () => {
  // The caller must differ from the disable target; self-disable is protected.
  const one = createFakeUsersPort({}, { users: [alice], meId: "another-admin" });
  const bob = { ...alice, principalId: 'bob', workspaceId: 'two', username: 'bob' };
  const two = createFakeUsersPort({}, { users: [bob] });
  function wrapper({ children }: { children: React.ReactNode }) { return <FetchQueryProvider>{children}</FetchQueryProvider>; }
  const { result } = renderHook(() => ({
    one: useUsers({ port: one, translate, queryScope: 'one' }),
    two: useUsers({ port: two, translate, queryScope: 'two' }),
  }), { wrapper });
  await waitFor(() => { expect(result.current.one.users).toEqual([alice]); expect(result.current.two.users).toEqual([bob]); });
  await act(async () => result.current.one.onToggleStatus(alice));
  await waitFor(() => expect(result.current.one.users?.[0]?.status).toBe('disabled'));
  expect(result.current.two.users).toEqual([bob]);
});

test('error codes supplied by independent transports use caller translations', () => {
  const error = Object.assign(new Error('raw'), { code: 'FORBIDDEN' });
  expect(describeIdentityError({ error, fallback: 'fallback', translate: key => `translated:${key}` }, {
    messages: { FORBIDDEN: 'You do not have permission to do that.' },
  })).toBe('translated:You do not have permission to do that.');
  expect(describeIdentityError({ error: new Error('connection lost'), fallback: 'fallback', translate })).toBe('connection lost');
  expect(describeIdentityError({ error: null, fallback: 'fallback', translate })).toBe('fallback');
});
