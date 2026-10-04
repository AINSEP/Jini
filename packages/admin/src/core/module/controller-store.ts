export interface ControllerStore<S> {
  getSnapshot(required?: Record<string, never>, optional?: Record<string, never>): S;
  subscribe(required: { listener: () => void }, optional?: Record<string, never>): () => void;
  dispose(required?: Record<string, never>, optional?: Record<string, never>): void;
}
/** Snapshot identity changes only on a write: useSyncExternalStore requires a cached snapshot. */
export function createControllerStore<S extends object>(
  { initial }: { initial: S },
  _optional: Record<string, never> = {},
) {
  let state = Object.freeze(initial),
    disposed = false;
  const listeners = new Set<() => void>();
  const abort = new AbortController();
  return {
    getSnapshot: () => state,
    subscribe: ({ listener }: { listener: () => void }) => {
      if (!disposed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: ({ patch }: { patch: Partial<S> }) => {
      if (disposed) return;
      state = Object.freeze({ ...state, ...patch });
      for (const listener of listeners) listener();
    },
    signal: abort.signal,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      abort.abort();
      listeners.clear();
    },
  };
}
