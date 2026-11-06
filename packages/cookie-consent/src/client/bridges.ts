/** UI and outside CMP bridges use the same state and receipt-enforcing API as the built-in banner. */
import { BRIDGE_KIND, type ConsentBridge, type JiniConsentApi, type SlotKind } from '../contract.js';
export const BRIDGE_SLOT: SlotKind<ConsentBridge> = {
  kind: BRIDGE_KIND,
  accept: ({ contribution }) => typeof contribution.mount === 'function' || typeof contribution.src === 'string'
    ? contribution as unknown as ConsentBridge : 'mount() or module src needed',
};

function disposeBridge(entry: { disposed: boolean; dispose?: (() => void) | undefined }): void {
  entry.disposed = true;
  try { entry.dispose?.(); } catch { /* A broken bridge cannot block other mounts or consent. */ }
}

export function bindBridges({ api, doc }: { api: JiniConsentApi; doc: Document }, _optional = {}): void {
  const active = new Map<string, { disposed: boolean; dispose?: (() => void) | undefined }>();
  function sync(items: readonly ConsentBridge[]): void {
    for (const [id, entry] of active) {
      if (items.some(item => item.id === id)) continue;
      disposeBridge(entry);
      active.delete(id);
    }
    for (const bridge of items) {
      if (active.has(bridge.id)) continue;
      const held = { disposed: false, dispose: undefined as (() => void) | undefined };
      active.set(bridge.id, held);
      const mount = (loaded: ConsentBridge) => {
        if (held.disposed) return;
        try {
          const dispose = loaded.mount?.({ api, doc });
          if (typeof dispose === 'function') held.dispose = dispose;
        } catch { /* Isolate this contribution; the shared consent state stays authoritative. */ }
      };
      if (bridge.mount) mount(bridge);
      else void import(/* @vite-ignore */ bridge.src!).then(module => mount(module.default)).catch(() => undefined);
    }
  }
  api.plugins.defineSlot({ slot: BRIDGE_SLOT });
  api.plugins.subscribe({ kind: BRIDGE_KIND, listener: items => sync(items as readonly ConsentBridge[]) });
  sync(api.plugins.list<ConsentBridge>({ kind: BRIDGE_KIND }));
}
