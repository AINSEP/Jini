import type { RouteInputContext, RouteRequestFacts } from "@jini-ai/core/contracts/server";
import { describe, expect, it } from "vitest";
import { feedRoute, type FeedRouteDeps } from "../feed.js";
import { robotsRoute, type RobotsRouteDeps } from "../robots.js";
import { sitemapRoute, type SitemapRouteDeps } from "../sitemap.js";

const CACHE = "public, max-age=60";
const signal = new AbortController().signal;

function rawWith(facts: RouteRequestFacts | undefined): RouteInputContext {
  return { params: {}, query: {}, body: undefined, ...(facts === undefined ? {} : { facts }) } as unknown as RouteInputContext;
}
const facts = (servingOrigin?: string): RouteRequestFacts => ({ clientAddress: "203.0.113.9", ...(servingOrigin === undefined ? {} : { servingOrigin }) });

function sitemapDeps(overrides: Partial<SitemapRouteDeps> = {}): SitemapRouteDeps & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    workspaceId: "ws", cacheControl: CACHE, seoReady: Promise.resolve(), seoDeps: { renderBaseUrl: "https://stored.test" },
    buildSitemap: async (input, optional) => { calls.push({ input, optional }); return [{ loc: `${optional.renderBaseUrl}/a`, lastmod: "2026-01-01T00:00:00.000Z" }]; },
    calls, ...overrides,
  };
}

describe("sitemapRoute", () => {
  it("is a GET on /sitemap.xml that opts into request facts", () => {
    expect(sitemapRoute).toMatchObject({ method: "get", path: "/sitemap.xml", requestFacts: true });
  });

  it("answers the sitemap xml with the serving origin, the host cache policy and the xml content type", async () => {
    const deps = sitemapDeps();
    const res = await sitemapRoute.handle({ raw: rawWith(facts("https://www.example.test:8443")), deps }, { signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/xml; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe(CACHE);
    expect(await res.text()).toContain("<url><loc>https://www.example.test:8443/a</loc><lastmod>2026-01-01T00:00:00.000Z</lastmod></url>");
    expect(deps.calls).toEqual([{ input: { workspaceId: "ws" }, optional: { renderBaseUrl: "https://www.example.test:8443" } }]);
  });

  it("falls back to the stored origin when the host could form no serving origin", async () => {
    const deps = sitemapDeps();
    const res = await sitemapRoute.handle({ raw: rawWith(facts()), deps }, { signal });
    expect(await res.text()).toContain("<loc>https://stored.test/a</loc>");
  });

  it("refuses (throws) when the host supplied no request facts, after the readiness gate", async () => {
    const order: string[] = [];
    const deps = sitemapDeps({ seoReady: Promise.resolve().then(() => { order.push("ready"); }), buildSitemap: async () => { order.push("build"); return []; } });
    await expect(sitemapRoute.handle({ raw: rawWith(undefined), deps }, { signal })).rejects.toThrow(/request facts/);
    expect(order).toEqual(["ready"]);
  });

  it("lets a readiness or build failure propagate to the host failure writer", async () => {
    const boom = new Error("post store unavailable");
    await expect(sitemapRoute.handle({ raw: rawWith(facts("https://o.test")), deps: sitemapDeps({ buildSitemap: async () => { throw boom; } }) }, { signal })).rejects.toBe(boom);
    await expect(sitemapRoute.handle({ raw: rawWith(facts("https://o.test")), deps: sitemapDeps({ seoReady: Promise.reject(boom) }) }, { signal })).rejects.toBe(boom);
  });
});

function robotsDeps(renderBaseUrl: string | undefined): RobotsRouteDeps {
  return {
    workspaceId: "ws", cacheControl: CACHE, seoReady: Promise.resolve(),
    seoDeps: {
      renderBaseUrl,
      runtimeMode: "production",
      originRegistry: { getVerifiedOrigin: async () => undefined },
      settings: { getSeoSettings: async () => ({ sitemapEnabled: true, robotsRules: [{ userAgent: "*", allow: ["/"], disallow: ["/admin"] }] }) },
    } as unknown as RobotsRouteDeps["seoDeps"],
  };
}

describe("robotsRoute", () => {
  it("is a GET on /robots.txt that opts into request facts", () => {
    expect(robotsRoute).toMatchObject({ method: "get", path: "/robots.txt", requestFacts: true });
  });

  it("writes the policy with the Sitemap line on the serving origin, as plain text with the host cache policy", async () => {
    const res = await robotsRoute.handle({ raw: rawWith(facts("https://www.example.test")), deps: robotsDeps("https://stored.test") }, { signal });
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe(CACHE);
    const body = await res.text();
    expect(body).toMatch(/^User-agent: \*\nAllow: \/\nDisallow: \/admin\n\nSitemap: /);
    expect(body).toMatch(/^Sitemap: https:\/\/www\.example\.test\/sitemap\.xml\n$/m);
    expect(body.endsWith("\n")).toBe(true);
  });

  it("keeps the stored origin when no serving origin was formed", async () => {
    const res = await robotsRoute.handle({ raw: rawWith(facts()), deps: robotsDeps("https://stored.test") }, { signal });
    expect(await res.text()).toMatch(/^Sitemap: https:\/\/stored\.test\/sitemap\.xml\n$/m);
  });

  it("refuses when the host supplied no request facts", async () => {
    await expect(robotsRoute.handle({ raw: rawWith(undefined), deps: robotsDeps("https://stored.test") }, { signal })).rejects.toThrow(/request facts/);
  });
});

function feedDeps(): FeedRouteDeps {
  return {
    workspaceId: "ws", cacheControl: CACHE, seoReady: Promise.resolve(),
    resolveSiteTitle: async () => "Site & Co",
    seoDeps: { renderBaseUrl: "https://stored.test", postRepo: { list: async () => [] }, clock: { nowIso: () => "2026-01-01T00:00:00.000Z" } } as unknown as FeedRouteDeps["seoDeps"],
  };
}

describe("feedRoute", () => {
  it("is a GET on /feed.xml that opts into request facts", () => {
    expect(feedRoute).toMatchObject({ method: "get", path: "/feed.xml", requestFacts: true });
  });

  it("renders the RSS channel for the resolved title on the serving origin", async () => {
    const res = await feedRoute.handle({ raw: rawWith(facts("https://www.example.test")), deps: feedDeps() }, { signal });
    expect(res.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe(CACHE);
    const body = await res.text();
    expect(body).toContain("<title>Site &amp; Co</title>");
    expect(body).toContain("https://www.example.test/feed.xml");
  });

  it("refuses when the host supplied no request facts", async () => {
    await expect(feedRoute.handle({ raw: rawWith(undefined), deps: feedDeps() }, { signal })).rejects.toThrow(/request facts/);
  });
});

it("emits no phantom directive or newline when robots rules and sitemap are both disabled", async () => {
  const deps = robotsDeps("https://stored.test");
  const getSeoSettings = async () => ({ sitemapEnabled: false, robotsRules: [] });
  const res = await robotsRoute.handle({
    raw: rawWith(facts()), deps: { ...deps, seoDeps: { ...deps.seoDeps, settings: { getSeoSettings } as RobotsRouteDeps['seoDeps']['settings'] } },
  }, { signal });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("");
});

it("writes only the allow and disallow directives that each robots agent actually declares", async () => {
  const deps = robotsDeps("https://stored.test");
  const getSeoSettings = async () => ({ sitemapEnabled: false, robotsRules: [
    { userAgent: "IndexBot", allow: ["/reference"] }, { userAgent: "ArchiveBot", disallow: ["/drafts"] },
  ] });
  const res = await robotsRoute.handle({
    raw: rawWith(facts()), deps: { ...deps, seoDeps: { ...deps.seoDeps, settings: { getSeoSettings } as RobotsRouteDeps['seoDeps']['settings'] } },
  }, { signal });
  expect(await res.text()).toBe("User-agent: IndexBot\nAllow: /reference\n\nUser-agent: ArchiveBot\nDisallow: /drafts\n\n");
});
