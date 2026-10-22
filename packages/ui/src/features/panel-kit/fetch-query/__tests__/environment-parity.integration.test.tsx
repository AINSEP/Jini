import { StrictMode, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FetchQueryProvider as BuiltInProvider, useFetchMutation, useFetchQuery, type FetchQueryEnvironmentPort } from '../index.js';
import { FetchQueryProvider as TanStackProvider } from "../tanstack.js";

function environmentFixture({ online = true }: { online?: boolean } = {}) {
  const connectivity = new Set<(online: boolean) => void>();
  const focus = new Set<() => void>();
  const environment: FetchQueryEnvironmentPort = {
    isOnline: () => online,
    subscribeOnline: ({ listener }) => { connectivity.add(listener); return () => { connectivity.delete(listener); }; },
    subscribeFocus: ({ listener }) => { focus.add(listener); return () => { focus.delete(listener); }; },
  };
  return {
    environment, connectivity, focus,
    connect: (value: boolean) => { online = value; for (const notify of connectivity) notify(value); },
    focused: () => { for (const notify of focus) notify(); },
  };
}


describe.each([["built-in", BuiltInProvider], ["tanstack", TanStackProvider]] as const)("%s adapter conformance", (_name, FetchQueryProvider) => {

describe('provider environment parity', () => {
  it('keeps host connectivity independent between providers', async () => {
    const offline = environmentFixture({ online: false });
    const online = environmentFixture();
    const firstFetch = vi.fn(async () => 'first');
    const secondFetch = vi.fn(async () => 'second');
    const firstWrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider environment={offline.environment}>{children}</FetchQueryProvider>;
    const secondWrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider environment={online.environment}>{children}</FetchQueryProvider>;
    const first = renderHook(() => useFetchQuery({ key: ['same'], fetch: firstFetch }, { staleTime: 0 }), { wrapper: firstWrapper });
    const second = renderHook(() => useFetchQuery({ key: ['same'], fetch: secondFetch }, { staleTime: 0 }), { wrapper: secondWrapper });
    await waitFor(() => expect(second.result.current.data).toBe('second'));
    expect(firstFetch).not.toHaveBeenCalled();
    await act(async () => offline.connect(true));
    await waitFor(() => expect(first.result.current.data).toBe('first'));
    expect(firstFetch).toHaveBeenCalledTimes(1);
    expect(secondFetch).toHaveBeenCalledTimes(1);
  });

  it('uses a host port for offline reads/writes and resumes both without duplicates', async () => {
    const env = environmentFixture({ online: false });
    const fetch = vi.fn(async () => 'online data');
    const run = vi.fn(async ({ input }: { input: string }) => `saved ${input}`);
    const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider environment={env.environment}>{children}</FetchQueryProvider>;
    const { result, unmount } = renderHook(() => ({
      read: useFetchQuery({ key: ['rows'], fetch }),
      write: useFetchMutation({ run }),
    }), { wrapper });
    let write!: Promise<string>;
    await act(async () => { write = result.current.write.mutate({ input: 'record' }); });
    expect(fetch).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
    expect(result.current.read).toMatchObject({ status: 'loading', error: null, isFetching: false });
    // TanStack publishes observer updates on its notify tick (setTimeout 0), after act's microtasks.
    await waitFor(() => expect(result.current.write.status).toBe('pending'));
    expect(run).not.toHaveBeenCalled();
    await act(async () => { env.connect(true); await write; });
    await waitFor(() => expect(result.current.read.data).toBe('online data'));
    expect(result.current.write.status).toBe('success');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ input: 'record' });
    expect(fetch).toHaveBeenCalledTimes(1);
    unmount();
    expect(env.connectivity.size).toBe(0); expect(env.focus.size).toBe(0);
  });

  it('reconnects stale enabled queries while default focus and disabled queries stay quiet', async () => {
    const env = environmentFixture();
    let call = 0;
    const fetch = vi.fn(async () => `value ${++call}`);
    const disabledFetch = vi.fn(async () => 'disabled');
    const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider environment={env.environment}>{children}</FetchQueryProvider>;
    const { result, unmount } = renderHook(() => ({
      read: useFetchQuery({ key: ['rows'], fetch }, { staleTime: 0 }),
      disabled: useFetchQuery({ key: ['disabled'], fetch: disabledFetch }, { enabled: false }),
    }), { wrapper });
    await waitFor(() => expect(result.current.read.data).toBe('value 1'));
    await act(async () => { env.focused(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { env.connect(false); env.connect(true); });
    await waitFor(() => expect(result.current.read.data).toBe('value 2'));
    expect(fetch).toHaveBeenCalledTimes(2); expect(disabledFetch).not.toHaveBeenCalled();
    unmount();
  });

  it('retries an initial failure with loading and retains the error until success through the hook', async () => {
    const env = environmentFixture();
    let resolve!: (value: string) => void;
    const next = new Promise<string>(yes => { resolve = yes; });
    const error = new Error('failed');
    const fetch = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(error)
      .mockImplementationOnce(() => next);
    const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider environment={env.environment}>{children}</FetchQueryProvider>;
    const { result, unmount } = renderHook(() => useFetchQuery({ key: ['rows'], fetch }), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => { result.current.refetch(); });
    await waitFor(() => expect(result.current).toMatchObject({ data: undefined, status: 'loading', error, isFetching: true }));
    expect(result.current.error).toBe(error);
    await act(async () => { resolve('recovered'); });
    await waitFor(() => expect(result.current.data).toBe('recovered'));
    expect(result.current).toMatchObject({ data: 'recovered', status: 'success', error: null, isFetching: false });
    unmount();
  });

  it('keeps an unobserved entry past the 5-minute idle default while its staleTime says it is fresh', async () => {
    vi.useFakeTimers();
    const { environment } = environmentFixture();
    const fetch = vi.fn(async (key: string) => `${key}-value`);
    const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider environment={environment}>{children}</FetchQueryProvider>;
    const hook = renderHook(({ id }) => useFetchQuery({ key: [id], fetch: () => fetch(id) }, { staleTime: 10 * 60_000 }), { wrapper, initialProps: { id: 'kept' } });
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(hook.result.current.data).toBe('kept-value');
      // Switching keys leaves ['kept'] with no observer, so only idle retention keeps it.
      hook.rerender({ id: 'other' });
      await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60_000); });
      hook.rerender({ id: 'kept' });
      expect(hook.result.current.data).toBe('kept-value');
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(fetch.mock.calls.filter(([key]) => key === 'kept')).toHaveLength(1);
    } finally {
      hook.unmount(); vi.useRealTimers();
    }
  });

  it('wires browser online/offline signals and cleans up StrictMode subscriptions', async () => {
    let online = false;
    const onlineGetter = vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const fetch = vi.fn(async () => 'connected');
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode><FetchQueryProvider>{children}</FetchQueryProvider></StrictMode>;
    const hook = renderHook(() => useFetchQuery({ key: ['rows'], fetch }, { staleTime: 0 }), { wrapper });
    try {
      await act(async () => {});
      expect(fetch).not.toHaveBeenCalled();
      expect(hook.result.current.isFetching).toBe(false);
      await act(async () => { online = true; window.dispatchEvent(new Event('online')); });
      await waitFor(() => expect(hook.result.current.data).toBe('connected'));
      expect(fetch).toHaveBeenCalledTimes(1);
      await act(async () => { online = false; window.dispatchEvent(new Event('offline')); hook.result.current.refetch(); });
      expect(fetch).toHaveBeenCalledTimes(1); expect(hook.result.current.isFetching).toBe(false);
      await act(async () => { online = true; window.dispatchEvent(new Event('online')); });
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(hook.result.current.isFetching).toBe(false));
      hook.unmount();
      for (const type of ['online', 'offline', 'focus']) {
        const registrations = add.mock.calls.filter(([event]) => event === type);
        const removals = remove.mock.calls.filter(([event]) => event === type);
        expect(registrations.length).toBeGreaterThan(0);
        expect(removals.length).toBe(registrations.length);
        for (const [, listener] of registrations) expect(removals.some(([, removed]) => removed === listener)).toBe(true);
      }
    } finally {
      hook.unmount(); onlineGetter.mockRestore(); add.mockRestore(); remove.mockRestore();
    }
  });
});

});
