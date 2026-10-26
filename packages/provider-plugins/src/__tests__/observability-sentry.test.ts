/** The Sentry provider plugin against the real SDK (recording transport, `.invalid` DSN: no network). */
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { NodeClient, createTransport, getCurrentScope } from "@sentry/node";

import { createSentryObservabilityAdapter, type SentryConfigEnabled } from "../observability-sentry/sentry.js";

const CONFIG: SentryConfigEnabled = { enabled: true, dsn: "https://public@sentry.invalid/1", tracesSampleRate: 1 };
const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

type Item = { type: string; payload: Record<string, any> };
function recordingTransport() {
  const items: Item[] = [];
  const transport = (options: Parameters<typeof createTransport>[0]) => createTransport(options, async (request) => {
    const lines = String(request.body).split("\n").filter(Boolean);
    for (let i = 1; i + 1 < lines.length; i += 2) items.push({ type: JSON.parse(lines[i]!).type, payload: JSON.parse(lines[i + 1]!) });
    return { statusCode: 200 };
  });
  return { items, transport };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

test("obs2 #1: credential-shaped error codes never reach Sentry exception types", async () => {
  const { items, transport } = recordingTransport();
  const { port, dispose } = createSentryObservabilityAdapter({ config: CONFIG }, { transport });
  const code = "AKIA" + "A".repeat(16);
  port.reportError({ error: Object.assign(new Error("request failed"), { code }), context: { operation: "tool.call" } });
  await flush(); await dispose();
  const events = items.filter((item) => item.type === "event");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.payload.exception.values[0].type, "[REDACTED:credential]");
  assert.ok(!JSON.stringify(items).includes(code));
});

test("review #4: independent operations start distinct traces; a nested one shares its parent's", async () => {
  const { items, transport } = recordingTransport();
  const { port, dispose } = createSentryObservabilityAdapter({ config: CONFIG }, { transport });
  const a = port.trackOperation({ name: "tool.call" });
  a.run(() => port.trackOperation({ name: "inner" }).end({ outcome: "completed", failed: false }));
  a.end({ outcome: "completed", failed: false });
  port.trackOperation({ name: "tool.call" }).end({ outcome: "completed", failed: false });
  await flush(); await dispose();
  const traces = items.filter((i) => i.type === "transaction").map((i) => i.payload.contexts.trace.trace_id);
  assert.equal(traces.length, 2);
  assert.notEqual(traces[0], traces[1]);
  const first = items.find((i) => i.type === "transaction")!.payload;
  assert.deepEqual(first.spans.map((s: { trace_id: string }) => s.trace_id), [traces[0]]);
});

test("review #5: the adapter neither sets the process async-context strategy nor turns on channel injection, yet still delivers", async () => {
  const carrier = (globalThis as { __SENTRY__?: Record<string, { acs?: unknown }> }).__SENTRY__;
  const before = JSON.stringify(Object.keys(carrier ?? {}).map((k) => [k, Boolean(carrier?.[k]?.acs)]));
  const { items, transport } = recordingTransport();
  const { port, dispose } = createSentryObservabilityAdapter({ config: CONFIG }, { transport });
  const after = JSON.stringify(Object.keys((globalThis as any).__SENTRY__ ?? {}).map((k) => [k, Boolean((globalThis as any).__SENTRY__[k]?.acs)]));
  assert.equal(after, before);
  const error = new Error(`token ${SECRET}`); error.name = SECRET;
  port.reportError({ error, context: { operation: "tool.call", attributes: { "tool.id": SECRET } } });
  await flush(); await dispose();
  assert.equal(items.filter((i) => i.type === "event").length, 1);
  assert.ok(!JSON.stringify(items).includes(SECRET));
  assert.equal(getCurrentScope().getClient(), undefined);
});

test("review #5: a host-owned client is reused and left open by dispose", async () => {
  const { transport } = recordingTransport();
  let closed = 0;
  const hostClient = { close: async () => { closed += 1; return true; }, getOptions: () => ({}) } as never;
  const { dispose } = createSentryObservabilityAdapter({ config: CONFIG }, { transport, client: hostClient });
  await dispose();
  assert.equal(closed, 0);
});

test("review #6: dispose releases the SDK's beforeExit listeners (repeated open/close does not leak)", async () => {
  const baseline = process.listenerCount("beforeExit");
  for (let i = 0; i < 5; i += 1) {
    const { transport } = recordingTransport();
    const { dispose } = createSentryObservabilityAdapter({ config: CONFIG }, { transport });
    assert.ok(process.listenerCount("beforeExit") > baseline);
    await dispose();
  }
  assert.equal(process.listenerCount("beforeExit"), baseline);
});

test("operation end: settled attributes and failure status reach the transaction; a second end is ignored", async () => {
  const { items, transport } = recordingTransport();
  const { port, dispose } = createSentryObservabilityAdapter({ config: CONFIG }, { transport });
  const tracker = port.trackOperation({ name: "site.publish", attributes: { "publish.target": "pages" } });
  tracker.end({ outcome: "AUTH_FAILED", failed: true, attributes: { attempt: 2 } });
  tracker.end({ outcome: "published", failed: false });
  port.trackOperation({ name: "plain" }).end({ outcome: "completed", failed: false });
  await flush(); await dispose();
  const transactions = items.filter((item) => item.type === "transaction").map((item) => item.payload.contexts.trace);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].status, "internal_error");
  assert.equal(transactions[0].data["operation.outcome"], "AUTH_FAILED");
  assert.equal(transactions[0].data.attempt, 2);
  assert.equal(transactions[1].status, "ok");
});

test("an error reported inside an operation's run() is attached to it; a non-Error value is reported by type with no stack", async () => {
  const { items, transport } = recordingTransport();
  const { port, dispose } = createSentryObservabilityAdapter({ config: CONFIG }, { transport });
  const tracker = port.trackOperation({ name: "outbox.deliver" });
  tracker.run(() => port.reportError({ error: "plain string failure", context: { operation: "outbox.deliver", attributes: { "event.name": "entry.updated" } } }));
  tracker.end({ outcome: "error", failed: true });
  await flush(); await dispose();
  const [event] = items.filter((item) => item.type === "event");
  assert.equal(event?.payload.exception.values[0].type, "string");
  assert.equal(event?.payload.contexts.operation["event.name"], "entry.updated");
  assert.equal(event?.payload.contexts.trace.trace_id, items.find((item) => item.type === "transaction")!.payload.contexts.trace.trace_id);
});

test("a broken SDK call inside reportError never throws, and a failing close is swallowed", async () => {
  const { transport } = recordingTransport();
  const { port, dispose } = createSentryObservabilityAdapter({ config: CONFIG }, { transport });
  const hostile = new Error("x");
  Object.defineProperty(hostile, "message", { get() { throw new Error("hostile"); } });
  assert.doesNotThrow(() => port.reportError({ error: hostile, context: { operation: "x" } }));
  const close = vi.spyOn(NodeClient.prototype, "close").mockRejectedValueOnce(new Error("close failed"));
  let calls = 0;
  try { await dispose(); calls = close.mock.calls.length; } finally { close.mockRestore(); }
  assert.equal(calls, 1);
});

test("plugin factory: validates its card input, defaults to errors only, and reuses a host-owned client", async () => {
  const { default: plugin, createSentryProvider } = await import("../observability-sentry/index.js");
  const registered: unknown[] = [];
  plugin.definition.setup({ providers: { register: (value: unknown) => { registered.push(value); } } } as never);
  assert.deepEqual(registered, [{ contract: "observability", id: "sentry", contractVersion: 1, factory: createSentryProvider }]);
  for (const [input, message] of [
    [{}, "dsn must be a non-empty string"], [{ dsn: " " }, "dsn must be a non-empty string"], [{ dsn: 3 }, "dsn must be a non-empty string"],
    [{ dsn: CONFIG.dsn, environment: 1 }, "environment must be a string"],
    [{ dsn: CONFIG.dsn, tracesSampleRate: 2 }, "tracesSampleRate must be within 0..1"], [{ dsn: CONFIG.dsn, tracesSampleRate: -0.1 }, "tracesSampleRate must be within 0..1"],
    [{ dsn: CONFIG.dsn, tracesSampleRate: "1" }, "tracesSampleRate must be within 0..1"], [{ dsn: CONFIG.dsn, tracesSampleRate: Number.NaN }, "tracesSampleRate must be within 0..1"],
  ] as const) assert.throws(() => createSentryProvider(input as Record<string, unknown>), { name: "TypeError", message });
  const { items, transport } = recordingTransport();
  const resource = createSentryProvider({ dsn: ` ${CONFIG.dsn} `, environment: "production" }, { transport });
  resource.port.trackOperation({ name: "unsampled" }).end({ outcome: "completed", failed: false });
  resource.port.reportError({ error: new Error("boom"), context: { operation: "x" } });
  await flush(); await resource.dispose({});
  assert.deepEqual(items.map((item) => item.type), ["event"], "rate 0: errors are sent, operations are not sampled");
  assert.equal(items[0]?.payload.environment, "production");
  let closed = 0;
  const hosted = createSentryProvider({ dsn: CONFIG.dsn }, { client: { close: async () => { closed += 1; return true; }, getOptions: () => ({}) } });
  await hosted.dispose({});
  assert.equal(closed, 0);
});

test("without a test transport the private client uses the SDK's own transport (nothing sent when idle)", async () => {
  const { dispose } = createSentryObservabilityAdapter({ config: CONFIG });
  await dispose();
});

test("site attribution: every exception and transaction carries the host's attributes as tags; a blank environment defaults to deployment.environment", async () => {
  const { createSentryProvider } = await import("../observability-sentry/index.js");
  const attribution = { attributes: { "tovu.site.id": "uuid-of-site-b", "tovu.site.slug": "site-b", "deployment.environment": "desktop", "tovu.project.id": "project-x" } };
  const { items, transport } = recordingTransport();
  const resource = createSentryProvider({ dsn: CONFIG.dsn, environment: "", tracesSampleRate: 1, attribution }, { transport });
  const tracker = resource.port.trackOperation({ name: "site.publish" });
  tracker.run(() => resource.port.reportError({ error: new Error("inside"), context: { operation: "site.publish" } }));
  tracker.end({ outcome: "completed", failed: false });
  resource.port.reportError({ error: new Error("outside"), context: { operation: "x" } });
  await flush(); await resource.dispose({});
  const sent = items.filter((item) => item.type === "event" || item.type === "transaction");
  assert.deepEqual(sent.map((item) => item.type).sort(), ["event", "event", "transaction"]);
  for (const item of sent) {
    assert.deepEqual({ ...item.payload.tags, operation: undefined }, { ...attribution.attributes, operation: undefined }, `${item.type} carries the site tags`);
    assert.equal(item.payload.environment, "desktop");
  }
  // An explicit card environment wins over the host's deployment environment.
  const second = recordingTransport();
  const explicit = createSentryProvider({ dsn: CONFIG.dsn, environment: "staging", attribution }, { transport: second.transport });
  explicit.port.reportError({ error: new Error("boom"), context: { operation: "x" } });
  await flush(); await explicit.dispose({});
  assert.equal(second.items[0]?.payload.environment, "staging");
  assert.equal(second.items[0]?.payload.tags["tovu.site.id"], "uuid-of-site-b");
  assert.throws(() => createSentryProvider({ dsn: CONFIG.dsn, attribution: { attributes: { n: 1 } } }), { name: "TypeError" });
});
