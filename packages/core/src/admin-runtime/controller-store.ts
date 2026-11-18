export interface ControllerStore<S> {
  getSnapshot(required?: Record<string, never>, optional?: Record<string, never>): S;
  subscribe(required: { listener: () => void }, optional?: Record<string, never>): () => void;
  dispose(required?: Record<string, never>, optional?: Record<string, never>): void;
}
/** What an owner's controller holds: the read-only store contract plus its single write and its abort signal. */
export interface WritableControllerStore<S extends object> extends ControllerStore<S> {
  set(required: { patch: Partial<S> }, optional?: Record<string, never>): void;
  /** Aborted by `dispose`, so an in-flight call can stop instead of settling into a retired scope. */
  readonly signal: AbortSignal;
}
/** Snapshot identity changes only on a write: useSyncExternalStore requires a cached snapshot. */
export function createControllerStore<S extends object>(
  { initial }: { initial: S },
  _optional: Record<string, never> = {},
): WritableControllerStore<S> {
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
