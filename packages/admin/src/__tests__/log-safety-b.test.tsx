// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from './fetch-query-support.js';
import { AdminApiError } from '@jini-ai/core/admin-runtime';
import { createHttpTransport } from '../core/transport/http.js';
import { createMemoryMediaApi } from '../media/adapters/memory.js';
import { createLibraryController } from '../media/controllers/library.controller.js';
import { createEditMediaController } from '../media/controllers/edit-media.controller.js';
import { createMemorySeoApi } from '../seo/adapters/memory.js';
import { createSitemapController } from '../seo/controllers/sitemap.controller.js';
import { createMemoryWidgetsApi } from '../widgets/adapters/memory.js';
import { useWidgetsLibrary } from '../widgets/react/hooks/use-widgets-library.hooks.js';
import { useWidgetRegions } from '../widgets/react/hooks/use-widget-regions.hooks.js';
import { useWidgetsListQuery, useWidgetRegionsQuery } from '../widgets/react/hooks/WidgetsQuery.hooks.js';
import { useSitemapModal } from '../seo/react/hooks/use-sitemap-modal.hooks.js';
import { useSitemapQuery } from '../seo/react/hooks/SeoQuery.hooks.js';

const secret = 'SENTINEL_PRIVATE_B';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('sheet B safe error surfaces', () => {
  it.each([['network', new TypeError(secret), 'API_UNREACHABLE', 'TypeError'], ['timeout', new DOMException(secret, 'TimeoutError'), 'REQUEST_TIMEOUT', 'TimeoutError']] as const)(
    'classifies synthetic %s bodies while preserving transport status and code', async (_kind, cause, code, label) => {
      const transport = createHttpTransport({ baseUrl: '/api', fetch: () => Promise.reject(cause) });
      const failure = await transport.request({ path: '/media' }).catch(error => error);
      expect(failure).toBeInstanceOf(AdminApiError);
      expect(failure).toMatchObject({ status: 0, code, body: { cause: label } });
      expect(JSON.stringify(failure)).not.toContain(secret);
    },
  );

  it('preserves parsed server envelopes, cancellation and adapter errors', async () => {
    const body = { error: 'Server-approved refusal', code: 'FORBIDDEN', detail: 'allowed envelope' };
    const transport = createHttpTransport({ baseUrl: '/api', fetch: async () => new Response(JSON.stringify(body), { status: 403 }) });
    await expect(transport.request({ path: '/media' })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: body.error, body });
    for (const cause of [new DOMException(secret, 'AbortError'), new RangeError(secret)]) {
      const failing = createHttpTransport({ baseUrl: '/api', fetch: () => Promise.reject(cause) });
      await expect(failing.request({ path: '/media' })).rejects.toBe(cause);
    }
  });

  it('keeps read, cache-settle and write fallbacks while emitting class-only diagnostics', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const memory = createMemoryMediaApi({});
    const controller = createLibraryController({ api: { ...memory, list: () => Promise.reject(new Error(secret)), trash: () => Promise.reject(new Error(secret)) } });
    await controller.load();
    expect(controller.getSnapshot().error).toBe('Failed to load media');
    controller.settleLibrary({ error: new Error(secret) });
    expect(controller.getSnapshot().error).toBe('Failed to load media');
    expect(await controller.trash({ id: 'media' })).toBe(false);
    expect(controller.getSnapshot().error).toBe('Media write failed');
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls.flat().join(' ')).not.toContain(secret);
    expect(warn.mock.calls.flat().join(' ')).toContain('Error');
    controller.dispose();
  });

  it('sanitizes metadata writes and sitemap reads, preserving typed API copy', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = createMemoryMediaApi({});
    const item = await api.upload({ filename: 'image.png', contentType: 'image/png', dataBase64: 'bytes' });
    const edit = createEditMediaController({ api: { ...api, update: () => Promise.reject(new Error(secret)) }, item });
    edit.setDraft({ patch: { title: 'Changed' } });
    expect(await edit.save()).toBe(false);
    expect(edit.getSnapshot().error).toBe('Failed to save media metadata');
    let failure: unknown = new Error(secret);
    const sitemap = createSitemapController({ enabled: true, api: { ...createMemorySeoApi({}), fetchSitemapXml: () => Promise.reject(failure) } });
    await sitemap.load();
    expect(sitemap.getSnapshot()).toMatchObject({ status: 'error', error: 'failed to load the sitemap' });
    failure = new AdminApiError({ message: 'Sitemap is temporarily unavailable', status: 503 });
    await sitemap.load();
    expect(sitemap.getSnapshot().error).toBe('Sitemap is temporarily unavailable');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.flat().join(' ')).not.toContain(secret);
    edit.dispose(); sitemap.dispose();
  });

  it('sanitizes query-only widget failures and preserves controller error precedence', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = createMemoryWidgetsApi({});
    const useQuery: typeof useWidgetsListQuery = input => {
      const cached = useWidgetsListQuery(input);
      return { ...cached, query: { ...cached.query, error: new Error(secret) } };
    };
    const { result } = renderHook(() => useWidgetsLibrary({ api }, { useQuery }));
    await waitFor(() => expect(result.current.widgets).toEqual([]));
    expect(result.current.error).toBe('failed to load widgets');
    const useRegions: typeof useWidgetRegionsQuery = input => {
      const cached = useWidgetRegionsQuery(input);
      return { ...cached, query: { ...cached.query, error: new AdminApiError({ message: 'Query unavailable', status: 503 }) } };
    };
    const regionApi = { ...api, bindWidgetRegion: () => Promise.reject(new AdminApiError({ message: 'Controller refused binding', status: 409 })) };
    const regions = renderHook(() => useWidgetRegions({ api: regionApi }, { useQuery: useRegions }));
    await waitFor(() => expect(regions.result.current.regions).toEqual([]));
    act(() => regions.result.current.setNewRegionKey('header'));
    await act(async () => regions.result.current.bind());
    expect(regions.result.current.error).toBe('Controller refused binding');
    expect(warn.mock.calls.length).toBeGreaterThan(0);
    expect(warn.mock.calls.flat().join(' ')).not.toContain(secret);
  });

  it('keeps null query errors empty and sanitizes query-only sitemap failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = createMemorySeoApi({});
    let error: Error | null = null;
    const useQuery: typeof useSitemapQuery = input => {
      const cached = useSitemapQuery(input);
      return { ...cached, query: { ...cached.query, error } };
    };
    const { result, rerender } = renderHook(() => useSitemapModal({ api, enabled: true }, { useQuery }));
    expect(result.current.error).toBeNull();
    error = new Error(secret); rerender();
    expect(result.current).toMatchObject({ error: 'failed to load the sitemap', status: 'error' });
    expect(warn.mock.calls.flat().join(' ')).not.toContain(secret);
  });
});
