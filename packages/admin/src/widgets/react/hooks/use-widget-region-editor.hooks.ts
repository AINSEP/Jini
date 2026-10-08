import type { AdminWidget, AdminWidgetType, AdminWidgetWhereUsed, AdminWidgetRegionBinding, AdminWidgetArea, AdminWidgetPlacement, WidgetsTranslate as Translate } from '../../models.js';
import type { DirtyGuard } from '@jini-ai/ui/panel-kit';
export interface WidgetRegionEditorController {
  area: AdminWidgetArea | null;
  placements: AdminWidgetPlacement[];
  message: string | null;
  error: string | null;
  loading: boolean;
  saving: boolean;
  removeAt: (placementId: string) => void;
  moveAt: (index: number, direction: -1 | 1) => void;
  toggleEnabled: (placementId: string) => void;
  addPlacement: (widgetInstanceId: string) => void;
  save: () => Promise<void>;
  /** Bound translator — `WidgetRegionEditor.tsx`'s only source of UI copy; see this file's own
   *  header. */
  t: Translate;
  /** The raw resolved locale — exposed only because `widgetTypeLabel` (`../rules.ts`) needs it. */
  locale: string;
}
import { useEffect, useRef } from 'react';
import { useController } from '../../../core/react/use-controller.js';
import { createWidgetRegionEditorController } from '../../controllers/region-editor.controller.js';
import type { AdminWidgetsPort } from '../../ports.js';
import { widgetsEnglish } from '../../messages.en.js';
import { useWidgetsPorts, useWidgetsOptions } from './WidgetsPorts.hooks.js';
export function staleVersionMessage({ t = widgetsEnglish }: { t?: Translate | undefined } = {}, _optional: Record<string, never> = {}): string { return t('This region changed since you loaded it, refresh and try again.'); }
export function useWidgetRegionEditor({ regionKey, api }: { regionKey: string; api: AdminWidgetsPort }, { t = widgetsEnglish, locale = 'en' }: { t?: Translate | undefined; locale?: string | undefined } = {}): WidgetRegionEditorController {
  const keyRef = useRef(regionKey), latestT = useRef(t); latestT.current = t;
  const { controller, snapshot } = useController({ create: () => createWidgetRegionEditorController({ api, regionKey: keyRef.current }, { t: key => latestT.current(key) }), dependencies: [api] }, { start: ({ controller }) => { void controller.load(); } });
  useEffect(() => { if (keyRef.current !== regionKey) { keyRef.current = regionKey; controller?.setRegionKey({ regionKey }); } }, [controller, regionKey]);
  return { ...(snapshot ?? { area: null, placements: [], message: null, error: null, loading: true, saving: false }), removeAt: placementId => controller?.removeAt({ placementId }), moveAt: (index, direction) => controller?.moveAt({ index, direction }), toggleEnabled: placementId => controller?.toggleEnabled({ placementId }), addPlacement: widgetInstanceId => controller?.addPlacement({ widgetInstanceId }), save: async () => { await controller?.save(); }, t, locale };
}
export function useWiredWidgetRegionEditor(regionKey: string): WidgetRegionEditorController {
  const { widgetsApi: api } = useWidgetsPorts();
  const { t, locale } = useWidgetsOptions();
  return useWidgetRegionEditor({ regionKey, api }, { t, locale });
}
