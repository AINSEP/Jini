import { forwardRef, useEffect, useRef, useState, type ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import type { CachedLoader, CachedLoaderDefaults, FetchMutationOptions, MutationResult, MutationStatus, QueryResult } from '@jini-ai/core/fetch';
import { UserManagementKitProvider, type AsyncActionState, type ConfirmDialogProps, type InfoTipProps, type RowMenuProps, type SecretInputProps, type UserManagementKit, type UserManagementKitComponents, type UserManagementKitHooks } from '../kit.js';

/** Plain elements, no UI library: each slot is a tagged element so a test asserts which slot rendered, not a kit's markup. */
const fakeComponents: UserManagementKitComponents = {
  SecretInput: forwardRef<HTMLInputElement, Omit<SecretInputProps, 'ref'>>(function FakeSecretInput({ label, toggleLabels: _toggleLabels, revealed: _revealed, onRevealedChange: _onRevealedChange, toggleAttrs: _toggleAttrs, ...input }, ref) {
    return <label data-um-kit="SecretInput">{label}<input {...input} ref={ref} type="password" /></label>;
  }),
  RowMenu: (p: RowMenuProps) => (
    <div data-um-kit="RowMenu" role="menu" aria-label={p.triggerLabel}>
      {p.items.map((item) => <button key={item.key} type="button" role="menuitem" data-tone={item.tone} onClick={item.onSelect}>{item.label}</button>)}
    </div>
  ),
  ConfirmDialog: (p: ConfirmDialogProps) => (
    <div data-um-kit="ConfirmDialog" data-open={String(p.open)} data-tone={p.tone} role={p.open ? 'dialog' : undefined} aria-label={p.open ? p.title : undefined}>
      {p.open ? <>{p.body}
        <button type="button" disabled={p.pending} onClick={p.onCancel}>{p.cancelLabel ?? 'Cancel'}</button>
        <button type="button" disabled={p.pending} onClick={p.onConfirm}>{p.confirmLabel}</button></> : null}
    </div>
  ),
  InfoTip: (p: InfoTipProps) => <span data-um-kit="InfoTip" title={p.label} aria-label={p.triggerLabel ?? p.label} />,
};

type Settled<T> = { status: 'loading' } | { status: 'success'; data: T } | { status: 'error'; error: Error };

/** Loading first, then the fetch's value or its error, exactly the three states a page renders. */
const fakeUseFetchQuery: UserManagementKitHooks['useFetchQuery'] = <T,>({ fetch }: { fetch: () => Promise<T> }, { enabled = true }: { enabled?: boolean } = {}): QueryResult<T> => {
  const [state, setState] = useState<Settled<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // A test's fetch is a fresh closure every render; the latest one is read when the effect runs, never listed as a dependency.
  const latestFetch = useRef(fetch);
  latestFetch.current = fetch;
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    latestFetch.current().then(
      (data) => { if (live) setState({ status: 'success', data }); },
      (error: unknown) => { if (live) setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) }); },
    );
    return () => { live = false; };
  }, [attempt, enabled]);
  return {
    data: state.status === 'success' ? state.data : undefined, error: state.status === 'error' ? state.error : null,
    status: state.status, isFetching: state.status === 'loading', refetch: () => setAttempt((n) => n + 1),
  };
};

const fakeUseFetchMutation: UserManagementKitHooks['useFetchMutation'] = <TInput, TOutput>({ run }: Pick<FetchMutationOptions<TInput, TOutput>, 'run'>): MutationResult<TInput, TOutput> => {
  const [state, setState] = useState<{ status: MutationStatus; error: Error | null }>({ status: 'idle', error: null });
  const mutate = async ({ input }: { input: TInput }): Promise<TOutput> => {
    setState({ status: 'pending', error: null });
    try {
      const out = await run({ input });
      setState({ status: 'success', error: null });
      return out;
    } catch (error) {
      setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) });
      throw error;
    }
  };
  return { mutate, status: state.status, error: state.error, reset: () => setState({ status: 'idle', error: null }) };
};

const fakeUseAsyncAction = (): AsyncActionState => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run: AsyncActionState['run'] = async ({ action, describeError }) => {
    setSaving(true); setError(null);
    try { await action(); } catch (e) { setError(describeError(e)); } finally { setSaving(false); }
  };
  return { saving, error, setError, run };
};

const fakeUseCachedLoader: UserManagementKitHooks['useCachedLoader'] = <T,>(required: CachedLoaderDefaults<T>): CachedLoader<T> => {
  const cache = useRef<T | undefined>(undefined);
  const load: CachedLoader<T>['load'] = async (override) => {
    const fetch = override?.fetch ?? required.fetch;
    if (!fetch) throw new Error('fake cached loader needs a fetch');
    const value = await fetch();
    cache.current = value;
    return value;
  };
  return { peek: () => cache.current, load, replace: ({ value }) => { cache.current = value; } };
};

const fakeHooks: UserManagementKitHooks = {
  useFetchQuery: fakeUseFetchQuery,
  useFetchMutation: fakeUseFetchMutation,
  useAsyncAction: fakeUseAsyncAction,
  useCachedLoader: fakeUseCachedLoader,
  useInvalidate: () => () => {},
};

/** Test-only kit: plain tagged elements and in-memory hooks. An override replaces exactly the named slots. */
export function fakeUmKit(overrides: Partial<{ [G in keyof UserManagementKit]: Partial<UserManagementKit[G]> }> = {}): UserManagementKit {
  return { components: { ...fakeComponents, ...overrides.components }, hooks: { ...fakeHooks, ...overrides.hooks } };
}

/** Render under the user-management kit provider; `kit` defaults to the plain fake. */
export function renderWithUmKit(ui: ReactElement, { kit = fakeUmKit() }: { kit?: UserManagementKit } = {}): RenderResult {
  return render(ui, { wrapper: ({ children }) => <UserManagementKitProvider kit={kit}>{children}</UserManagementKitProvider> });
}
