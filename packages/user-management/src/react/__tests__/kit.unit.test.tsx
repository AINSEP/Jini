import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import {
  ConfirmDialog, InfoTip, RowMenu, SecretInput, UserManagementKitMissingError, UserManagementKitProvider,
  useAsyncAction, useCachedLoader, useFetchMutation, useFetchQuery, useInvalidate, useUserManagementKit,
  type UserManagementKit, type UserManagementKitComponents, type UserManagementKitHooks,
} from '../kit.js';
import { fakeUmKit, renderWithUmKit } from './fake-um-kit.js';

/** Test-only consumer: renders all four slot components and calls all five hook wrappers, as R3b's pages will. */
function KitProbe({ fetchUsers = () => Promise.resolve('three users') }: { fetchUsers?: () => Promise<string> }) {
  const query = useFetchQuery({ key: ['probe'], fetch: fetchUsers });
  const mutation = useFetchMutation({ run: ({ input }: { input: string }) => Promise.resolve(input.toUpperCase()) });
  const action = useAsyncAction();
  const loader = useCachedLoader({ key: ['probe-cache'], fetch: () => Promise.resolve('cached') });
  const invalidate = useInvalidate();
  const [loaded, setLoaded] = useState('none');
  return (
    <div>
      <p data-testid="query">{query.status}:{query.status === 'success' ? query.data : query.error?.message ?? ''}</p>
      <p data-testid="mutation">{mutation.status}</p>
      <p data-testid="action">{action.saving ? 'saving' : (action.error ?? 'idle')}</p>
      <p data-testid="invalidate">{typeof invalidate}</p>
      <p data-testid="loaded">{loaded}</p>
      <button type="button" onClick={() => void mutation.mutate({ input: 'ok' })}>mutate</button>
      <button type="button" onClick={() => void action.run({ action: () => Promise.reject(new Error('boom')), describeError: (e) => `failed: ${(e as Error).message}` })}>act</button>
      <button type="button" onClick={() => void loader.load().then(setLoaded)}>load</button>
      <SecretInput label="Password" onChange={() => {}} value="" />
      <RowMenu triggerLabel="Actions for user" items={[{ key: 'del', label: 'Delete', onSelect: () => {}, tone: 'danger' }]} />
      <ConfirmDialog open title="Delete?" body={<span>Sure?</span>} confirmLabel="Delete" onConfirm={() => {}} onCancel={() => {}} />
      <InfoTip label="About roles" />
    </div>
  );
}

const quietly = <T,>(run: () => T): T => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { return run(); } finally { spy.mockRestore(); }
};

describe('user-management kit: provider contract', () => {
  it('throws a typed error naming the provider when KitProbe renders without one', () => {
    const thrown = quietly(() => { try { render(<KitProbe />); } catch (e) { return e; } return null; });
    expect(thrown).toBeInstanceOf(UserManagementKitMissingError);
    expect((thrown as Error).message).toContain('UserManagementKitProvider');
  });

  it.each([
    ['SecretInput', <SecretInput key="s" label="Password" />],
    ['RowMenu', <RowMenu key="r" triggerLabel="Actions" items={[]} />],
    ['ConfirmDialog', <ConfirmDialog key="c" open={false} title="t" body="b" confirmLabel="ok" onConfirm={() => {}} onCancel={() => {}} />],
    ['InfoTip', <InfoTip key="i" label="tip" />],
  ])('the %s slot alone throws the same typed error without a provider', (_name, element) => {
    expect(quietly(() => { try { render(element); } catch (e) { return e; } return null; })).toBeInstanceOf(UserManagementKitMissingError);
  });

  it('useUserManagementKit throws the typed error without a provider and returns the kit under one', () => {
    expect(quietly(() => { try { renderHook(() => useUserManagementKit()); } catch (e) { return e; } return null; })).toBeInstanceOf(UserManagementKitMissingError);
    const kit = fakeUmKit();
    const wrapper = ({ children }: { children: ReactNode }) => <UserManagementKitProvider kit={kit}>{children}</UserManagementKitProvider>;
    expect(renderHook(() => useUserManagementKit(), { wrapper }).result.current).toBe(kit);
  });

  it('keeps the first kit it received so hook slots never change identity between renders', () => {
    const first = fakeUmKit();
    const second = fakeUmKit();
    const seen: UserManagementKit[] = [];
    const Reader = () => { seen.push(useUserManagementKit()); return null; };
    const { rerender } = render(<UserManagementKitProvider kit={first}><Reader /></UserManagementKitProvider>);
    rerender(<UserManagementKitProvider kit={second}><Reader /></UserManagementKitProvider>);
    expect(seen.every((kit) => kit === first)).toBe(true);
  });
});

describe('user-management kit: slots and hooks resolve through the provider', () => {
  it('renders every slot component as the fake element, with its props passed through', () => {
    const { container } = renderWithUmKit(<KitProbe />);
    expect(Array.from(container.querySelectorAll('[data-um-kit]'), (el) => el.getAttribute('data-um-kit')).sort())
      .toEqual(['ConfirmDialog', 'InfoTip', 'RowMenu', 'SecretInput']);
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('menu', { name: 'Actions for user' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute('data-tone', 'danger');
    expect(screen.getByRole('dialog', { name: 'Delete?' })).toHaveTextContent('Sure?');
    expect(screen.getByLabelText('About roles')).toHaveAttribute('title', 'About roles');
  });

  it('every hook wrapper returns the fake kit\'s output: query loading then resolved, mutation, async action, cached loader, invalidate', async () => {
    renderWithUmKit(<KitProbe />);
    expect(screen.getByTestId('query')).toHaveTextContent('loading:');
    expect(await screen.findByText('success:three users')).toBeInTheDocument();
    expect(screen.getByTestId('mutation')).toHaveTextContent('idle');
    fireEvent.click(screen.getByText('mutate'));
    expect(await screen.findByText('success', { selector: '[data-testid="mutation"]' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('act'));
    expect(await screen.findByText('failed: boom')).toBeInTheDocument();
    fireEvent.click(screen.getByText('load'));
    expect(await screen.findByText('cached', { selector: '[data-testid="loaded"]' })).toBeInTheDocument();
    expect(screen.getByTestId('invalidate')).toHaveTextContent('function');
  });

  it('surfaces a rejected query as the error state', async () => {
    renderWithUmKit(<KitProbe fetchUsers={() => Promise.reject(new Error('server is down'))} />);
    expect(await screen.findByText('error:server is down')).toBeInTheDocument();
  });

  it('an override replaces exactly one slot and leaves the other three on the fake', () => {
    const Custom = () => <span data-custom="info-tip" />;
    const { container } = renderWithUmKit(<KitProbe />, { kit: fakeUmKit({ components: { InfoTip: Custom } }) });
    expect(container.querySelector('[data-custom="info-tip"]')).not.toBeNull();
    expect(container.querySelector('[data-um-kit="InfoTip"]')).toBeNull();
    expect(Array.from(container.querySelectorAll('[data-um-kit]'), (el) => el.getAttribute('data-um-kit')).sort())
      .toEqual(['ConfirmDialog', 'RowMenu', 'SecretInput']);
  });

  it('an overridden hook replaces exactly that hook', async () => {
    const useFetchQueryOverride: UserManagementKitHooks['useFetchQuery'] = () => ({ data: undefined, error: null, status: 'loading', isFetching: true, refetch: () => {} });
    renderWithUmKit(<KitProbe />, { kit: fakeUmKit({ hooks: { useFetchQuery: useFetchQueryOverride } }) });
    expect(screen.getByTestId('query')).toHaveTextContent('loading:');
    fireEvent.click(screen.getByText('mutate'));
    expect(await screen.findByText('success', { selector: '[data-testid="mutation"]' })).toBeInTheDocument();
  });
});

describe('UserManagementKit type', () => {
  it('requires every slot and every hook', () => {
    type WithoutInfoTip = { components: Omit<UserManagementKitComponents, 'InfoTip'>; hooks: UserManagementKitHooks };
    type WithoutInvalidate = { components: UserManagementKitComponents; hooks: Omit<UserManagementKitHooks, 'useInvalidate'> };
    expectTypeOf<WithoutInfoTip>().not.toMatchTypeOf<UserManagementKit>();
    expectTypeOf<WithoutInvalidate>().not.toMatchTypeOf<UserManagementKit>();
    expectTypeOf<{ components: UserManagementKitComponents; hooks: UserManagementKitHooks }>().toMatchTypeOf<UserManagementKit>();
  });
});
