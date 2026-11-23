import { useSyncExternalStore } from "react";
import { DEFAULT_ADMIN_BASE, adminHref as adminHrefCore, currentRoutePath as currentRoutePathCore } from "../../core/index.js";
import { createAdminShellNavigation } from "../../browser/shell-navigation.js";

/**
 * @file Path-based routing for the admin SPA — `/admin/settings`, not `/admin/#/section/settings`.
 *
 * **This file is now a thin adapter over `@jini-ai/admin`.** The route model
 * (`adminHref`/`currentRoutePath`) lives in `@jini-ai/admin/core` and the `window`-bound half
 * (`navigate`, the link interceptor, route subscription) in `@jini-ai/admin/browser`. What stays
 * here is only what is genuinely host-specific: the legacy `#/section/...` URL migration, and the
 * React hook. The full rationale for every rule below now lives in those modules' headers — this
 * file keeps the export surface its ~14 call sites already use so none of them had to change.
 *
 * Why paths at all: the hash was never load-bearing. Both places that serve this app already fall
 * back to `index.html` for any `/admin/*` depth — the host's admin static-file handler does it
 * explicitly (SEA and static-build branches), and Vite dev does it by default under
 * `base: "/admin/"`. So a real URL survives a refresh, and the hash was only costing us shareable
 * links.
 *
 * ## The base is fixed at `/admin`
 *
 * Not configurable here, and deliberately so — it is already hard-coded in `vite.config.ts`
 * (`base: "/admin/"`) and in the server's route patterns. Changing it means changing all three.
 * `@jini-ai/admin` takes a base parameter so another product can mount elsewhere; the host does not
 * use that, and `ADMIN_BASE` below stays the one place this app names it.
 *
 * ## Route paths vs URLs
 *
 * The distinction this module exists to keep straight, because collapsing it is what produced
 * `/admin/#/section/settings` in the first place:
 *   - a **route path** is base-agnostic and is what `App.tsx`'s parser consumes: `/`, `/settings`,
 *     `/posts/abc`.
 *   - a **URL** is what goes in an `href` or the address bar: `/admin/`, `/admin/settings`.
 * `adminHref` converts the first into the second; `currentRoutePath` recovers the first from the
 * address bar. Nothing else should be doing string surgery on `location`.
 */

export const ADMIN_BASE = DEFAULT_ADMIN_BASE;

/** `/settings` → `/admin/settings`; `/` → `/admin/`. */
export function adminHref({ routePath }: { routePath: string }, _options = {}): string {
  return adminHrefCore({ routePath }, { base: ADMIN_BASE });
}

/**
 * The current route path, base stripped. Always starts with `/`.
 *
 * Keeps the `window.location.pathname` default this app's call sites rely on. The package
 * deliberately requires the argument — that default is what made the original untestable without
 * a DOM — so the default is reapplied here, at the edge that already assumes a browser.
 */
export function currentRoutePath(_required: Record<string, never>, { pathname = window.location.pathname }: { pathname?: string } = {}): string {
  return currentRoutePathCore({ pathname }, { base: ADMIN_BASE });
}

/** Bind the shared browser ports to this SPA's window and fixed admin base. */
export function navigate({ routePath }: { routePath: string }, options: { replace?: boolean } = {}): void {
  createAdminShellNavigation({ location: window.location, window, document }).navigate({ routePath, base: ADMIN_BASE }, options);
}

/** Install the shared interceptor with this SPA's browser and fixed admin base. */
export function installInternalLinkInterceptor(): () => void {
  return createAdminShellNavigation({ location: window.location, window, document }).installLinkInterceptor({ base: ADMIN_BASE });
}

/** React's subscribe ABI is positional; the Jini boundary receives explicit browser ports. */
function subscribeToRoute(onChange: () => void): () => void {
  return createAdminShellNavigation({ location: window.location, window, document }).subscribe({ base: ADMIN_BASE, onChange });
}

/**
 * Translates a legacy hash URL to its path equivalent, in place, and reports whether it did.
 *
 * Moved with the rest of the router, although only a host whose admin once used the old hash router
 * has those URLs to carry: anywhere else the hash never starts with `#/` and this returns false.
 *
 * Bookmarks, anything the assistant wrote down, and muscle memory all still point at
 * `#/section/settings`. Without this they would land on the dashboard — the parser's fallback for
 * an unrecognized route — which looks like the link rotted rather than moved.
 *
 * `replaceState`, not `pushState`: the hash URL should not become a Back-button stop, or Back from
 * the redirected page would land on the hash URL and redirect forward again.
 */
export function redirectLegacyHashUrl(): boolean {
  const { hash } = window.location;
  if (!hash.startsWith("#/")) return false;
  /*
   * Only when the PATH carries no route of its own.
   *
   * A genuine legacy URL is always `/admin/#/section/seo`: the path is the bare base and the entire
   * route lives in the hash. If the path already names a route, then a `#/…` is an ordinary document
   * fragment that merely looks route-shaped, and rewriting on it throws the real route away —
   * `/admin/posts/abc#/section/seo` reloaded as `/admin/seo`, losing `/posts/abc` entirely.
   */
  if (currentRoutePath({}) !== "/") return false;
  const [rawPath, rawQuery] = hash.replace(/^#\/?/, "").split("?");
  /*
   * `section/` was an artifact of the hash router's own dispatch, never meaningful in a URL — but it
   * is only safe to strip when what remains is a single segment, which is the only shape the
   * parser's bare-section branch accepts.
   *
   * The case that forced the guard: `#/section/settings/foo` used to render Settings, because the old
   * parser matched on `section` + `settings` and ignored the trailing segment. Stripping
   * unconditionally turned it into `/admin/settings/foo`, which is multi-segment and falls through to
   * the dashboard — a silent behaviour change for a stored URL. Keeping the prefix in that case hands
   * it to the legacy `section/:id` branch, which still ignores extra segments as before.
   *
   * Known and accepted divergence: the segment count is taken on the RAW path, so an encoded slash
   * slips past it — `#/section/settings%2Ffoo` counts as one segment and gets stripped to
   * `/admin/settings%2Ffoo`, which resolves to the dashboard, where the old parser produced the
   * unknown-section placeholder. Decoding first would need a `try`/`catch` for malformed escapes, and
   * both outcomes are equally "you did not get a real screen" for a URL nobody has.
   */
  // `String#split` always yields at least one element, so the path part is always a string.
  const path = rawPath!;
  const stripped = path.replace(/^section\//, "");
  const canStrip = stripped.split("/").filter(Boolean).length === 1;
  const query = rawQuery ? `?${rawQuery}` : "";
  window.history.replaceState(null, "", adminHref({ routePath: "/" + (canStrip ? stripped : path) }) + query);
  return true;
}

/**
 * `useSyncExternalStore`'s required `getServerSnapshot` for {@link useRouteLocation} — named and
 * exported, rather than left as an inline arrow, so its contractually-required return value is
 * directly assertable. React only calls this during SSR/hydration; this admin is a pure-CSR Vite
 * SPA with no SSR entry point, so it never runs in production, but `useSyncExternalStore` still
 * requires the argument. `"/"` (route paths, not URLs — see this file's own doc) is the same safe,
 * unauthenticated-looking default `currentRoutePath` falls back to when nothing more specific is
 * knowable yet.
 */
export function getServerRouteSnapshot(): string {
  return "/";
}

/**
 * The address bar as an external store.
 *
 * `useSyncExternalStore` rather than `useState` + an effect: the URL is genuinely external state,
 * and reading it during render is what keeps the first paint from briefly showing the wrong route.
 * The snapshot is a string so React's identity check works without memoization — returning an
 * object here would re-render on every subscriber notification.
 *
 * Stays here rather than in `@jini-ai/admin/browser` because it imports React; it belongs in that
 * package's `/react` layer once that exists.
 */
export function useRouteLocation(): string {
  return useSyncExternalStore(
    subscribeToRoute,
    () => `${currentRoutePath({})}${window.location.search}`,
    getServerRouteSnapshot,
  );
}
