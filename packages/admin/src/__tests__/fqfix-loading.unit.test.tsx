// @vitest-environment jsdom
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { FetchQueryProvider as BuiltinProvider } from '@jini-ai/ui/fetch-query';
import { FetchQueryProvider as TanstackProvider } from '@jini-ai/ui/fetch-query/tanstack';
import { createLibraryController } from '../media/controllers/library.controller.js';
import { createMemoryMediaApi, createMemoryMediaProviders } from '../media/adapters/memory.js';
import { useMediaLibraryQuery, useMediaProvidersQuery } from '../media/react/hooks/MediaQuery.hooks.js';
import { useProvidersTab } from '../media/react/hooks/ProvidersTab.hooks.js';
import { MediaPortsContext } from '../media/react/hooks/MediaPorts.hooks.js';
import { createMemoryWidgetsApi } from '../widgets/adapters/memory.js';
import { useWidgetInstanceQuery, useWidgetRegionQuery } from '../widgets/react/hooks/WidgetsQuery.hooks.js';
import { createMemorySeoApi } from '../seo/adapters/memory.js';
import { useSeoSettingsQuery, useSeoEntryQuery } from '../seo/react/hooks/SeoQuery.hooks.js';
import { Seo } from '../seo/react/pages/SeoPage.js';
import { SeoPortsContext, SeoOptionsContext } from '../seo/react/hooks/SeoPorts.hooks.js';
import type { AdminWidget } from '../widgets/models.js';
import type { SeoEntryMeta } from '../seo/models.js';

it('clears a media failure after successful cache settlement, including an empty library', () => {
  const controller = createLibraryController({ api: createMemoryMediaApi({}) });
  try {
    controller.settleLibrary({ error: new Error('Library unavailable') });
    expect(controller.getSnapshot().error).toBe('Library unavailable');
    controller.settleLibrary({ all: [] });
    expect(controller.getSnapshot().items).toEqual([]);
    expect(controller.getSnapshot().error).toBeNull();
    controller.settleLibrary({ all: [], error: new Error('Latest read failed') });
    expect(controller.getSnapshot().error).toBe('Latest read failed');
  } finally { controller.dispose(); }
});

describe.each(['builtin', 'tanstack'] as const)('editor/cache regressions with %s', adapter => {
  const Provider = adapter === 'builtin' ? BuiltinProvider : TanstackProvider;
  const wrapper = ({ children }: { children: ReactNode }) => <Provider>{children}</Provider>;
  it('reads SEO settings once per settings-form open through the shared query owner', async () => {
    const source = createMemorySeoApi({});
    let reads = 0;
    const api = { ...source, getSeoSettings: async () => { reads++; return source.getSeoSettings({}); } };
    const screen = <SeoPortsContext.Provider value={{ seoApi: api }}>
      <SeoOptionsContext.Provider value={{ siteUrl: () => 'https://example.com' }}><Seo /></SeoOptionsContext.Provider>
    </SeoPortsContext.Provider>;
    const view = render(<Provider>{screen}</Provider>);
    try {
      await waitFor(() => expect(view.container.querySelector('form input[name="titleTemplate"]')).toHaveValue('%s'));
      await act(async () => {});
      expect(reads).toBe(1);
      view.rerender(<Provider>{null}</Provider>);
      await source.putSeoSettings({}, { titleTemplate: '%s | Fresh' });
      view.rerender(<Provider>{screen}</Provider>);
      await waitFor(() => expect(view.container.querySelector('form input[name="titleTemplate"]')).toHaveValue('%s | Fresh'));
      await act(async () => {});
      expect(reads).toBe(2);
    } finally { view.unmount(); }
  });
  it('reads fresh widget and region versions on the next editor load', async () => {
    const widget: AdminWidget = { id: 'w1', workspaceId: 'ws1', title: 'Cached', slug: 'hero', status: 'active', widgetType: 'text',
      config: {}, version: 1, updatedAt: '2026-10-01T00:00:00Z' };
    const api = createMemoryWidgetsApi({ widgets: [widget] });
    await api.bindWidgetRegion({ regionKey: 'main' });
    const { result } = renderHook(() => ({ instance: useWidgetInstanceQuery({ api, widgetId: 'w1' }),
      region: useWidgetRegionQuery({ api, regionKey: 'main' }) }), { wrapper });
    await act(async () => {
      expect((await result.current.instance.getWidget({ id: 'w1' })).widget.version).toBe(1);
      expect((await result.current.region.getWidgetRegion({ regionKey: 'main' })).area.version).toBe(1);
    });
    await api.updateWidget({ id: 'w1', baseVersion: 1, config: {}, title: 'Fresh' });
    await api.mutateWidgetRegionPlacements({ regionKey: 'main', baseVersion: 1, placements: [] });
    await act(async () => {
      const fresh = await result.current.instance.getWidget({ id: 'w1' });
      expect(fresh.widget.version).toBe(2);
      expect(fresh.widget.title).toBe('Fresh');
      expect((await result.current.region.getWidgetRegion({ regionKey: 'main' })).area.version).toBe(2);
    });
  });
  it('revalidates SEO settings on reopen and entry overrides on an imperative editor read', async () => {
    const meta: SeoEntryMeta = { title: 'Cached', description: '', canonical: 'https://example.com/entry', robots: { noindex: false, nofollow: false },
      openGraph: { title: 'Cached', type: 'article', url: 'https://example.com/entry' }, twitter: { card: 'summary', title: 'Cached' }, jsonLd: [] };
    const api = createMemorySeoApi({ entries: { entry: { meta, analysis: { entryId: 'entry', score: 80, issues: [], resolved: meta } } } });
    let settings!: ReturnType<typeof useSeoSettingsQuery>;
    let entry!: ReturnType<typeof useSeoEntryQuery>;
    function Probe() { settings = useSeoSettingsQuery({ api }); entry = useSeoEntryQuery({ api, entryId: 'entry' }); return null; }
    const view = render(<Provider><Probe /></Provider>);
    await waitFor(() => expect(settings.query.data?.titleTemplate).toBe('%s'));
    await waitFor(() => expect(entry.query.data?.resolved.title).toBe('Cached'));
    await act(async () => { expect((await entry.api.getSeoEntry({ entryId: 'entry' })).title).toBe('Cached'); });
    await api.putSeoEntry({ entryId: 'entry' }, { title: 'Fresh' });
    await act(async () => { expect((await entry.api.getSeoEntry({ entryId: 'entry' })).title).toBe('Fresh'); });
    view.rerender(<Provider>{null}</Provider>);
    await api.putSeoSettings({}, { titleTemplate: '%s | Fresh' });
    view.rerender(<Provider><Probe /></Provider>);
    await waitFor(() => expect(settings.query.data?.titleTemplate).toBe('%s | Fresh'));
  });
  it('joins the providers mount read and spends no providers request on a library write', async () => {
    const api = createMemoryMediaApi({});
    const source = createMemoryMediaProviders({ providers: [{ id: 'example', label: 'Example', configured: false }] });
    let reads = 0;
    const port = { ...source, list: async () => { reads++; return source.list({}); } };
    const portsWrapper = ({ children }: { children: ReactNode }) => <Provider><MediaPortsContext.Provider value={{ mediaApi: api, mediaProviders: port }}>{children}</MediaPortsContext.Provider></Provider>;
    const { result } = renderHook(() => ({ providers: useProvidersTab(), library: useMediaLibraryQuery({ api }), catalogue: useMediaProvidersQuery({ port }) }), { wrapper: portsWrapper });
    await waitFor(() => expect(result.current.providers.reloadDisabled).toBe(false));
    await waitFor(() => expect(result.current.catalogue.query.data).toHaveLength(1));
    expect(reads).toBe(1);
    await act(async () => { await result.current.library.api.upload({ filename: 'example.png', contentType: 'image/png', dataBase64: 'test-bytes' }); });
    await waitFor(() => expect(result.current.library.query.data).toHaveLength(1));
    expect(reads).toBe(1);
    act(() => result.current.providers.reload());
    await waitFor(() => expect(reads).toBe(2));
    await waitFor(() => expect(result.current.providers.reloadDisabled).toBe(false));
  });
});
