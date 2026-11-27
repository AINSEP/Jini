import { describe, expect, it, vi } from "vitest";
import { buildRouteManifest, type RouteManifestSources, type RouteManifestPolicy } from "../route-manifest.js";

const policy: RouteManifestPolicy = {
  initialRoutes: [{ path: "/", kind: "home", label: "home" }], initialSkips: [],
  probeBase: "probe", probeSuffix: () => "next",
  postPath: ({ slug }) => slug === "/" ? "/" : `/${slug}`,
  productPaths: { list: "/products", detail: ({ slug }) => `/products/${slug}` },
  isStandaloneThemePage: ({ pageId }) => !["index", "404", "shell"].includes(pageId),
  skipCopy: { absent: "absent", deliberatelyOff: "off", nonExactRedirect: ({ matchType }) => matchType },
};
const theme: Awaited<ReturnType<RouteManifestSources["readThemeAndPosts"]>>["theme"] = {
  kind: "selected", identity: { id: "theme", dir: "/theme" }, tier: "static", pages: ["index", "about", "shell"],
};

describe("buildRouteManifest", () => {
  it("explicit false preserves the standalone theme route while an unset override preserves the post", async () => {
    for (const overridesThemePage of [false, undefined]) {
      const result = await buildRouteManifest({ policy, sources: {
        readThemeAndPosts: async () => ({ theme, posts: [{ slug: "about", title: "About", kind: "page", overridesThemePage }] }),
        listProducts: async () => [], listActiveRedirects: async () => [],
      } });
      expect(result.routes.find(row => row.path === "/about")?.kind).toBe(overridesThemePage === false ? "theme-page" : "page");
    }
  });

  it("404 probe cannot collide with any contributed path", async () => {
    const result = await buildRouteManifest({ policy, sources: {
      readThemeAndPosts: async () => ({ theme, posts: [] }), listProducts: async () => [],
      listActiveRedirects: async () => [{ matchType: "exact", fromPattern: "/probe", toTarget: "/about", statusCode: 301 }],
    } });
    expect(result.routes.at(-1)).toEqual({ path: "/probe-next", kind: "not-found", label: "404" });
  });

  it("replaces only the seeded homepage, omits products, and keeps stable source order", async () => {
    const order: string[] = [];
    const result = await buildRouteManifest({ policy, sources: {
      readThemeAndPosts: async () => { order.push("theme/posts"); return { theme, posts: [{ slug: "/", title: "Start", kind: "page" }] }; },
      listProducts: async () => { order.push("products"); return []; },
      listActiveRedirects: async () => { order.push("redirects"); return [{ matchType: "exact", fromPattern: "/old", toTarget: "/", statusCode: 302 }]; },
    } });
    expect(order).toEqual(["theme/posts", "products", "redirects"]);
    expect(result.routes.map(row => row.path)).toEqual(["/", "/about", "/old", "/probe"]);
    expect(result.routes[0]).toEqual({ path: "/", kind: "page", label: "Start" });
    expect(policy.initialRoutes).toEqual([{ path: "/", kind: "home", label: "home" }]);
    expect(policy.initialSkips).toEqual([]);
  });

  it("keeps absent and deliberately-off skip details distinct and omits activeTheme", async () => {
    for (const kind of ["absent", "deliberately-off"] as const) {
      const result = await buildRouteManifest({ policy, sources: {
        readThemeAndPosts: async () => ({ theme: { kind }, posts: [] }),
        listProducts: vi.fn(async () => []), listActiveRedirects: async () => [],
      } });
      expect(result.skipped).toEqual([{ reason: "no-theme", detail: kind === "absent" ? "absent" : "off" }]);
      expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty("activeTheme");
    }
  });
});

it("exports the storefront and exact redirects while reporting non-exact rules", async () => {
  const result = await buildRouteManifest({ policy: {
    ...policy,
    initialSkips: [{ reason: "host-filter", detail: "Internal page" }],
    productPaths: { list: "/shop", detail: ({ slug }) => `/shop/item/${slug}` },
    skipCopy: { ...policy.skipCopy, nonExactRedirect: ({ matchType, fromPattern, toTarget }) => `${matchType}: ${fromPattern} -> ${toTarget}` },
  }, sources: {
    readThemeAndPosts: async () => ({
      theme: { kind: "selected", identity: { id: "cms", dir: "/themes/cms" }, tier: "dynamic", pages: ["about"] },
      posts: [{ slug: "news", title: "News", kind: "post" }],
    }),
    listProducts: async () => [{ slug: "zine", title: "Quarterly Zine" }, { slug: "mug", title: "Studio Mug" }],
    listActiveRedirects: async () => [
      { matchType: "prefix", fromPattern: "/legacy", toTarget: "/archive", statusCode: 301 },
      { matchType: "exact", fromPattern: "/store", toTarget: "/shop", statusCode: 308 },
      { matchType: "regex", fromPattern: "/item-(.*)", toTarget: "/shop/item/$1", statusCode: 302 },
    ],
  } });

  expect(result).toEqual({
    activeTheme: { id: "cms", dir: "/themes/cms" },
    routes: [
      { path: "/", kind: "home", label: "home" },
      { path: "/news", kind: "post", label: "News" },
      { path: "/shop", kind: "product-list", label: "products" },
      { path: "/shop/item/zine", kind: "product", label: "Quarterly Zine" },
      { path: "/shop/item/mug", kind: "product", label: "Studio Mug" },
      { path: "/store", kind: "redirect", label: "/store", redirectTarget: "/shop", redirectStatusCode: 308 },
      { path: "/probe", kind: "not-found", label: "404" },
    ],
    skipped: [
      { reason: "host-filter", detail: "Internal page" },
      { reason: "non-exact-redirect", detail: "prefix: /legacy -> /archive" },
      { reason: "non-exact-redirect", detail: "regex: /item-(.*) -> /shop/item/$1" },
    ],
  });
});
