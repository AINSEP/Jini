/**
 * Keep the contract independent of any query library so an adapter swap does not require
 * rewriting callers. Add narrow required capabilities here rather than exporting library
 * result/client types that would bypass this boundary.
 */
/**
 * Keys contain primitive array parts so parameterised resources compose without fragile
 * string formatting or object-identity mismatches. Invalidation matches by PREFIX: a list
 * key also refreshes its derived child keys. Exact-key equality would compile while quietly
 * breaking that guarantee; avoid a shared prefix for resources that merely sound related,
 * or writes will fan out unnecessary refetches.
 */
export type QueryKey = readonly (string | number)[];


// loading describes an initial read with no data; background reads use isFetching so a
// revalidating screen can retain its content instead of flashing its first-load skeleton.
export type QueryStatus = "loading" | "success" | "error";

export interface QueryResult<T> {
  
  data: T | undefined;
  
  // Independent of status: a disabled query can retain successful data and a later
  // background error together, allowing callers to flag that visible data may be stale.
  error: Error | null;
  status: QueryStatus;
  
  // Includes background reads; use this for refreshing affordances and status for skeletons.
  isFetching: boolean;
  
  // Explicit user refresh ignores freshness; write-driven refresh belongs in invalidates
  // so every mounted consumer of the same resource is updated, not just one screen.
  refetch: () => void;
}

export interface FetchQueryOptions<T> {
  key: QueryKey;
  
  // Reject on failure: a resolved [] or null hides a broken request as a valid empty result.
  fetch: () => Promise<T>;
  
  /**
   * Gate on user intent or prerequisites to avoid fetching an undefined id. Disabling does
   * not erase cached failures: without any successful data, report loading/error:null so
   * a gesture-gated read cannot show an old failure before the user asks for it. With
   * earlier data, report success but retain a later background error so known-stale data
   * need not be presented as an unqualified success.
   */
  enabled?: boolean;
  
  // Freshness in milliseconds; use zero when every mount must observe possible writes
  // by another operator rather than reuse the short provider default.
  staleTime?: number;
  
  // Default false. Opt in for screens changed by other screens, tools or desktop instances
  // that have no single local write path from which to invalidate their data.
  refetchOnWindowFocus?: boolean;
}

export type MutationStatus = "idle" | "pending" | "success" | "error";

export interface MutationResult<TInput, TOutput> {
  
  /**
   * Awaiting the write receives its result or rejection; discarding the same promise and
   * reading state is safe because it already has a rejection handler. Returning a bare
   * rejecting promise would make only the awaiting form safe. Node unhandledRejection
   * can verify this contract even where a DOM unhandledrejection event does not fire.
   */
  mutate: (required: { input: TInput }) => Promise<TOutput>;
  status: MutationStatus;
  error: Error | null;
  
  // Dismiss an old failure/status without remounting the form.
  reset: () => void;
}

export interface FetchMutationOptions<TInput, TOutput> {
  run: (required: { input: TInput }) => Promise<TOutput>;
  
  // Success invalidates every mounted read under these prefixes, preventing two screens
  // from drifting after a write. Failure does not invalidate: the rejected write changed nothing.
  invalidates?: readonly QueryKey[];
}

/**
 * Keep key and fetch references stable: they are memo dependencies of the loader handle.
 * Failed fetches reject and are not cached, so the next load retries instead of replaying
 * a failure as data. Retain an idle value at least as long as its declared freshness: an
 * imperative loader has no persistent observer to keep it alive.
 */
export interface CachedLoaderOptions<T> {
  
  key: QueryKey;
  
  fetch: () => Promise<T>;
  
  staleTime?: number;
}


/**
 * A plain promise loader serves components that own their loading UI rather than consuming
 * a hook result. It shares the provider cache, including one in-flight request per key.
 */
export interface CachedLoader<T> {
  
  // Non-reactive snapshot: use only as a render seed, never as the subsequent display truth.
  peek: () => T | undefined;
  
  load: () => Promise<T>;
  
  // A write response can replace the value immediately; an older load already in flight
  // must resolve to this replacement rather than overwrite it with a stale answer.
  replace: (required: { value: T }) => void;
}


/**
 * Keep the provider-facing hooks, loader and invalidator behind one binding so replacing
 * the cache implementation does not leave different consumers on different adapters.
 */
export interface FetchQueryAdapter {
  useFetchQuery: <T>(required: Pick<FetchQueryOptions<T>, "key" | "fetch">, optional?: Omit<FetchQueryOptions<T>, "key" | "fetch">) => QueryResult<T>;
  useFetchMutation: <TInput, TOutput>(
    required: Pick<FetchMutationOptions<TInput, TOutput>, "run">,
    optional?: Omit<FetchMutationOptions<TInput, TOutput>, "run">,
  ) => MutationResult<TInput, TOutput>;
  useInvalidate: () => (required: { key: QueryKey }) => void;
  useCachedLoader: <T>(required: Pick<CachedLoaderOptions<T>, "key" | "fetch">, optional?: Omit<CachedLoaderOptions<T>, "key" | "fetch">) => CachedLoader<T>;
}
