import type { AdminWidget, AdminWidgetType, AdminWidgetWhereUsed, AdminWidgetRegionBinding, AdminWidgetArea, AdminWidgetPlacement, WidgetsTranslate as Translate } from '../../models.js';
import type { DirtyGuard } from '@jini-ai/ui/panel-kit';
export interface WidgetInstanceEditorController {
  isNew: boolean;
  widget: AdminWidget | null;
  whereUsed: AdminWidgetWhereUsed;
  title: string;
  setTitle: (title: string) => void;
  config: Record<string, unknown>;
  setConfig: (config: Record<string, unknown>) => void;
  message: string | null;
  error: string | null;
  fieldErrors: Array<{ field: string; reason: string }>;
  loading: boolean;
  saving: boolean;
  /** The type this editor is configuring — the `?type=` query param while creating, the loaded
   *  widget's own type once one exists. `null` when neither is available. */
  widgetType: AdminWidgetType | null;
  save: () => Promise<void>;
  /** `useDirtyGuard`'s `confirmLeave` for the title/config pair — `WidgetInstanceEditor.tsx`'s back
   *  link calls it before leaving (Opus themes+widgets review, OPEN item 2: this editor previously
   *  had no unsaved-changes guard at all, unlike Posts/Pages). Always `true` with no prompt while
   *  `widget` is `null` (a brand-new, not-yet-saved widget) — same "nothing loaded to compare
   *  against yet" contract `useDirtyGuard`'s own doc describes; matches every other editor's
   *  identical carve-out. */
  confirmLeave: DirtyGuard["confirmLeave"];
  /** Bound translator — `WidgetInstanceEditor.tsx`'s only source of UI copy; see this file's own
   *  header. */
  t: Translate;
  /** The raw resolved locale — exposed only because `widgetTypeLabel` (`../rules.ts`) genuinely
   *  needs it, not `t`. */
  locale: string;
}
import { useEffect, useRef, useCallback } from 'react';
import { useDirtyGuard } from '@jini-ai/ui/panel-kit';
import { useController } from '../../../core/react/use-controller.js';
import { createWidgetInstanceEditorController } from '../../controllers/instance-editor.controller.js';
import type { AdminWidgetsPort } from '../../ports.js';
import type { WidgetEditorParams, WidgetSlugRedirectPath } from '../../models.js';
import { widgetsEnglish } from '../../messages.en.js';
import { widgetEntityKey } from '../../rules.js';
import { useWidgetsPorts, useWidgetsOptions } from './WidgetsPorts.hooks.js';
import { useWidgetsNavigate } from './navigation.hooks.js';
export type WidgetInstanceEditorHookProps = WidgetEditorParams;
export function staleVersionMessage({ t = widgetsEnglish }: { t?: Translate | undefined } = {}, _optional: Record<string, never> = {}): string { return t('This widget changed since you loaded it, refresh and try again.'); }
export function useWidgetInstanceEditor(
  { params, api, defaultConfig }: { params: WidgetEditorParams; api: AdminWidgetsPort; defaultConfig: (type: AdminWidgetType) => Record<string, unknown> },
  { t = widgetsEnglish, locale = 'en', navigate, slugRedirectPath }: { t?: Translate | undefined; locale?: string | undefined; navigate?: ((path: string, options?: { replace?: boolean }) => void) | undefined; slugRedirectPath?: WidgetSlugRedirectPath | undefined } = {},
): WidgetInstanceEditorController {
  const paramsRef = useRef(params);
  // Saves compare with the latest rendered identity, before a route effect can run.
  const renderedKey = useRef(widgetEntityKey({ params })); renderedKey.current = widgetEntityKey({ params });
  const latest = useRef({ t, navigate, slugRedirectPath }); latest.current = { t, navigate, slugRedirectPath };
  const { controller, snapshot } = useController({ create: () => createWidgetInstanceEditorController({ api, params: paramsRef.current, defaultConfig }, {
    getEntityKey: () => renderedKey.current, t: key => latest.current.t(key), navigate: (path, options) => latest.current.navigate?.(path, options),
    slugRedirectPath: (base, id, item) => latest.current.slugRedirectPath?.(base, id, item) ?? null,
  }), dependencies: [api, defaultConfig] }, { start: ({ controller }) => { void controller.load(); } });
  useEffect(() => {
    if (paramsRef.current.widgetId === params.widgetId && paramsRef.current.widgetType === params.widgetType) return;
    paramsRef.current = params; controller?.setParams({ params });
  }, [controller, params.widgetId, params.widgetType]);
  const state = snapshot ?? { isNew: params.widgetId === null, widget: null, whereUsed: { count: 0, references: [] }, title: '', config: params.widgetId === null ? defaultConfig(params.widgetType ?? 'text') : {}, message: null, error: null, fieldErrors: [], loading: params.widgetId !== null, saving: false, widgetType: params.widgetId === null ? params.widgetType : undefined };
  // New unsaved widgets have no original to compare with and leave without a prompt.
  const { confirmLeave } = useDirtyGuard({ current: { title: state.title, config: state.config }, original: state.widget ? { title: state.widget.title, config: state.widget.config } : null }, { host: window, translate: key => key });
  return { ...state, widgetType: state.widgetType as AdminWidgetType | null, setTitle: title => controller?.setTitle({ title }), setConfig: config => controller?.setConfig({ config }), save: async () => { await controller?.save(); }, confirmLeave, t, locale };
}
export function useWiredWidgetInstanceEditor(params: WidgetEditorParams): WidgetInstanceEditorController {
  const { widgetsApi: api, widgetsNavigation } = useWidgetsPorts();
  const { t, locale, defaultConfig, slugRedirectPath, navigationBase = '/admin' } = useWidgetsOptions();
  const navigate = useWidgetsNavigate({ navigation: widgetsNavigation, navigationBase });
  return useWidgetInstanceEditor({ params, api, defaultConfig }, { t, locale, navigate, slugRedirectPath });
}
