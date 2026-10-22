import type { AdminWidgetsPort } from '../ports.js';
import type { WidgetsRequestOptions } from '../models.js';
/** Host owns auth, JSON serialization, request deadlines/retries, and status/error decoding. */
export interface WidgetsTransportPort {
  request<T>(required: { path: string; method: 'GET' | 'POST' | 'PUT'; body?: unknown | undefined }, optional?: WidgetsRequestOptions | undefined): Promise<T>;
  url(required: { path: string }, optional?: Record<string, never> | undefined): string;
}
/** basePath is the host workspace root; the adapter adds /widgets and the shared /trash/items. */
export function createHttpWidgetsApi({ transport, basePath }: { transport: WidgetsTransportPort; basePath: string }, _optional: Record<string, never> = {}): AdminWidgetsPort {
  const root = basePath.replace(/\/$/, '');
  const base = `${root}/widgets`;
  const request = <T>(path: string, method: 'GET' | 'POST' | 'PUT', body: unknown, options: WidgetsRequestOptions): Promise<T> => {
    options.signal?.throwIfAborted();
    return transport.request<T>({ path, method, ...(body === undefined ? {} : { body }) }, options);
  };
  return {
    listWidgets({ widgetType, includeInactive }, options = {}) {
      const query = new URLSearchParams();
      if (widgetType) query.set('widgetType', widgetType);
      if (includeInactive) query.set('includeInactive', 'true');
      const suffix = query.toString();
      return request<Awaited<ReturnType<AdminWidgetsPort['listWidgets']>>>(`${base}${suffix ? `?${suffix}` : ''}`, 'GET', undefined, options);
    },
    getWidget({ id }, options = {}) { return request<Awaited<ReturnType<AdminWidgetsPort['getWidget']>>>(`${base}/${encodeURIComponent(id)}`, 'GET', undefined, options); },
    createWidget(input, options = {}) { return request<Awaited<ReturnType<AdminWidgetsPort['createWidget']>>>(base, 'POST', input, options); },
    updateWidget({ id, baseVersion, config, title }, options = {}) {
      return request<Awaited<ReturnType<AdminWidgetsPort['updateWidget']>>>(`${base}/${encodeURIComponent(id)}`, 'PUT', { baseVersion, config, ...(title === undefined ? {} : { title }) }, options);
    },
    trashWidget({ id }, options = {}) { return request<Awaited<ReturnType<AdminWidgetsPort['trashWidget']>>>(`${root}/trash/items`, 'POST', { type: 'widget', id }, options); },
    listWidgetRegions(_required, options = {}) { return request<Awaited<ReturnType<AdminWidgetsPort['listWidgetRegions']>>>(`${base}/regions`, 'GET', undefined, options); },
    bindWidgetRegion({ regionKey }, options = {}) { return request<Awaited<ReturnType<AdminWidgetsPort['bindWidgetRegion']>>>(`${base}/regions`, 'POST', { regionKey }, options); },
    getWidgetRegion({ regionKey }, options = {}) { return request<Awaited<ReturnType<AdminWidgetsPort['getWidgetRegion']>>>(`${base}/regions/${encodeURIComponent(regionKey)}`, 'GET', undefined, options); },
    mutateWidgetRegionPlacements({ regionKey, baseVersion, placements }, options = {}) {
      return request<Awaited<ReturnType<AdminWidgetsPort['mutateWidgetRegionPlacements']>>>(`${base}/regions/${encodeURIComponent(regionKey)}`, 'PUT', { baseVersion, placements }, options);
    },
  };
}
