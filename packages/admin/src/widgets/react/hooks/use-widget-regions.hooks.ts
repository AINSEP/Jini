import type { AdminWidget, AdminWidgetType, AdminWidgetWhereUsed, AdminWidgetRegionBinding, AdminWidgetArea, AdminWidgetPlacement, WidgetsTranslate as Translate } from '../../models.js';
import type { DirtyGuard } from '@jini-ai/ui/panel-kit';
export interface WidgetRegionsController {
  /** `null` until the initial load settles — the caller renders a loading state. */
  regions: AdminWidgetRegionBinding[] | null;
  error: string | null;
  newRegionKey: string;
  setNewRegionKey: (value: string) => void;
  binding: boolean;
  bind: () => Promise<void>;
  /** Bound translator — `WidgetRegions.tsx`'s only source of UI copy; see this file's own header. */
  t: Translate;
}
import { useEffect, useRef } from 'react';
import { useController } from '../../../core/react/use-controller.js';
import { createWidgetRegionsController } from '../../controllers/regions.controller.js';
import type { AdminWidgetsPort, WidgetsEventsPort } from '../../ports.js';
import { widgetsEnglish } from '../../messages.en.js';
import { WIDGETS_REGIONS_RESOURCE } from '../../rules.js';
import { useWidgetsPorts, useWidgetsOptions } from './WidgetsPorts.hooks.js';
export function useWidgetRegions({ api }: { api: AdminWidgetsPort }, { t = widgetsEnglish, locale = 'en', events, navigate }: { t?: Translate | undefined; locale?: string | undefined; events?: WidgetsEventsPort | undefined; navigate?: ((path: string) => void) | undefined } = {}): WidgetRegionsController {
  const latest = useRef({ t, navigate }); latest.current = { t, navigate };
  const { controller, snapshot } = useController({ create: () => createWidgetRegionsController({ api }, { t: key => latest.current.t(key), navigate: path => latest.current.navigate?.(path) }), dependencies: [api] }, { start: ({ controller }) => { void controller.load(); } });
  useEffect(() => { if (!controller) return; return events?.subscribe({ resource: WIDGETS_REGIONS_RESOURCE, onRefresh: () => { void controller.load(); } }); }, [controller, events]);
  return { ...(snapshot ?? { regions: null, error: null, newRegionKey: '', binding: false }), setNewRegionKey: value => controller?.setNewRegionKey({ value }), bind: async () => { await controller?.bind(); }, t };
}
export function useWiredWidgetRegions(): WidgetRegionsController {
  const { widgetsApi: api, widgetsEvents: events, widgetsNavigation } = useWidgetsPorts();
  const { t, locale, navigationBase = '/admin' } = useWidgetsOptions();
  const navigate = useWidgetsNavigate({ navigation: widgetsNavigation, navigationBase });
  return useWidgetRegions({ api }, { t, locale, events, navigate });
}
import { useWidgetsNavigate } from './navigation.hooks.js';
