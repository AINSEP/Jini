import { act, renderHook, waitFor } from '../../../__tests__/fetch-query-support.js';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AdminApiError } from '../../../core/transport/errors.js';
import { createMemoryWidgetsApi } from '../../adapters/memory.js';
import { WidgetsOptionsContext, WidgetsPortsContext, type WidgetsReactOptions } from '../hooks/WidgetsPorts.hooks.js';
import { useWidgetRegions, useWiredWidgetRegions, type WidgetRegionsController } from '../hooks/use-widget-regions.hooks.js';
import type { AdminWidgetsPort, WidgetsNavigationPort } from '../../ports.js';

/** @file The wired entry point (ports + options contexts) and the pre-controller first render. */
const options: WidgetsReactOptions = { slots: { ConfigFields: () => null, AddControl: () => null }, widgetTypes: [], defaultConfig: () => ({}) };
function wrapperFor({ api, navigation, extra = {} }: { api: AdminWidgetsPort; navigation: WidgetsNavigationPort; extra?: Partial<WidgetsReactOptions> }) {
  return ({ children }: { children: ReactNode }) => createElement(WidgetsPortsContext.Provider, { value: { widgetsApi: api, widgetsNavigation: navigation } },
    createElement(WidgetsOptionsContext.Provider, { value: { ...options, ...extra } }, children));
}

describe('useWiredWidgetRegions', () => {
  it('binds through the scoped api and navigates under the default /admin base', async () => {
    const api = createMemoryWidgetsApi({});
    const navigation: WidgetsNavigationPort = { navigate: vi.fn() };
    const { result } = renderHook(() => useWiredWidgetRegions(), { wrapper: wrapperFor({ api, navigation }) });
    await waitFor(() => expect(result.current.regions).toEqual([]));
    act(() => result.current.setNewRegionKey('sidebar'));
    await act(async () => { await result.current.bind(); });
    expect(api.regions.map(r => r.regionKey)).toEqual(['sidebar']);
    expect(navigation.navigate).toHaveBeenCalledWith({ base: '/admin', routePath: '/widgets/regions/sidebar' }, undefined);
  });

  it('navigates under a host-supplied base and exposes the host translator', async () => {
    const navigation: WidgetsNavigationPort = { navigate: vi.fn() };
    const t = (key: string) => `T:${key}`;
    const { result } = renderHook(() => useWiredWidgetRegions(), { wrapper: wrapperFor({ api: createMemoryWidgetsApi({}), navigation, extra: { navigationBase: '/console', t } }) });
    await waitFor(() => expect(result.current.regions).toEqual([]));
    act(() => result.current.setNewRegionKey('footer'));
    await act(async () => { await result.current.bind(); });
    expect(navigation.navigate).toHaveBeenCalledWith({ base: '/console', routePath: '/widgets/regions/footer' }, undefined);
    expect(result.current.t).toBe(t);
  });
});

describe('useWidgetRegions before the controller exists', () => {
  it('renders the empty loading state and its actions are inert', async () => {
    const api = createMemoryWidgetsApi({});
    const bind = vi.spyOn(api, 'bindWidgetRegion');
    const renders: WidgetRegionsController[] = [];
    const { result } = renderHook(() => { const view = useWidgetRegions({ api }); renders.push(view); return view; });
    const first = renders[0]!;
    expect(first).toMatchObject({ regions: null, error: null, newRegionKey: '', binding: false });
    first.setNewRegionKey('ignored');
    await first.bind();
    await waitFor(() => expect(result.current.regions).toEqual([]));
    expect(bind).not.toHaveBeenCalled();
    expect(result.current.newRegionKey).toBe('');
  });

  it('surfaces the list failure message', async () => {
    const api: AdminWidgetsPort = { ...createMemoryWidgetsApi({}), listWidgetRegions: () => Promise.reject(new AdminApiError({ message: 'regions denied', status: 403 })) };
    const { result } = renderHook(() => useWidgetRegions({ api }));
    await waitFor(() => expect(result.current.error).toBe('regions denied'));
    expect(result.current.regions).toBeNull();
  });
});
