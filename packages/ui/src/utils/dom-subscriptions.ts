// Small, framework-free DOM subscription helpers. Every function here is a
// no-op outside the browser (SSR) and returns a cleanup function for the
// subscription variants, so callers can wire them directly into a React
// effect's cleanup return (or any other lifecycle hook) without adapting
// the shape.
//
// Ported from a chat-surface-scoped `providers/dom/*.dom.ts` pair in the
// source project, where these were filed under one feature's "DOM bridges"
// despite having no feature-specific logic in their bodies — see
// archived UI provenance ledger for the reclassification note.

export interface ViewportSize {
  width: number;
  height: number;
}

/** The current viewport size, or a zero-size fallback outside the browser (SSR). */
export function getViewportSize(): ViewportSize {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}

/** The document body, or `null` outside the browser (SSR). */
export function getDocumentBody(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.body;
}

/**
 * Fires `onClose` on a `pointerdown` outside `container.current`, or on
 * non-composing Escape anywhere. A no-op subscription outside the browser (SSR).
 *
 * Uses `pointerdown` (not `mousedown`/`click`) to match every real popover/
 * dropdown call site that dismisses on outside interaction (verified against
 * `ViewportSwitcher`/`BrowserViewportControls` in `packages/ui/src/browser/
 * useDismissOnOutsideOrEscape.ts`'s callers) — it fires before `mouseup`-based
 * text selection can interfere and covers touch input `click` doesn't.
 *
 * @param container - A ref-like box holding the element to treat as
 *   "inside" (any click within it is ignored). Omit entirely (`undefined`)
 *   to skip the outside-click listener and react to Escape only — e.g. a
 *   modal whose backdrop click is already handled by the caller.
 * @param onClose - Called once per qualifying outside-click or Escape key.
 * @param options.escapeCapture - Listen before bubbling handlers when true; defaults to bubble.
 * @returns A cleanup function that removes the listener(s) that were added.
 */
export function subscribeOutsideClickOrEscape(
  { container, onClose }: { container: { current: HTMLElement | null } | undefined; onClose: () => void },
  options: { escapeCapture?: boolean | undefined } = {},
): () => void {
  if (typeof document === 'undefined') return () => {};
  function onPointer(e: PointerEvent) {
    const target = e.target as Node;
    if (container?.current?.contains(target)) return;
    onClose();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !e.isComposing) onClose();
  }
  if (container) document.addEventListener('pointerdown', onPointer);
  if (options.escapeCapture) document.addEventListener('keydown', onKey, true);
  else document.addEventListener('keydown', onKey);
  return () => {
    if (container) document.removeEventListener('pointerdown', onPointer);
    if (options.escapeCapture) document.removeEventListener('keydown', onKey, true);
    else document.removeEventListener('keydown', onKey);
  };
}

/**
 * Adds a `window` event listener for `eventName` and returns the matching
 * removal function. A no-op subscription outside the browser (SSR).
 */
export function subscribeWindowEvent(
  { eventName, onEvent }: { eventName: string; onEvent: (event: Event) => void },
  _optional: Record<string, never> = {},
): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(eventName, onEvent);
  return () => window.removeEventListener(eventName, onEvent);
}

/**
 * Fires `onVisible` when the tab regains focus or becomes visible again
 * (e.g. returning from an external OAuth/redirect tab) — skipped while the
 * tab itself is hidden, since `visibilitychange` also fires on the way out.
 * A no-op subscription outside the browser (SSR).
 */
export function subscribeVisibleFocusOrVisibilityChange({ onVisible }: { onVisible: () => void }, _optional: Record<string, never> = {}): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => {
    if (document.visibilityState === 'hidden') return;
    onVisible();
  };
  window.addEventListener('focus', handler);
  document.addEventListener('visibilitychange', handler);
  return () => {
    window.removeEventListener('focus', handler);
    document.removeEventListener('visibilitychange', handler);
  };
}

/** Runs `callback` every `ms` via `window.setInterval`; the returned
 *  function clears it. A no-op outside the browser (SSR). */
export function scheduleInterval({ callback, ms }: { callback: () => void; ms: number }, _optional: Record<string, never> = {}): () => void {
  if (typeof window === 'undefined') return () => {};
  const id = window.setInterval(callback, ms);
  return () => window.clearInterval(id);
}

/** Runs `callback` once after `ms` via `window.setTimeout`; the returned
 *  function cancels it. A no-op outside the browser (SSR). */
export function scheduleTimeout({ callback, ms }: { callback: () => void; ms: number }, _optional: Record<string, never> = {}): () => void {
  if (typeof window === 'undefined') return () => {};
  const id = window.setTimeout(callback, ms);
  return () => window.clearTimeout(id);
}

/** Opens `url` in a new tab (`noopener,noreferrer`); a no-op outside the
 *  browser (SSR). */
export function openExternalUrl({ url }: { url: string }, _optional: Record<string, never> = {}): void {
  if (typeof window === 'undefined') return;
  window.open(url, '_blank', 'noopener,noreferrer');
}
