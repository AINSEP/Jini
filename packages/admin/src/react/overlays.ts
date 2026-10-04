import type { ReactNode } from 'react';
import { createControllerStore } from '../core/module/controller-store.js';
export interface OverlayEntry {
  readonly id: number;
  readonly render: () => ReactNode;
}
export interface OverlayPort {
  open<T>(
    required: {
      render: (required: { resolve: (value: T | null) => void; cancel: () => void }) => ReactNode;
    },
    optional?: { signal?: AbortSignal },
  ): Promise<T | null>;
}
/** One active overlay per host. A second request rejects instead of stealing the first
 * caller's promise; abort/dispose settle null and release every event listener. */
export function createOverlayController(
  _required: Record<string, never> = {},
  _optional: Record<string, never> = {},
) {
  const store = createControllerStore({ initial: { entries: [] as readonly OverlayEntry[] } });
  let sequence = 0,
    cancelActive: (() => void) | null = null;
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    open<T>(
      {
        render,
      }: {
        render: (required: { resolve: (value: T | null) => void; cancel: () => void }) => ReactNode;
      },
      { signal }: { signal?: AbortSignal } = {},
    ): Promise<T | null> {
      if (store.signal.aborted || signal?.aborted) return Promise.resolve(null);
      if (cancelActive) return Promise.reject(new Error('An overlay is already open'));
      return new Promise((resolve) => {
        let settled = false;
        const finish = (value: T | null) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', cancel);
          cancelActive = null;
          store.set({ patch: { entries: [] } });
          resolve(value);
        };
        const cancel = () => finish(null);
        cancelActive = cancel;
        signal?.addEventListener('abort', cancel, { once: true });
        store.set({
          patch: {
            entries: [{ id: ++sequence, render: () => render({ resolve: finish, cancel }) }],
          },
        });
      });
    },
    cancel(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
      cancelActive?.();
    },
    dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
      cancelActive?.();
      store.dispose();
    },
  };
}

export { OverlayHost } from './OverlayHost.js';
export type { OverlayHostProps } from './OverlayHost.hooks.js';
