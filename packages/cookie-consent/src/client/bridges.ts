/** UI and outside CMP bridges use the same state and receipt-enforcing API as the built-in banner. */
import { BRIDGE_KIND, type ConsentBridge, type JiniConsentApi, type SlotKind } from '../contract.js';
export const BRIDGE_SLOT: SlotKind<ConsentBridge> = {
  kind: BRIDGE_KIND,
  accept: ({ contribution }) => typeof contribution.mount === 'function' || typeof contribution.src === 'string'
    ? contribution as unknown as ConsentBridge : 'mount() or module src needed',
};

export function bindBridges({ api, doc }: { api: JiniConsentApi; doc: Document }, _optional = {}): void {
  const active = new Map<string, { disposed: boolean; dispose?: (() => void) | undefined }>();
  function sync(items: readonly ConsentBridge[]): void {
    for (const [id, entry] of active) {
      if (items.some(item => item.id === id)) continue;
      entry.disposed = true;
      entry.dispose?.();
      active.delete(id);
    }
    for (const bridge of items) {
      if (active.has(bridge.id)) continue;
      const held = { disposed: false, dispose: undefined as (() => void) | undefined };
      active.set(bridge.id, held);
      const mount = (loaded: ConsentBridge) => {
        if (held.disposed) return;
        const dispose = loaded.mount?.({ api, doc });
        if (typeof dispose === 'function') held.dispose = dispose;
      };
      if (bridge.mount) mount(bridge);
      else void import(/* @vite-ignore */ bridge.src!).then(module => mount(module.default), () => undefined);
    }
  }
  api.plugins.defineSlot({ slot: BRIDGE_SLOT });
  api.plugins.subscribe({ kind: BRIDGE_KIND, listener: items => sync(items as readonly ConsentBridge[]) });
  sync(api.plugins.list<ConsentBridge>({ kind: BRIDGE_KIND }));
}
