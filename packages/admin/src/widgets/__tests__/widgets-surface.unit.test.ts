import { describe, expect, it, vi } from 'vitest';
import { AdminApiError } from '../../core/transport/errors.js';
import * as widgets from '../index.js';
import { createHttpWidgetsApi, type WidgetsTransportPort } from '../adapters/http.js';
import { createMemoryWidgetsApi } from '../adapters/memory.js';

function recordingTransport() {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const transport: WidgetsTransportPort = {
    async request<T>(required: { path: string; method: 'GET' | 'POST' | 'PUT'; body?: unknown }) { calls.push(required); return { echoed: required.path } as T; },
    url: ({ path }) => path,
  };
  return { transport, calls };
}

describe('createHttpWidgetsApi', () => {
  it('maps widget and region operations onto the existing routes and bodies', async () => {
    const { transport, calls } = recordingTransport();
    const api = createHttpWidgetsApi({ transport, basePath: '/ws/' });
    await api.getWidget({ id: 'w 1' });
    await api.createWidget({ widgetType: 'text', title: 'Hello', config: {} });
    await api.updateWidget({ id: 'w1', baseVersion: 2, config: { body: 'x' } });
    await api.updateWidget({ id: 'w1', baseVersion: 3, config: {}, title: 'Renamed' });
    await api.listWidgetRegions({});
    await api.bindWidgetRegion({ regionKey: 'footer' });
    await expect(api.getWidgetRegion({ regionKey: 'foot er' })).resolves.toEqual({ echoed: '/ws/widgets/regions/foot%20er' });
    await api.mutateWidgetRegionPlacements({ regionKey: 'footer', baseVersion: 4, placements: [] });
    expect(calls).toEqual([
      { path: '/ws/widgets/w%201', method: 'GET' },
      { path: '/ws/widgets', method: 'POST', body: { widgetType: 'text', title: 'Hello', config: {} } },
      { path: '/ws/widgets/w1', method: 'PUT', body: { baseVersion: 2, config: { body: 'x' } } },
      { path: '/ws/widgets/w1', method: 'PUT', body: { baseVersion: 3, config: {}, title: 'Renamed' } },
      { path: '/ws/widgets/regions', method: 'GET' },
      { path: '/ws/widgets/regions', method: 'POST', body: { regionKey: 'footer' } },
      { path: '/ws/widgets/regions/foot%20er', method: 'GET' },
      { path: '/ws/widgets/regions/footer', method: 'PUT', body: { baseVersion: 4, placements: [] } },
    ]);
  });
});

describe('createHttpWidgetsApi cancellation', () => {
  it('refuses an aborted request before it reaches the host transport', () => {
    const { transport, calls } = recordingTransport();
    const abort = new AbortController(); abort.abort();
    // The guard runs before the transport is touched, so it throws synchronously.
    expect(() => createHttpWidgetsApi({ transport, basePath: '/ws' }).getWidget({ id: 'w1' }, { signal: abort.signal })).toThrow('This operation was aborted');
    expect(calls).toEqual([]);
  });
});

describe('createMemoryWidgetsApi regions', () => {
  it('refuses to bind a region that already has a binding row', async () => {
    const api = createMemoryWidgetsApi({ regions: [{ workspaceId: 'fake-ws', regionKey: 'footer', areaEntryId: 'a1', updatedAt: 'then', placementCount: 0 }] });
    await expect(api.bindWidgetRegion({ regionKey: 'footer' })).rejects.toMatchObject({ code: 'WIDGETS_REGION_BOUND' });
  });

  it('honours an aborted signal when listing regions', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(createMemoryWidgetsApi({}).listWidgetRegions({}, { signal: abort.signal })).rejects.toThrow();
  });
});

describe('widget regions controller', () => {
  it('describes a plain load failure with its own message', async () => {
    const api = { ...createMemoryWidgetsApi({}), listWidgetRegions: () => Promise.reject(new Error('regions offline')) };
    const controller = widgets.createWidgetRegionsController({ api });
    await controller.load({});
    expect(controller.getSnapshot().error).toBe('regions offline');
  });

  it('ignores a bind with a blank region key', async () => {
    const api = createMemoryWidgetsApi({});
    const bind = vi.spyOn(api, 'bindWidgetRegion');
    const controller = widgets.createWidgetRegionsController({ api });
    controller.setNewRegionKey({ value: '   ' });
    await controller.bind({});
    expect(bind).not.toHaveBeenCalled();
    expect(controller.getSnapshot().binding).toBe(false);
  });

  it('describes a plain bind failure with its own message', async () => {
    const api = { ...createMemoryWidgetsApi({}), bindWidgetRegion: () => Promise.reject(new Error('bind transport down')) };
    const controller = widgets.createWidgetRegionsController({ api });
    controller.setNewRegionKey({ value: 'header' });
    await controller.bind({});
    expect(controller.getSnapshot()).toMatchObject({ error: 'bind transport down', binding: false, newRegionKey: 'header' });
  });

  it('keeps the typed key and reports a failed bind without navigating', async () => {
    const api = createMemoryWidgetsApi({ regions: [{ workspaceId: 'fake-ws', regionKey: 'footer', areaEntryId: 'a1', updatedAt: 'then', placementCount: 0 }] });
    const navigate = vi.fn();
    const controller = widgets.createWidgetRegionsController({ api }, { navigate });
    controller.setNewRegionKey({ value: 'footer' });
    await controller.bind({});
    expect(controller.getSnapshot()).toMatchObject({ newRegionKey: 'footer', binding: false, error: 'Region already bound' });
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('widgets rules and messages', () => {
  it('adopts a host error that carries a numeric status as an API error', () => {
    const hostError = Object.assign(new Error('gone'), { status: 410, code: 'WIDGETS_GONE' });
    const adopted = widgets.widgetApiError({ error: hostError });
    expect(adopted).toBeInstanceOf(AdminApiError);
    expect(adopted).toMatchObject({ message: 'gone', status: 410, code: 'WIDGETS_GONE' });
    expect(widgets.widgetApiError({ error: new Error('plain') })).toBeNull();
  });

  it('explains a region version conflict, and falls back for an opaque failure', () => {
    const conflict = new AdminApiError({ message: 'conflict', status: 409 }, { code: 'WIDGETS_AREA_CONFLICT' });
    expect(widgets.resolveWidgetRegionSaveError({ error: conflict })).toBe('This region changed since you loaded it, refresh and try again.');
    expect(widgets.resolveWidgetRegionSaveError({ error: 'opaque' }, { t: key => `fr:${key}` })).toBe('fr:save failed');
  });

  it('returns an unknown key untouched and interpolates only supplied variables', () => {
    expect(widgets.widgetsEnglish('No such message')).toBe('No such message');
    expect(widgets.widgetsEnglish('Hello {name}', { name: 'Ada' })).toBe('Hello Ada');
  });

  it('publishes the module with its ports and editor routes', () => {
    expect(widgets.widgetsApiToken).toEqual({ id: 'admin.widgets.api', version: 1, cardinality: 'one' });
    expect(widgets.widgetsModule.optional).toEqual({ widgetsEvents: widgets.widgetsEventsToken, widgetsNavigation: widgets.widgetsNavigationToken });
    expect(widgets.widgetsEditorPaths).toEqual(['/widgets/new', '/widgets/:widgetId']);
    expect(widgets.widgetsAgentPageIds.region).toBe('widget-regions');
  });
});
