/**
 * @file Whether this document is on its way out — the one fact `api.ts` needs to tell a request the
 * browser cancelled because of a navigation apart from a request that found no server.
 *
 * Chromium rejects a `fetch` still in flight when the page navigates with `TypeError: Failed to
 * fetch` — the same type and text as a refused connection — and does so AFTER `pagehide` has fired
 * (live-probed 2026-09-13: `beforeunload` → `pagehide` → `visibilitychange:hidden` → the rejection).
 * `pagehide` rather than `beforeunload` because only `pagehide` has a `pageshow` counterpart: a page
 * restored from the back/forward cache fires `pageshow`, and its requests must report real failures
 * again.
 *
 * Listeners are installed at import (guarded for non-browser environments) rather than lazily on the
 * first request, so a `pagehide` that lands before this module's first caller is never missed.
 */

/** The two page events this module listens to — `window` in a browser, a plain `EventTarget` in a test. */
export interface PageLifecycleEvents {
  addEventListener(type: "pagehide" | "pageshow", listener: () => void): void;
}

/**
 * Tracks one document's unloading fact from `target`'s `pagehide`/`pageshow`. With no `target` (a
 * non-browser host, where `window` does not exist) nothing ever unloads, so it always reports `false`.
 *
 * @complexity O(1) per event and per read.
 */
export function createPageLifecycle({ target }: { target: PageLifecycleEvents | undefined }, _options = {}): { isPageUnloading: () => boolean } {
  let unloading = false;
  target?.addEventListener("pagehide", () => {
    unloading = true;
  });
  target?.addEventListener("pageshow", () => {
    unloading = false;
  });
  return { isPageUnloading: () => unloading };
}

// `globalThis.window` (not a bare `window`) so a non-browser import reads `undefined` instead of
// throwing a ReferenceError.
const pageLifecycle = createPageLifecycle({ target: globalThis.window });

/**
 * True between `pagehide` and the next `pageshow` — i.e. while the document is being unloaded or sits
 * in the back/forward cache.
 *
 * @complexity O(1).
 */
export function isPageUnloading(): boolean {
  return pageLifecycle.isPageUnloading();
}
