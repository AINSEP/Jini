import { createControllerStore } from '../../core/module/controller-store.js';
import type { PlaygroundRenderTargetPort } from '../../contracts/playground-render-target.js';
import type { PlaygroundState } from '../models.js';
import { canMountPlayground } from '../rules.js';
export function createPlaygroundController({ targets, permissions = [] }: { targets: PlaygroundRenderTargetPort; permissions?: readonly string[] }, _optional = {}) {
  const store = createControllerStore<PlaygroundState>({ initial: { attached: false } });
  let node: object | null = null, lease: ReturnType<PlaygroundRenderTargetPort['register']> | null = null;
  function detach() { lease?.release({}); lease = null; node = null; store.set({ patch: { attached: false } }); }
  return { getSnapshot: store.getSnapshot, subscribe: store.subscribe,
    attach({ target }: { target: object | null }, _optional = {}) {
      if (store.signal.aborted || !canMountPlayground({ permissions }) || target === node) return;
      detach(); if (target) { lease = targets.register({ target }); node = target; store.set({ patch: { attached: true } }); }
    },
    dispose(_required: Record<string, never> = {}, _optional = {}) { detach(); store.dispose(); },
  };
}
