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

test('the factory rejects private keys and credential-bearing hosts before constructing an SDK', () => {
  const apiKey = ['phc', 'fixture'].join('_');
  expect(() => createPostHogProvider({ apiKey: ['phx', 'private', 'fixture'].join('_'), host: 'https://posthog.invalid' }))
    .toThrow(new TypeError('Use a PostHog project key starting with phc_, not a personal API key.'));
  const host = new URL('https://posthog.invalid');
  host.username = ['fixture', 'user'].join('-'); host.password = ['fixture', 'password'].join('-');
  expect(() => createPostHogProvider({ apiKey, host: host.href }))
    .toThrow(new TypeError('Use an HTTP or HTTPS host URL without credentials.'));
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
  const resource = createPostHogProvider({ apiKey: ['phc', 'fixture'].join('_'), host: "https://posthog.invalid" }, { fetch: async () => { throw new Error("offline"); }, flushAt: 1 });
  resource.port.capture({ name: "x", userId: "u1" });
  await expect(resource.dispose({})).resolves.toBeUndefined();
});

test("owner events without properties retain SDK profile behavior and identities without traits remain bare; dispose flushes the default batch", async () => {
  const { batches, fetch } = recordingFetch();
  const { port, dispose } = createPostHogProductAnalyticsAdapter({ config: { enabled: true, apiKey: "phc_test_dummy", host: "https://posthog.invalid" } }, { fetch: fetch as never });
  port.capture({ name: "theme_changed", userId: "u2" });
  port.identify({ userId: "u2" });
  expect(batches).toEqual([]);
  await dispose();
  const events = batches.flatMap((b) => b.body.batch);
  expect(events.map((e) => [e.event, e.distinct_id])).toEqual([["theme_changed", "u2"], ["$identify", "u2"]]);
  expect(events[0]?.properties).not.toHaveProperty('$process_person_profile');
  expect(events[1]?.properties).not.toHaveProperty('$process_person_profile');
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

test("site attribution: identify events carry the host's attribution and $groups; traits cannot override site_id (Codex fix-lane MED)", async () => {
  const { batches, fetch } = recordingFetch();
  const resource = createPostHogProvider({ apiKey: "phc_test_dummy", host: "https://posthog.invalid",
    attribution: { attributes: { site_id: "site-123", site_slug: "blog", environment: "local", project_id: "proj-9" }, groups: { site: "site-123" } } }, { fetch, flushAt: 1 });
  resource.port.identify({ userId: "u1", traits: { site_id: "spoofed", plan: "self-hosted", constructor: "kept", toString: "kept too" } });
  resource.port.identify({ userId: "u2" });
  await resource.dispose({});
  const identifies = batches.flatMap((b) => b.body.batch).filter((e) => e.event === "$identify");
  expect(identifies.map((e) => e.distinct_id)).toEqual(["u1", "u2"]);
  for (const event of identifies) {
    expect(event.properties).toMatchObject({ site_id: "site-123", site_slug: "blog", environment: "local", project_id: "proj-9", $groups: { site: "site-123" } });
  }
  // The traits still set the person's properties, minus any key the host attributes authoritatively
  // (an own key only: a trait named like an Object.prototype member is kept).
  expect(identifies[0]?.properties.$set).toEqual({ plan: "self-hosted", constructor: "kept", toString: "kept too" });
  expect(JSON.stringify(identifies)).not.toContain("spoofed");
});

test("LLM analytics maps neutral metadata to PostHog's event contract with authoritative site identity and no text by default", async () => {
  const { batches, fetch } = recordingFetch();
  const resource = createPostHogProvider({ apiKey: ["phc", "fixture"].join("_"), host: "https://posthog.invalid",
    attribution: { attributes: { site_id: "s1", site_slug: "blog", environment: "local" }, groups: { site: "s1" } } }, { fetch, flushAt: 1 });
  expect(resource.port.includeAiContent).toBe(false);
  resource.port.captureAiGeneration!({ userId: "site:s1", properties: {
    model: "model-1", provider: "anthropic", inputTokens: 12, outputTokens: 4, cacheReadTokens: 2,
    latencySeconds: 1.5, costUsd: 0.01, costSource: "provider", traceId: "r1", spanId: "r1:turn:0", isError: false, toolCallCount: 1,
    site_id: "spoofed", error: "private error prose",
  }, input: "private prompt", output: "private response" });
  resource.port.captureAiGeneration!({ userId: "site:s1", properties: { traceId: "r2", spanId: "r2:turn:0", isError: true, latencySeconds: 0.2 } });
  await resource.dispose({});
  const events = batches.flatMap((b) => b.body.batch).filter((e) => e.event === "$ai_generation");
  expect(events.map((event) => [event.event, event.distinct_id])).toEqual([["$ai_generation", "site:s1"], ["$ai_generation", "site:s1"]]);
  expect(events[0]?.properties).toMatchObject({ $ai_model: "model-1", $ai_provider: "anthropic", $ai_input_tokens: 12, $ai_output_tokens: 4, $ai_cache_read_input_tokens: 2,
    $ai_latency: 1.5, $ai_total_cost_usd: 0.01, cost_source: "provider", $ai_trace_id: "r1", $ai_span_id: "r1:turn:0", $ai_is_error: false, tool_call_count: 1,
    site_id: "s1", site_slug: "blog", environment: "local", $groups: { site: "s1" } });
  expect(events[1]?.properties).toMatchObject({ $ai_trace_id: "r2", $ai_is_error: true });
  for (const key of ["$ai_model", "$ai_input_tokens", "$ai_output_tokens", "$ai_total_cost_usd"]) expect(events[1]?.properties).not.toHaveProperty(key);
  expect(JSON.stringify(events)).not.toMatch(/private|spoofed/);
});

test("LLM content setting is explicit and guarded by operator consent; input and output use PostHog message shapes", async () => {
  const { batches, fetch } = recordingFetch();
  const resource = createPostHogProvider({ apiKey: ["phc", "fixture"].join("_"), host: "https://posthog.invalid", includePromptsAndResponses: "true" }, { fetch, flushAt: 1 });
  let consent = false;
  const port = withProductAnalyticsGuards({ inner: resource.port, consent: () => consent });
  expect(port.includeAiContent).toBe(true);
  port.captureAiGeneration!({ userId: "s", properties: { traceId: "denied" }, input: "denied" });
  consent = true;
  port.captureAiGeneration!({ userId: "s", properties: { traceId: "r" }, input: "Hello", output: "Welcome" });
  await resource.dispose({});
  const events = batches.flatMap((b) => b.body.batch);
  expect(events).toHaveLength(1);
  expect(events[0]?.properties).toMatchObject({ $ai_trace_id: "r", $ai_input: [{ role: "user", content: "Hello" }], $ai_output_choices: [{ role: "assistant", content: "Welcome" }] });
});

test.each([200, 401, 429])('PostHog factory reports real HTTP %i with no private response text', async status => {
  const reports: import('@jini-ai/diagnostics/observability').ProviderTelemetryReport[] = [];
  const resource = createPostHogProvider({ apiKey: 'phc_test_dummy', host: 'https://posthog.invalid' }, {
    reportTelemetry: (report: import('@jini-ai/diagnostics/observability').ProviderTelemetryReport) => { reports.push(report); },
    fetch: async () => ({ status, text: async () => 'private provider response', json: async () => ({}) }), flushAt: 1,
  });
  resource.port.capture({ name: 'telemetry_test', userId: 'owner' });
  await resource.dispose({});
  expect(reports.at(-1)).toEqual({ phase: 'export', outcome: status === 200 ? 'ok' : 'failed', host: 'posthog.invalid',
    ...(status === 200 ? {} : { errorClass: 'Error', statusCode: status }) });
  expect(JSON.stringify(reports)).not.toContain('private provider response');
});


test('server visitor counters cannot create person profiles, even through caller or attribution overrides', async () => {
  const { batches, fetch } = recordingFetch();
  const resource = createPostHogProvider({ apiKey: 'phc_fixture', host: 'https://posthog.invalid',
    attribution: { attributes: { $process_person_profile: 'true' }, groups: {} } }, { fetch, flushAt: 1 });
  resource.port.capture({ name: 'form_submitted', userId: 'visitor:ephemeral', properties: { eventId: 'committed-event', $process_person_profile: true } });
  await resource.dispose({});
  const events = batches.flatMap(batch => batch.body.batch);
  expect(events).toHaveLength(1);
  const event = events[0]!;
  expect({ name: event.event, subject: event.distinct_id, profiles: event.properties.$process_person_profile,
    insertId: event.properties.$insert_id, geoipDisabled: event.properties.$geoip_disable })
    .toEqual({ name: 'form_submitted', subject: 'visitor:ephemeral', profiles: false, insertId: 'committed-event', geoipDisabled: true });
});


test('visitor suppression is authoritative while owner capture and AI events keep their profile policy', async () => {
  const { batches, fetch } = recordingFetch();
  const resource = createPostHogProvider({ apiKey: 'phc_fixture', host: 'https://posthog.invalid' }, { fetch, flushAt: 1 });
  resource.port.capture({ name: 'visitor_event', userId: 'visitor:ephemeral', properties: { $process_person_profile: true } });
  resource.port.capture({ name: 'owner_event', userId: 'owner:1' });
  resource.port.capture({ name: 'owner_choice', userId: 'owner:1', properties: { $process_person_profile: true } });
  resource.port.captureAiGeneration!({ userId: 'site:1', properties: {} });
  resource.port.captureAiGeneration!({ userId: 'visitor:ephemeral', properties: {} });
  await resource.dispose({});
  const events = batches.flatMap(batch => batch.body.batch);
  expect(events.map(event => event.properties.$process_person_profile)).toEqual([false, undefined, true, undefined, false]);
});
