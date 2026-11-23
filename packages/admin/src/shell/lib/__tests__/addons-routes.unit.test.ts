import { expect, it } from "vitest";
import { resolveAddonsRoute, type AddonsRoutePolicy } from "../addons-routes.js";
import { resolveImportExportRoute } from "../import-export-routes.js";

/** A neutral host policy: panels moved under `/extras`, one detail section, one legacy default tab.
 *  The host's real table and its redirect cases live in the host's own parity tests. */
const policy: AddonsRoutePolicy = {
  section: "extras",
  panelPaths: { alpha: "/extras/alpha", hub: "/extras/hub", links: "/extras/hub?tab=links" },
  detail: { legacySection: "links", panelId: "hub" },
  legacyDefaults: { links: { path: "/extras/hub", tab: "links" } },
};

it.each([
  ["/alpha", "/extras/alpha"],
  ["/hub/?tab=x&c=a%2Bb", "/extras/hub?tab=x&c=a%2Bb"],
  ["/links", "/extras/hub?tab=links"],
  ["/links?c=1", "/extras/hub?c=1&tab=links"],
  ["/links?tab=other", "/extras/hub?tab=other"],
  ["/links?", "/extras/hub?&tab=links"],
  ["/links/d%2F1?c=1", "/extras/hub/d%2F1?c=1"],
])("resolves legacy %s to %s", (routePath, redirectPath) => {
  expect(resolveAddonsRoute({ routePath, policy })).toStrictEqual({ matchPath: routePath, redirectPath });
});

it.each([
  ["/extras/alpha?tab=a", "/alpha?tab=a"],
  ["/extras/hub", "/hub"],
  ["/extras/hub/d%2F1?c=1", "/links/d%2F1?c=1"],
  ["/extras/alpha?q=a?b", "/alpha?q=a?b"],
])("adapts current %s to stable panel path %s without redirecting", (routePath, matchPath) => {
  expect(resolveAddonsRoute({ routePath, policy })).toStrictEqual({ matchPath });
});

it.each(["/", "/other", "/alpha/x", "/links/d/x", "/extras", "/extras/unknown", "/extras/hub/d/x", "/constructor", "/extras/constructor"])(
  "leaves unrelated or invalid %s to the existing matcher",
  (routePath) => {
    expect(resolveAddonsRoute({ routePath, policy })).toStrictEqual({ matchPath: routePath });
  },
);

it("ignores detail and default rules a policy does not declare", () => {
  const bare: AddonsRoutePolicy = { section: "extras", panelPaths: { links: "/extras/links" } };
  expect(resolveAddonsRoute({ routePath: "/links", policy: bare })).toStrictEqual({ matchPath: "/links", redirectPath: "/extras/links" });
  expect(resolveAddonsRoute({ routePath: "/links/d1", policy: bare })).toStrictEqual({ matchPath: "/links/d1" });
});

it("sends only the policy's moved tabs of its old section to the new page", () => {
  const moved = { fromSection: "old", movedTabs: new Set(["a"]), destinationPath: "/new" };
  expect(resolveImportExportRoute({ routePath: "/old/?tab=a&x=1", policy: moved })).toStrictEqual({ matchPath: "/new?tab=a", redirectPath: "/new?tab=a" });
  for (const routePath of ["/old", "/old?tab=b", "/old?tab=A", "/new?tab=a", "/old/a"]) {
    expect(resolveImportExportRoute({ routePath, policy: moved }), routePath).toBeUndefined();
  }
});
