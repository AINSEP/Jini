/** Optional adapter entry. Importing the default entry never loads TanStack. */
export { FetchQueryProvider } from './adapter.tanstack.js';
export { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate } from './binding.react.js';
export type { FetchQueryEnvironmentPort } from './cache.js';
export type { QueryKey, QueryStatus, QueryResult, FetchQueryOptions, MutationStatus, MutationResult, FetchMutationOptions, CachedLoaderOptions, CachedLoader, FetchQueryAdapter } from './types.js';
