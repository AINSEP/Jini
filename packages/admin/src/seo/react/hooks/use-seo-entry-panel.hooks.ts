import { describeSeoError } from '../../models.js';
import { useEffect, useRef } from 'react';
import { useSeoEntryQuery, SEO_KEYS } from './SeoQuery.hooks.js';
import { useFetchQuery } from '@jini-ai/ui/fetch-query';
import { useController } from '../../../core/react/use-controller.js';
import { createSeoEntryController } from '../../controllers/seo-entry.controller.js';
import { initialSeoEntryState } from '../../models.js';
import { inheritedXFor, ogImageInherited } from '../../rules.js';
import type { SeoEntryPanelController, SeoTranslator, SeoErrorFormatter } from '../../models.js';
import type { AdminSeoPort } from '../../ports.js';
import { useSeoOptions, useSeoPorts } from './SeoPorts.hooks.js';
export type { SeoEntryPanelController, SeoEntryPanelOptions } from '../../models.js';
export function useSeoEntryPanel({ api, entryId }: { api: AdminSeoPort; entryId: string }, { t, describeError }: { t?: SeoTranslator | undefined; describeError?: SeoErrorFormatter | undefined } = {}): SeoEntryPanelController {
  const cached = useSeoEntryQuery({ api, entryId });
  const translator = useRef(t);
  translator.current = t;
  const formatter = useRef(describeError);
  formatter.current = describeError;
  const { controller, snapshot } = useController({ create: () => createSeoEntryController({ api: cached.api, entryId }, { t: (key, vars) => translator.current?.(key, vars) ?? key, describeError: required => formatter.current ? formatter.current(required) : describeSeoError(required) }), dependencies: [cached.api, entryId] }, { start: ({ controller }) => { void controller.load({}); } });
  useEffect(() => {
    // Revalidation updates server truth without discarding touched override fields.
    if (controller && cached.query.data) controller.set({ patch: cached.query.data });
  }, [controller, cached.query.data]);
  // The site defaults read the Site defaults tab already caches; only the default image is used here.
  const settings = useFetchQuery({ key: SEO_KEYS.settings, fetch: () => api.getSeoSettings({}) });
  const state = snapshot ?? initialSeoEntryState;
  return {
    ...state,
    ogImageInherited: state.resolved ? ogImageInherited({ meta: state.resolved, defaultOgImage: settings.data?.defaultOgImage, touched: state.touched }) : false,
    fieldValue: (key, resolvedValue) => controller ? controller.fieldValue({ key, resolvedValue }) : resolvedValue,
    setField: (key, value) => {
      // An edit to the social preview also clears an X field that was following it (rules.ts).
      const xKey = state.resolved ? inheritedXFor({ key, meta: state.resolved, touched: state.touched }) : null;
      controller?.setField({ key, value });
      if (xKey) controller?.setField({ key: xKey, value: '' });
    },
    save: async () => { await controller?.save({}); },
  };
}
export function useWiredSeoEntryPanel({ entryId }: { entryId: string }, _optional: Record<string, never> = {}): SeoEntryPanelController {
  const { seoApi: api } = useSeoPorts();
  const { t, describeError } = useSeoOptions();
  return useSeoEntryPanel({ api, entryId }, { t, describeError });
}
