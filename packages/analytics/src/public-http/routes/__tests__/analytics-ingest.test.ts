import { describe, expect, it } from "vitest";

import type { AnalyticsSaltContext, AnalyticsSiteConfig, NormalizedHit } from "../../../index.js";
import { createLocalAnalyticsSink } from "../../../site/jini-adapters.js";
import { createAnalyticsForwardLimiter } from "../../../forwarding.js";
import { analyticsIngestRoute, type AnalyticsIngestBeaconRouteDeps } from "../analytics-ingest.js";

/** @file Spec-level coverage of `POST /_analytics/e`: the answer is ALWAYS an empty 204 (no oracle). */

const signal = new AbortController().signal;
const saltContext: AnalyticsSaltContext = { extractionSalt: "test-salt-v1", infoPrefix: "analytics-salt:" };
const baseConfig = {
  workspaceId: "ws-1", enabled: true, honorDoNotTrack: true, honorGlobalPrivacyControl: true,
  rawRetentionDays: 30, excludedPaths: [], excludedIpRanges: [], sink: "local",
} as unknown as AnalyticsSiteConfig;

interface Harness {
  deps: AnalyticsIngestBeaconRouteDeps;
  sink: ReturnType<typeof createLocalAnalyticsSink>;
  log: { resolved: string[]; captured: unknown[]; forwarders: number; hookHits: number; clockReads: number; configReads: number };
}

function harness(overrides: Partial<AnalyticsIngestBeaconRouteDeps> = {}, config: Partial<AnalyticsSiteConfig> = {}): Harness {
  const sink = createLocalAnalyticsSink({});
  const log: Harness["log"] = { resolved: [], captured: [], forwarders: 0, hookHits: 0, clockReads: 0, configReads: 0 };
  const deps: AnalyticsIngestBeaconRouteDeps = {
    ingest: {
      clock: { nowMs: () => { log.clockReads += 1; return Date.parse("2026-11-01T10:00:00.000Z"); } },
      ids: { newId: () => "id-1" },
      sink,
      config: { get: async () => { log.configReads += 1; return { ...baseConfig, ...config } as AnalyticsSiteConfig; } },
      resolveWorkspaceForHost: (host: string) => { log.resolved.push(host); return "ws-1"; },
      analyticsSeed: "seed-for-test",
      saltContext,
      reportForwardFailure: () => {},
      hooks: { beforeIngest: async ({ hit }: { hit: NormalizedHit }) => { log.hookHits += 1; return hit; } },
    } as AnalyticsIngestBeaconRouteDeps["ingest"],
    limiter: createAnalyticsForwardLimiter(),
    forwarders: async () => { log.forwarders += 1; return []; },
    capturePageview: (event) => { log.captured.push(event); },
    hostname: () => "site.example",
    clientAddress: () => "198.51.100.7",
    ...overrides,
  };
  return { deps, sink, log };
}

async function post(h: Harness, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return analyticsIngestRoute.handle({ raw: { body, query: {}, params: {}, headers }, deps: h.deps }, { signal });
}

async function expectEmpty204(response: Response): Promise<void> {
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
}

describe("analyticsIngestRoute", () => {
  it("pins the method, path and the only request headers it reads", () => {
    expect(analyticsIngestRoute.method).toBe("post");
    expect(analyticsIngestRoute.path).toBe("/_analytics/e");
    expect([...(analyticsIngestRoute.readHeaders ?? [])].sort()).toEqual(["accept-language", "dnt", "sec-gpc", "user-agent"]);
  });

  it.each([["dnt"], ["sec-gpc"]])("a %s: 1 header answers 204 before any clock, config or sink read", async (header) => {
    const h = harness();
    await expectEmpty204(await post(h, { path: "/a" }, { [header]: "1" }));
    expect(h.log).toMatchObject({ clockReads: 0, configReads: 0, forwarders: 0, resolved: [] });
    expect(h.sink.all()).toEqual([]);
  });

  it("records an accepted pageview and answers an empty 204", async () => {
    const h = harness();
    await expectEmpty204(await post(h, { host: "other.example", path: "/hello", kind: "pageview" }, { "user-agent": "Mozilla/5.0 Firefox/120" }));
    expect(h.log.resolved).toEqual(["other.example"]);
    expect(h.sink.all().map((hit) => [hit.path, hit.kind])).toEqual([["/hello", "pageview"]]);
    expect(h.log.forwarders).toBe(1);
  });

  it("falls back to the request hostname when the body's host is absent, empty or not a string", async () => {
    for (const host of [undefined, "", 42]) {
      const h = harness();
      await post(h, { host, path: "/x" });
      expect(h.log.resolved).toEqual(["site.example"]);
    }
  });

  it("falls back to an empty host when the request has no hostname", async () => {
    const h = harness({ hostname: () => undefined });
    await post(h, { path: "/x" });
    expect(h.log.resolved).toEqual([""]);
  });

  it("bounds every untrusted field and ignores a non-object body", async () => {
    const h = harness();
    await post(h, { host: "h".repeat(400), path: "/" + "p".repeat(3000), kind: "event", eventName: "e".repeat(500), eventProps: ["not", "an", "object"] });
    expect(h.log.resolved[0]).toHaveLength(253);
    const [hit] = h.sink.all();
    expect(hit?.path.length).toBeLessThanOrEqual(2048);
    expect(hit?.eventName).toHaveLength(200);
    for (const body of [undefined, null, "text", 7]) await expectEmpty204(await post(harness(), body));
  });

  it("treats any kind but 'event' as a pageview and drops its eventName", async () => {
    const h = harness();
    await post(h, { path: "/x", kind: "something", eventName: "ignored" });
    expect(h.sink.all().map((hit) => [hit.kind, hit.eventName])).toEqual([["pageview", null]]);
  });

  it("hands the client address to the ingest context (an excluded IP range records nothing)", async () => {
    const h = harness({ clientAddress: () => "203.0.113.5" }, { excludedIpRanges: ["203.0.113.5"] });
    await expectEmpty204(await post(h, { path: "/x" }));
    expect(h.sink.all()).toEqual([]);
    const allowed = harness({ clientAddress: () => undefined }, { excludedIpRanges: ["203.0.113.5"] });
    await post(allowed, { path: "/x" });
    expect(allowed.sink.all()).toHaveLength(1);
  });

  it("captures the visitor pageview only for an accepted public pageview with no browser contribution", async () => {
    const h = harness();
    await post(h, { path: "/hello" });
    expect(h.log.captured).toEqual([{ name: "site_pageview", properties: { routeTemplate: "/:path" } }]);
    for (const path of ["/admin", "/admin/x", "/preview", "/_preview/y"]) {
      const skipped = harness();
      await post(skipped, { path });
      expect(skipped.log.captured, path).toEqual([]);
    }
    const eventOnly = harness();
    await post(eventOnly, { path: "/x", kind: "event", eventName: "signup" });
    expect(eventOnly.log.captured).toEqual([]);
    const rejected = harness({}, { enabled: false });
    await post(rejected, { path: "/x" });
    expect(rejected.log.captured).toEqual([]);
  });

  it("leaves vendor pageviews to a browser contribution when one is present", async () => {
    const surfaces: unknown[] = [];
    const h = harness({ browserAnalytics: (required) => { surfaces.push(required); return [{ id: "vendor" }] as never; } });
    await post(h, { path: "/x" });
    expect(surfaces).toEqual([{ surface: "site" }]);
    expect(h.log.captured).toEqual([]);
    expect(h.sink.all()).toHaveLength(1);
  });

  it("skips plugin hooks only when vendorHooksAllowed answers exactly false", async () => {
    for (const [allowed, hookHits] of [[false, 0], [true, 1], [undefined, 1]] as const) {
      const h = harness(allowed === undefined ? {} : { vendorHooksAllowed: async () => allowed });
      await post(h, { path: "/x" });
      expect(h.log.hookHits, String(allowed)).toBe(hookHits);
    }
  });

  it("answers 204 and captures nothing when an ingest-side port throws", async () => {
    const failingForwarders = harness({ forwarders: async () => { throw new Error("consent store down"); } });
    await expectEmpty204(await post(failingForwarders, { path: "/x" }));
    expect(failingForwarders.sink.all()).toEqual([]);
    expect(failingForwarders.log.captured).toEqual([]);
    const failingSink = harness();
    failingSink.deps.ingest.sink.accept = async () => { throw new Error("disk full"); };
    await expectEmpty204(await post(failingSink, { path: "/x" }));
    expect(failingSink.log.captured).toEqual([]);
  });
});
