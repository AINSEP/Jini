import { useCallback, useMemo, useRef } from 'react';
import { useCachedLoader, useFetchMutation, useFetchQuery } from '@jini-ai/ui/fetch-query';
import { describeSeoError, type SeoTranslator } from '../../models.js';
import type { AdminSeoPort } from '../../ports.js';

export const SEO_KEYS = {
  settings: ['seo', 'settings'] as const,
  entries: ['seo', 'entry'] as const,
  entry: ({ entryId }: { entryId: string }, _optional: Record<string, never> = {}) => ['seo', 'entry', entryId] as const,
  choices: ['seo', 'choices'] as const,
  sitemap: ['seo', 'sitemap'] as const,
  media: ['seo', 'media'] as const,
};

/** Controllers keep their draft/error contracts; these injected ports share the provider cache.
 * Reads omit a controller's abort signal because another mounted consumer can own the same read.
 * Controller generations/disposal still prevent that consumer from settling an obsolete screen. */
export function useSeoSettingsQuery({ api }: { api: AdminSeoPort }, { t = key => key }: { t?: SeoTranslator } = {}) {
  const translator = useRef(t); translator.current = t;
  const fetch = useCallback(async () => {
    try { return await api.getSeoSettings({}); }
    catch (error) { throw new Error(describeSeoError({ error, fallback: translator.current('failed to load SEO settings') })); }
  }, [api]);
  const query = useFetchQuery({ key: SEO_KEYS.settings, fetch }, { staleTime: 0 });
  const loader = useCachedLoader({ key: SEO_KEYS.settings, fetch }, { staleTime: 0 });
  const save = useFetchMutation({ run: ({ input }: { input: Parameters<AdminSeoPort['putSeoSettings']> }) => api.putSeoSettings(...input) }, { invalidates: [SEO_KEYS.settings, SEO_KEYS.entries] });
  const regenerate = useFetchMutation({ run: ({ input }: { input: Parameters<AdminSeoPort['regenerateSeoSitemap']> }) => api.regenerateSeoSitemap(...input) }, { invalidates: [SEO_KEYS.sitemap] });
  const current = useRef({ loader, save, regenerate }); current.current = { loader, save, regenerate };
  const cachedApi = useMemo<AdminSeoPort>(() => ({ ...api,
    getSeoSettings: () => current.current.loader.load(),
    putSeoSettings: (...input) => current.current.save.mutate({ input }),
    regenerateSeoSitemap: (...input) => current.current.regenerate.mutate({ input }),
  }), [api]);
  return { api: cachedApi, query };
}

export function useSeoEntryQuery({ api, entryId }: { api: AdminSeoPort; entryId: string }, _optional: Record<string, never> = {}) {
  const key = useMemo(() => SEO_KEYS.entry({ entryId }), [entryId]);
  const fetch = useCallback(async () => {
    const [resolved, analysis] = await Promise.all([api.getSeoEntry({ entryId }), api.analyzeSeoEntry({ entryId })]);
    return { resolved, analysis };
  }, [api, entryId]);
  const query = useFetchQuery({ key, fetch }, { enabled: !!entryId, staleTime: 0 });
  const loader = useCachedLoader({ key, fetch }, { staleTime: 0 });
  const save = useFetchMutation({ run: ({ input }: { input: Parameters<AdminSeoPort['putSeoEntry']> }) => api.putSeoEntry(...input) }, { invalidates: [SEO_KEYS.entries] });
  const current = useRef({ loader, save }); current.current = { loader, save };
  const cachedApi = useMemo<AdminSeoPort>(() => ({ ...api,
    getSeoEntry: async () => (await current.current.loader.load()).resolved,
    analyzeSeoEntry: async () => (await current.current.loader.load()).analysis,
    putSeoEntry: (...input) => current.current.save.mutate({ input }),
  }), [api, entryId]);
  return { api: cachedApi, query };
}

export function useSitemapQuery({ api, enabled }: { api: AdminSeoPort; enabled: boolean }, _optional: Record<string, never> = {}) {
  const fetch = useCallback(() => api.fetchSitemapXml({}), [api]);
  const query = useFetchQuery({ key: SEO_KEYS.sitemap, fetch }, { enabled });
  const loader = useCachedLoader({ key: SEO_KEYS.sitemap, fetch });
  const current = useRef(loader); current.current = loader;
  const cachedApi = useMemo<AdminSeoPort>(() => ({ ...api, fetchSitemapXml: () => current.current.load() }), [api]);
  return { api: cachedApi, query };
}
