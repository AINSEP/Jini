import { createControllerStore } from '../../core/module/controller-store.js';
import { describeApiError } from '../../core/transport/errors.js';
import { widgetApiError } from '../rules.js';
import { widgetsEnglish } from '../messages.en.js';
import type { AdminWidgetsPort } from '../ports.js';
import type { AdminWidgetRegionBinding, WidgetsTranslate } from '../models.js';
export interface WidgetRegionsState { regions: AdminWidgetRegionBinding[] | null; error: string | null; newRegionKey: string; binding: boolean }
/** Region keys stay free text: no admin-listable theme registry exists. Latest refresh wins. */
export function createWidgetRegionsController({ api }: { api: AdminWidgetsPort }, { t = widgetsEnglish, navigate }: { t?: WidgetsTranslate | undefined; navigate?: ((path: string) => void) | undefined } = {}) {
  const store = createControllerStore<WidgetRegionsState>({ initial: { regions: null, error: null, newRegionKey: '', binding: false } });
  let generation = 0;
  async function load(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    const ticket = ++generation;
    try {
      const result = await api.listWidgetRegions({}, { signal: store.signal });
      if (ticket === generation && !store.signal.aborted) store.set({ patch: { regions: result.regions } });
    } catch (error) {
      if (ticket === generation && !store.signal.aborted) store.set({ patch: { error: describeApiError({ e: widgetApiError({ error }) ?? error, fallback: t('failed to load regions') }) } });
    }
  }
  async function bind(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    const regionKey = store.getSnapshot().newRegionKey.trim();
    if (!regionKey) return;
    store.set({ patch: { binding: true, error: null } });
    try {
      await api.bindWidgetRegion({ regionKey }, { signal: store.signal });
      store.set({ patch: { newRegionKey: '' } });
      navigate?.(`/widgets/regions/${regionKey}`);
    } catch (error) {
      store.set({ patch: { error: describeApiError({ e: widgetApiError({ error }) ?? error, fallback: t('bind failed') }) } });
    } finally { store.set({ patch: { binding: false } }); }
  }
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, load, bind,
    setNewRegionKey({ value }: { value: string }, _optional: Record<string, never> = {}) { store.set({ patch: { newRegionKey: value } }); },
    dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { generation++; store.dispose(); },
  };
}
