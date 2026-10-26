/** The PostHog provider plugin against the real SDK with a recording fetch (no network). Moved from `@jini-ai/analytics`. */
import { gunzipSync } from "node:zlib";
import { expect, test, vi } from "vitest";
import { PostHog } from "posthog-node";

import { withProductAnalyticsGuards } from "@jini-ai/analytics/product";
import { createPostHogProductAnalyticsAdapter } from "../analytics-posthog/posthog.js";
import plugin, { createPostHogProvider } from "../analytics-posthog/index.js";

/** A fetch that keeps every batch PostHog sends, decoded. */
function recordingFetch() {
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

test("plugin setup only registers the product-analytics factory", () => {
  const registered: unknown[] = [];
  plugin.definition.setup({ providers: { register: (value: unknown) => { registered.push(value); } } } as never);
  expect(registered).toEqual([{ contract: "product_analytics", id: "posthog", contractVersion: 1, factory: createPostHogProvider }]);
});

test("the factory port behind the host's guards: consent false sends nothing; PII-shaped properties are dropped", async () => {
  const { batches, fetch } = recordingFetch();
  const resource = createPostHogProvider({ apiKey: " phc_test_dummy ", host: "https://posthog.invalid" }, { fetch, flushAt: 1 });
  let consent = false;
  const guarded = withProductAnalyticsGuards({ inner: resource.port, consent: () => consent });
  guarded.capture({ name: "assistant_tool_call", userId: "u1" });
  consent = true;
  guarded.capture({ name: "assistant_tool_call", userId: "u1", properties: { email: "private" } });
  guarded.capture({ name: "assistant_tool_call", userId: "u1", properties: { outcome: "completed" } });
  await resource.dispose({});
  const events = batches.flatMap((b) => b.body.batch);
  expect(events.map((e) => [e.event, e.distinct_id, e.properties.outcome])).toEqual([["assistant_tool_call", "u1", "completed"]]);
  expect(batches[0]?.body.api_key).toBe("phc_test_dummy");
});

test.each([
  [{ host: "https://posthog.invalid" }, "apiKey must be a non-empty string"],
  [{ apiKey: "  ", host: "https://posthog.invalid" }, "apiKey must be a non-empty string"],
  [{ apiKey: 7, host: "https://posthog.invalid" }, "apiKey must be a non-empty string"],
  [{ apiKey: "phc" }, "host must be a non-empty string"],
  [{ apiKey: "phc", host: {} }, "host must be a non-empty string"],
])("the factory refuses %j", (input, message) => {
  expect(() => createPostHogProvider(input)).toThrow(new TypeError(message));
});

test("dispose never throws when the SDK shutdown fails", async () => {
  const resource = createPostHogProvider({ apiKey: "phc", host: "https://posthog.invalid" }, { fetch: async () => { throw new Error("offline"); }, flushAt: 1 });
  resource.port.capture({ name: "x", userId: "u1" });
  await expect(resource.dispose({})).resolves.toBeUndefined();
});

test("events without properties and identities without traits are sent bare; the default batch size holds until dispose flushes", async () => {
  const { batches, fetch } = recordingFetch();
  const { port, dispose } = createPostHogProductAnalyticsAdapter({ config: { enabled: true, apiKey: "phc_test_dummy", host: "https://posthog.invalid" } }, { fetch: fetch as never });
  port.capture({ name: "theme_changed", userId: "u2" });
  port.identify({ userId: "u2" });
  expect(batches).toEqual([]);
  await dispose();
  const events = batches.flatMap((b) => b.body.batch);
  expect(events.map((e) => [e.event, e.distinct_id])).toEqual([["theme_changed", "u2"], ["$identify", "u2"]]);
});

test("without an injected fetch an idle client is built and shut down with nothing to send", async () => {
  const { dispose } = createPostHogProductAnalyticsAdapter({ config: { enabled: true, apiKey: "phc_test_dummy", host: "https://posthog.invalid" } });
  await expect(dispose()).resolves.toBeUndefined();
});

test("a rejected SDK shutdown is swallowed by dispose", async () => {
  const shutdown = vi.spyOn(PostHog.prototype, "shutdown").mockRejectedValueOnce(new Error("network gone"));
  try {
    const { dispose } = createPostHogProductAnalyticsAdapter({ config: { enabled: true, apiKey: "phc_test_dummy", host: "https://posthog.invalid" } }, { fetch: recordingFetch().fetch as never });
    await expect(dispose()).resolves.toBeUndefined();
    expect(shutdown).toHaveBeenCalledTimes(1);
  } finally { shutdown.mockRestore(); }
});

test("site attribution: every captured event carries the host's attribution properties (not overridable by the event) and its $groups", async () => {
  const { batches, fetch } = recordingFetch();
  const resource = createPostHogProvider({ apiKey: "phc_test_dummy", host: "https://posthog.invalid",
    attribution: { attributes: { site_id: "site-123", site_slug: "blog", environment: "local", project_id: "proj-9" }, groups: { site: "site-123" } } }, { fetch, flushAt: 1 });
  resource.port.capture({ name: "post_published", userId: "u1", properties: { site_id: "spoofed", outcome: "ok" } });
  resource.port.capture({ name: "plugin_toggled", userId: "u1" });
  await resource.dispose({});
  const events = batches.flatMap((b) => b.body.batch).filter((e) => e.event !== "$groupidentify");
  expect(events).toHaveLength(2);
  for (const event of events) {
    expect(event.properties).toMatchObject({ site_id: "site-123", site_slug: "blog", environment: "local", project_id: "proj-9", $groups: { site: "site-123" } });
  }
  expect(events[0]?.properties.outcome).toBe("ok");
});
