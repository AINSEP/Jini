import { act, renderHook, waitFor } from '@testing-library/react';
import type { FormEvent, ReactNode } from 'react';
import { expect, test, vi } from 'vitest';
import { FetchQueryProvider } from '@jini-ai/ui/panel-kit';
import { useUsers } from '../index.js';
import { createFakeRolesPort, createFakeUsersPort } from '../testing.js';

const translate = (key: string) => key;
function wrapper({ children }: { children: ReactNode }) { return <FetchQueryProvider>{children}</FetchQueryProvider>; }
const submit = () => ({ preventDefault: vi.fn() }) as unknown as FormEvent;

test('user creation, grants, email and status writes preserve exact port payloads and refresh the roster', async () => {
  const port = createFakeUsersPort({}, { meId: 'another-admin', roles: [{ id: 'editor', workspaceId: 'fake-ws', name: 'Editor', isBuiltin: false }] });
  const create = vi.spyOn(port, 'createUser');
  const { result } = renderHook(() => useUsers({ port, translate, queryScope: 'reconcile-users' }), { wrapper });
  await waitFor(() => expect(result.current.users).toEqual([]));
  act(() => { result.current.setUsername('alice'); result.current.setPassword('secret'); result.current.setEmail('alice@example.com'); });
  await act(async () => result.current.onCreate(submit()));
  expect(create).toHaveBeenCalledWith({ username: 'alice', password: 'secret' }, { email: 'alice@example.com' });
  await waitFor(() => expect(result.current.users?.[0]?.username).toBe('alice'));
  const user = result.current.users![0]!;
  act(() => { result.current.toggleExpanded(user); result.current.setPendingRoleId('editor'); });
  await act(async () => result.current.onAssignRole({ principalId: user.principalId }));
  await waitFor(() => expect(result.current.users?.[0]?.roleIds).toEqual(['editor']));
  act(() => result.current.setEditEmail('new@example.com'));
  await act(async () => result.current.onSaveEmail({ principalId: user.principalId }));
  await waitFor(() => expect(result.current.users?.[0]?.email).toBe('new@example.com'));
  await act(async () => result.current.onToggleStatus(result.current.users![0]!));
  await waitFor(() => expect(result.current.users?.[0]?.status).toBe('disabled'));
  expect(result.current.formError).toBeNull();
  expect(result.current.grantError).toBeNull();
});

// REGRESSION: fails if updatePolicy spreads opts without restoring the existing name for name: undefined.
test('fake policy updates preserve the required name across omitted and undefined optional names', async () => {
  const port = createFakeRolesPort({}, { policies: [{ id: 'custom', workspaceId: 'fake-ws', name: 'Custom', isBuiltin: false, isFrozen: false }] });
  const target = { policyId: 'custom' };
  expect((await port.updatePolicy(target)).policy.name).toBe('Custom');
  const described = await port.updatePolicy(target, { description: 'New description' });
  expect(described.policy).toMatchObject({ name: 'Custom', description: 'New description' });
  const undefinedName = await port.updatePolicy(target, { name: undefined });
  expect(undefinedName.policy).toMatchObject({ name: 'Custom', description: 'New description' });
  expect((await port.updatePolicy(target, { name: 'Renamed' })).policy.name).toBe('Renamed');
  expect(port.policies[0]?.name).toBe('Renamed');
});

test('failed create exposes the port error and leaves the draft available for retry', async () => {
  const port = createFakeUsersPort({}, { createUserError: new Error('creation unavailable') });
  const { result } = renderHook(() => useUsers({ port, translate, queryScope: 'reconcile-create-failure' }), { wrapper });
  await waitFor(() => expect(result.current.users).toEqual([]));
  act(() => { result.current.setUsername('alice'); result.current.setPassword('secret'); result.current.setFormOpen(true); });
  await act(async () => result.current.onCreate(submit()));
  expect(result.current.formError).toBe('creation unavailable');
  expect(result.current.saving).toBe(false);
  expect(result.current.formOpen).toBe(true);
  expect(result.current.username).toBe('alice');
  expect(port.users).toEqual([]);
});
