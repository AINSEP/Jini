// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { FetchQueryCache, type FetchQueryEnvironmentPort } from '../cache.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture({ online = true }: { online?: boolean } = {}) {
  let now = 100;
  const onlineListeners = new Set<(online: boolean) => void>();
  const focusListeners = new Set<() => void>();
  const environment: FetchQueryEnvironmentPort = {
    isOnline: () => online,
    subscribeOnline: ({ listener }) => { onlineListeners.add(listener); return () => { onlineListeners.delete(listener); }; },
    subscribeFocus: ({ listener }) => { focusListeners.add(listener); return () => { focusListeners.delete(listener); }; },
  };
  const cache = new FetchQueryCache({}, {
    environment, clock: { nowMs: () => now },
    scheduler: { schedule: () => 0, cancel: () => {} },
  });
  cache.activate();
  return {
    cache, onlineListeners, focusListeners,
    tick: () => { now += 20_000; },
    connect: (value: boolean) => { online = value; for (const listener of onlineListeners) listener(value); },
    focus: () => { for (const listener of focusListeners) listener(); },
  };
}

// Deferred requests exercise response ordering through public state and promises, not
// private request counters: superseded reads must never replace a newer refresh or write.
describe('fetch-query cache parity', () => {
  it.each(['resolve', 'reject'] as const)('restarts a cached forced read and ignores its old %s', async outcome => {
    const { cache } = fixture();
    const entry = cache.entry({ key: ['rows'] });
    cache.replace({ entry, data: 'cached' });
    const old = deferred<string>();
    const next = deferred<string>();
    const first = cache.load({ entry, fetch: () => old.promise, staleTime: 0 });
    await Promise.resolve();
    const fetch = vi.fn(() => next.promise);
    const second = cache.load({ entry, fetch, staleTime: 0 }, { force: true });
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second).not.toBe(first);
    if (outcome === 'resolve') old.resolve('old'); else old.reject(new Error('old failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(entry.state).toMatchObject({ data: 'cached', error: null, isFetching: true });
    expect(entry.invalidated).toBe(false);
    next.resolve('new');
    expect(await second).toBe('new');
    expect(await first).toBe('new');
    expect(entry.state).toEqual({ data: 'new', error: null, status: 'success', isFetching: false });
    cache.dispose();
  });

  it('invalidation restarts a background read immediately, even with infinite freshness', async () => {
    const { cache } = fixture();
    const entry = cache.entry({ key: ['rows', 1] }, { staleTime: Infinity });
    cache.replace({ entry, data: 'cached' });
    const old = deferred<string>();
    const first = cache.load({ entry, fetch: () => old.promise, staleTime: Infinity }, { force: true });
    await Promise.resolve();
    const fetch = vi.fn(async () => 'after write');
    const release = cache.observe({ entry, observer: { fetch, staleTime: Infinity, focus: false } });
    cache.invalidate({ prefix: ['rows'] });
    const latest = entry.pending;
    await latest;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(entry.state.data).toBe('after write');
    old.resolve('before write');
    await first;
    expect(entry.state.data).toBe('after write');
    release(); cache.dispose();
  });

  it('still shares an initial request when forced before any data exists', async () => {
    const { cache } = fixture();
    const entry = cache.entry({ key: ['rows'] });
    const next = deferred<string>();
    const first = cache.load({ entry, fetch: () => next.promise, staleTime: 0 });
    const fetch = vi.fn(async () => 'duplicate');
    expect(cache.load({ entry, fetch, staleTime: 0 }, { force: true })).toBe(first);
    next.resolve('initial');
    await first;
    expect(fetch).not.toHaveBeenCalled();
    cache.dispose();
  });

  it('invalidates a failed background read so an infinite-freshness loader retries', async () => {
    const { cache } = fixture();
    const entry = cache.entry({ key: ['rows'] }, { staleTime: Infinity });
    cache.replace({ entry, data: 'cached' });
    await expect(cache.load({ entry, fetch: async () => { throw new Error('refresh failed'); }, staleTime: Infinity }, { force: true })).rejects.toThrow('refresh failed');
    expect(entry.state.data).toBe('cached');
    expect(cache.fresh({ entry, staleTime: Infinity })).toBe(false);
    const fetch = vi.fn(async () => 'recovered');
    expect(await cache.load({ entry, fetch, staleTime: Infinity })).toBe('recovered');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(entry.invalidated).toBe(false);
    cache.dispose();
  });

  it.each([false, true])('retains the last error until a retry settles (cached data: %s)', async cached => {
    const { cache } = fixture();
    const entry = cache.entry({ key: ['rows'] });
    if (cached) cache.replace({ entry, data: 'cached' });
    const firstError = new Error('first failure');
    const secondError = new Error('second failure');
    await expect(cache.load({ entry, fetch: async () => { throw firstError; }, staleTime: 0 })).rejects.toBe(firstError);
    const data = cached ? 'cached' : undefined;
    expect(entry.state).toEqual({ data, error: firstError, status: 'error', isFetching: false });
    const failed = deferred<string>();
    const retry = cache.load({ entry, fetch: () => failed.promise, staleTime: 0 }, { force: true });
    const fetchingState = { data, error: firstError, status: cached ? 'error' : 'pending', isFetching: true };
    expect(entry.state).toEqual(fetchingState);
    expect(entry.state.error).toBe(firstError);
    await Promise.resolve();
    expect(entry.state).toEqual(fetchingState);
    expect(entry.state.error).toBe(firstError);
    failed.reject(secondError);
    await expect(retry).rejects.toBe(secondError);
    expect(entry.state).toEqual({ data, error: secondError, status: 'error', isFetching: false });
    expect(entry.state.error).toBe(secondError);

    const next = deferred<string>();
    const recovery = cache.load({ entry, fetch: () => next.promise, staleTime: 0 }, { force: true });
    expect(entry.state).toEqual({ ...fetchingState, error: secondError });
    expect(entry.state.error).toBe(secondError);
    next.resolve('recovered');
    await expect(recovery).resolves.toBe('recovered');
    expect(entry.state).toEqual({ data: 'recovered', error: null, status: 'success', isFetching: false });
    cache.dispose();
  });

  it.each([false, true])('rejects undefined data and preserves prior data: %s', async cached => {
    const { cache } = fixture();
    const entry = cache.entry({ key: ['rows', 1] });
    if (cached) cache.replace({ entry, data: 'cached' });
    await expect(cache.load({ entry, fetch: async () => undefined, staleTime: 0 }, { force: true })).rejects.toThrow('["rows",1] data is undefined');
    expect(entry.state).toEqual({ data: cached ? 'cached' : undefined, error: new Error('["rows",1] data is undefined'), status: 'error', isFetching: false });
    expect(entry.invalidated).toBe(true);
    cache.dispose();
  });

  it('pauses offline reads and writes, resumes once, and does not duplicate a resumed read', async () => {
    const { cache, connect } = fixture({ online: false });
    const entry = cache.entry({ key: ['rows'] });
    const next = deferred<string>();
    const fetch = vi.fn(() => next.promise);
    const run = vi.fn(async () => 'saved');
    const release = cache.observe({ entry, observer: { fetch, staleTime: 0, focus: false } });
    const read = cache.load({ entry, fetch, staleTime: 0 });
    const write = cache.runOnline({ run });
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
    expect(entry.state).toMatchObject({ status: 'pending', error: null, isFetching: false });
    connect(true);
    await write;
    expect(run).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1);
    expect(entry.state.isFetching).toBe(true);
    next.resolve('online');
    await read;
    connect(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    release(); cache.dispose();
  });

  it('refreshes stale enabled reads on reconnect, retaining fresh and disabled data', async () => {
    const { cache, connect } = fixture();
    const stale = cache.entry({ key: ['stale'] });
    const fresh = cache.entry({ key: ['fresh'] }, { staleTime: Infinity });
    const disabled = cache.entry({ key: ['disabled'] });
    for (const entry of [stale, fresh, disabled]) cache.replace({ entry, data: 'cached' });
    const fetch = vi.fn(async () => 'reconnected');
    const freshFetch = vi.fn(async () => 'unexpected');
    const release = cache.observe({ entry: stale, observer: { fetch, staleTime: 0, focus: false } });
    const releaseFresh = cache.observe({ entry: fresh, observer: { fetch: freshFetch, staleTime: Infinity, focus: false } });
    connect(false); connect(true);
    await stale.pending;
    expect(stale.state.data).toBe('reconnected'); expect(fetch).toHaveBeenCalledTimes(1);
    expect(freshFetch).not.toHaveBeenCalled(); expect(fresh.state.data).toBe('cached');
    expect(disabled.state.data).toBe('cached'); expect(disabled.pending).toBeUndefined();
    release(); releaseFresh(); cache.dispose();
  });

  it('preserves opt-in focus refresh and releases environment listeners on disposal/replay', async () => {
    const { cache, focus, tick, onlineListeners, focusListeners } = fixture();
    const entry = cache.entry({ key: ['rows'] });
    const fetch = vi.fn(async () => 'focused');
    cache.replace({ entry, data: 'cached' });
    const release = cache.observe({ entry, observer: { fetch, staleTime: 10_000, focus: true } });
    focus(); expect(fetch).not.toHaveBeenCalled();
    tick(); focus(); await entry.pending;
    expect(entry.state.data).toBe('focused'); expect(fetch).toHaveBeenCalledTimes(1);
    cache.dispose();
    expect(onlineListeners.size).toBe(0); expect(focusListeners.size).toBe(0);
    cache.activate(); cache.activate();
    expect(onlineListeners.size).toBe(1); expect(focusListeners.size).toBe(1);
    release(); cache.dispose();
  });
});
