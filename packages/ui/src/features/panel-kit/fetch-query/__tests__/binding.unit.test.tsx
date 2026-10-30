import type { ReactNode } from 'react';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchQueryAdapter } from '@jini-ai/core/fetch';
import { FetchQueryBinding, useCachedLoader, useFetchMutation, useFetchQuery, useFetchQueryScope, useInvalidate } from '../binding.react.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function adapterFixture() {
  const query = { data: undefined, error: null, status: 'loading' as const, isFetching: false, refetch: vi.fn() };
  const mutation = { mutate: vi.fn(), status: 'idle' as const, error: null, reset: vi.fn() };
  const invalidate = vi.fn();
  const loader = { load: vi.fn(), peek: vi.fn(), replace: vi.fn() };
  const adapter: FetchQueryAdapter = {
    useFetchQuery: vi.fn(() => query) as FetchQueryAdapter['useFetchQuery'],
    useFetchMutation: vi.fn(() => mutation), useInvalidate: vi.fn(() => invalidate),
    useCachedLoader: vi.fn(() => loader),
  };
  return { adapter, query, mutation, invalidate, loader };
}

describe('provider binding', () => {
  it('forwards required inputs, explicit options and results to the selected adapter', () => {
    const { adapter, query, mutation, invalidate, loader } = adapterFixture();
    const read = { key: ['item', 7], fetch: async () => 'value' }, readOptions = { staleTime: 5 };
    const write = { run: async ({ input }: { input: string }) => input.length }, writeOptions = { invalidates: [['item']] };
    const loaderOptions = { staleTime: 10 };
    const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryBinding adapter={adapter}>{children}</FetchQueryBinding>;
    const { result } = renderHook(() => ({ query: useFetchQuery(read, readOptions), mutation: useFetchMutation(write, writeOptions), invalidate: useInvalidate(), loader: useCachedLoader(read, loaderOptions) }), { wrapper });
    expect(result.current).toEqual({ query, mutation, invalidate, loader });
    expect(result.current.query).toBe(query); expect(result.current.mutation).toBe(mutation); expect(result.current.loader).toBe(loader);
    expect(adapter.useFetchQuery).toHaveBeenCalledWith(read, readOptions);
    expect(adapter.useFetchMutation).toHaveBeenCalledWith(write, writeOptions);
    expect(adapter.useCachedLoader).toHaveBeenCalledWith(read, loaderOptions);
    expect(adapter.useInvalidate).toHaveBeenCalledWith();
  });

  it('supplies empty options consistently for unconfigured calls', () => {
    const { adapter } = adapterFixture();
    const read = { key: ['item'], fetch: async () => 'value' }, write = { run: async () => 'saved' };
    const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryBinding adapter={adapter}>{children}</FetchQueryBinding>;
    renderHook(() => { useFetchQuery(read); useFetchMutation(write); useCachedLoader(read); }, { wrapper });
    expect(adapter.useFetchQuery).toHaveBeenCalledWith(read, {});
    expect(adapter.useFetchMutation).toHaveBeenCalledWith(write, {});
    expect(adapter.useCachedLoader).toHaveBeenCalledWith(read, {});
  });

  it('keeps one scope per owner across rerenders and adapter replacement', () => {
    const first = adapterFixture(), second = adapterFixture();
    const a = {}, b = {};
    let selected = first.adapter;
    const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryBinding adapter={selected}>{children}</FetchQueryBinding>;
    const { result, rerender } = renderHook(() => [useFetchQueryScope({ owner: a }), useFetchQueryScope({ owner: a }), useFetchQueryScope({ owner: b })], { wrapper });
    expect(result.current).toEqual([1, 1, 2]);
    selected = second.adapter; rerender();
    expect(result.current).toEqual([1, 1, 2]);
  });

  it('allocates scopes independently per provider and dispatches to the nearest one', () => {
    const outer = adapterFixture(), inner = adapterFixture(), owner = {};
    const read = { key: ['item'], fetch: async () => 'value' };
    const parent = renderHook(() => useFetchQueryScope({ owner: {} }), { wrapper: ({ children }) => <FetchQueryBinding adapter={outer.adapter}>{children}</FetchQueryBinding> });
    expect(parent.result.current).toBe(1);
    const nested = renderHook(() => ({ scope: useFetchQueryScope({ owner }), query: useFetchQuery(read) }), {
      wrapper: ({ children }) => <FetchQueryBinding adapter={outer.adapter}><FetchQueryBinding adapter={inner.adapter}>{children}</FetchQueryBinding></FetchQueryBinding>,
    });
    expect(nested.result.current.scope).toBe(1); expect(nested.result.current.query).toBe(inner.query);
    expect(outer.adapter.useFetchQuery).not.toHaveBeenCalled();
    expect(inner.adapter.useFetchQuery).toHaveBeenCalledWith(read, {});
  });

  it.each([
    () => useFetchQuery({ key: ['item'], fetch: async () => 1 }),
    () => useFetchMutation({ run: async () => 1 }),
    () => useCachedLoader({ key: ['item'] }),
    () => useInvalidate(),
    () => useFetchQueryScope({ owner: {} }),
  ])('refuses an unscoped hook before using a cache', hook => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => hook())).toThrow('Fetch-query hooks require FetchQueryProvider');
  });
});
