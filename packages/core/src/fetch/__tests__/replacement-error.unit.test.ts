import { describe, expect, it } from 'vitest';
import { FetchQueryCache } from '../index.js';

describe('replacement writes supersede read failures', () => {
  it.each([false, true])('keeps a replacement successful after an older read rejects (cached: %s)', async cached => {
    let now = 100;
    const cache = new FetchQueryCache({}, {
      clock: { nowMs: () => now },
      scheduler: { schedule: () => 0, cancel: () => {} },
    });
    const entry = cache.entry({ key: ['record'] }, { staleTime: Infinity });
    if (cached) cache.replace({ entry, data: 'cached' });
    let reject!: (error: Error) => void;
    const transport = new Promise<string>((_resolve, fail) => { reject = fail; });
    const read = cache.load({ entry, fetch: () => transport, staleTime: Infinity }, { force: true });
    await Promise.resolve();
    cache.replace({ entry, data: 'saved' });
    const states: string[] = [];
    const release = cache.subscribe({ entry, listener: () => { states.push(entry.state.status); } });
    try {
      // A saved value is newer than either outcome of the read that preceded it.
      now = 200;
      reject(new Error('obsolete read failed'));
      await expect(read).resolves.toBe('saved');
      expect(entry.state).toEqual({ data: 'saved', error: null, status: 'success', isFetching: false });
      expect(entry.invalidated).toBe(false);
      expect(entry.updatedAt).toBe(100);
      expect(cache.fresh({ entry, staleTime: Infinity })).toBe(true);
      expect(states).not.toContain('error');
      expect(entry.pending).toBeUndefined();
    } finally {
      release();
      cache.dispose();
    }
  });

  it('still publishes and rejects the current read failure when no write replaces it', async () => {
    const cache = new FetchQueryCache({}, { scheduler: { schedule: () => 0, cancel: () => {} } });
    const entry = cache.entry({ key: ['record'] });
    const error = new Error('current read failed');
    try {
      await expect(cache.load({ entry, fetch: async () => { throw error; }, staleTime: 0 })).rejects.toBe(error);
      expect(entry.state).toEqual({ data: undefined, error, status: 'error', isFetching: false });
      expect(entry.invalidated).toBe(true);
    } finally {
      cache.dispose();
    }
  });
});


describe('replacement between transport resolution and publication', () => {
  it.each([false, true])('keeps the newer value for both callers and the cache (cached: %s)', async cached => {
    const cache = new FetchQueryCache({}, { scheduler: { schedule: () => 0, cancel: () => {} } });
    const entry = cache.entry({ key: ['publication'] });
    if (cached) cache.replace({ entry, data: 'cached' });
    let resolve!: (value: string) => void;
    const transport = new Promise<string>(yes => { resolve = yes; });
    const fetch = () => transport;
    const first = cache.load({ entry, fetch, staleTime: 0 });
    const second = cache.load({ entry, fetch, staleTime: 0 });
    // Let the cache adopt the transport before registering the publication-gap replacement.
    await Promise.resolve(); await Promise.resolve();
    let replaced = false;
    const afterReplace: unknown[] = [];
    const release = cache.subscribe({ entry, listener: () => { if (replaced) afterReplace.push(entry.state.data); } });
    void transport.then(() => queueMicrotask(() => { replaced = true; cache.replace({ entry, data: 'saved' }); }));
    try {
      resolve('obsolete');
      await expect(first).resolves.toBe('saved');
      await expect(second).resolves.toBe('saved');
      expect(entry.state).toEqual({ data: 'saved', error: null, status: 'success', isFetching: false });
      expect(afterReplace).not.toContain('obsolete');
      expect(afterReplace.length).toBeGreaterThan(0);
    } finally { release(); cache.dispose(); }
  });
});
