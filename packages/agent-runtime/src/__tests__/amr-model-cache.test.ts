import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AmrModelLoadingCache, amrModelLoadingCache } from '../amr-model-cache.js';

describe('AmrModelLoadingCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the preset list on a cold cache and kicks off a background refresh', async () => {
    const cache = new AmrModelLoadingCache();
    const preset = [{ id: 'preset-1', label: 'Preset 1' }];
    const fetchPreset = vi.fn(async () => preset);
    const fetchRemote = vi.fn(async () => [{ id: 'remote-1', label: 'Remote 1' }]);

    const result = await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });

    expect(result.source).toBe('preset');
    expect(result.models).toEqual(preset);
    // The refresh was started synchronously inside get() (fire-and-forget),
    // so refreshing must be true immediately after the preset resolves.
    expect(result.refreshing).toBe(true);
    expect(fetchPreset).toHaveBeenCalledTimes(1);
    expect(fetchRemote).toHaveBeenCalledTimes(1);
  });

  it('serves the cached remote list instantly once a refresh has completed', async () => {
    const cache = new AmrModelLoadingCache();
    const remoteModels = [{ id: 'remote-1', label: 'Remote 1' }];
    const fetchPreset = vi.fn(async () => [{ id: 'preset-1', label: 'Preset 1' }]);
    const fetchRemote = vi.fn(async () => remoteModels);

    await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    // Let the in-flight background refresh's promise settle.
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    const second = await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    expect(second.source).toBe('remote');
    expect(second.models).toEqual(remoteModels);
    expect(second.refreshing).toBe(false);
    expect(second.stale).toBeUndefined();
    expect(second.remoteError).toBeUndefined();
    // fetchPreset must not be called again once a remote entry exists.
    expect(fetchPreset).toHaveBeenCalledTimes(1);
    // fetchRemote was called once by the cold-start refresh; not again yet
    // (the cached entry is fresh, well within the refresh interval).
    expect(fetchRemote).toHaveBeenCalledTimes(1);
  });

  it('triggers a fresh background refresh once the cached remote entry goes stale by age', async () => {
    const cache = new AmrModelLoadingCache({}, { refreshIntervalMs: 1000 });
    const fetchPreset = vi.fn(async () => [{ id: 'preset-1', label: 'Preset 1' }]);
    let call = 0;
    const fetchRemote = vi.fn(async () => {
      call += 1;
      return [{ id: `remote-${call}`, label: `Remote ${call}` }];
    });

    await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    await Promise.resolve();
    await Promise.resolve();

    // Advance past the refresh interval so the cached entry is stale by age.
    vi.setSystemTime(2000);

    const result = await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    // The stale-but-cached remote list is still returned instantly...
    expect(result.source).toBe('remote');
    expect(result.models).toEqual([{ id: 'remote-1', label: 'Remote 1' }]);
    // ...while a new background refresh has been kicked off (marks stale: true).
    expect(result.refreshing).toBe(true);
    expect(result.stale).toBe(true);
    expect(fetchRemote).toHaveBeenCalledTimes(2);
  });

  it('does not start a second refresh while one is already in flight', async () => {
    const cache = new AmrModelLoadingCache();
    const fetchPreset = vi.fn(async () => [{ id: 'preset-1', label: 'Preset 1' }]);
    let resolveRemote: (models: { id: string; label: string }[]) => void = () => {};
    const fetchRemote = vi.fn(
      () =>
        new Promise<{ id: string; label: string }[]>((resolve) => {
          resolveRemote = resolve;
        }),
    );

    // Kick off the cold-start refresh (still pending).
    const first = await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    expect(first.refreshing).toBe(true);

    // A second call while the refresh is still in flight must not start
    // another one (fetchRemote called only once).
    const second = await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    expect(second.source).toBe('preset');
    expect(second.refreshing).toBe(true);
    expect(fetchRemote).toHaveBeenCalledTimes(1);

    resolveRemote([{ id: 'remote-1', label: 'Remote 1' }]);
    await Promise.resolve();
    await Promise.resolve();
  });

  it('records a remote error and keeps serving preset models when the remote fetch throws', async () => {
    const cache = new AmrModelLoadingCache();
    const fetchPreset = vi.fn(async () => [{ id: 'preset-1', label: 'Preset 1' }]);
    const fetchRemote = vi.fn(async () => {
      throw new Error('network down');
    });

    await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    await Promise.resolve();
    await Promise.resolve();

    const second = await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    expect(second.source).toBe('preset');
    expect(second.remoteError).toBe('network down');
    expect(fetchRemote).toHaveBeenCalledTimes(2);
  });

  it('reports remoteError on a cached remote list once a subsequent background refresh fails', async () => {
    const cache = new AmrModelLoadingCache({}, { refreshIntervalMs: 1000 });
    const fetchPreset = vi.fn(async () => [{ id: 'preset-1', label: 'Preset 1' }]);
    let call = 0;
    const fetchRemote = vi.fn(async () => {
      call += 1;
      if (call === 1) return [{ id: 'remote-1', label: 'Remote 1' }];
      throw new Error('refresh failed');
    });

    await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    await Promise.resolve();
    await Promise.resolve();

    // Advance past the refresh interval so a second (failing) refresh fires.
    vi.setSystemTime(1000);
    await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    await Promise.resolve();
    await Promise.resolve();

    // A third get() still serves the last-known-good remote list instantly,
    // now annotated with the error from the background refresh that failed.
    const result = await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    expect(result.source).toBe('remote');
    expect(result.models).toEqual([{ id: 'remote-1', label: 'Remote 1' }]);
    expect(result.stale).toBe(true);
    expect(result.remoteError).toBe('refresh failed');
  });

  it('treats a remote fetch that resolves with zero models as an error (no silent empty catalog)', async () => {
    const cache = new AmrModelLoadingCache();
    const fetchPreset = vi.fn(async () => [{ id: 'preset-1', label: 'Preset 1' }]);
    const fetchRemote = vi.fn(async () => []);

    await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    await Promise.resolve();
    await Promise.resolve();

    const second = await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    expect(second.source).toBe('preset');
    expect(second.remoteError).toBe('AMR remote model list returned no chat models');
  });

  it('stringifies a non-Error throw via errorMessage()', async () => {
    const cache = new AmrModelLoadingCache();
    const fetchPreset = vi.fn(async () => [{ id: 'preset-1', label: 'Preset 1' }]);
    const fetchRemote = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'plain string failure';
    });

    await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    await Promise.resolve();
    await Promise.resolve();

    const second = await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    expect(second.remoteError).toBe('plain string failure');
  });

  it('falls back to a generic message when the thrown value is nullish', async () => {
    const cache = new AmrModelLoadingCache();
    const fetchPreset = vi.fn(async () => [{ id: 'preset-1', label: 'Preset 1' }]);
    const fetchRemote = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw undefined;
    });

    await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    await Promise.resolve();
    await Promise.resolve();

    const second = await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    expect(second.remoteError).toBe('unknown error');
  });

  it('keeps independent cache state per cacheKey', async () => {
    const cache = new AmrModelLoadingCache();
    const fetchPreset = vi.fn(async () => [{ id: 'preset-1', label: 'Preset 1' }]);
    const fetchRemote = vi.fn(async () => [{ id: 'remote-1', label: 'Remote 1' }]);

    await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    const otherScope = await cache.get({ cacheKey: 'scope-b', fetchers: { fetchPreset, fetchRemote } });

    expect(otherScope.source).toBe('preset');
    expect(fetchPreset).toHaveBeenCalledTimes(2);
    expect(fetchRemote).toHaveBeenCalledTimes(2);
  });

  it('warm() proactively starts a refresh for a cache key without requiring get()', async () => {
    const cache = new AmrModelLoadingCache();
    const fetchRemote = vi.fn(async () => [{ id: 'remote-1', label: 'Remote 1' }]);

    cache.warm({ cacheKey: 'scope-a', fetchRemote: fetchRemote });
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchRemote).toHaveBeenCalledTimes(1);
    const result = await cache.get({ cacheKey: 'scope-a', fetchers: {
      fetchPreset: async () => [{ id: 'preset-1', label: 'Preset 1' }],
      fetchRemote,
    } });
    expect(result.source).toBe('remote');
    expect(result.models).toEqual([{ id: 'remote-1', label: 'Remote 1' }]);
  });

  it('warm() is a no-op when a refresh is already in flight for that key', async () => {
    const cache = new AmrModelLoadingCache();
    let resolveFirst: (models: { id: string; label: string }[]) => void = () => {};
    const fetchRemote = vi.fn(
      () =>
        new Promise<{ id: string; label: string }[]>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    cache.warm({ cacheKey: 'scope-a', fetchRemote: fetchRemote });
    cache.warm({ cacheKey: 'scope-a', fetchRemote: fetchRemote });
    expect(fetchRemote).toHaveBeenCalledTimes(1);
    resolveFirst([{ id: 'remote-1', label: 'Remote 1' }]);
    await Promise.resolve();
    await Promise.resolve();
  });

  it('resetForTests() clears all cached state so the next get() starts cold again', async () => {
    const cache = new AmrModelLoadingCache();
    const fetchPreset = vi.fn(async () => [{ id: 'preset-1', label: 'Preset 1' }]);
    const fetchRemote = vi.fn(async () => [{ id: 'remote-1', label: 'Remote 1' }]);

    await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    await Promise.resolve();
    await Promise.resolve();

    cache.resetForTests();

    const result = await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    expect(result.source).toBe('preset');
    expect(fetchPreset).toHaveBeenCalledTimes(2);
  });

  it('defaults to a 10-minute refresh interval when none is supplied', async () => {
    const cache = new AmrModelLoadingCache();
    const fetchPreset = vi.fn(async () => [{ id: 'preset-1', label: 'Preset 1' }]);
    const fetchRemote = vi.fn(async () => [{ id: 'remote-1', label: 'Remote 1' }]);

    await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    await Promise.resolve();
    await Promise.resolve();

    // Just under 10 minutes: still fresh, no second refresh triggered.
    vi.setSystemTime(10 * 60_000 - 1);
    const stillFresh = await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    expect(stillFresh.refreshing).toBe(false);
    expect(fetchRemote).toHaveBeenCalledTimes(1);

    // At/after 10 minutes: stale, triggers a refresh.
    vi.setSystemTime(10 * 60_000);
    const stale = await cache.get({ cacheKey: 'scope-a', fetchers: { fetchPreset, fetchRemote } });
    expect(stale.refreshing).toBe(true);
    expect(fetchRemote).toHaveBeenCalledTimes(2);
  });

  it('exports a shared module-level singleton instance', () => {
    expect(amrModelLoadingCache).toBeInstanceOf(AmrModelLoadingCache);
  });
});
