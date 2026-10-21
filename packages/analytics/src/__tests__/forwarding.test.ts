import { describe, expect, it } from "vitest";
import { providerOk, providerRejected, providerUnknown, type ProviderContext, type ProviderResult } from "@jini-ai/core/provider-registry";
import {
  ANALYTICS_FORWARDER_CONTRACT, asAnalyticsForwarderModule, asAnalyticsIngestHook, composeBeforeIngestHooks,
  createAnalyticsForwarderRegistry, createFanOutAnalyticsSink, LocalBufferSink, selectAnalyticsForwarder, toForwardedHit,
  type AnalyticsForwarder, type AnalyticsForwarderModule, type ForwardedHit, type NormalizedHit,
} from "../index.js";

const hit = (path = "/a"): NormalizedHit => ({
  workspaceId: "ws-1", occurredAt: "2026-10-21T10:00:00.000Z", kind: "pageview", path, referrerHost: "ref.example",
  utm: { source: "news", medium: null, campaign: null, term: null, content: null }, country: "DE", region: "BE",
  deviceClass: "desktop", browserFamily: "Firefox", osFamily: "Linux", visitorHash: "vh", sessionId: "sid",
  eventName: null, eventProps: null,
});

const context: ProviderContext = { workspaceId: "ws-1", mode: "live" };

function recordingForwarder(result: () => Promise<ProviderResult<void>> = async () => providerOk({ value: undefined })) {
  const seen: ForwardedHit[] = [];
  const forwarder: AnalyticsForwarder = { forward: async ({ hit: forwarded }) => { seen.push(forwarded); return result(); } };
  return { seen, forwarder };
}

const module = (forwarder: AnalyticsForwarder): AnalyticsForwarderModule => ({ create: () => forwarder });

describe("toForwardedHit", () => {
  it("drops region and sessionId and copies utm", () => {
    const source = hit();
    const forwarded = toForwardedHit({ hit: source });
    expect(forwarded).not.toHaveProperty("region");
    expect(forwarded).not.toHaveProperty("sessionId");
    expect(forwarded).toEqual({
      workspaceId: "ws-1", occurredAt: source.occurredAt, kind: "pageview", path: "/a", referrerHost: "ref.example",
      utm: source.utm, country: "DE", deviceClass: "desktop", browserFamily: "Firefox", osFamily: "Linux",
      visitorHash: "vh", eventName: null, eventProps: null,
    });
    expect(forwarded.utm).not.toBe(source.utm);
  });
});

describe("module validators", () => {
  it("accepts a module with create() and refuses others", () => {
    const valid = { create: () => recordingForwarder().forwarder };
    expect(asAnalyticsForwarderModule({ exported: valid })).toBe(valid);
    expect(asAnalyticsForwarderModule({ exported: null })).toBe("its module has no create() function");
    expect(asAnalyticsForwarderModule({ exported: { create: 1 } })).toBe("its module has no create() function");
    expect(asAnalyticsForwarderModule({ exported: "x" })).toBe("its module has no create() function");
  });

  it("accepts a hook with beforeIngest() and refuses others", () => {
    const valid = { beforeIngest: async () => null };
    expect(asAnalyticsIngestHook({ exported: valid })).toBe(valid);
    expect(asAnalyticsIngestHook({ exported: null })).toBe("its module has no beforeIngest() function");
    expect(asAnalyticsIngestHook({ exported: {} })).toBe("its module has no beforeIngest() function");
  });
});

describe("createAnalyticsForwarderRegistry + selectAnalyticsForwarder", () => {
  it("registers seeds, validates shape, and selects by id", () => {
    const vendor = module(recordingForwarder().forwarder);
    const registry = createAnalyticsForwarderRegistry({}, { seed: [{ id: "plausible", provider: vendor }] });
    expect(registry.contract).toBe(ANALYTICS_FORWARDER_CONTRACT);
    expect(registry.get({ id: "plausible" })?.provider).toBe(vendor);
    expect(registry.contribute({ definition: { id: "bad", provider: {} as AnalyticsForwarderModule }, pluginId: "p" })).toBe(false);
    expect(registry.refusals()[0]?.message).toContain("its module has no create() function");
    expect(() => registry.register({ definition: { id: "worse", provider: {} as AnalyticsForwarderModule } })).toThrow(/create\(\)/);

    expect(selectAnalyticsForwarder({ registry, sinkId: "local" })).toEqual({});
    expect(selectAnalyticsForwarder({ registry, sinkId: "" })).toEqual({});
    expect(selectAnalyticsForwarder({ registry, sinkId: "plausible" }).entry?.id).toBe("plausible");
    expect(selectAnalyticsForwarder({ registry, sinkId: "posthog" })).toEqual({
      warning: "analytics sink 'posthog' is not installed; hits stay in the built-in sink only",
    });
  });

  it("starts empty without a seed", () => {
    expect(createAnalyticsForwarderRegistry().list()).toEqual([]);
  });
});

describe("createFanOutAnalyticsSink", () => {
  it("writes the primary, then forwards the minimised hit to every forwarder", async () => {
    const primary = new LocalBufferSink({});
    const a = recordingForwarder();
    const b = recordingForwarder();
    const tasks: Promise<void>[] = [];
    const sink = createFanOutAnalyticsSink({ primary }, {
      forwarders: [{ id: "a", forwarder: a.forwarder, context }, { id: "b", forwarder: b.forwarder, context }],
      schedule: (task) => tasks.push(task),
    });
    await sink.accept({ hit: hit("/one") });
    await sink.acceptBatch({ hits: [hit("/two"), hit("/three")] });
    await Promise.all(tasks);
    expect(primary.all({}).map((h) => h.path)).toEqual(["/one", "/two", "/three"]);
    expect(a.seen.map((h) => h.path)).toEqual(["/one", "/two", "/three"]);
    expect(b.seen).toHaveLength(3);
    expect(a.seen[0]).not.toHaveProperty("sessionId");
    expect(sink.capabilities({})).toEqual({ durable: false, batch: true });
    expect((await sink.list({}, { limit: 1 })).map((h) => h.path)).toEqual(["/three"]);
  });

  it("reports rejected, unknown and thrown forwards without failing the primary or other forwarders", async () => {
    const primary = new LocalBufferSink({});
    const reports: unknown[] = [];
    const tasks: Promise<void>[] = [];
    const ok = recordingForwarder();
    const rejected = recordingForwarder(async () => providerRejected({ code: "unauthorized", message: "bad key" }));
    const unknown = recordingForwarder(async () => providerUnknown({ code: "timeout", message: "slow" }));
    const threw: AnalyticsForwarder = { forward: async () => { throw new Error("boom"); } };
    const threwValue: AnalyticsForwarder = { forward: async () => { throw "raw"; } };
    const sink = createFanOutAnalyticsSink({ primary }, {
      forwarders: [
        { id: "rej", forwarder: rejected.forwarder, context }, { id: "unk", forwarder: unknown.forwarder, context },
        { id: "thr", forwarder: threw, context }, { id: "raw", forwarder: threwValue, context },
        { id: "ok", forwarder: ok.forwarder, context },
      ],
      report: (r) => reports.push(r),
      schedule: (task) => tasks.push(task),
    });
    await sink.accept({ hit: hit() });
    await Promise.all(tasks);
    expect(primary.all({})).toHaveLength(1);
    expect(ok.seen).toHaveLength(1);
    // Forwards run concurrently, so report order is settle order, not declaration order.
    expect(reports).toHaveLength(4);
    expect(reports).toEqual(expect.arrayContaining([
      { forwarderId: "rej", outcome: "rejected", message: "bad key" },
      { forwarderId: "unk", outcome: "unknown", message: "slow" },
      { forwarderId: "thr", outcome: "threw", message: "boom" },
      { forwarderId: "raw", outcome: "threw", message: "raw" },
    ]));
  });

  it("propagates a primary failure and forwards nothing", async () => {
    const forwarder = recordingForwarder();
    const failing = new LocalBufferSink({});
    failing.accept = async () => { throw new Error("disk"); };
    const sink = createFanOutAnalyticsSink({ primary: failing }, { forwarders: [{ id: "a", forwarder: forwarder.forwarder, context }] });
    await expect(sink.accept({ hit: hit() })).rejects.toThrow("disk");
    expect(forwarder.seen).toEqual([]);
  });

  it("defaults: detached forwards and a silent report", async () => {
    let resolveSeen: () => void = () => undefined;
    const seen = new Promise<void>((resolve) => { resolveSeen = resolve; });
    const forwarder: AnalyticsForwarder = { forward: async () => { resolveSeen(); return providerRejected({ code: "provider_error", message: "x" }); } };
    const primary = new LocalBufferSink({});
    const sink = createFanOutAnalyticsSink({ primary }, { forwarders: [{ id: "a", forwarder, context }] });
    await sink.accept({ hit: hit() });
    await seen;
    expect(primary.all({})).toHaveLength(1);
    const bare = createFanOutAnalyticsSink({ primary });
    await bare.accept({ hit: hit() });
    expect(primary.all({})).toHaveLength(2);
  });
});

describe("composeBeforeIngestHooks", () => {
  it("returns undefined for no handlers", () => {
    expect(composeBeforeIngestHooks({ hooks: [] })).toBeUndefined();
  });

  it("chains handlers in order and stops at null", async () => {
    const calls: string[] = [];
    const chain = composeBeforeIngestHooks({ hooks: [
      { beforeIngest: async ({ hit: h }) => { calls.push("a"); return { ...h, path: `${h.path}/a` }; } },
      { beforeIngest: async ({ hit: h }) => { calls.push("b"); return h.path.startsWith("/drop") ? null : { ...h, path: `${h.path}/b` }; } },
      { beforeIngest: async ({ hit: h }) => { calls.push("c"); return h; } },
    ] });
    expect((await chain!.beforeIngest({ hit: hit("/keep") }))?.path).toBe("/keep/a/b");
    expect(calls).toEqual(["a", "b", "c"]);
    calls.length = 0;
    expect(await chain!.beforeIngest({ hit: hit("/drop") })).toBeNull();
    expect(calls).toEqual(["a", "b"]);
  });

  it("skips and reports a throwing handler, passing the hit on unchanged", async () => {
    const reports: unknown[] = [];
    const chain = composeBeforeIngestHooks({ hooks: [
      { beforeIngest: async () => { throw new Error("broken plugin"); } },
      { beforeIngest: async () => { throw 7; } },
      { beforeIngest: async ({ hit: h }) => ({ ...h, path: "/after" }) },
    ] }, { report: (r) => reports.push(r) });
    expect((await chain!.beforeIngest({ hit: hit() }))?.path).toBe("/after");
    expect(reports).toEqual([{ index: 0, message: "broken plugin" }, { index: 1, message: "7" }]);
  });

  it("uses a silent default report", async () => {
    const chain = composeBeforeIngestHooks({ hooks: [{ beforeIngest: async () => { throw new Error("x"); } }] });
    expect((await chain!.beforeIngest({ hit: hit() }))?.path).toBe("/a");
  });
});
