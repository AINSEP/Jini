import assert from "node:assert/strict";
import { test } from "vitest";

import { createAnalyticsForwardLimiter, type AnalyticsForwardReport, type AnalyticsSaltContext } from "../../index.js";

import { analyticsPrivacyPolicy, createAnalyticsIngestBinding, createLocalAnalyticsSink, type AnalyticsIngestRouteDeps } from "../jini-adapters.js";
import type { NormalizedHit } from "../../index.js";

/** @file The host -> package port binding: injected salt context and REQUIRED forward-failure reporter. */

/** A test-only host wire context; the real one is defined (byte-identical) by the host. */
const hostSaltContext: AnalyticsSaltContext = { extractionSalt: "host-analytics-daily-salt-hkdf-v1", infoPrefix: "analytics-salt:" };

const hit = (path: string): NormalizedHit => ({
  workspaceId: "ws-1", occurredAt: "2026-10-21T10:00:00.000Z", kind: "pageview", path, referrerHost: null,
  utm: { source: null, medium: null, campaign: null, term: null, content: null }, country: null, region: null,
  deviceClass: "desktop", browserFamily: null, osFamily: null, visitorHash: "vh", sessionId: "sid", eventName: null, eventProps: null,
});

function hostDeps(sink = createLocalAnalyticsSink({}), reportForwardFailure: AnalyticsForwardReport = () => {}): AnalyticsIngestRouteDeps & { sink: ReturnType<typeof createLocalAnalyticsSink> } {
  return {
    clock: { nowIso: () => "2026-10-21T10:00:00.000Z", nowMs: () => 0 } as never,
    ids: { newId: () => "id" } as never,
    sink,
    config: { get: async () => { throw new Error("unused"); } },
    resolveWorkspaceForHost: () => "ws-1",
    analyticsSeed: "seed",
    saltContext: hostSaltContext,
    reportForwardFailure,
  };
}

test("binding: the fan-out sink delegates every primary method to the host sink and passes host presets", async () => {
  const deps = hostDeps();
  const { deps: bound, optional } = createAnalyticsIngestBinding({ deps });
  assert.deepEqual(optional, {});
  assert.equal(bound.privacyPolicy, analyticsPrivacyPolicy);
  assert.equal(bound.saltContext, hostSaltContext);
  assert.equal(bound.rootKeySeed, "seed");
  assert.equal(await bound.resolveWorkspaceForHost({ host: "example.com" }), "ws-1");
  assert.deepEqual(bound.sink.capabilities({}), { durable: false, batch: true });
  await bound.sink.accept({ hit: hit("/a") });
  await bound.sink.acceptBatch({ hits: [hit("/b"), hit("/c")] });
  assert.deepEqual((await bound.sink.list({}, { limit: 2 })).map((h) => h.path), ["/c", "/b"]);
  assert.deepEqual(deps.sink.all().map((h) => h.path), ["/a", "/b", "/c"]);
});

test("binding: forwarders receive batch hits too, and host hooks are adapted to the engine shape", async () => {
  const forwarded: string[] = [];
  const deps = { ...hostDeps(), hooks: { beforeIngest: async ({ hit: h }: { hit: NormalizedHit }) => ({ ...h, path: `${h.path}!` }) } };
  const { deps: bound, optional } = createAnalyticsIngestBinding({ deps }, {
    forwarders: [{ id: "v", context: { workspaceId: "ws-1", mode: "live" }, forwarder: { forward: async ({ hit: h }) => {
      forwarded.push(h.path); return { status: "ok", value: undefined };
    } } }],
  });
  await bound.sink.acceptBatch({ hits: [hit("/x"), hit("/y")] });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(forwarded, ["/x", "/y"]);
  assert.equal((await optional.hooks!.beforeIngest({ hit: hit("/h") }))?.path, "/h!");
});

test("createLocalAnalyticsSink seeds initial hits and exposes all()", async () => {
  const sink = createLocalAnalyticsSink({}, { initialHits: [hit("/seed")] });
  assert.deepEqual(sink.all().map((h) => h.path), ["/seed"]);
  assert.deepEqual((await sink.list({})).map((h) => h.path), ["/seed"]);
});

test("binding: a shared limiter over its cap drops the forward but the built-in sink still accepts", async () => {
  const limiter = createAnalyticsForwardLimiter({}, { maxInFlight: 0 });
  const reported: unknown[] = [];
  const deps = hostDeps(createLocalAnalyticsSink({}), (report) => { reported.push(report); });
  const { deps: bound } = createAnalyticsIngestBinding({ deps }, {
    limiter,
    forwarders: [{ id: "v", context: { workspaceId: "ws-1", mode: "live" }, forwarder: { forward: async () => { throw new Error("must not run"); } } }],
  });
  await bound.sink.accept({ hit: hit("/kept") });
  assert.deepEqual(deps.sink.all().map((h) => h.path), ["/kept"]);
  assert.deepEqual(reported, [{ forwarderId: "v", outcome: "dropped", message: "too many vendor calls in flight" }]);
});

test("binding: a throwing vendor is reported through the host's REQUIRED reporter, never propagated", async () => {
  const reported: unknown[] = [];
  const deps = hostDeps(createLocalAnalyticsSink({}), (report) => { reported.push(report); });
  const { deps: bound } = createAnalyticsIngestBinding({ deps }, {
    forwarders: [{ id: "boom", context: { workspaceId: "ws-1", mode: "live" }, forwarder: { forward: async () => { throw new Error("vendor down"); } } }],
  });
  await bound.sink.accept({ hit: hit("/kept") });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(deps.sink.all().map((h) => h.path), ["/kept"]);
  assert.deepEqual(reported, [{ forwarderId: "boom", outcome: "threw", message: "forwarder threw" }]);
});
