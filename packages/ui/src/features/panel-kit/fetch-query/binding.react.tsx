import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { FetchQueryAdapter } from '@jini-ai/core/fetch';

/** Allocate primitive namespace keys within one cache provider; weak keys do not retain APIs. */
function createQueryScopes(_required: Record<string, never>, _options: Record<string, never> = {}) {
  const scopes = new WeakMap<object, number>();
  let nextScope = 0;
  return ({ owner }: { owner: object }, _optional: Record<string, never> = {}): number => {
    let scope = scopes.get(owner);
    if (scope === undefined) {
      scope = ++nextScope;
      scopes.set(owner, scope);
    }
    return scope;
  };
}
interface QueryBinding { adapter: FetchQueryAdapter; scopeFor: ReturnType<typeof createQueryScopes> }
const AdapterContext = createContext<QueryBinding | null>(null);

/** Internal composition seam: hooks and imperative loaders always use the same provider.
 * Keep the adapter fixed for this provider's lifetime to preserve React hook ordering. */
export function FetchQueryBinding({ adapter, children }: { adapter: FetchQueryAdapter; children: ReactNode }) {
  const [scopeFor] = useState(() => createQueryScopes({}));
  const binding = useMemo(() => ({ adapter, scopeFor }), [adapter, scopeFor]);
  return <AdapterContext.Provider value={binding}>{children}</AdapterContext.Provider>;
}

/** Resolve the nearest provider; fail before attempting an unscoped read or write. */
function useBinding(): QueryBinding {
  const binding = useContext(AdapterContext);
  if (!binding) throw new Error('Fetch-query hooks require FetchQueryProvider');
  return binding;
}

/** Library-free read facade; the provider selects its implementation. */
export const useFetchQuery: FetchQueryAdapter['useFetchQuery'] = (required, optional = {}) => useBinding().adapter.useFetchQuery(required, optional);
/** Library-free write facade, including safe discarded promises. */
export const useFetchMutation: FetchQueryAdapter['useFetchMutation'] = (required, optional = {}) => useBinding().adapter.useFetchMutation(required, optional);
/** Prefix invalidator for the nearest provider's cache. */
export const useInvalidate: FetchQueryAdapter['useInvalidate'] = () => useBinding().adapter.useInvalidate();
/** Promise loader using the same cache as reactive reads. */
export const useCachedLoader: FetchQueryAdapter['useCachedLoader'] = (required, optional = {}) => useBinding().adapter.useCachedLoader(required, optional);

/** Stable API identity shared by observers of the same provider, expressed as a primitive key. */
export function useFetchQueryScope(required: { owner: object }, _options: Record<string, never> = {}): number {
  return useBinding().scopeFor(required);
}
