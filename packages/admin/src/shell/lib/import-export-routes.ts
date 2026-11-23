import type { AddonsRouteResolution } from "./addons-routes.js";

/**
 * @file Moved-tab redirect: a host that moves some tabs of one section to another page sends the old
 * `/<fromSection>?tab=<moved>` links (bookmarks, chat history, an older desktop build's button) to the
 * new tab. The host runs this BEFORE its section route gate, so a host without the old section still
 * lands on the new tab rather than its dashboard. The host owns the policy and passes it in.
 */
export interface MovedTabsRoutePolicy {
  /** The old section's single path segment. */
  readonly fromSection: string;
  /** Tab values that moved; any other tab stays on the old section. */
  readonly movedTabs: ReadonlySet<string>;
  /** The page those tabs now live on, without a query. */
  readonly destinationPath: string;
}

/**
 * @param input Base-agnostic route path, including its query string, and the host's policy.
 * @returns Matcher path and redirect for an old moved-tab link; `undefined` otherwise.
 *   No side effects or errors.
 * @example resolveImportExportRoute({ routePath: "/old?tab=a", policy: { fromSection: "old", movedTabs: new Set(["a"]), destinationPath: "/new" } })
 *   // → { matchPath: "/new?tab=a", redirectPath: "/new?tab=a" }
 * @complexity O(n) in URL length.
 */
export function resolveImportExportRoute(
  { routePath, policy }: { readonly routePath: string; readonly policy: MovedTabsRoutePolicy },
  _options = {},
): AddonsRouteResolution | undefined {
  const queryStart = routePath.indexOf("?");
  const pathname = queryStart === -1 ? routePath : routePath.slice(0, queryStart);
  if (pathname.split("/").filter(Boolean).join("/") !== policy.fromSection) return undefined;
  const tab = new URLSearchParams(routePath.slice(pathname.length)).get("tab");
  if (tab === null || !policy.movedTabs.has(tab)) return undefined;
  const destination = `${policy.destinationPath}?tab=${tab}`;
  return { matchPath: destination, redirectPath: destination };
}
