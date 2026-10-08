import { createControllerStore } from '../../core/module/controller-store.js';
import { describeApiError } from '../../core/transport/errors.js';
import { resolveEditorWidgetType, resolveWidgetSaveError, widgetApiError, widgetSlugRedirectPath, widgetEntityKey } from '../rules.js';
import { widgetsEnglish } from '../messages.en.js';
import type { AdminWidgetsPort } from '../ports.js';
import type { AdminWidget, AdminWidgetWhereUsed, AdminWidgetType, WidgetsTranslate, WidgetEditorParams, WidgetSlugRedirectPath } from '../models.js';
export interface WidgetInstanceEditorState {
  isNew: boolean; widget: AdminWidget | null; whereUsed: AdminWidgetWhereUsed; title: string;
  config: Record<string, unknown>; message: string | null; error: string | null;
  fieldErrors: Array<{ field: string; reason: string }>; loading: boolean; saving: boolean;
  widgetType: AdminWidgetType | null | undefined;
}
/** Editor identity includes both route params. Reads and saves cannot overwrite a different editor. */
export function createWidgetInstanceEditorController(
  { api, params: initialParams, defaultConfig }: { api: AdminWidgetsPort; params: WidgetEditorParams; defaultConfig: (type: AdminWidgetType) => Record<string, unknown> },
  { t = widgetsEnglish, navigate, slugRedirectPath, getEntityKey }: { t?: WidgetsTranslate | undefined; navigate?: ((path: string, options?: { replace?: boolean }) => void) | undefined; slugRedirectPath?: WidgetSlugRedirectPath | undefined; getEntityKey?: (() => string) | undefined } = {},
) {
  let params = initialParams;
  const key = () => widgetEntityKey({ params });
  const currentKey = () => getEntityKey?.() ?? activeKey;
  let activeKey = key(), generation = 0;
  const isNew = params.widgetId === null;
  const store = createControllerStore<WidgetInstanceEditorState>({ initial: {
    isNew, widget: null, whereUsed: { count: 0, references: [] }, title: '',
    config: isNew ? defaultConfig(params.widgetType ?? 'text') : {}, message: null, error: null, fieldErrors: [],
    loading: !isNew, saving: false, widgetType: resolveEditorWidgetType({ isNew, queryWidgetType: params.widgetType, widget: null }),
  } });
  async function load(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    const ticket = ++generation;
    const isNew = params.widgetId === null;
    store.set({ patch: { isNew, saving: false } });
    if (isNew) {
      store.set({ patch: { widget: null, title: '', config: defaultConfig(params.widgetType ?? 'text'), whereUsed: { count: 0, references: [] }, loading: false, widgetType: params.widgetType } });
      return;
    }
    const requestedId = params.widgetId!;
    store.set({ patch: { loading: true, error: null } });
    try {
      const result = await api.getWidget({ id: requestedId }, { signal: store.signal });
      if (ticket !== generation || store.signal.aborted) return;
      store.set({ patch: { widget: result.widget, title: result.widget.title, config: result.widget.config, whereUsed: result.whereUsed, widgetType: result.widget.widgetType } });
      // Replace rather than push: an old id bookmark should not add a Back-button stop.
      const redirect = widgetSlugRedirectPath({ requestedId, widget: result.widget }, { slugRedirectPath });
      if (redirect) navigate?.(redirect, { replace: true });
    } catch (error) {
      if (ticket === generation && !store.signal.aborted) store.set({ patch: { error: describeApiError({ e: widgetApiError({ error }) ?? error, fallback: t('failed to load widget') }) } });
    } finally {
      if (ticket === generation && !store.signal.aborted) store.set({ patch: { loading: false } });
    }
  }
  async function save(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    const { widgetType, isNew, widget, title, config } = store.getSnapshot();
    if (!widgetType) return;
    const savingFor = currentKey();
    store.set({ patch: { saving: true, message: null, error: null, fieldErrors: [] } });
    try {
      if (isNew) {
        const { widget: created } = await api.createWidget({ widgetType, title, config }, { signal: store.signal });
        // Creation intentionally navigates even if route identity changed while it was in flight.
        navigate?.(`/widgets/${created.slug}`);
        return;
      }
      if (!widget) return;
      const { widget: saved } = await api.updateWidget({ id: widget.id, baseVersion: widget.version, title, config }, { signal: store.signal });
      if (currentKey() !== savingFor || store.signal.aborted) return;
      store.set({ patch: { widget: saved, title: saved.title, config: saved.config, widgetType: saved.widgetType, message: t('Saved · version {version}').replace('{version}', String(saved.version)) } });
    } catch (error) {
      if (currentKey() === savingFor && !store.signal.aborted) store.set({ patch: resolveWidgetSaveError({ error }, { t }) });
    } finally {
      if (currentKey() === savingFor && !store.signal.aborted) store.set({ patch: { saving: false } });
    }
  }
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, load, save,
    setParams({ params: next }: { params: WidgetEditorParams }, _optional: Record<string, never> = {}) {
      params = next; activeKey = key(); void load();
    },
    setTitle({ title }: { title: string }, _optional: Record<string, never> = {}) { store.set({ patch: { title } }); },
    setConfig({ config }: { config: Record<string, unknown> }, _optional: Record<string, never> = {}) { store.set({ patch: { config } }); },
    dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { generation++; activeKey = ''; store.dispose(); },
  };
}
