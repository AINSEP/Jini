/** The Sentry provider plugin against the real SDK (recording transport, `.invalid` DSN: no network). */
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { NodeClient, createTransport, getCurrentScope } from "@sentry/node";
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { combineObservabilityPorts } from '@jini-ai/diagnostics/observability';
import { createTracker } from '@jini-ai/diagnostics/observability/node';
import { createOtelObservabilityAdapter } from '../observability-opentelemetry/opentelemetry.js';

import { createSentryObservabilityAdapter, type SentryConfigEnabled } from "../observability-sentry/sentry.js";

const CONFIG: SentryConfigEnabled = { enabled: true, dsn: "https://public@sentry.invalid/1", tracesSampleRate: 1 };
const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

test.each(['ftp://public@sentry.invalid/123', 'https://%ZZ@sentry.invalid/123'])
('a borrowed client advertises no crash upload for an unusable DSN %s', async dsn => {
  const close = vi.fn(async () => true);
  const resource = createSentryObservabilityAdapter({ config: { ...CONFIG, dsn } }, {
    client: { close, getOptions: () => ({}) } as never,
  });
  try { assert.equal(Object.hasOwn(resource.port, 'crashUpload'), false); }
  finally { await resource.dispose(); }
  assert.equal(close.mock.calls.length, 0);
});

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

test('a composed tracker correlates Sentry errors to the actual active OTel span only', async () => {
  const { items, transport } = recordingTransport();
  const sentry = createSentryObservabilityAdapter({ config: CONFIG }, { transport });
  const exporter = new InMemorySpanExporter();
  const otel = createOtelObservabilityAdapter({ config: {
    enabled: true, serviceName: 'fixture', tracerName: 'fixture', endpoint: 'https://collector.invalid/v1/traces',
  } }, { spanProcessors: [new SimpleSpanProcessor(exporter)] });
  try {
    const tracker = createTracker({ observability: combineObservabilityPorts({ ports: [sentry.port, otel.port] }) });
    await tracker.trace({ name: 'site.publish', run: async () => {
      await Promise.resolve();
      tracker.error({ error: new Error('inside') }, { context: { operation: 'site.publish' } });
    } });
    const span = exporter.getFinishedSpans().find(value => value.name === 'site.publish')!;
    const ids = span.spanContext();
    tracker.error({ error: new Error('outside') }, { context: { operation: 'site.publish' } });
    await sentry.dispose();
    const events = items.filter(item => item.type === 'event');
    assert.equal(events.length, 2);
    assert.deepEqual(events[0]!.payload.contexts.otel, { trace_id: ids.traceId, span_id: ids.spanId });
    assert.equal(events[1]!.payload.contexts.otel, undefined);
  } finally { await Promise.all([sentry.dispose(), otel.dispose()]); }
});

test('an OTel correlation context is explicit and independent of the Sentry trace', async () => {
  const { items, transport } = recordingTransport();
  const { port, dispose } = createSentryObservabilityAdapter({ config: CONFIG }, { transport });
  const operation = port.trackOperation({ name: 'site.publish' });
  const ids = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) };
  operation.run(() => port.reportError({ error: new Error('publish failed'), context: { operation: 'site.publish', trace: ids } }));
  operation.end({ outcome: 'failed', failed: true });
  port.reportError({ error: new Error('outside'), context: { operation: 'site.publish' } });
  await dispose();
  const events = items.filter(item => item.type === 'event');
  assert.equal(events.length, 2);
  assert.deepEqual(events[0]!.payload.contexts.otel, { trace_id: ids.traceId, span_id: ids.spanId });
  assert.notEqual(events[0]!.payload.contexts.trace.trace_id, ids.traceId);
  assert.equal(events[1]!.payload.contexts.otel, undefined);
});

test('memory diagnostic severity is a warning in the destination envelope', async () => {
  const { items, transport } = recordingTransport();
  const { port, dispose } = createSentryObservabilityAdapter({ config: CONFIG }, { transport });
  port.reportError({ error: new Error('process memory growth'), context: {
    operation: 'desktop.memory_growth', level: 'warning', attributes: { process: 'renderer', rss_0_mb: 1000, rss_1_mb: 1300 },
  } });
  await dispose();
  const events = items.filter(item => item.type === 'event');
  assert.equal(events.length, 1);
  assert.equal(events[0]!.payload.level, 'warning');
  assert.deepEqual(events[0]!.payload.contexts.operation, { process: 'renderer', rss_0_mb: 1000, rss_1_mb: 1300 });
});

test("obs2 #1: credential-shaped error codes never reach Sentry exception types", async () => {
  const { items, transport } = recordingTransport();
  const { port, dispose } = createSentryObservabilityAdapter({ config: CONFIG }, { transport });
  assert.equal(port.supportsMetric, false);
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
  const resource = createSentryProvider({ dsn: CONFIG.dsn, release: 'tovu@1.2.3+abcdef0', environment: "", tracesSampleRate: 1, attribution }, { transport });
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
    assert.equal(item.payload.release, 'tovu@1.2.3+abcdef0');
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

test('release reaches the private client and delivered event without global initialization or default integrations', async () => {
  const { createSentryProvider } = await import('../observability-sentry/index.js');
  const { items, transport } = recordingTransport();
  const options = vi.spyOn(NodeClient.prototype, 'getOptions');
  const init = vi.spyOn(NodeClient.prototype, 'init');
  const previousClient = getCurrentScope().getClient();
  try {
    const resource = createSentryProvider({ dsn: CONFIG.dsn, release: 'fixture-app@1.2.3' }, { transport });
    try {
      resource.port.reportError({ error: new Error('fixture failure'), context: { operation: 'fixture' } });
      await flush();
      const clientOptions = options.mock.results.flatMap(result => result.type === 'return' ? [result.value] : [])
        .find(value => value.release === 'fixture-app@1.2.3');
      assert.equal(clientOptions?.release, 'fixture-app@1.2.3');
      // Sentry 11.6's ServerRuntimeClient adds this internal integration even to an empty list.
      // It is set up by init(), which this private client must never call.
      assert.deepEqual(clientOptions?.integrations.map(integration => integration.name), ['SpanStreaming']);
      assert.equal(clientOptions?.enableRuntimeChannelInjection, false);
      assert.equal(init.mock.calls.length, 0);
      assert.equal(getCurrentScope().getClient(), previousClient);
    } finally { await resource.dispose({}); }
    assert.deepEqual(items.filter(item => item.type === 'event').map(item => item.payload.release), ['fixture-app@1.2.3']);
    assert.throws(() => createSentryProvider({ dsn: CONFIG.dsn, release: 42 }), { name: 'TypeError', message: 'release must be a string' });
  } finally { options.mockRestore(); init.mockRestore(); }
});

test.each([
  ['https://public@sentry.invalid/123', 'https://sentry.invalid/api/123/minidump/?sentry_key=public'],
  ['https://public:fixture-secret@sentry.invalid/prefix/123', 'https://sentry.invalid/prefix/api/123/minidump/?sentry_key=public'],
  ['http://public@localhost:9000/123', 'http://localhost:9000/api/123/minidump/?sentry_key=public'],
])('crashUpload derives only publishable upload configuration from %s', async (dsn, submitURL) => {
  const { transport } = recordingTransport();
  const resource = createSentryObservabilityAdapter({ config: { ...CONFIG, dsn } }, { transport });
  try {
    assert.deepEqual(resource.port.crashUpload?.({ release: 'fixture-app@1.2.3', environment: 'fixture' }), {
      submitURL, globalExtra: { sentry: JSON.stringify({ release: 'fixture-app@1.2.3', environment: 'fixture' }) },
    });
  } finally { await resource.dispose(); }
});

test('crashUpload is absent on noop and when a borrowed client has no usable configured DSN', async () => {
  const { createNoopObservabilityPort } = await import('@jini-ai/diagnostics/observability');
  assert.equal(Object.hasOwn(createNoopObservabilityPort({}), 'crashUpload'), false);
  for (const dsn of ['', 'not-a-dsn', 'https://sentry.invalid/123', 'https://public@sentry.invalid/no-project']) {
    const resource = createSentryObservabilityAdapter({ config: { ...CONFIG, dsn } }, {
      client: { close: async () => true, getOptions: () => ({}) } as never,
    });
    assert.equal(Object.hasOwn(resource.port, 'crashUpload'), false);
    await resource.dispose();
  }
});
