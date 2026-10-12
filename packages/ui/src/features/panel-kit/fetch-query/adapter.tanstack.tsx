/** Optional TanStack translation layer. No library types escape the fetch-query contract. */
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { isCancelledError, QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { DEFAULT_STALE_TIME, FetchQueryCache, IDLE_RETENTION, toQueryError, type FetchQueryEnvironmentPort } from '@jini-ai/core/fetch';
import { browserFetchQueryEnvironment } from './environment.browser.js';
import { resolveFetchQueryError, resolveFetchQueryStatus } from './adapter.react.js';
import { FetchQueryBinding } from './binding.react.js';
import type { CachedLoader, CachedLoaderOptions, FetchMutationOptions, FetchQueryAdapter, FetchQueryOptions, MutationResult, QueryKey, QueryResult } from '@jini-ai/core/fetch';

interface Scope {
  client: QueryClient;
  gate: FetchQueryCache;
  environment: FetchQueryEnvironmentPort;
  history: WeakMap<object, { replacement: number; request: number; error: unknown }>;
}
const ScopeContext = createContext<Scope | null>(null);

/** Match built-in defaults. Failed authorization/validation must surface immediately;
 * automatic retries would hide the server's first useful error behind repeated requests. */
function createScope({ environment }: { environment: FetchQueryEnvironmentPort }): Scope {
  return {
    client: new QueryClient({ defaultOptions: {
      queries: { staleTime: DEFAULT_STALE_TIME, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, networkMode: 'always' },
      mutations: { retry: false, networkMode: 'always' },
    } }),
    // Reuse the existing connectivity gate; TanStack's online/focus managers are global
    // and cannot represent two providers with independent host environment ports.
    gate: new FetchQueryCache({}, { environment }), environment, history: new WeakMap(),
  };
}

/** Provider-owned TanStack cache and binding, compatible with hooks from the default entry.
 * @example <FetchQueryProvider><ResourceScreen /></FetchQueryProvider>
 * @param props Children and optional host connectivity/focus port. */
export function FetchQueryProvider({ children, environment = browserFetchQueryEnvironment }: { children: ReactNode; environment?: FetchQueryEnvironmentPort }) {
  // A module singleton would leak cache values between independent providers/tests,
  // producing cases that pass alone but fail together. Scope ownership to this provider.
  const scope = useMemo(() => createScope({ environment }), [environment]);
  useEffect(() => {
    scope.gate.activate();
    let online = environment.isOnline();
    const release = environment.subscribeOnline({ listener: next => {
      const reconnect = next && !online;
      online = next;
      // An offline/online pair may be batched into one React render. Signal the cache
      // directly rather than depending on a disabled -> enabled render to revalidate.
      if (reconnect) void scope.client.refetchQueries({ predicate: query => query.isActive() && query.isStale() && query.state.fetchStatus !== 'fetching' });
    } });
    return () => { release(); scope.gate.dispose(); };
  }, [scope, environment]);
  return <QueryClientProvider client={scope.client}><ScopeContext.Provider value={scope}>
    <FetchQueryBinding adapter={adapter}>{children}</FetchQueryBinding>
  </ScopeContext.Provider></QueryClientProvider>;
}

/** Fail closed when an adapter hook is used without its provider. */
function useScope(): Scope {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error('Fetch-query hooks require FetchQueryProvider');
  return scope;
}

/** Observe only this provider's connectivity; paused reads do not claim network activity. */
function useOnline({ environment }: Scope): boolean {
  const subscribe = useCallback((listener: () => void) => environment.subscribeOnline({ listener }), [environment]);
  const snapshot = useCallback(() => environment.isOnline(), [environment]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Preserve contract metadata across observers, without retaining evicted query objects. */
function historyFor({ scope, query }: { scope: Scope; query: object }) {
  let history = scope.history.get(query);
  if (!history) { history = { replacement: 0, request: 0, error: null }; scope.history.set(query, history); }
  return history;
}

/** Replacement writes win over either outcome of an older transport, across all loaders
 * and reactive reads. Weak keys follow TanStack's own query eviction lifecycle. */
async function read<T>({ scope, key, fetch }: { scope: Scope; key: QueryKey; fetch: () => Promise<T> }): Promise<T> {
  const query = scope.client.getQueryCache().find({ queryKey: key, exact: true })!;
  const history = historyFor({ scope, query });
  const generation = history.replacement;
  const request = ++history.request;
  try {
    const value = await scope.gate.runOnline({ run: fetch });
    if (generation !== history.replacement) return scope.client.getQueryData<T>(key)!;
    if (value === undefined) throw new Error(`${JSON.stringify(key)} data is undefined`);
    if (request === history.request) history.error = null;
    return value;
  } catch (error) {
    if (generation !== history.replacement) return scope.client.getQueryData<T>(key)!;
    // Earlier data remains useful, but a failed refresh is not a fresh cache hit.
    // The next loader/mount must retry even when its staleTime would retain that data.
    if (request === history.request) { history.error = toQueryError(error); query.invalidate(); }
    throw error;
  }
}

/** Match the built-in cache's idle retention. TanStack's default gcTime (5 min) would
 * otherwise evict an unobserved entry before a longer staleTime says it is stale. */
function gcTimeFor({ staleTime }: { staleTime: number }): number {
  return Math.max(IDLE_RETENTION, staleTime);
}

/** Reactive read translated to the library-free contract, with explicit focus opt-in. */
function useFetchQuery<T>({ key, fetch }: Pick<FetchQueryOptions<T>, 'key' | 'fetch'>, { enabled = true, staleTime = DEFAULT_STALE_TIME, refetchOnWindowFocus = false }: Omit<FetchQueryOptions<T>, 'key' | 'fetch'> = {}): QueryResult<T> {
  const scope = useScope();
  const online = useOnline(scope);
  const query = useQuery<T, unknown>({ queryKey: key, queryFn: () => read({ scope, key, fetch }), enabled: enabled && online, staleTime, gcTime: gcTimeFor({ staleTime }) }, scope.client);
  const { refetch: refresh } = query;
  const refetch = useCallback(() => {
    if (scope.environment.isOnline()) {
      supersedeInitialRead({ scope, key });
      void refresh();
      return;
    }
    // Reconnect may already have started a fetch (re-enabled observer or provider refetch);
    // that request postdates this one, so join it instead of cancelling it into a duplicate.
    void scope.gate.runOnline({ run: () => refresh({ cancelRefetch: false }) });
  }, [scope, refresh, JSON.stringify(key)]);
  useEffect(() => {
    if (!enabled || !refetchOnWindowFocus) return;
    return scope.environment.subscribeFocus({ listener: () => {
      const cached = scope.client.getQueryCache().find({ queryKey: key, exact: true });
      if (scope.environment.isOnline() && cached?.isStaleByTime(staleTime) && cached.state.fetchStatus !== 'fetching') refetch();
    } });
  }, [scope, JSON.stringify(key), enabled, staleTime, refetchOnWindowFocus, refetch]);
  // TanStack clears an initial error when a retry starts. The contract keeps it until
  // recovery, so a retry is never mistaken for evidence that the last failure is gone.
  const cached = scope.client.getQueryCache().find({ queryKey: key, exact: true })!;
  const history = historyFor({ scope, query: cached });
  const hasData = query.data !== undefined;
  return {
    data: query.data,
    status: resolveFetchQueryStatus({ disabled: !enabled, hasData, status: query.status }),
    error: resolveFetchQueryError({ error: history.error ?? query.error, disabled: !enabled, hasData }),
    isFetching: online && query.isFetching, refetch,
  };
}

/** Preserve promise rejection for awaiting writes while also handling discarded promises. */
function useFetchMutation<TInput, TOutput>({ run }: Pick<FetchMutationOptions<TInput, TOutput>, 'run'>, { invalidates }: Omit<FetchMutationOptions<TInput, TOutput>, 'run'> = {}): MutationResult<TInput, TOutput> {
  const scope = useScope();
  const mutation = useMutation<TOutput, unknown, { input: TInput }>({
    mutationFn: required => scope.gate.runOnline({ run: () => run(required) }),
    onSuccess: () => {
      // Do not await dependent reads: the mutation promise means the write succeeded,
      // not that every list finished reloading. Refetches proceed on their own schedule.
      for (const key of invalidates ?? []) invalidateResource({ scope, key });
    },
  }, scope.client);
  const { mutateAsync, reset } = mutation;
  const mutate = useCallback((required: { input: TInput }) => {
    const promise = mutateAsync(required);
    // Handle this same promise for callers that discard it, while still returning it so
    // await/catch observes the original rejection; discarding the derived promise is intentional.
    void promise.catch(() => {});
    return promise;
  }, [mutateAsync]);
  return { mutate, status: mutation.status, error: mutation.status === 'error' ? toQueryError(mutation.error) : null, reset };
}

/** Loader shares reactive reads, retains fresh idle values, and protects replacement writes. */
function useCachedLoader<T>({ key, fetch }: Pick<CachedLoaderOptions<T>, 'key' | 'fetch'>, { staleTime = DEFAULT_STALE_TIME }: Omit<CachedLoaderOptions<T>, 'key' | 'fetch'> = {}): CachedLoader<T> {
  const scope = useScope();
  return useMemo(() => {
    const options = { queryKey: key, queryFn: () => read({ scope, key, fetch }), staleTime, gcTime: gcTimeFor({ staleTime }) };
    return {
      peek: () => scope.client.getQueryData<T>(key),
      load: (required = { key, fetch }) => {
        const selected = { ...options, queryKey: required.key, queryFn: () => read({ scope, key: required.key, fetch: required.fetch }) };
        return scope.client.fetchQuery(selected).catch(error => {
          // A forced refresh can supersede a loader's request without aborting its transport.
          // Follow the new request instead of exposing TanStack's cancellation vocabulary.
          if (!isCancelledError(error)) throw error;
          // Invalidation also supersedes loader-only reads. Join (or start) the post-write
          // request rather than returning an obsolete value while the key is invalidated.
          const query = scope.client.getQueryCache().find({ queryKey: required.key, exact: true })!;
          if (query.state.isInvalidated) return scope.client.fetchQuery(selected);
          return (query.promise ?? scope.client.getQueryData<T>(required.key)) as Promise<T> | T;
        });
      },
      replace: ({ value }: { value: T }) => {
        const query = scope.client.getQueryCache().build(scope.client, options);
        const history = historyFor({ scope, query });
        history.replacement += 1;
        history.error = null;
        scope.client.setQueryData(key, value);
      },
    };
  }, [scope, key, fetch, staleTime]);
}

/** A host write/refresh postdates the initial GET as well as a background GET. TanStack
 * normally joins an initial fetch with no data, which would let that pre-write snapshot win.
 * Cancel its cache ownership before requesting the replacement; transports need no abort API. */
function supersedeInitialRead({ scope, key }: { scope: Scope; key: QueryKey }, { exact = true }: { exact?: boolean } = {}): void {
  void scope.client.cancelQueries({ queryKey: key, exact, predicate: query => query.isActive() && query.state.data === undefined && query.state.fetchStatus === 'fetching' });
}

/** One invalidation path serves both imperative refreshes and accepted writes. */
function invalidateResource({ scope, key }: { scope: Scope; key: QueryKey }, _optional: Record<string, never> = {}): void {
  // A loader-only detail request may feed an active parent query. It is just as stale
  // after a write as an observed read, even though TanStack considers it inactive.
  // Silent cancellation follows the replacement promise instead of resolving old cached data.
  void scope.client.cancelQueries({ queryKey: key, predicate: query => query.state.fetchStatus === 'fetching' }, { silent: true });
  void scope.client.invalidateQueries({ queryKey: key });
}

/** Prefix invalidation also reaches child keys read by other mounted consumers. */
function useInvalidate(): (required: { key: QueryKey }) => void {
  const scope = useScope();
  return useCallback(({ key }: { key: QueryKey }) => { invalidateResource({ scope, key }); }, [scope]);
}

const adapter: FetchQueryAdapter = { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate };
