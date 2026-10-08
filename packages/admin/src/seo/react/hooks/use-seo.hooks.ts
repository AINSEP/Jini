import { useEffect, useRef } from 'react';
import { useController } from '../../../core/react/use-controller.js';
import { createSeoController } from '../../controllers/seo.controller.js';
import { initialSeoState } from '../../models.js';
import type { SeoController, SeoTranslator } from '../../models.js';
import type { AdminSeoPort, SeoEventsPort } from '../../ports.js';
import { useSeoOptions, useSeoPorts } from './SeoPorts.hooks.js';
export type { SeoController } from '../../models.js';
export function useSeo({ api }: { api: AdminSeoPort }, { t, events }: { t?: SeoTranslator | undefined; events?: SeoEventsPort | undefined } = {}): SeoController {
  const translator = useRef(t);
  translator.current = t;
  const { controller, snapshot } = useController({ create: () => createSeoController({ api }, { t: (key, vars) => translator.current?.(key, vars) ?? key }), dependencies: [api] }, { start: ({ controller }) => { void controller.load({}); } });
  useEffect(() => {
    if (!controller || !events) return;
    return events.subscribe({ onRefresh: () => { void controller.load({}); } });
  }, [controller, events]);
  return {
    ...(snapshot ?? initialSeoState), locale: 'en',
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
