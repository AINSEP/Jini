/**
 * @file The seam between "the assistant drew something via `assistant_render_ui`" and "the
 * Playground page wants it drawn ON THE PAGE instead of inline in the chat transcript" — the
 * whiteboard feature's whole host-side piece (Jini's A2UI transport and `render-ui-tool.ts` are
 * untouched; this is purely about where the browser puts what they already send).
 *
 * ## Why a bus rather than props
 *
 * Same shape as `assistant-dock-bus.ts`, and for the same structural reason: the two components
 * that need to agree — `components/AssistantDock/RoutedA2uiSurfaceCard.tsx` (rendered from
 * `AssistantDock.tsx`, mounted once in `App.tsx`'s `<aside>`) and `features/playground/Playground.tsx`
 * (rendered through `renderRoute(route)`, a plain function with no props bag) — are siblings under
 * `App.tsx` with no shared state between them and no path to thread a prop through. `App.tsx` never
 * needs to know this exists; unlike the dock-open bus, there is no third owner here at all.
 *
 * ## Why this one holds a DOM node, not a boolean or id
 *
 * The reader (`RoutedA2uiSurfaceCard`) needs something `ReactDOM.createPortal` can target directly.
 * A boolean ("is Playground mounted") would still leave the renderer with no container to portal
 * into; an id string would make the renderer respend a `document.getElementById` lookup for every
 * a2ui event, racing Playground's own mount/unmount. The node itself is the one value that answers
 * both "is there a target" and "where is it" in one read.
 *
 * ## Ownership
 *
 * Only `Playground.tsx` calls {@link setPlaygroundRenderTarget} — it owns the container div's
 * lifecycle (mount registers it, unmount clears it back to `null`) via a ref callback. Everything
 * else only ever reads.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let targetNode: HTMLDivElement | null = null;

/**
 * Subscribes to changes in the registered render-target node (registered, swapped, or cleared).
 *
 * @returns A disposer; call it from the subscriber's effect cleanup (or let
 * `useSyncExternalStore` do it, as {@link getPlaygroundRenderTarget}'s doc recommends).
 * @complexity O(1).
 */
export function subscribeToPlaygroundRenderTarget(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The currently registered Playground render-target node, or `null` when Playground is not
 * mounted (or has not yet attached its ref). Shaped for `useSyncExternalStore` — see
 * `RoutedA2uiSurfaceCard.tsx` for the one live reader.
 *
 * @complexity O(1).
 */
export function getPlaygroundRenderTarget(): HTMLDivElement | null {
  return targetNode;
}

/**
 * Registers (or clears) the Playground page's canvas container. **Only `Playground.tsx` should
 * call this** — it is the component whose ref callback owns the container's lifecycle, and a
 * second publisher would let this module disagree with the DOM node it is supposed to mirror.
 *
 * No-ops when the value is unchanged (matches `publishAssistantDockState`'s guard), so React
 * re-invoking a stable ref callback identity cannot turn into a notification storm.
 *
 * @complexity O(n) in the subscriber count, O(1) when unchanged.
 */
export function setPlaygroundRenderTarget({ node }: { node: HTMLDivElement | null }, _options = {}): void {
  if (node === targetNode) return;
  targetNode = node;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.error("[admin] playground render-target listener failed", error);
    }
  }
}

/** Test seam — drops every listener and resets the state. Not used in production code. */
export function resetPlaygroundRenderTargetBus(): void {
  listeners.clear();
  targetNode = null;
}
