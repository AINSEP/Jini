import { createControllerStore } from '../../core/module/controller-store.js';
import { describeApiError } from '../../core/transport/errors.js';
import { widgetApiError } from '../rules.js';
import { widgetsEnglish } from '../messages.en.js';
import type { AdminWidgetsPort } from '../ports.js';
import type { AdminWidget, AdminWidgetType, WidgetsTranslate } from '../models.js';
export interface WidgetsLibraryState {
  widgets: AdminWidget[] | null; error: string | null; skippedCount: number; skippedIds: string[];
  createType: AdminWidgetType; pendingTrash: AdminWidget | null; trashingId: string | null;
}
/** Active-only library. Latest read wins across mount, refresh and write-triggered reads. */
export function createWidgetsLibraryController({ api }: { api: AdminWidgetsPort }, { t = widgetsEnglish }: { t?: WidgetsTranslate | undefined } = {}) {
  const store = createControllerStore<WidgetsLibraryState>({ initial: { widgets: null, error: null, skippedCount: 0, skippedIds: [], createType: 'text', pendingTrash: null, trashingId: null } });
  let generation = 0;
  async function load(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    const ticket = ++generation;
    try {
      // No includeInactive: trashed widgets belong to the shared Trash screen.
      const result = await api.listWidgets({}, { signal: store.signal });
      if (ticket !== generation || store.signal.aborted) return;
      store.set({ patch: { widgets: result.widgets, skippedCount: result.skippedCount ?? 0, skippedIds: result.skippedIds ?? [] } });
    } catch (e) {
      if (ticket === generation && !store.signal.aborted) store.set({ patch: { error: describeApiError({ e: widgetApiError({ error: e }) ?? e, fallback: t('failed to load widgets') }) } });
    }
  }
  async function confirmTrash(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    const widget = store.getSnapshot().pendingTrash;
    if (!widget) return;
    store.set({ patch: { trashingId: widget.id, error: null } });
    try {
      await api.trashWidget({ id: widget.id }, { signal: store.signal });
      void load();
    } catch (error) {
      const e = widgetApiError({ error });
      if (e?.code === 'NOT_FOUND') void load();
      else store.set({ patch: { error: e?.code === 'TRASH_VERSION_CHANGED' ? t('This item changed since you loaded it. Reload and try again.') : describeApiError({ e: e ?? error, fallback: t('delete failed') }) } });
    } finally {
      // A's completion cannot close a newly opened confirmation for B.
      const current = store.getSnapshot();
      store.set({ patch: { trashingId: current.trashingId === widget.id ? null : current.trashingId, pendingTrash: current.pendingTrash?.id === widget.id ? null : current.pendingTrash } });
    }
  }
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, load, confirmTrash,
    setCreateType({ type }: { type: AdminWidgetType }, _optional: Record<string, never> = {}) { store.set({ patch: { createType: type } }); },
    requestTrash({ widget }: { widget: AdminWidget }, _optional: Record<string, never> = {}) { store.set({ patch: { error: null, pendingTrash: widget } }); },
    cancelTrash(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { store.set({ patch: { pendingTrash: null } }); },
    dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { generation++; store.dispose(); },
  };
}
