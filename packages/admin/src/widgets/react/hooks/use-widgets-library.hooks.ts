import { useInvalidate } from '@jini-ai/ui/fetch-query';
import { WIDGET_QUERY_KEYS, useWidgetsListQuery } from './WidgetsQuery.hooks.js';
import type { AdminWidget, AdminWidgetType, WidgetsTranslate as Translate } from '../../models.js';
export interface WidgetsLibraryController {
  /** `null` until the initial load settles — the caller renders a loading state. */
  widgets: AdminWidget[] | null;
  error: string | null;
  /** Count of widget-instance records the server could not read (unparseable `fields_json`).
   *  `0` and `undefined` both mean "nothing to say". */
  skippedCount: number;
  /** IDs of the malformed widget records counted in {@link skippedCount}. */
  skippedIds: string[];
  createType: AdminWidgetType;
  setCreateType: (type: AdminWidgetType) => void;
  /** The widget a "Trash" click is asking to confirm — `null` when the dialog is closed. Set by
   *  `requestTrash`; no network call happens until {@link confirmTrash}. */
  pendingTrash: AdminWidget | null;
  /** True only while the CONFIRMED trash for {@link pendingTrash} is in flight — same
   *  `pendingX !== null && xId === pendingX.id` shape `use-media.hooks.ts` uses. */
  trashing: boolean;
  requestTrash: (widget: AdminWidget) => void;
  confirmTrash: () => Promise<void>;
  cancelTrash: () => void;
  /** Bound translator — `WidgetsLibrary.tsx`'s only source of UI copy; see this file's own header. */
  t: Translate;
  /** The raw resolved locale — exposed only because `widgetTypeLabel` (`../rules.ts`) genuinely
   *  needs it, not `t`. */
  locale: string;
}
import { useEffect, useRef } from 'react';
import { useController } from '../../../core/react/use-controller.js';
import { createWidgetsLibraryController, type WidgetsLibraryState } from '../../controllers/library.controller.js';
import type { AdminWidgetsPort, WidgetsEventsPort } from '../../ports.js';
import { widgetsEnglish } from '../../messages.en.js';
import { WIDGETS_LIBRARY_RESOURCE } from '../../rules.js';
import { useWidgetsPorts, useWidgetsOptions } from './WidgetsPorts.hooks.js';
export function useWidgetsLibrary({ api }: { api: AdminWidgetsPort }, { t = widgetsEnglish, locale = 'en', events }: { t?: Translate | undefined; locale?: string | undefined; events?: WidgetsEventsPort | undefined } = {}): WidgetsLibraryController {
  const cached = useWidgetsListQuery({ api });
  const invalidate = useInvalidate();
  const latestT = useRef(t); latestT.current = t;
  const { controller, snapshot } = useController({ create: () => createWidgetsLibraryController({ api: cached.api }, { t: key => latestT.current(key) }), dependencies: [cached.api] }, { start: ({ controller }) => { void controller.load(); } });
  useEffect(() => { if (!controller) return undefined;
    return events?.subscribe({ resource: WIDGETS_LIBRARY_RESOURCE, onRefresh: () => invalidate({ key: WIDGET_QUERY_KEYS.library }) }); }, [controller, events, invalidate]);
  return { ...mergeLibraryState({ snapshot, data: cached.query.data, queryError: cached.query.error }),
    setCreateType: type => controller?.setCreateType({ type }), requestTrash: widget => controller?.requestTrash({ widget }),
    confirmTrash: async () => { await controller?.confirmTrash(); }, cancelTrash: () => controller?.cancelTrash(), t, locale };
}
const EMPTY_LIBRARY_STATE: WidgetsLibraryState = { widgets: null, error: null, skippedCount: 0, skippedIds: [], createType: 'text', pendingTrash: null, trashingId: null };
/** Cached query data wins for the list and skipped rows; a controller error wins over a query error. */
type LibraryListResult = Awaited<ReturnType<AdminWidgetsPort['listWidgets']>>;
function mergeLibraryState({ snapshot, data, queryError }: { snapshot: WidgetsLibraryState | null; data: LibraryListResult | undefined; queryError: Error | null | undefined }, _optional: Record<string, never> = {}) {
  const state = snapshot ?? EMPTY_LIBRARY_STATE;
  return { ...state, ...cachedListFields({ state, data }), error: state.error ?? queryError?.message ?? null, trashing: state.pendingTrash !== null && state.trashingId === state.pendingTrash.id };
}
function cachedListFields({ state, data }: { state: WidgetsLibraryState; data: LibraryListResult | undefined }, _optional: Record<string, never> = {}) {
  return { widgets: data?.widgets ?? state.widgets, skippedCount: data?.skippedCount ?? state.skippedCount, skippedIds: data?.skippedIds ?? state.skippedIds };
}
export function useWiredWidgetsLibrary(): WidgetsLibraryController {
  const { widgetsApi: api, widgetsEvents: events } = useWidgetsPorts();
  const { t, locale } = useWidgetsOptions();
  return useWidgetsLibrary({ api }, { t, locale, events });
}
