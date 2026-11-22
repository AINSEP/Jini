/**
 * @file The smallest observable cell the two controllers share, shaped for React's
 * `useSyncExternalStore` (`subscribe` + a `getSnapshot` that returns the same object until the
 * state changes) without importing React: `desktop-host` has no UI dependency.
 */

export interface Store<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
  /** Replace the snapshot and tell every subscriber. */
  set(next: T): void;
}

/** @complexity O(subscribers) per `set`. */
export function createStore<T>({ initial }: { readonly initial: T }, _optional = {}): Store<T> {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    set(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener();
    },
  };
}
