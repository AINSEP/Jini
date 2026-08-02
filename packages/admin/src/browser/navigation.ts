/**
 * @file `window`-bound navigation. DOM, but no React.
 *
 * Ported from Tovu's `lib/router.ts`. Separated from `core/routing` because that module must stay
 * universal — a Vue consumer, an SSR pass, or a test asserting route rules should not need a DOM.
 * Everything here genuinely touches `window`; everything that does not stayed in core.
 *
 * This is not a fourth architectural layer so much as an honest home for four functions. It
 * follows the `src/browser/` split `@jini-ai/ui` already uses.
 */

import { DEFAULT_ADMIN_BASE, adminHref, currentRoutePath, stripTrailingSlash } from '../core/routing/rules.js';

/** Fires on `navigate()`. `pushState` does not emit `popstate`, so subscribers need this too. */
export const NAVIGATION_EVENT = 'jini:admin-navigate';

/** The current route path, read from the address bar. */
export function readRoutePath(base: string = DEFAULT_ADMIN_BASE): string {
  return currentRoutePath(window.location.pathname, base);
}

/**
 * Navigates without a page load.
 *
 * Takes a *route path*, not a URL — passing `/admin/settings` here would produce
 * `/admin/admin/settings`, which is exactly the class of mistake `adminHref` prevents.
 */
export function navigate(
  routePath: string,
  options: { readonly replace?: boolean; readonly base?: string } = {},
): void {
  const base = options.base ?? DEFAULT_ADMIN_BASE;
  const url = adminHref(routePath, base);

  /*
   * Navigating to where you already are is a no-op, not a history entry. Without this, clicking
   * the already-active sidebar link five times pushes five identical entries and Back appears
   * stuck on the same screen.
   *
   * Both sides go through `URL` before comparing rather than string-matching. `pushState` stores a
   * *normalized* URL, so a path containing anything the browser percent-encodes (a space, any
   * non-ASCII character) comes back out of `location.pathname` in a different spelling than
   * `adminHref` produced — `/admin/collections/my recipe` vs `/admin/collections/my%20recipe`.
   * Comparing raw strings there silently fails to match and pushes the duplicate anyway, which is
   * the exact bug this guard exists to prevent.
   *
   * Trailing slash is normalized away because the matcher drops empty segments, so `/settings/`
   * and `/settings` are the same screen. Query and hash are compared in full: a
   * same-path/different-query navigation is a real one.
   */
  const target = new URL(url, window.location.href);
  const isCurrent =
    stripTrailingSlash(target.pathname) === stripTrailingSlash(window.location.pathname) &&
    target.search === window.location.search &&
    target.hash === window.location.hash;
  if (isCurrent) return;

  if (options.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}

/**
 * Turns clicks on internal `<a href="/admin/...">` links into SPA navigations.
 *
 * A document-level listener rather than a `<Link>` component, and deliberately so: panel markup
 * should stay plain anchors, because they are real URLs that middle-click, cmd-click and "copy
 * link address" should all treat normally. Intercepting only the plain-left-click case preserves
 * every one of those behaviours for free, where a `<Link>` component would have to re-implement
 * them.
 *
 * @returns a teardown function.
 */
export function installInternalLinkInterceptor(base: string = DEFAULT_ADMIN_BASE): () => void {
  const onClick = (event: MouseEvent) => {
    // Anything but an unmodified primary click is the browser's to handle: cmd/ctrl-click opens a
    // tab, shift-click a window, alt-click downloads.
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = (event.target as Element | null)?.closest?.('a');
    if (!anchor) return;
    if (anchor.hasAttribute('download')) return;
    // An explicit target (`_blank`, a frame name) is an explicit request not to navigate in place.
    const target = anchor.getAttribute('target');
    if (target && target !== '_self') return;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) return;

    // `anchor.href` is the resolved absolute form, which is what makes relative hrefs and
    // cross-origin links both fall out correctly.
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return;

    event.preventDefault();
    // `url.hash` is carried through: an in-page fragment (`/admin/settings#seo-defaults`) is not a
    // routing concern, but dropping it silently loses the anchor. It never reaches the matcher —
    // the route snapshot is path + query only — so preserving it cannot affect routing.
    navigate(`${currentRoutePath(url.pathname, base)}${url.search}${url.hash}`, { base });
  };

  document.addEventListener('click', onClick);
  return () => document.removeEventListener('click', onClick);
}

/** Subscribes to route changes from both `popstate` and programmatic `navigate()`. */
export function subscribeToRoute(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATION_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATION_EVENT, onChange);
  };
}
