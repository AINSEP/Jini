import { describeSeoError } from '../../models.js';
import { useFetchQuery } from '@jini-ai/ui/fetch-query';
import { SEO_KEYS } from './SeoQuery.hooks.js';
import { initialEntryPickerState } from '../../models.js';
import type { EntryPickerController, SeoTranslator, SeoErrorFormatter } from '../../models.js';
import type { AdminSeoPort } from '../../ports.js';
import { useSeoOptions, useSeoPorts } from './SeoPorts.hooks.js';
export type { EntryPickerController } from '../../models.js';
export function useEntryPicker({ api }: { api: AdminSeoPort }, { t, describeError }: { t?: SeoTranslator | undefined; describeError?: SeoErrorFormatter | undefined } = {}): EntryPickerController {
  const query = useFetchQuery({ key: SEO_KEYS.choices, fetch: async () => {
    const [posts, pages] = await Promise.all([api.listSeoPosts({}), api.listSeoPages({})]);
    return [...posts, ...pages];
  } });
  return { ...initialEntryPickerState, entries: query.data ?? null, error: query.error ? (describeError ?? describeSeoError)({ error: query.error, fallback: t?.('failed to load entries') ?? 'failed to load entries' }) : null };
}
export function useWiredEntryPicker(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): EntryPickerController {
  const { seoApi: api } = useSeoPorts();
  const { t, describeError } = useSeoOptions();
  return useEntryPicker({ api }, { t, describeError });
}
