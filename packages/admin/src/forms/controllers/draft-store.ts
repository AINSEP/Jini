import { createControllerStore } from '../../core/module/controller-store.js';
/** Section controllers share only the typed draft-update mechanism, not domain decisions. */
export function createFormsDraftStore<S extends object>({ initial }: { initial: S }, _optional = {}) {
  const store = createControllerStore({ initial });
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, dispose: store.dispose,
    update<K extends keyof S>({ key, value }: { key: K; value: S[K] | ((current: S[K]) => S[K]) }, _options = {}) {
      const current = store.getSnapshot()[key];
      const next = typeof value === 'function' ? (value as (state: S[K]) => S[K])(current) : value;
      const patch: Partial<S> = {};
      patch[key] = next;
      store.set({ patch });
    },
    patch({ patch }: { patch: Partial<S> }, _options = {}) { store.set({ patch }); },
  };
}
