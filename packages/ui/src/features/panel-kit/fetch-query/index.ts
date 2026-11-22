export { FetchQueryProvider, type FetchQueryProviderProps } from './adapter.react.js';
export { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate, useFetchQueryScope } from './binding.react.js';
export { useCursorPages } from './use-cursor-pages.hooks.js';
export type { CursorPage, CursorPages, CursorPagesRequired } from './use-cursor-pages.hooks.js';
/** @deprecated Import the framework-neutral environment port from @jini-ai/core/fetch. */
export type { FetchQueryEnvironmentPort } from '@jini-ai/core/fetch';
/** @deprecated Import framework-neutral query contracts from @jini-ai/core/fetch. */
export type { QueryKey, QueryStatus, QueryResult, FetchQueryOptions, MutationStatus, MutationResult, FetchMutationOptions, CachedLoaderOptions, CachedLoader, FetchQueryAdapter } from '@jini-ai/core/fetch';
