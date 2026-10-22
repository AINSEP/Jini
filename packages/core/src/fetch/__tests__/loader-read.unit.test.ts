// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { missingCachedLoaderFetchError, withCachedLoaderFetch } from '../index.js';

/**
 * @file `withCachedLoaderFetch`, the shared guard behind every adapter's `load`: a loader created
 * without a default fetch must reject an argument-less read with a named error, and must not run
 * the read (so the cache is never touched); with a fetch present it forwards exactly that pair.
 */
describe('withCachedLoaderFetch', () => {
  it('forwards the key and fetch to the read and resolves with its value', async () => {
    const fetch = vi.fn(async () => 'value');
    const read = vi.fn(async ({ fetch: f }: { key: readonly unknown[]; fetch: () => Promise<string> }) => f());
    await expect(withCachedLoaderFetch({ key: ['a', 1], fetch }, read)).resolves.toBe('value');
    expect(read).toHaveBeenCalledWith({ key: ['a', 1], fetch });
  });

  it('rejects with the named missing-fetch error and never runs the read when no fetch exists', async () => {
    const read = vi.fn(async () => 'never');
    await expect(withCachedLoaderFetch<string>({ key: ['themes', 'source', 't1'] }, read)).rejects.toThrow(
      'Cached loader for key ["themes","source","t1"] has no default fetch: call load({ key, fetch }) with a fetch of its own',
    );
    expect(read).not.toHaveBeenCalled();
  });

  it('treats an explicit undefined fetch the same as an omitted one', async () => {
    const read = vi.fn(async () => 'never');
    await expect(withCachedLoaderFetch<string>({ key: ['k'], fetch: undefined }, read)).rejects.toEqual(missingCachedLoaderFetchError(['k']));
    expect(read).not.toHaveBeenCalled();
  });
});
