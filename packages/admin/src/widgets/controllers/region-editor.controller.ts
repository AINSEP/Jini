import { createControllerStore } from '../../core/module/controller-store.js';
import { describeApiError } from '../../core/transport/errors.js';
import { buildDraftPlacement, movePlacement, resolveWidgetRegionSaveError, widgetApiError } from '../rules.js';
import { widgetsEnglish } from '../messages.en.js';
import type { AdminWidgetsPort } from '../ports.js';
import type { AdminWidgetArea, AdminWidgetPlacement, WidgetsTranslate } from '../models.js';
export interface WidgetRegionEditorState { area: AdminWidgetArea | null; placements: AdminWidgetPlacement[]; message: string | null; error: string | null; loading: boolean; saving: boolean }
/** One generation guards both load call sites (route changes and post-save rereads). */
export function createWidgetRegionEditorController({ api, regionKey: initialKey }: { api: AdminWidgetsPort; regionKey: string }, { t = widgetsEnglish }: { t?: WidgetsTranslate | undefined } = {}) {
  const store = createControllerStore<WidgetRegionEditorState>({ initial: { area: null, placements: [], message: null, error: null, loading: true, saving: false } });
  let regionKey = initialKey, generation = 0;
  async function load(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    const ticket = ++generation;
    store.set({ patch: { loading: true, error: null, saving: false } });
    try {
      const result = await api.getWidgetRegion({ regionKey }, { signal: store.signal });
      if (ticket === generation && !store.signal.aborted) store.set({ patch: { area: result.area, placements: result.placements } });
    } catch (error) {
      if (ticket === generation && !store.signal.aborted) store.set({ patch: { error: describeApiError({ e: widgetApiError({ error }) ?? error, fallback: t('failed to load region') }) } });
    } finally {
      if (ticket === generation && !store.signal.aborted) store.set({ patch: { loading: false } });
    }
  }
  function addPlacement({ widgetInstanceId }: { widgetInstanceId: string }, _optional: Record<string, never> = {}) {
    const draft = buildDraftPlacement({ widgetInstanceId });
    store.set({ patch: { placements: [...store.getSnapshot().placements, draft] } });
    // A failed lookup keeps the draft saveable; the post-save reread supplies its title/type.
    void api.getWidget({ id: widgetInstanceId }, { signal: store.signal }).then(({ widget }) => {
      store.set({ patch: { placements: store.getSnapshot().placements.map(p => p.placementId === draft.placementId ? { ...p, widgetTitle: widget.title, widgetType: widget.widgetType } : p) } });
    }).catch(() => {});
  }
  async function save(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    const { area, placements } = store.getSnapshot();
    if (!area) return;
    const ticket = generation;
    store.set({ patch: { saving: true, message: null, error: null } });
    let stale = false;
    try {
      const { area: saved } = await api.mutateWidgetRegionPlacements({ regionKey, baseVersion: area.version, placements: placements.map(p => ({ placementId: p.placementId, widgetEntryId: p.widgetEntryId, enabled: p.enabled })) }, { signal: store.signal });
      stale = ticket !== generation || store.signal.aborted;
      if (stale) return;
      store.set({ patch: { area: saved, message: t('Saved · version {version}').replace('{version}', String(saved.version)) } });
      // A stale save must never mint a read generation that supersedes the new region's load.
      void load();
    } catch (error) {
      stale = ticket !== generation || store.signal.aborted;
      if (!stale) store.set({ patch: { error: resolveWidgetRegionSaveError({ error }, { t }) } });
    } finally { if (!stale) store.set({ patch: { saving: false } }); }
  }
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, load, save, addPlacement,
    setRegionKey({ regionKey: next }: { regionKey: string }, _optional: Record<string, never> = {}) { regionKey = next; void load(); },
    removeAt({ placementId }: { placementId: string }, _optional: Record<string, never> = {}) { store.set({ patch: { placements: store.getSnapshot().placements.filter(p => p.placementId !== placementId) } }); },
    moveAt({ index, direction }: { index: number; direction: -1 | 1 }, _optional: Record<string, never> = {}) { store.set({ patch: { placements: movePlacement({ items: store.getSnapshot().placements, index, direction }) } }); },
    toggleEnabled({ placementId }: { placementId: string }, _optional: Record<string, never> = {}) { store.set({ patch: { placements: store.getSnapshot().placements.map(p => p.placementId === placementId ? { ...p, enabled: !p.enabled } : p) } }); },
    dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { generation++; store.dispose(); },
  };
}
