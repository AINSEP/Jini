import { useEffect, useRef } from 'react';
import { useInvalidate } from '@jini-ai/ui/fetch-query';
import { SEO_KEYS, useSeoSettingsQuery } from './SeoQuery.hooks.js';
import { useController } from '../../../core/react/use-controller.js';
import { createSeoController } from '../../controllers/seo.controller.js';
import { initialSeoState } from '../../models.js';
import type { SeoController, SeoTranslator } from '../../models.js';
import type { AdminSeoPort, SeoEventsPort } from '../../ports.js';
import { useSeoOptions, useSeoPorts } from './SeoPorts.hooks.js';
export type { SeoController } from '../../models.js';
export function useSeo({ api }: { api: AdminSeoPort }, { t, events }: { t?: SeoTranslator | undefined; events?: SeoEventsPort | undefined } = {}): SeoController {
  const cached = useSeoSettingsQuery({ api }, { ...(t ? { t } : {}) });
  const invalidate = useInvalidate();
  const translator = useRef(t);
  translator.current = t;
  const { controller, snapshot } = useController({ create: () => createSeoController({ api: cached.api }, { t: (key, vars) => translator.current?.(key, vars) ?? key }), dependencies: [cached.api] }, {
    // Uncontrolled form fields must first mount with this open's fresh settings. The loader
    // joins the query's mount read; retained data would permanently fill defaultValue too early.
    start: ({ controller }) => { void controller.load({}); },
  });
  useEffect(() => {
    if (!controller || !cached.query.data) return;
    const state = controller.getSnapshot();
    if (!state.settings) return;
    // Shared revalidation updates server truth while an unsaved image choice stays local.
    const imageUntouched = state.defaultOgImage === (state.settings?.defaultOgImage ?? '');
    controller.set({ patch: { settings: cached.query.data, ...(imageUntouched ? { defaultOgImage: cached.query.data.defaultOgImage ?? '' } : {}) } });
  }, [controller, cached.query.data]);
  useEffect(() => {
    if (!controller || !events) return;
    return events.subscribe({ onRefresh: () => { invalidate({ key: SEO_KEYS.settings }); } });
  }, [controller, events, invalidate]);
  return {
    ...(snapshot ?? initialSeoState), error: cached.query.error?.message ?? snapshot?.error ?? null, locale: 'en',
    save: async patch => { await controller?.save({ patch }); },
    setDefaultOgImage: value => controller?.setDefaultOgImage({ value }),
    regenerateSitemap: async () => await controller?.regenerateSitemap({}) ?? false,
    openSitemapModal: () => controller?.openSitemapModal({}),
    closeSitemapModal: () => controller?.closeSitemapModal({}),
  };
}
export function useWiredSeo(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): SeoController {
  const { seoApi: api, seoEvents: events } = useSeoPorts();
  const { t } = useSeoOptions();
  return useSeo({ api }, { t, events });
}
