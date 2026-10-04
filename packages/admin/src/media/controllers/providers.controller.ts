import { createControllerStore } from '../../core/module/controller-store.js';
import type { MediaProvidersPort } from '../ports.js';
import type { MediaProvider } from '../models.js';
export function createProvidersController(
  { api }: { api: MediaProvidersPort },
  _optional: Record<string, never> = {},
) {
  const store = createControllerStore({
    initial: {
      items: [] as readonly MediaProvider[],
      loading: false,
      saving: false,
      error: null as string | null,
    },
  });
  let generation = 0;
  async function load(
    _required: Record<string, never> = {},
    _optional: Record<string, never> = {},
  ) {
    if (store.signal.aborted) return;
    const ticket = ++generation;
    store.set({ patch: { loading: true } });
    try {
      const items = await api.list({}, { signal: store.signal });
      // null leaves local edits untouched; [] is an authoritative empty answer.
      if (ticket === generation)
        store.set({
          patch:
            items === null
              ? { error: 'Provider service unavailable' }
              : { items: Object.freeze([...items]), error: null },
        });
    } catch {
      if (ticket === generation) store.set({ patch: { error: 'Provider service unavailable' } });
    } finally {
      if (ticket === generation) store.set({ patch: { loading: false } });
    }
  }
  async function write(run: () => Promise<MediaProvider>) {
    if (store.signal.aborted || store.getSnapshot().saving) return false;
    store.set({ patch: { saving: true, error: null } });
    try {
      await run();
      if (store.signal.aborted) return false;
      await load();
      return true;
    } catch {
      store.set({ patch: { error: 'Failed to save provider credentials' } });
      return false;
    } finally {
      store.set({ patch: { saving: false } });
    }
  }
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    load,
    save(
      { id, credential }: { id: string; credential: string },
      _optional: Record<string, never> = {},
    ) {
      return write(() => api.saveCredential({ id, credential }, { signal: store.signal }));
    },
    saveSettings({ id, baseUrl, model }: { id: string; baseUrl: string; model: string }, _optional: Record<string, never> = {}) {
      if (!api.saveSettings) return Promise.resolve(false);
      return write(() => api.saveSettings!({ id, baseUrl, model }, { signal: store.signal }));
    },
    remove({ id }: { id: string }, _optional: Record<string, never> = {}) {
      return write(() => api.removeCredential({ id }, { signal: store.signal }));
    },
    dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
      generation++;
      store.dispose();
    },
  };
}
