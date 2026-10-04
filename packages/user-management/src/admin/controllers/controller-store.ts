/** Effect owners dispose the controller. Settlements never update a retired scope. */
export function createControllerStore<S extends object>({ initial }: { initial: S }, _optional: Record<string, never> = {}) {
  let state = Object.freeze({ ...initial }), disposed = false;
  const listeners = new Set<() => void>();
  const abort = new AbortController();
  return {
    getSnapshot(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): Readonly<S> { return state; },
    active(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { return !disposed; },
    set({ patch }: { patch: Partial<S> }, _optional: Record<string, never> = {}) {
      if (disposed) return; state = Object.freeze({ ...state, ...patch }); for (const listener of listeners) listener();
    },
    subscribe({ listener }: { listener: () => void }, _optional: Record<string, never> = {}) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { if (disposed) return; disposed = true; abort.abort(); listeners.clear(); },
    call: { signal: abort.signal },
  };
}
