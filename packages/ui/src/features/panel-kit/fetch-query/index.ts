export { FetchQueryProvider } from './adapter.react.js';
export { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate } from './binding.react.js';
/** @deprecated Import the framework-neutral environment port from @jini-ai/core/fetch. */
export type { FetchQueryEnvironmentPort } from '@jini-ai/core/fetch';
/** @deprecated Import framework-neutral query contracts from @jini-ai/core/fetch. */
export type { QueryKey, QueryStatus, QueryResult, FetchQueryOptions, MutationStatus, MutationResult, FetchMutationOptions, CachedLoaderOptions, CachedLoader, FetchQueryAdapter } from '@jini-ai/core/fetch';
