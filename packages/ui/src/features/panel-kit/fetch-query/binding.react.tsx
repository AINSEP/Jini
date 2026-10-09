import { createContext, useContext, type ReactNode } from 'react';
import type { FetchQueryAdapter } from './types.js';

const AdapterContext = createContext<FetchQueryAdapter | null>(null);

/** Internal composition seam: hooks and imperative loaders always use the same provider.
 * Keep the adapter fixed for this provider's lifetime to preserve React hook ordering. */
export function FetchQueryBinding({ adapter, children }: { adapter: FetchQueryAdapter; children: ReactNode }) {
  return <AdapterContext.Provider value={adapter}>{children}</AdapterContext.Provider>;
}

/** Resolve the nearest provider; fail before attempting an unscoped read or write. */
function useAdapter(): FetchQueryAdapter {
  const adapter = useContext(AdapterContext);
  if (!adapter) throw new Error('Fetch-query hooks require FetchQueryProvider');
  return adapter;
}

/** Library-free read facade; the provider selects its implementation. */
export const useFetchQuery: FetchQueryAdapter['useFetchQuery'] = (required, optional = {}) => useAdapter().useFetchQuery(required, optional);
/** Library-free write facade, including safe discarded promises. */
export const useFetchMutation: FetchQueryAdapter['useFetchMutation'] = (required, optional = {}) => useAdapter().useFetchMutation(required, optional);
/** Prefix invalidator for the nearest provider's cache. */
export const useInvalidate: FetchQueryAdapter['useInvalidate'] = () => useAdapter().useInvalidate();
/** Promise loader using the same cache as reactive reads. */
export const useCachedLoader: FetchQueryAdapter['useCachedLoader'] = (required, optional = {}) => useAdapter().useCachedLoader(required, optional);
