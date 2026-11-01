import assert from "node:assert/strict";
import { test } from "vitest";
import { toAbsoluteUrl } from "../absolute-url.js";

for (const baseUrl of ["http://localhost:3000", "http://127.0.0.1:4000", "https://user.github.io/repo/"]) {
  test(`render address ${baseUrl} takes precedence without mutating verified identity`, () => {
    const origin = { scheme: "https" as const, host: "saved.example", source: "workspace-setting" as const, verifiedAt: "2026-10-31T00:00:00Z" };
    assert.equal(toAbsoluteUrl({ origin, path: "/about", baseUrl }), `${baseUrl.replace(/\/$/, "")}/about`);
    assert.equal(toAbsoluteUrl({ origin, path: "/feed.xml", baseUrl }), `${baseUrl.replace(/\/$/, "")}/feed.xml`);
    assert.equal(toAbsoluteUrl({ origin, path: "https://external.example/override", baseUrl }), "https://external.example/override");
    assert.equal(origin.host, "saved.example");
  });
}

import { createSitemapService } from "../sitemap.js";
import { buildFeed } from "../feed.js";
import type { SeoSitemapDeps } from "../sitemap.js";

function emptyDeps(): SeoSitemapDeps {
  return { renderBaseUrl: undefined, clock: { nowIso: () => "2026-10-31T00:00:00Z" }, runtimeMode: "production",
    postRepo: { list: async () => [], findById: async () => null, isTrashed: () => false, extractPlainText: () => "" },
    settings: { getSeoSettings: async () => ({ titleTemplate: "%s", defaultRobots: { noindex: false, nofollow: false }, sitemapEnabled: true, robotsRules: [] }), isDefaultRobotsNoindexExplicitlySet: async () => false },
    originRegistry: { canonicalOrigin: async () => { throw new Error("A scoped render must not read stored identity"); }, isAllowedRedirectTarget: async () => false, isAllowedEgressTarget: async () => false },
    media: {} as SeoSitemapDeps["media"], urls: {} as SeoSitemapDeps["urls"], liveness: {} as SeoSitemapDeps["liveness"], isPubliclyAccessible: () => true };
}

test("sitemap contributors resolve against each render without entering the shared cache", async () => {
  const deps = emptyDeps(), service = createSitemapService({ deps });
  const contexts: string[] = [];
  service.registerSitemapCollectHook({ hook: { priority: 100, handle: async ctx => { contexts.push(ctx.baseUrl); return [{ loc: "/extra" }]; } } });
  const [a, b] = await Promise.all([service.buildSitemap({ workspaceId: "site" }, { renderBaseUrl: "http://localhost:3000" }),
    service.buildSitemap({ workspaceId: "site" }, { renderBaseUrl: "https://user.github.io/repo" })]);
  assert.deepEqual(a, [{ loc: "http://localhost:3000/extra" }]);
  assert.deepEqual(b, [{ loc: "https://user.github.io/repo/extra" }]);
  assert.deepEqual(contexts.sort(), ["http://localhost:3000", "https://user.github.io/repo"]);
  assert.deepEqual(await service.buildSitemap({ workspaceId: "site" }), [{ loc: "/extra" }]);
});

test("feed channel and self URL use scoped rendering even when the identity registry is unavailable", async () => {
  const deps = { ...emptyDeps(), renderBaseUrl: "https://user.github.io/repo/" };
  const feed = await buildFeed({ deps, input: { workspaceId: "site", siteTitle: "Site" } });
  assert.equal(feed.siteLink, "https://user.github.io/repo/");
  assert.equal(feed.feedUrl, "https://user.github.io/repo/feed.xml");
});

test("project URLs retain their prefix once and protocol-relative URLs become absolute", () => {
  const baseUrl = "https://user.github.io/repo/";
  assert.equal(toAbsoluteUrl({ origin: undefined, baseUrl, path: "/repo/about" }), "https://user.github.io/repo/about");
  assert.equal(toAbsoluteUrl({ origin: undefined, baseUrl, path: "//external.example/feed.xml" }), "https://external.example/feed.xml");
});
