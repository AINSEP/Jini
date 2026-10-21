import { Suspense, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchQueryProvider } from '@jini-ai/ui/fetch-query';
import { createAdmin } from '../../../core/module/index.js';
import type { MediaPickerPort } from '../../../contracts/media-picker.js';
import { createMemorySeoApi } from '../../adapters/memory.js';
import type { AdminSeoPort, SeoEventsPort } from '../../ports.js';
import { seoModule } from '../../seo.module.js';
import { seo } from '../index.js';
import { SeoOptionsContext, SeoPortsContext, useSeoOptions } from '../hooks/SeoPorts.hooks.js';
import { useMediaPickerBridge } from '../hooks/MediaPickerBridge.hooks.js';
import { MediaPickerBridge } from '../components/MediaPickerBridge.js';
import { useWiredSeo } from '../hooks/use-seo.hooks.js';
import type { SeoMediaPickerSlotProps } from '../options.js';

afterEach(cleanup);

/** The lazy SEO page module is large; its first dynamic import can outlast the default wait. */
const LAZY = { timeout: 15000 };

function mountSeo({ api, events, onTabChange, tab, requestedTab }: { api: AdminSeoPort; events?: SeoEventsPort; onTabChange?: (required: { tab: string }) => void; tab?: 'defaults' | 'sitemap' | 'entries'; requestedTab?: string }) {
  const feature = seo({ siteUrl: () => 'https://site.test' });
  // Ports are scoped by the shared `seoModule` identity (the factory returns a copy).
  const admin = createAdmin({ modules: [seoModule], ports: { seoApi: api, ...(events ? { seoEvents: events } : {}) } }, { permissions: ['admin.seo.manage'] });
  const { Page, tabs } = feature.react.pages.settings;
  const Tab = tab ? tabs[tab] : null;
  return render(
    <FetchQueryProvider>
      <feature.react.Provider admin={admin}>
        <Suspense fallback="loading">
          {Tab ? <Tab params={{}} /> : <Page tabs={tabs} description={admin.describe().pages[0]!} {...(onTabChange ? { onTabChange } : {})} {...(requestedTab ? { requestedTab } : {})} />}
        </Suspense>
      </feature.react.Provider>
    </FetchQueryProvider>,
  );
}

describe('seo module binding', { timeout: 30000 }, () => {
  it('reports tab switches to the host', async () => {
    const onTabChange = vi.fn();
    mountSeo({ api: createMemorySeoApi({}), onTabChange });
    fireEvent.click(await screen.findByRole('tab', { name: 'Sitemap' }, LAZY));
    expect(onTabChange).toHaveBeenCalledWith({ tab: 'sitemap' });
  });

  it('mounts the standalone defaults tab once settings load', async () => {
    mountSeo({ api: createMemorySeoApi({}), tab: 'defaults' });
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(await screen.findByLabelText(/Title template/, {}, LAZY)).toBeInTheDocument();
  });

  it('shows the standalone tab load error when settings cannot be read', async () => {
    const api: AdminSeoPort = { ...createMemorySeoApi({}), getSeoSettings: () => Promise.reject(new Error('settings offline')) };
    mountSeo({ api, tab: 'sitemap' });
    expect(await screen.findByText('settings offline', {}, LAZY)).toBeInTheDocument();
  });

  it('opens the shell sitemap modal from the sitemap tab and closes it on dismiss', async () => {
    mountSeo({ api: createMemorySeoApi({ sitemapText: '<urlset></urlset>' }), requestedTab: 'sitemap' });
    fireEvent.click(await screen.findByRole('button', { name: 'View sitemap' }, LAZY));
    const dialog = await screen.findByRole('dialog');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('mounts the standalone entries tab', async () => {
    mountSeo({ api: createMemorySeoApi({}), tab: 'entries' });
    expect(await screen.findByText('Per-entry SEO', {}, LAZY)).toBeInTheDocument();
  });
});

function scope({ ports, children }: { ports: { seoApi: AdminSeoPort; seoEvents?: SeoEventsPort; mediaPicker?: MediaPickerPort }; children: ReactNode }) {
  return (
    <FetchQueryProvider>
      <SeoPortsContext.Provider value={ports}>
        <SeoOptionsContext.Provider value={{ siteUrl: () => '' }}>{children}</SeoOptionsContext.Provider>
      </SeoPortsContext.Provider>
    </FetchQueryProvider>
  );
}

describe('seo wired hooks', () => {
  it('refetches settings when the host events port signals a refresh', async () => {
    const api = createMemorySeoApi({});
    const read = vi.spyOn(api, 'getSeoSettings');
    let refresh: () => void = () => undefined;
    const events: SeoEventsPort = { subscribe: ({ onRefresh }) => { refresh = onRefresh; return () => undefined; } };
    const { result } = renderHook(() => useWiredSeo(), { wrapper: ({ children }) => scope({ ports: { seoApi: api, seoEvents: events }, children }) });
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    const before = read.mock.calls.length;
    act(() => refresh());
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before));
  });

  it('refuses to read options outside a configured scope', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useSeoOptions())).toThrow('React options unavailable: seo (siteUrl is required)');
    error.mockRestore();
  });
});

function slotProps(): SeoMediaPickerSlotProps & { onSelect: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn> } {
  return { onSelect: vi.fn(), onCancel: vi.fn() };
}

describe('media picker bridge', () => {
  it('reports an unavailable picker and lets the operator cancel', () => {
    const props = slotProps();
    render(scope({ ports: { seoApi: createMemorySeoApi({}) }, children: <MediaPickerBridge {...props} /> }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Media picker unavailable');
    fireEvent.click(within(alert).getByRole('button', { name: 'Cancel' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('asks the shared picker for images by default and forwards the chosen item', async () => {
    const item = { id: 'm1', title: 'Hero', contentType: 'image/png' };
    const pick = vi.fn(async () => item);
    const props = slotProps();
    renderHook(() => useMediaPickerBridge(props), { wrapper: ({ children }) => scope({ ports: { seoApi: createMemorySeoApi({}), mediaPicker: { pick } as MediaPickerPort }, children }) });
    await waitFor(() => expect(props.onSelect).toHaveBeenCalledWith(item));
    expect(pick).toHaveBeenCalledWith({ accept: ['image/*'] }, { signal: expect.any(AbortSignal) });
  });

  it('treats a dismissed picker as a cancel and honours a caller accept list', async () => {
    const pick = vi.fn(async () => null);
    const props = { ...slotProps(), accept: ['image/png'] };
    renderHook(() => useMediaPickerBridge(props), { wrapper: ({ children }) => scope({ ports: { seoApi: createMemorySeoApi({}), mediaPicker: { pick } }, children }) });
    await waitFor(() => expect(props.onCancel).toHaveBeenCalledTimes(1));
    expect(pick).toHaveBeenCalledWith({ accept: ['image/png'] }, { signal: expect.any(AbortSignal) });
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('surfaces a picker failure message, or a generic one for non-Error failures', async () => {
    for (const [failure, message] of [[new Error('library offline'), 'library offline'], ['nope', 'Media picker unavailable']] as const) {
      const props = slotProps();
      const { result, unmount } = renderHook(() => useMediaPickerBridge(props), { wrapper: ({ children }) => scope({ ports: { seoApi: createMemorySeoApi({}), mediaPicker: { pick: () => Promise.reject(failure) } }, children }) });
      await waitFor(() => expect(result.current.error).toBe(message));
      unmount();
    }
  });

  it('ignores a pick that settles after the bridge unmounted', async () => {
    let settle!: (value: null) => void;
    let fail!: (error: Error) => void;
    const props = slotProps();
    const first = renderHook(() => useMediaPickerBridge(props), { wrapper: ({ children }) => scope({ ports: { seoApi: createMemorySeoApi({}), mediaPicker: { pick: () => new Promise(resolve => { settle = resolve; }) } }, children }) });
    first.unmount();
    await act(async () => { settle(null); });
    const second = renderHook(() => useMediaPickerBridge(props), { wrapper: ({ children }) => scope({ ports: { seoApi: createMemorySeoApi({}), mediaPicker: { pick: () => new Promise((_, reject) => { fail = reject; }) } }, children }) });
    const { result } = second;
    second.unmount();
    await act(async () => { fail(new Error('late')); });
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });
});
