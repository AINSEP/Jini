/** Product analytics: the guard rules, and the PostHog provider against the real SDK with a recording fetch (no network). */
import { gunzipSync } from "node:zlib";
import { expect, test } from "vitest";

import { createNoopProductAnalytics, isNoopProductAnalytics, withProductAnalyticsGuards, type ProductEvent, type ProductAnalyticsPort } from "../product/index.js";
import { createPostHogProductAnalyticsAdapter } from "../product/posthog.js";

const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

function recordingPort(): { port: ProductAnalyticsPort; events: ProductEvent[] } {
  const events: ProductEvent[] = [];
  return { events, port: { capture: (event) => { events.push(event); }, identify: () => {} } };
}

/** A fetch that keeps every batch PostHog sends, decoded. */
export function recordingFetch() {
  const batches: { url: string; body: { api_key: string; batch: Array<Record<string, any>> } }[] = [];
  const fetch = async (url: string, init: { body?: unknown; headers?: Record<string, string> }) => {
    const body = init.body;
    const raw = body instanceof Blob ? Buffer.from(await body.arrayBuffer()) : body instanceof Uint8Array ? Buffer.from(body) : Buffer.from(String(body ?? ""));
    const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
    batches.push({ url, body: JSON.parse(text) });
    return { status: 200, text: async () => "{}", json: async () => ({}) };
  };
  return { batches, fetch };
}

test("noop: one shared frozen port, and the guard keeps it as-is (zero cost when unconfigured)", () => {
  const noop = createNoopProductAnalytics({});
  expect(isNoopProductAnalytics(noop)).toBe(true);
  expect(Object.isFrozen(noop)).toBe(true);
  expect(withProductAnalyticsGuards({ inner: noop, consent: () => true })).toBe(noop);
});

test("consent gates every event, checked per event (a revoked consent stops the next one)", () => {
  const { port, events } = recordingPort();
  let consented = true;
  const guarded = withProductAnalyticsGuards({ inner: port, consent: () => consented });
  guarded.capture({ name: "assistant_tool_call", userId: "u1" });
  consented = false;
  guarded.capture({ name: "assistant_tool_call", userId: "u1" });
  expect(events.map((e) => e.userId)).toEqual(["u1"]);
});

test("PII and secrets: e-mail ids, PII-named keys, e-mail values, bad names are dropped; secret values redacted", () => {
  const { port, events } = recordingPort();
  const guarded = withProductAnalyticsGuards({ inner: port, consent: () => true });
  guarded.capture({ name: "assistant_tool_call", userId: "owner@example.com" });
  guarded.capture({ name: "assistant_tool_call", userId: "u1", properties: { email: "x" } });
  guarded.capture({ name: "assistant_tool_call", userId: "u1", properties: { note: "mail me at a@b.co" } });
  guarded.capture({ name: "Free text the user typed", userId: "u1" });
  guarded.capture({ name: "assistant_tool_call", userId: SECRET });
  guarded.capture({ name: "assistant_tool_call", userId: "u1", properties: { tool_id: SECRET, ok: true } });
  expect(events).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain(SECRET);
  expect(events[0]?.properties?.ok).toBe(true);
});

test("a throwing consent check or vendor never fails the feature", () => {
  const broken = withProductAnalyticsGuards({ inner: { capture: () => { throw new Error("down"); }, identify: () => { throw new Error("down"); } }, consent: () => true });
  expect(() => broken.capture({ name: "x", userId: "u1" })).not.toThrow();
  expect(() => broken.identify({ userId: "u1" })).not.toThrow();
  const { port, events } = recordingPort();
  withProductAnalyticsGuards({ inner: port, consent: () => { throw new Error("settings down"); } }).capture({ name: "x", userId: "u1" });
  expect(events).toEqual([]);
});

test("PostHog provider (real posthog-node, recording fetch): capture/identify become batch events; no GeoIP; dispose flushes", async () => {
  const { batches, fetch } = recordingFetch();
  const { port, dispose } = createPostHogProductAnalyticsAdapter({ config: { enabled: true, apiKey: "phc_test_dummy", host: "https://posthog.invalid" } }, { fetch: fetch as never, flushAt: 1 });
  port.identify({ userId: "u1", traits: { plan: "self-hosted" } });
  port.capture({ name: "assistant_tool_call", userId: "u1", properties: { tool_id: "pages_list", outcome: "completed" } });
  await dispose();
  const events = batches.flatMap((b) => b.body.batch);
  expect(batches.every((b) => b.url.startsWith("https://posthog.invalid/"))).toBe(true);
  expect(events.map((e) => [e.event, e.distinct_id])).toEqual([["$identify", "u1"], ["assistant_tool_call", "u1"]]);
  expect(events[1]?.properties).toMatchObject({ tool_id: "pages_list", outcome: "completed", $geoip_disable: true });
});
