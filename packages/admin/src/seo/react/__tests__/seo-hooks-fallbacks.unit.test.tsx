import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchQueryProvider } from '@jini-ai/ui/fetch-query';
import { AdminConfigError } from '../../../core/module/index.js';
import { createMemorySeoApi } from '../../adapters/memory.js';
import type { AdminSeoPort } from '../../ports.js';
import { sitemapStateLabel, useSeoPorts } from '../index.js';
import { useSeo } from '../hooks/use-seo.hooks.js';
import { useSeoEntryPanel } from '../hooks/use-seo-entry-panel.hooks.js';
import { useEntryPicker } from '../hooks/use-entry-picker.hooks.js';

afterEach(cleanup);

const meta = { title: 'Seed title', canonical: 'https://example.test/entry', robots: { noindex: false, nofollow: false }, openGraph: { title: 'Seed title', type: 'website' as const, url: 'https://example.test/entry' }, twitter: { title: 'Seed title', card: 'summary' as const }, jsonLd: [] };
const entries = { e1: { meta, analysis: { entryId: 'e1', score: 100, issues: [], resolved: meta } } };
const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;

describe('useSeo', () => {
  it('uses the host translator for its notices', async () => {
    const api = createMemorySeoApi({});
    const { result } = renderHook(() => useSeo({ api }, { t: key => `fr:${key}` }), { wrapper });
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    await act(async () => { await result.current.regenerateSitemap(); });
    expect(result.current.notice).toBe('fr:Sitemap regeneration accepted.');
  });

  it('falls back to the untranslated key without a host translator', async () => {
    const api = createMemorySeoApi({});
    const { result } = renderHook(() => useSeo({ api }), { wrapper });
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    await act(async () => { await result.current.regenerateSitemap(); });
    expect(result.current.notice).toBe('Sitemap regeneration accepted.');
  });

  it('reports a regeneration requested before the controller mounts as not accepted', async () => {
    const api = createMemorySeoApi({});
    const regenerate = vi.spyOn(api, 'regenerateSeoSitemap');
    let first: ReturnType<typeof useSeo> | undefined;
    renderHook(() => { const state = useSeo({ api }); first ??= state; return state; }, { wrapper });
    await expect(first!.regenerateSitemap()).resolves.toBe(false);
    expect(regenerate).not.toHaveBeenCalled();
  });
});

describe('useSeoEntryPanel', () => {
  it('saves with the untranslated notice and formats failures with the shared describer', async () => {
    const api = createMemorySeoApi({ entries });
    const { result } = renderHook(() => useSeoEntryPanel({ api, entryId: 'e1' }), { wrapper });
    await waitFor(() => expect(result.current.resolved).not.toBeNull());
    act(() => result.current.setField('title', 'Edited'));
    await act(async () => { await result.current.save(); });
    expect(result.current.notice).toBe('Saved.');
    api.putSeoEntry = () => Promise.reject(new Error('write refused'));
    act(() => result.current.setField('title', 'Again'));
    await act(async () => { await result.current.save(); });
    expect(result.current.saveError).toBe('write refused');
  });

  it('translates its save notice with the host translator', async () => {
    const api = createMemorySeoApi({ entries });
    const { result } = renderHook(() => useSeoEntryPanel({ api, entryId: 'e1' }, { t: key => `fr:${key}` }), { wrapper });
    await waitFor(() => expect(result.current.resolved).not.toBeNull());
    act(() => result.current.setField('title', 'Edited'));
    await act(async () => { await result.current.save(); });
    expect(result.current.notice).toBe('fr:Saved.');
  });

  it('formats a save failure through the host describer when one is supplied', async () => {
    const api: AdminSeoPort = { ...createMemorySeoApi({ entries }), putSeoEntry: () => Promise.reject(new Error('raw')) };
    const describeError = ({ fallback }: { error: unknown; fallback: string }) => `host:${fallback}`;
    const { result } = renderHook(() => useSeoEntryPanel({ api, entryId: 'e1' }, { describeError }), { wrapper });
    await waitFor(() => expect(result.current.resolved).not.toBeNull());
    act(() => result.current.setField('title', 'Edited'));
    await act(async () => { await result.current.save(); });
    expect(result.current.saveError).toBe('host:failed to save SEO overrides');
  });

  it('accepts edits typed before the entry has loaded, and reads values pre-mount from the resolved fallback', async () => {
    const api: AdminSeoPort = { ...createMemorySeoApi({ entries }), getSeoEntry: () => new Promise(() => undefined) };
    let first: ReturnType<typeof useSeoEntryPanel> | undefined;
    const { result } = renderHook(() => { const state = useSeoEntryPanel({ api, entryId: 'e1' }); first ??= state; return state; }, { wrapper });
    expect(first!.fieldValue('title', 'Resolved title')).toBe('Resolved title');
    await act(async () => undefined);
    act(() => result.current.setField('ogImage', 'img1:hero.png'));
    expect(result.current.touched).toEqual({ ogImage: 'img1:hero.png' });
    expect(result.current.resolved).toBeNull();
  });
});

describe('useEntryPicker', () => {
  it('offers the untranslated fallback copy to the describer when no translator is given', async () => {
    const api: AdminSeoPort = { ...createMemorySeoApi({}), listSeoPosts: () => Promise.reject('down') };
    // A host describer that shows the fallback makes the fallback copy itself observable.
    const { result } = renderHook(() => useEntryPicker({ api }, { describeError: ({ fallback }) => fallback }), { wrapper });
    await waitFor(() => expect(result.current.error).toBe('failed to load entries'));
    expect(result.current.entries).toBeNull();
  });

  it('shows the failure message itself with the default describer', async () => {
    const api: AdminSeoPort = { ...createMemorySeoApi({}), listSeoPages: () => Promise.reject(new Error('pages offline')) };
    const { result } = renderHook(() => useEntryPicker({ api }), { wrapper });
    await waitFor(() => expect(result.current.error).toBe('pages offline'));
  });

  it('translates the load-failure fallback with the host translator', async () => {
    const api: AdminSeoPort = { ...createMemorySeoApi({}), listSeoPosts: () => Promise.reject('down') };
    const { result } = renderHook(() => useEntryPicker({ api }, { t: key => `fr:${key}`, describeError: ({ fallback }) => fallback }), { wrapper });
    await waitFor(() => expect(result.current.error).toBe('fr:failed to load entries'));
  });
});

describe('seo React exports', () => {
  it('refuses to resolve ports outside a seo scope', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useSeoPorts())).toThrow(AdminConfigError);
    error.mockRestore();
  });

  it('labels the sitemap state with untranslated copy by default', () => {
    expect(sitemapStateLabel({ sitemapEnabled: false })).toBe('This site does not publish a sitemap. Turn it on under Site defaults.');
    expect(sitemapStateLabel({ sitemapEnabled: true })).toBe('This site publishes a sitemap.');
  });
});
