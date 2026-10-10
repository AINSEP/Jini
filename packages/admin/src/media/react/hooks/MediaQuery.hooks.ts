import { useCallback, useMemo, useRef } from 'react';
import { useCachedLoader, useFetchMutation, useFetchQuery } from '@jini-ai/ui/fetch-query';
import type { MediaApiPort, MediaProvidersPort } from '../../ports.js';
export const MEDIA_QUERY_KEYS = { root: ['media'] as const, library: ['media', 'library'] as const, providers: ['media-providers'] as const };

/** Full-library cache stays separate from the controller's local filtering/counts. Writes
 * invalidate all mounted views, while controller locks retain the accepted-write ordering. */
export function useMediaLibraryQuery({ api }: { api: MediaApiPort }, { enabled = true }: { enabled?: boolean } = {}) {
  const fetch = useCallback(() => api.list({}), [api]);
  const query = useFetchQuery({ key: MEDIA_QUERY_KEYS.library, fetch }, { enabled });
  const loader = useCachedLoader({ key: MEDIA_QUERY_KEYS.library, fetch }, { staleTime: 0 });
  const uploadMutation = useFetchMutation({ run: ({ input }: { input: Parameters<MediaApiPort['upload']> }) => api.upload(...input) }, { invalidates: [MEDIA_QUERY_KEYS.root] });
  const trashMutation = useFetchMutation({ run: ({ input }: { input: Parameters<MediaApiPort['trash']> }) => api.trash(...input) }, { invalidates: [MEDIA_QUERY_KEYS.root] });
  const deleteMutation = useFetchMutation({ run: ({ input }: { input: Parameters<MediaApiPort['delete']> }) => api.delete(...input) }, { invalidates: [MEDIA_QUERY_KEYS.root] });
  const updateMutation = useFetchMutation({ run: ({ input }: { input: Parameters<MediaApiPort['update']> }) => api.update(...input) }, { invalidates: [MEDIA_QUERY_KEYS.root] });
  const restoreMutation = useFetchMutation({ run: ({ input }: { input: Parameters<NonNullable<MediaApiPort['restore']>> }) => api.restore!(...input) }, { invalidates: [MEDIA_QUERY_KEYS.root] });
  const replaceMutation = useFetchMutation({ run: ({ input }: { input: Parameters<NonNullable<MediaApiPort['replace']>> }) => api.replace!(...input) }, { invalidates: [MEDIA_QUERY_KEYS.root] });
  const current = useRef({ loader, uploadMutation, trashMutation, deleteMutation, updateMutation, restoreMutation, replaceMutation });
  current.current = { loader, uploadMutation, trashMutation, deleteMutation, updateMutation, restoreMutation, replaceMutation };
  const cachedApi = useMemo<MediaApiPort>(() => ({ ...api, list: () => current.current.loader.load(),
    upload: (...input) => current.current.uploadMutation.mutate({ input }),
    trash: (...input) => current.current.trashMutation.mutate({ input }),
    delete: (...input) => current.current.deleteMutation.mutate({ input }),
    update: (...input) => current.current.updateMutation.mutate({ input }),
    ...(api.restore ? { restore: (...input: Parameters<NonNullable<MediaApiPort['restore']>>) => current.current.restoreMutation.mutate({ input }) } : {}),
    ...(api.replace ? { replace: (...input: Parameters<NonNullable<MediaApiPort['replace']>>) => current.current.replaceMutation.mutate({ input }) } : {}),
  }), [api]);
  return { api: cachedApi, query };
}

/** null is an unavailable service, never a successful empty catalogue. The shared cache
 * stores only public credential markers returned by the host, never the submitted key text. */
export function useMediaProvidersQuery({ port }: { port: MediaProvidersPort | undefined }, { enabled = true }: { enabled?: boolean } = {}) {
  const fetch = useCallback(async () => {
    const items = await port?.list({});
    if (!items) throw new Error('Provider service unavailable');
    return items;
  }, [port]);
  const query = useFetchQuery({ key: MEDIA_QUERY_KEYS.providers, fetch }, { enabled: enabled && !!port });
  const loader = useCachedLoader({ key: MEDIA_QUERY_KEYS.providers, fetch }, { staleTime: 0 });
  return { query, loader };
}
