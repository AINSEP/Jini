// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchQueryCache, IDLE_RETENTION, toQueryError, type FetchQueryEnvironmentPort } from '../index.js';

/**
 * @file Edge contracts of `FetchQueryCache` not covered by the parity suite: error normalization,
 * fresh hits, the default timer-backed scheduler, prefix matching, connectivity flips between
 * queueing and invocation, superseded offline reads, and the public post-pending refresh flag.
 */

function connectivity({ online = true }: { online?: boolean } = {}) {
  const listeners = new Set<(online: boolean) => void>();
  const environment: FetchQueryEnvironmentPort = {
    isOnline: () => online,
    subscribeOnline: ({ listener }) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    subscribeFocus: () => () => {},
  };
  return { environment, connect: (value: boolean) => { online = value; for (const listener of listeners) listener(value); } };
}

/** A recording scheduler: callbacks run only when the test fires them. */
function manualScheduler() {
  const timers = new Map<number, { callback: () => void; delayMs: number }>();
  let id = 0;
  return {
    timers,
    scheduler: {
      schedule: ({ callback, delayMs }: { callback: () => void; delayMs: number }) => { timers.set(++id, { callback, delayMs }); return id; },
      cancel: ({ handle }: { handle: unknown }) => { timers.delete(handle as number); },
    },
  };
}

const flush = async (turns = 10) => { for (let i = 0; i < turns; i++) await Promise.resolve(); };

afterEach(() => { vi.useRealTimers(); });

describe('toQueryError', () => {
  it('passes Errors through and wraps a meaningful string, otherwise uses a fixed message', () => {
    const error = new TypeError('bad');
    expect(toQueryError(error)).toBe(error);
    expect(toQueryError('offline')).toEqual(new Error('offline'));
    expect(toQueryError('   ')).toEqual(new Error('request failed'));
    expect(toQueryError({ status: 500 })).toEqual(new Error('request failed'));
    expect(toQueryError(undefined)).toEqual(new Error('request failed'));
  });
});

describe('FetchQueryCache edges', () => {
  it('serves a fresh entry from cache without fetching and re-arms its idle eviction', async () => {
    const { timers, scheduler } = manualScheduler();
    let now = 1_000;
    const cache = new FetchQueryCache({}, { scheduler, clock: { nowMs: () => now } });
    const entry = cache.entry({ key: ['rows'] }, { staleTime: 500 });
    cache.replace({ entry, data: 'cached' });
    timers.clear();
    now = 1_400;
    const fetch = vi.fn(async () => 'network');

    expect(await cache.load({ entry, fetch, staleTime: 500 })).toBe('cached');
    expect(fetch).not.toHaveBeenCalled();
    expect([...timers.values()].map(timer => timer.delayMs)).toEqual([IDLE_RETENTION]);
  });

  it('evicts an unobserved entry through the default timer scheduler, and a subscriber cancels that eviction', () => {
    vi.useFakeTimers();
    const cache = new FetchQueryCache();
    const kept = cache.entry({ key: ['kept'] });
    const dropped = cache.entry({ key: ['dropped'] });
    cache.replace({ entry: kept, data: 'kept' });
    cache.replace({ entry: dropped, data: 'dropped' });
    const release = cache.subscribe({ entry: kept, listener: () => {} });

    vi.advanceTimersByTime(IDLE_RETENTION);
    expect(cache.entry({ key: ['kept'] })).toBe(kept);
    expect(cache.entry({ key: ['dropped'] })).not.toBe(dropped);
    expect(cache.entry({ key: ['dropped'] }).state.data).toBeUndefined();
    release();
    cache.dispose();
  });

  it('invalidates only entries whose key starts with the prefix', () => {
    const cache = new FetchQueryCache({}, manualScheduler());
    const child = cache.entry({ key: ['rows', 1] });
    const sibling = cache.entry({ key: ['rowsets', 1] });
    const shorter = cache.entry({ key: ['other'] });
    cache.invalidate({ prefix: ['rows'] });
    expect([child.invalidated, sibling.invalidated, shorter.invalidated]).toEqual([true, false, false]);
  });

  it('re-queues an operation whose connectivity dropped between queueing and invocation', async () => {
    const { environment, connect } = connectivity();
    const cache = new FetchQueryCache({}, { environment, ...manualScheduler() });
    cache.activate();
    const run = vi.fn(async () => 'sent');
    const result = cache.runOnline({ run });
    connect(false);
    await flush();
    expect(run).not.toHaveBeenCalled();
    connect(true);
    expect(await result).toBe('sent');
    expect(run).toHaveBeenCalledTimes(1);
    cache.dispose();
  });

  it('lets an offline read superseded by invalidation follow the newer request instead of fetching twice', async () => {
    const { environment, connect } = connectivity({ online: false });
    const cache = new FetchQueryCache({}, { environment, ...manualScheduler() });
    cache.activate();
    const entry = cache.entry({ key: ['rows'] });
    const fetch = vi.fn(async () => 'fresh');
    const first = cache.load({ entry, fetch, staleTime: 0 });
    await flush();
    expect(entry.state).toMatchObject({ status: 'pending', isFetching: false });

    cache.invalidate({ prefix: ['rows'] });
    const second = entry.pending;
    expect(second).not.toBe(first);
    connect(true);

    expect(await first).toBe('fresh');
    expect(await second).toBe('fresh');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(entry.state).toEqual({ data: 'fresh', error: null, status: 'success', isFetching: false });
    cache.dispose();
  });

  it('lets a queued offline read whose replacement already finished during a connectivity flap resolve to the published data', async () => {
    const { environment, connect } = connectivity({ online: false });
    const cache = new FetchQueryCache({}, { environment, ...manualScheduler() });
    cache.activate();
    const entry = cache.entry({ key: ['flap'] });
    const fetch = vi.fn(async () => 'fresh');
    const first = cache.load({ entry, fetch, staleTime: 0 });
    await flush();

    // Reconnect resumes the queued read, but an invalidation starts its replacement in the same
    // turn; the connection drops again before the queued read reaches its own invocation, so it
    // re-queues while the replacement's transport (already started) settles offline.
    connect(true);
    cache.invalidate({ prefix: ['flap'] });
    const second = entry.pending;
    await Promise.resolve();
    connect(false);
    expect(await second).toBe('fresh');
    expect(entry.pending).toBeUndefined();

    // By the time the queued read runs nothing is pending: it adopts the published value
    // rather than issuing a second request.
    connect(true);
    expect(await first).toBe('fresh');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(entry.state).toEqual({ data: 'fresh', error: null, status: 'success', isFetching: false });
    cache.dispose();
  });

  it('honours a refresh requested on the public entry while a request is in flight, once it settles', async () => {
    const cache = new FetchQueryCache({}, manualScheduler());
    const entry = cache.entry({ key: ['rows'] });
    let calls = 0;
    const fetch = vi.fn(async () => `v${++calls}`);
    cache.observe({ entry, observer: { fetch, staleTime: Infinity, focus: false } });
    const first = cache.load({ entry, fetch, staleTime: Infinity });
    entry.refreshAfterPending = true;

    expect(await first).toBe('v1');
    expect(entry.refreshAfterPending).toBe(false);
    await entry.pending;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(entry.state.data).toBe('v2');
    cache.dispose();
  });
});
