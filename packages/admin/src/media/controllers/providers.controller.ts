import { createControllerStore, describeApiError } from '@jini-ai/core/admin-runtime';
import type { MediaProvidersPort } from '../ports.js';
import type { MediaProvider } from '../models.js';
function createProviderWriter(
  store: ReturnType<typeof createControllerStore<{ items: readonly MediaProvider[]; loading: boolean; saving: boolean; error: string | null }>>,
  load: () => Promise<void>,
) {
  return async function write(run: () => Promise<MediaProvider>) {
    if (store.signal.aborted || store.getSnapshot().saving) return false;
    store.set({ patch: { saving: true, error: null } });
    try {
      await run();
      if (store.signal.aborted) return false;
      await load();
      return true;
    } catch (error) {
      store.set({ patch: { error: describeApiError({ e: error, fallback: 'Failed to save provider credentials' }) } });
    } finally {
      store.set({ patch: { saving: false } });
    }
    // Reached only through the catch above: the failure is already recorded in `error`.
    return false;
  }
}

function createProviderLoader(
  store: ReturnType<typeof createControllerStore<{ items: readonly MediaProvider[]; loading: boolean; saving: boolean; error: string | null }>>,
  api: MediaProvidersPort,
  { nextGeneration, isCurrent }: { nextGeneration: () => number; isCurrent: (ticket: number) => boolean },
) {
  return async function load(
    _required: Record<string, never> = {},
    _optional: Record<string, never> = {},
  ) {
    if (store.signal.aborted) return;
    const ticket = nextGeneration();
    store.set({ patch: { loading: true } });
    try {
      const items = await api.list({}, { signal: store.signal });
      // null leaves local edits untouched; [] is an authoritative empty answer.
      if (isCurrent(ticket))
        store.set({
          patch:
            items === null
              ? { error: 'Provider service unavailable' }
              : { items: Object.freeze([...items]), error: null },
        });
    } catch (error) {
      // The host's API port reports the incident (Copy details); this line shows its approved words.
      if (isCurrent(ticket)) store.set({ patch: { error: describeApiError({ e: error, fallback: 'Provider service unavailable' }) } });
    } finally {
      if (isCurrent(ticket)) store.set({ patch: { loading: false } });
    }
  }
}

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
  const load = createProviderLoader(store, api, { nextGeneration: () => ++generation, isCurrent: ticket => ticket === generation });
  const write = createProviderWriter(store, load);
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
