import { type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FetchQueryProvider as BuiltInProvider, useCachedLoader, useFetchQuery, useFetchMutation, useInvalidate } from '../index.js';
import { FetchQueryProvider as TanStackProvider } from '../tanstack.js';

describe.each([['built-in', BuiltInProvider], ['tanstack', TanStackProvider]] as const)('%s event-driven cache reads', (_name, Provider) => {
  it('deduplicates a selected key, isolates a different key and publishes to its observers', async () => {
    let calls = 0;
    let complete!: (value: string) => void;
    const readA = () => { calls++; return new Promise<string>(resolve => { complete = resolve; }); };
    const readB = async () => 'row B';
    const fallback = async () => 'unused';
    const keyA = ['rows', 'a'] as const;
    const keyB = ['rows', 'b'] as const;
    const wrapper = ({ children }: { children: ReactNode }) => <Provider>{children}</Provider>;
    const { result } = renderHook(() => ({
      loader: useCachedLoader({ key: ['rows', 'default'], fetch: fallback }),
      first: useFetchQuery({ key: keyA, fetch: readA }, { enabled: false }),
      second: useFetchQuery({ key: keyB, fetch: readB }, { enabled: false }),
    }), { wrapper });
    let first!: Promise<string>, joined!: Promise<string>;
    act(() => {
      first = result.current.loader.load({ key: keyA, fetch: readA });
      joined = result.current.loader.load({ key: keyA, fetch: readA });
    });
    await waitFor(() => expect(calls).toBe(1));
    await act(async () => {
      expect(await result.current.loader.load({ key: keyB, fetch: readB })).toBe('row B');
      complete('row A');
      expect(await first).toBe('row A');
      expect(await joined).toBe('row A');
    });
    await waitFor(() => {
      expect(result.current.first.data).toBe('row A');
      expect(result.current.second.data).toBe('row B');
    });
    expect(result.current.loader.peek()).toBeUndefined();
  });

  it('retries a failed selected key instead of caching failure as data', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <Provider>{children}</Provider>;
    const fallback = async () => 'unused';
    const { result } = renderHook(() => useCachedLoader({ key: ['rows'], fetch: fallback }), { wrapper });
    const key = ['rows', 'retry'] as const;
    await expect(result.current.load({ key, fetch: async () => { throw new Error('offline'); } })).rejects.toThrow('offline');
    await expect(result.current.load({ key, fetch: async () => 'recovered' })).resolves.toBe('recovered');
  });
});


describe.each([['built-in', BuiltInProvider], ['tanstack', TanStackProvider]] as const)('%s refresh ordering', (_name, Provider) => {
  it.each(['success', 'failure'] as const)('a write supersedes a loader-only read ending in %s', async outcome => {
    const key = ['resource', 'detail'] as const;
    let finishOld!: (value: string) => void;
    let failOld!: (error: Error) => void;
    let calls = 0;
    const fetch = () => ++calls === 1
      ? new Promise<string>((resolve, reject) => { finishOld = resolve; failOld = reject; })
      : Promise.resolve('after write');
    const wrapper = ({ children }: { children: ReactNode }) => <Provider>{children}</Provider>;
    const { result } = renderHook(() => ({
      loader: useCachedLoader({ key, fetch }, { staleTime: 0 }),
      invalidate: useInvalidate(),
    }), { wrapper });
    let old!: Promise<string>;
    act(() => { old = result.current.loader.load(); });
    await waitFor(() => expect(calls).toBe(1));
    await act(async () => {
      result.current.invalidate({ key: ['resource'] });
      expect(await result.current.loader.load()).toBe('after write');
      if (outcome === 'success') finishOld('before write');
      else failOld(new Error('obsolete failure'));
      expect(await old).toBe('after write');
    });
    expect(result.current.loader.peek()).toBe('after write');
  });

  it.each(['refresh', 'write'] as const)('%s supersedes a pending initial snapshot', async intent => {
    let calls = 0;
    let finishOld!: (value: string) => void;
    const fetch = () => ++calls === 1 ? new Promise<string>(resolve => { finishOld = resolve; }) : Promise.resolve('current');
    const key = ['resource', 'list'] as const;
    const wrapper = ({ children }: { children: ReactNode }) => <Provider>{children}</Provider>;
    const { result } = renderHook(() => ({
      read: useFetchQuery({ key, fetch }),
      invalidate: useInvalidate(),
      write: useFetchMutation({ run: async () => 'accepted' }, { invalidates: [['resource']] }),
    }), { wrapper });
    await waitFor(() => expect(calls).toBe(1));
    await act(async () => {
      if (intent === 'refresh') result.current.invalidate({ key: ['resource'] });
      else await result.current.write.mutate({ input: {} });
    });
    await waitFor(() => expect(result.current.read.data).toBe('current'));
    expect(calls).toBe(2);
    await act(async () => { finishOld('obsolete'); });
    expect(result.current.read.data).toBe('current');
  });
});
