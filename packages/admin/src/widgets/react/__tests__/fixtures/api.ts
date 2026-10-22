import { AdminApiError } from '../../../../core/transport/errors.js';
import { createHttpWidgetsApi } from '../../../adapters/http.js';
import type { WidgetsTransportPort } from '../../../adapters/http.js';
export type * from '../../../models.js';
/** Constructor facade belongs to the copied harness; production uses the existing admin owner. */
export class ApiError extends AdminApiError {
  constructor(message: string, status: number, code?: string | undefined, body?: Record<string, unknown> | undefined) { super({ message, status }, { code, body }); }
}
export const transport: WidgetsTransportPort = {
  async request<T>({ path, method, body }: Parameters<WidgetsTransportPort['request']>[0], options: NonNullable<Parameters<WidgetsTransportPort['request']>[1]> = {}): Promise<T> {
    const response = await fetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(options.signal === undefined ? {} : { signal: options.signal }) });
    const data = await response.json();
    if (!response.ok) throw new ApiError(typeof data.error === 'string' ? data.error : 'Request failed', response.status, data.code, data);
    return data as T;
  },
  url({ path }) { return path; },
};
const http = createHttpWidgetsApi({ transport, basePath: '/api/admin/v1/workspaces/workspace-local' });
export const api = {
  listWidgets: (options: { widgetType?: string | undefined; includeInactive?: boolean | undefined } = {}) => http.listWidgets(options),
  getWidget: (id: string) => http.getWidget({ id }),
  createWidget: (input: Parameters<typeof http.createWidget>[0]) => http.createWidget(input),
  updateWidget: (input: Parameters<typeof http.updateWidget>[0]) => http.updateWidget(input),
  trashWidget: (id: string) => http.trashWidget({ id }),
  listWidgetRegions: () => http.listWidgetRegions({}),
  bindWidgetRegion: (regionKey: string) => http.bindWidgetRegion({ regionKey }),
  getWidgetRegion: (regionKey: string) => http.getWidgetRegion({ regionKey }),
  mutateWidgetRegionPlacements: (input: Parameters<typeof http.mutateWidgetRegionPlacements>[0]) => http.mutateWidgetRegionPlacements(input),
};
