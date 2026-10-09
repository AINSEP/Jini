import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DEFAULT_STALE_TIME, FetchQueryCache, toQueryError, type FetchQueryEnvironmentPort } from './cache.js';
import { browserFetchQueryEnvironment } from './environment.browser.js';
import { FetchQueryBinding } from './binding.react.js';
import type { CachedLoader, CachedLoaderOptions, FetchMutationOptions, FetchQueryOptions, MutationResult, QueryKey, QueryResult } from './types.js';

const CacheContext = createContext<FetchQueryCache | null>(null);

/** Isolated cache scope; no external provider or query-library singleton is needed. */
export function FetchQueryProvider({ children, environment = browserFetchQueryEnvironment }: { children: ReactNode; environment?: FetchQueryEnvironmentPort }) {
  // A module singleton would leak cache values between independent providers/tests,
  // producing cases that pass alone but fail together. Scope ownership to this provider.
  const cache = useMemo(() => new FetchQueryCache({}, { environment }), [environment]);
  useEffect(() => {
    cache.activate();
    return () => cache.dispose();
  }, [cache]);
  return <CacheContext.Provider value={cache}><FetchQueryBinding adapter={adapter}>{children}</FetchQueryBinding></CacheContext.Provider>;
}

function useCache(): FetchQueryCache {
  const cache = useContext(CacheContext);
  if (!cache) throw new Error('Fetch-query hooks require FetchQueryProvider');
  return cache;
}

/**
 * Without prior successful data, a disabled read hides cached errors so gesture-gated
 * content cannot display a failure the user has not asked to retry. With prior data, retain
 * a later background failure so callers can distinguish usable data from guaranteed freshness.
 */
// Keep status/error folds outside subscription wiring so their branches are directly
// testable without mounting observers; flat decisions avoid nested conditional review costs.
/** Disabled reads keep earlier data but suppress errors before any successful read. */
export function resolveFetchQueryStatus({ disabled, hasData, status }: { disabled: boolean; hasData: boolean; status: 'pending' | 'error' | 'success' }): QueryResult<unknown>['status'] {
  if (disabled) return hasData ? 'success' : 'loading';
  return status === 'pending' ? 'loading' : status;
}

export function resolveFetchQueryError({ error, disabled, hasData }: { error: unknown; disabled: boolean; hasData: boolean }): Error | null {
  if (!error || (disabled && !hasData)) return null;
  return toQueryError(error);
}

/** Reactive keyed read. Background refresh keeps cached data visible. */
export function useFetchQuery<T>(required: Pick<FetchQueryOptions<T>, "key" | "fetch">, optional: Omit<FetchQueryOptions<T>, "key" | "fetch"> = {}): QueryResult<T> {
  const cache = useCache();
  const options = { ...optional, ...required };
  const { key, enabled = true, staleTime = DEFAULT_STALE_TIME, refetchOnWindowFocus = false } = options;
  const latest = useRef(options);
  latest.current = options;
  const entry = cache.entry({ key: key }, { staleTime: staleTime });
  const subscribe = useCallback((listener: () => void) => cache.subscribe({ entry: entry, listener: listener }), [cache, entry]);
  const snapshot = useCallback(() => entry.state, [entry]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const fetch = useCallback(() => latest.current.fetch(), []);
  useEffect(() => {
    if (!enabled) return;
    const release = cache.observe({ entry: entry, observer: { fetch, staleTime, focus: refetchOnWindowFocus } });
    void cache.load({ entry: entry, fetch: fetch, staleTime: staleTime });
    return release;
  }, [cache, entry, enabled, staleTime, refetchOnWindowFocus, fetch]);
  const refetch = useCallback(() => { void cache.load({ entry: entry, fetch: fetch, staleTime: staleTime }, { force: true }); }, [cache, entry, fetch, staleTime]);
  const hasData = state.data !== undefined;
  return {
    data: state.data as T | undefined,
    status: resolveFetchQueryStatus({ disabled: !enabled, hasData: hasData, status: state.status }),
    error: resolveFetchQueryError({ error: state.error, disabled: !enabled, hasData: hasData }),
    isFetching: state.isFetching, refetch,
  };
}

/** A write returns its rejection to awaiting callers and also handles discarded promises. */
export function useFetchMutation<TInput, TOutput>(required: Pick<FetchMutationOptions<TInput, TOutput>, "run">, optional: Omit<FetchMutationOptions<TInput, TOutput>, "run"> = {}): MutationResult<TInput, TOutput> {
  const cache = useCache();
  const options = { ...optional, ...required };
  const latest = useRef(options);
  latest.current = options;
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [state, setState] = useState<{ status: MutationResult<TInput, TOutput>['status']; error: Error | null }>({ status: 'idle', error: null });
  const mutate = useCallback(({ input }: { input: TInput }): Promise<TOutput> => {
    const current = ++generation.current;
    const { run, invalidates } = latest.current;
    setState({ status: 'pending', error: null });
    // Surface a rejected write immediately instead of silently retrying authorization or
    // validation failures that another identical attempt cannot fix.
    const promise = cache.runOnline({ run: () => run({ input }) }).then(value => {
      // Do not await dependent reads: the mutation promise means the write succeeded,
      // not that every list finished reloading. Refetches proceed on their own schedule.
      for (const key of invalidates ?? []) cache.invalidate({ prefix: key });
      if (mounted.current && current === generation.current) setState({ status: 'success', error: null });
      return value;
    }, error => {
      if (mounted.current && current === generation.current) setState({ status: 'error', error: toQueryError(error) });
      throw error;
    });
    // Handle this same promise for callers that discard it, while still returning it so
    // await/catch observes the original rejection; discarding the derived promise is intentional.
    void promise.catch(() => {});
    return promise;
  }, [cache]);
  const reset = useCallback(() => { generation.current += 1; setState({ status: 'idle', error: null }); }, []);
  return { ...state, mutate, reset };
}

/** Promise loader sharing the provider cache; replace wins over an older in-flight read. */
export function useCachedLoader<T>({ key, fetch }: Pick<CachedLoaderOptions<T>, "key" | "fetch">, { staleTime = DEFAULT_STALE_TIME }: Omit<CachedLoaderOptions<T>, "key" | "fetch"> = {}): CachedLoader<T> {
  const cache = useCache();
  return useMemo(() => ({
    peek: () => cache.entry({ key: key }, { staleTime: staleTime }).state.data as T | undefined,
    load: () => cache.load({ entry: cache.entry({ key: key }, { staleTime: staleTime }), fetch: fetch, staleTime: staleTime }),
    replace: ({ value }: { value: T }) => cache.replace({ entry: cache.entry({ key: key }, { staleTime: staleTime }), data: value }),
  }), [cache, key, fetch, staleTime]);
}

// Imperative invalidation also covers externally delivered events, such as an SSE change
// feed, whose producer cannot call a React read hook or a component-local reload.
/** Prefix invalidation refreshes every currently enabled read under that key. */
export function useInvalidate(): (required: { key: QueryKey }) => void {
  const cache = useCache();
  return useCallback(({ key }: { key: QueryKey }) => cache.invalidate({ prefix: key }), [cache]);
}

const adapter = { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate };
