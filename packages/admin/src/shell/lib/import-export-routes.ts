import type { AddonsRouteResolution } from "./addons-routes.js";

/**
 * @file Sites → Export Site / Import Site moved to Operations → Import & Export as tabs (owner,
 * 2026-10-25). Old `/sites?tab=export|import` links — bookmarks, chat history, an older desktop
 * build's "Import site" button — are sent to the new tab. `App.tsx`'s `parseRoute` runs this BEFORE
 * the Sites route gate, so a host with no Sites section lands on the tab, not the dashboard.
 */
const MOVED_SITES_TABS: ReadonlySet<string> = new Set(["export", "import"]);

/**
 * @param input Base-agnostic route path, including its query string.
 * @returns Matcher path and redirect for an old Sites export/import link; `undefined` otherwise.
 *   No side effects or errors.
 * @example resolveImportExportRoute({ routePath: "/sites?tab=import" })
 *   // → { matchPath: "/import-export?tab=import", redirectPath: "/import-export?tab=import" }
 * @complexity O(n) in URL length.
 */
export function resolveImportExportRoute({ routePath }: { readonly routePath: string }): AddonsRouteResolution | undefined {
  const queryStart = routePath.indexOf("?");
  const pathname = queryStart === -1 ? routePath : routePath.slice(0, queryStart);
  if (pathname.split("/").filter(Boolean).join("/") !== "sites") return undefined;
  const tab = new URLSearchParams(routePath.slice(pathname.length)).get("tab");
  if (tab === null || !MOVED_SITES_TABS.has(tab)) return undefined;
  const destination = `/import-export?tab=${tab}`;
  return { matchPath: destination, redirectPath: destination };
}
