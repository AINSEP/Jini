/**
 * @file Pure route matching, driven by the panel registry rather than a hard-coded branch list.
 *
 * ## What changed from the ported original
 *
 * Tovu's `parseRoute` (`apps/admin/src/App.tsx:138`) is a ~30-line if-chain with one branch per
 * detail route — `/posts/:id`, `/menus/new`, `/widgets/regions/:key`,
 * `/collections/:key/:entryId`, and so on. It works, and its fall-through-to-dashboard behaviour
 * is deliberate. But it means a panel cannot own a URL without an edit to the router, which is
 * fatal for a package whose whole point is that hosts and AI-generated code add panels.
 *
 * Here the panel declares its patterns and the matcher is generic. Behaviour that is preserved
 * exactly, because each was a considered decision in the original:
 *
 * - **Unrecognized paths fall through** (`panelId: null`) rather than rendering a placeholder,
 *   so a typo behaves like a bad URL rather than an empty screen.
 * - **A bare single segment only matches a registered panel.** Testing against the registry
 *   rather than accepting any single segment is what keeps `/typo` from rendering an empty shell.
 * - **Trailing slashes are insignificant** — segments are split and empties dropped, so
 *   `/settings/` and `/settings` are the same screen.
 * - **Query is parsed but never part of matching.** Tovu's widget-editor route reads
 *   `?type=` for its initial state; that is panel state, not routing.
 */

import type { AdminPanel } from '../manifest/types.js';
import type { AdminRoute } from './types.js';

/** Default mount point. Overridable per call — a product that mounts its admin elsewhere passes
 *  its own base rather than patching this package. */
export const DEFAULT_ADMIN_BASE = '/admin';

/** `"/admin/settings/"` -> `"/admin/settings"`; leaves a lone `"/"` alone. */
export function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/** Route path -> URL. `/settings` -> `/admin/settings`; `/` -> `/admin/`. */
export function adminHref(routePath: string, base: string = DEFAULT_ADMIN_BASE): string {
  const normalized = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${base}${normalized}`;
}

/**
 * URL pathname -> route path, base stripped. Always starts with `/`.
 *
 * A bare `/admin` (no trailing slash) and `/admin/` both mean the dashboard, so the base is
 * removed by prefix rather than by assuming a trailing separator.
 *
 * Unlike Tovu's version this takes `pathname` as a required argument instead of defaulting to
 * `window.location.pathname` — that default is what made the original untestable without a DOM,
 * and it belongs in the browser layer, not here.
 */
export function currentRoutePath(pathname: string, base: string = DEFAULT_ADMIN_BASE): string {
  if (pathname === base) return '/';
  if (pathname.startsWith(`${base}/`)) return pathname.slice(base.length) || '/';
  // Reached only if the app is mounted somewhere unexpected; treat the whole path as the route
  // rather than silently returning the dashboard, so the mismatch is visible in the URL.
  return pathname || '/';
}

/**
 * Matches a route path against the registered panels.
 *
 * Callers should pass the **resolved** panel set (see `resolvePanels`), not the raw one — routing
 * to a panel whose capability is not wired would render a section the host deliberately withheld.
 *
 * @complexity O(p * r * s) — p panels, r patterns per panel, s segments per pattern. Bounded by
 * the manifest, and the common case exits on the first segment comparison.
 */
export function matchRoute<T>(routePath: string, panels: readonly AdminPanel<T>[]): AdminRoute {
  const [rawPath, rawQuery] = routePath.split('?');
  const segments = (rawPath ?? '').split('/').filter(Boolean);
  const query = new URLSearchParams(rawQuery ?? '');

  const miss = (panelId: string | null): AdminRoute => ({ panelId, view: null, params: {}, query });

  // Root is the dashboard by convention, and `dashboard` need not be registered for `/` to
  // resolve — the shell's fallback handles an empty registry.
  if (segments.length === 0) return miss('dashboard');

  const panel = panels.find((p) => p.id === segments[0]);
  if (!panel) return miss(null);

  const rest = segments.slice(1);
  // Bare panel segment: the index view.
  if (rest.length === 0) return miss(panel.id);

  for (const route of panel.routes ?? []) {
    const params = matchPattern(route.pattern, rest);
    if (params) return { panelId: panel.id, view: route.view, params, query };
  }

  // A registered panel with unmatched trailing segments. Falls through rather than rendering the
  // panel's index view, so `/posts/abc/typo` is a bad URL rather than silently showing the list.
  return miss(null);
}

/**
 * Matches one pattern against already-split segments.
 *
 * @returns captured params, or `null` when the pattern does not match. An empty object is a
 * successful match with no captures — which is why this returns `null` rather than `{}` for a
 * miss, and why callers must check for `null` explicitly rather than truthiness of the size.
 */
function matchPattern(pattern: string, segments: readonly string[]): Record<string, string> | null {
  const patternSegments = pattern.split('/').filter(Boolean);
  if (patternSegments.length !== segments.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i += 1) {
    const patternSegment = patternSegments[i] ?? '';
    const segment = segments[i] ?? '';
    if (patternSegment.startsWith(':')) {
      params[patternSegment.slice(1)] = segment;
      continue;
    }
    if (patternSegment !== segment) return null;
  }
  return params;
}
