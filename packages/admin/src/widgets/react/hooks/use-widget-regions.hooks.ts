import { useInvalidate } from '@jini-ai/ui/fetch-query';
import { WIDGET_QUERY_KEYS, useWidgetRegionsQuery } from './WidgetsQuery.hooks.js';
import type { AdminWidgetRegionBinding, WidgetsTranslate as Translate } from '../../models.js';
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
import { createWidgetRegionsController, type WidgetRegionsState } from '../../controllers/regions.controller.js';
import type { AdminWidgetsPort, WidgetsEventsPort } from '../../ports.js';
import { widgetsEnglish } from '../../messages.en.js';
import { WIDGETS_REGIONS_RESOURCE } from '../../rules.js';
import { useWidgetsPorts, useWidgetsOptions } from './WidgetsPorts.hooks.js';
import { useWidgetsNavigate } from './navigation.hooks.js';
export function useWidgetRegions({ api }: { api: AdminWidgetsPort }, { t = widgetsEnglish, events, navigate }: { t?: Translate | undefined; locale?: string | undefined; events?: WidgetsEventsPort | undefined; navigate?: ((path: string) => void) | undefined } = {}): WidgetRegionsController {
  const cached = useWidgetRegionsQuery({ api });
  const invalidate = useInvalidate();
  const latest = useRef({ t, navigate }); latest.current = { t, navigate };
  const { controller, snapshot } = useController({ create: () => createWidgetRegionsController({ api: cached.api }, { t: key => latest.current.t(key), navigate: path => latest.current.navigate?.(path) }), dependencies: [cached.api] }, { start: ({ controller }) => { void controller.load(); } });
  useEffect(() => { if (!controller) return undefined;
    return events?.subscribe({ resource: WIDGETS_REGIONS_RESOURCE, onRefresh: () => invalidate({ key: WIDGET_QUERY_KEYS.regions }) }); }, [controller, events, invalidate]);
  return { ...mergeRegionsState({ snapshot, data: cached.query.data, queryError: cached.query.error }), setNewRegionKey: value => controller?.setNewRegionKey({ value }), bind: async () => { await controller?.bind(); }, t };
}
const EMPTY_REGIONS_STATE: WidgetRegionsState = { regions: null, error: null, newRegionKey: '', binding: false };
/** Cached query data wins for the list; a controller error wins over a query error. */
function mergeRegionsState({ snapshot, data, queryError }: { snapshot: WidgetRegionsState | null; data: { regions: AdminWidgetRegionBinding[] } | undefined; queryError: Error | null | undefined }, _optional: Record<string, never> = {}): WidgetRegionsState {
  const state = snapshot ?? EMPTY_REGIONS_STATE;
  return { ...state, regions: data?.regions ?? state.regions, error: state.error ?? queryError?.message ?? null };
}
export function useWiredWidgetRegions(): WidgetRegionsController {
  const { widgetsApi: api, widgetsEvents: events, widgetsNavigation } = useWidgetsPorts();
  const { t, locale, navigationBase = '/admin' } = useWidgetsOptions();
  const navigate = useWidgetsNavigate({ navigation: widgetsNavigation, navigationBase });
  return useWidgetRegions({ api }, { t, locale, events, navigate });
}
