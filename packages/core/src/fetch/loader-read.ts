import type { CachedLoaderDefaults, CachedLoaderOptions, QueryKey } from './types.js';

/**
 * The error an argument-less `load()` rejects with when its loader was created without a default
 * `fetch`. Named, rather than left to a `TypeError: fetch is not a function` from deep inside a cache
 * adapter, so the misuse points at the call site that needs to pass `{ key, fetch }`.
 */
export function missingCachedLoaderFetchError(key: QueryKey): Error {
  return new Error(`Cached loader for key ${JSON.stringify(key)} has no default fetch: call load({ key, fetch }) with a fetch of its own`);
}

/**
 * Runs `read` with a fully specified `{ key, fetch }`, or rejects with
 * {@link missingCachedLoaderFetchError} when `required` (a loader's own defaults, for an argument-less
 * `load()`) carries no fetch. It rejects BEFORE `read` runs, so a misuse never enters the shared cache:
 * a failed fetch there would publish an error state to every observer of that key.
 * Shared by every `FetchQueryAdapter` so each adapter's `load` stays a single straight-line call.
 */
export function withCachedLoaderFetch<T>(
  required: CachedLoaderDefaults<T>,
  read: (resolved: Pick<CachedLoaderOptions<T>, 'key' | 'fetch'>) => Promise<T>,
): Promise<T> {
  const { key, fetch } = required;
  if (fetch === undefined) return Promise.reject(missingCachedLoaderFetchError(key));
  return read({ key, fetch });
}
