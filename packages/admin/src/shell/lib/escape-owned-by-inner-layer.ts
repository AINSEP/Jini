import { orFallbackSync } from "@jini-ai/core/errors/idioms";

/**
 * @file Whether an Escape keypress belongs to an open inner layer (modal, menu, popup) rather than
 * to the container behind it.
 *
 * Every modal here closes on a document-level `keydown` listener (`useDismissOnOutsideOrEscape` in
 * `@jini-ai/ui`), and so does the assistant dock (`App.hooks.ts`). With the dock's Chat settings
 * modal open, one Escape therefore closed BOTH (Chrome check, 2026-10-11). The dock's Chats menu
 * (`ConversationList` in `@jini-ai/chat`) has the same shape: its own document listener closes it
 * without `preventDefault`, so Escape closed the menu AND the dock (Chrome re-check, 2026-10-11).
 * The dock asks this first and leaves the keypress to whichever layer is on top.
 *
 * Listener order does not matter: React batches the inner layer's `setOpen(false)` past the current
 * dispatch, so the open menu/modal is still in the DOM when the dock's listener reads it.
 */

/** The parts of `Document` this check reads — a port, so tests pass a fake. */
export interface InnerLayerQueryRoot {
  querySelector(selectors: string): unknown;
}

/**
 * Open layers that own Escape: an ARIA modal (portaled settings shells, confirm dialogs), an open
 * menu (menus here render only while open), or a menu/listbox trigger reporting itself expanded
 * (covers popups whose panel is not a `role="menu"`). Plain `role="listbox"` is left out on purpose:
 * version lists and suggest inputs keep one mounted while closed. `aria-haspopup="dialog"` triggers
 * are left out too: `ChatFab` is one, and it stays expanded for as long as its own panel is open.
 */
const OPEN_LAYER_SELECTOR = [
  '[aria-modal="true"]',
  '[role="menu"]:not([hidden])',
  '[aria-haspopup="menu"][aria-expanded="true"]',
  '[aria-haspopup="true"][aria-expanded="true"]',
  '[aria-haspopup="listbox"][aria-expanded="true"]',
].join(", ");

/** The same, plus native modal `<dialog>` and open `popover` — pseudo-classes an old browser rejects. */
const OPEN_LAYER_SELECTOR_MODERN = `${OPEN_LAYER_SELECTOR}, dialog[open]:modal, :popover-open`;

/**
 * @param input.key The pressed key (`KeyboardEvent.key`).
 * @param input.defaultPrevented `KeyboardEvent.defaultPrevented` — an inner handler that already
 *   consumed Escape (the composer's palette) says so this way.
 * @param input.root Where to look for an open layer — `document` in the app.
 * @returns `true` when the key is Escape and an inner layer already handled it or is open, so a
 *   container's own Escape handler should do nothing. Never throws: a browser without `:modal` /
 *   `:popover-open` support falls back to the ARIA check.
 * @complexity O(n) in DOM nodes for the selector query; runs once per Escape.
 */
export function isEscapeOwnedByInnerLayer(input: {
  key: string;
  defaultPrevented: boolean;
  root: InnerLayerQueryRoot;
}): boolean {
  if (input.key !== "Escape") return false;
  if (input.defaultPrevented) return true;
  return orFallbackSync({ work: () => {
    return input.root.querySelector(OPEN_LAYER_SELECTOR_MODERN) !== null;
  }, fallback: undefined, step: "Check modern Escape ownership" }) ?? (input.root.querySelector(OPEN_LAYER_SELECTOR) !== null);
}
