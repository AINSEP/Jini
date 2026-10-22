/** Framework-neutral query contracts and cache; hosts supply transport callbacks and environment ports. */
export { DEFAULT_STALE_TIME, IDLE_RETENTION, FetchQueryCache, toQueryError } from './cache.js';
export type { QueryCacheSchedulerPort, FetchQueryEnvironmentPort, FetchQueryCacheOptions, QueryState, QueryObserver, CacheEntry } from './cache.js';
export type { QueryKey, QueryStatus, QueryResult, FetchQueryOptions, MutationStatus, MutationResult, FetchMutationOptions, CachedLoaderOptions, CachedLoaderDefaults, CachedLoader, FetchQueryAdapter } from './types.js';
export { missingCachedLoaderFetchError, withCachedLoaderFetch } from './loader-read.js';
