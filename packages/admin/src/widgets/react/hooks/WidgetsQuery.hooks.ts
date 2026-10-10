import { useCallback, useMemo, useRef } from 'react';
import { useCachedLoader, useFetchMutation, useFetchQuery } from '@jini-ai/ui/fetch-query';
import type { AdminWidgetsPort } from '../../ports.js';
export const WIDGET_QUERY_KEYS = {
  root: ['widgets'] as const,
  library: ['widgets', 'library'] as const,
  instances: ['widgets', 'instance'] as const,
  regions: ['widgets', 'regions'] as const,
  regionDetails: ['widgets', 'region'] as const,
};

/** Query ports preserve headless controller APIs. Each hook owns one fixed resource key;
 * mutable refs keep the injected port stable without capturing stale route ids or mutations. */
export function useWidgetsListQuery({ api }: { api: AdminWidgetsPort }, _optional: Record<string, never> = {}) {
  const fetch = useCallback(() => api.listWidgets({}), [api]);
  const query = useFetchQuery({ key: WIDGET_QUERY_KEYS.library, fetch });
  const loader = useCachedLoader({ key: WIDGET_QUERY_KEYS.library, fetch }, { staleTime: 0 });
  const write = useFetchMutation({ run: ({ input }: { input: Parameters<AdminWidgetsPort['trashWidget']> }) => api.trashWidget(...input) }, { invalidates: [WIDGET_QUERY_KEYS.root] });
  const current = useRef({ loader, write }); current.current = { loader, write };
  const cachedApi = useMemo<AdminWidgetsPort>(() => ({ ...api,
    listWidgets: () => current.current.loader.load(),
    trashWidget: (...input) => current.current.write.mutate({ input }),
  }), [api]);
  return { api: cachedApi, query };
}

export function useWidgetRegionsQuery({ api }: { api: AdminWidgetsPort }, _optional: Record<string, never> = {}) {
  const fetch = useCallback(() => api.listWidgetRegions({}), [api]);
  const query = useFetchQuery({ key: WIDGET_QUERY_KEYS.regions, fetch });
  const loader = useCachedLoader({ key: WIDGET_QUERY_KEYS.regions, fetch }, { staleTime: 0 });
  const write = useFetchMutation({ run: ({ input }: { input: Parameters<AdminWidgetsPort['bindWidgetRegion']> }) => api.bindWidgetRegion(...input) }, { invalidates: [WIDGET_QUERY_KEYS.root] });
  const current = useRef({ loader, write }); current.current = { loader, write };
  const cachedApi = useMemo<AdminWidgetsPort>(() => ({ ...api,
    listWidgetRegions: () => current.current.loader.load(),
    bindWidgetRegion: (...input) => current.current.write.mutate({ input }),
  }), [api]);
  return { api: cachedApi, query };
}

export function useWidgetInstanceQuery({ api, widgetId }: { api: AdminWidgetsPort; widgetId: string | null }, _optional: Record<string, never> = {}) {
  const key = useMemo(() => [...WIDGET_QUERY_KEYS.instances, widgetId ?? ''], [widgetId]);
  const fetch = useCallback(() => api.getWidget({ id: widgetId! }), [api, widgetId]);
  // The editor owns its draft: an imperative loader shares reads without replacing typed text
  // merely because a sibling screen invalidated this widget.
  const loader = useCachedLoader({ key, fetch }, { staleTime: 0 });
  const create = useFetchMutation({ run: ({ input }: { input: Parameters<AdminWidgetsPort['createWidget']> }) => api.createWidget(...input) }, { invalidates: [WIDGET_QUERY_KEYS.root] });
  const update = useFetchMutation({ run: ({ input }: { input: Parameters<AdminWidgetsPort['updateWidget']> }) => api.updateWidget(...input) }, { invalidates: [WIDGET_QUERY_KEYS.root] });
  const current = useRef({ loader, create, update }); current.current = { loader, create, update };
  return useMemo<AdminWidgetsPort>(() => ({ ...api,
    getWidget: () => current.current.loader.load(),
    createWidget: (...input) => current.current.create.mutate({ input }),
    updateWidget: (...input) => current.current.update.mutate({ input }),
  }), [api]);
}

export function useWidgetRegionQuery({ api, regionKey }: { api: AdminWidgetsPort; regionKey: string }, _optional: Record<string, never> = {}) {
  const key = useMemo(() => [...WIDGET_QUERY_KEYS.regionDetails, regionKey], [regionKey]);
  const fetch = useCallback(() => api.getWidgetRegion({ regionKey }), [api, regionKey]);
  const loader = useCachedLoader({ key, fetch }, { staleTime: 0 });
  const save = useFetchMutation({ run: ({ input }: { input: Parameters<AdminWidgetsPort['mutateWidgetRegionPlacements']> }) => api.mutateWidgetRegionPlacements(...input) }, { invalidates: [WIDGET_QUERY_KEYS.root] });
  const widgetKey = useMemo(() => [...WIDGET_QUERY_KEYS.instances, 'lookup'] as const, []);
  const fetchWidget = useCallback(async (): ReturnType<AdminWidgetsPort['getWidget']> => { throw new Error('Widget id required'); }, []);
  const widgetLookup = useCachedLoader({ key: widgetKey, fetch: fetchWidget });
  const current = useRef({ loader, save, widgetLookup }); current.current = { loader, save, widgetLookup };
  return useMemo<AdminWidgetsPort>(() => ({ ...api,
    getWidgetRegion: () => current.current.loader.load(),
    getWidget: ({ id }) => current.current.widgetLookup.load({ key: [...WIDGET_QUERY_KEYS.instances, id], fetch: () => api.getWidget({ id }) }),
    mutateWidgetRegionPlacements: (...input) => current.current.save.mutate({ input }),
  }), [api]);
}
