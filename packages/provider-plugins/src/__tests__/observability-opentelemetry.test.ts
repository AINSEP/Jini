/**
 * The OpenTelemetry provider plugin against the real SDK. Ported from Tovu
 * `apps/website/src/platform/observability/__tests__/unit/{otel,otel-surfaces,otel-default-pipeline}.unit.test.ts`
 * when the adapter left Tovu core (2026-10-25). Proves the adapter builds real spans through the
 * port's own vocabulary (`trackRequest`/`end`), never asserting against OTel-specific call shapes from
 * the outside. Uses `InMemorySpanExporter` + `SimpleSpanProcessor` (OTel's own standard testing pair —
 * synchronous export on `span.end()`) via the `spanProcessors` test seam, so only the default-pipeline
 * case touches a socket, and that is a loopback collector this test owns.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, test } from "vitest";

import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { OTLPExporterBase } from "@opentelemetry/otlp-exporter-base";
import { createAsyncLocalSpanScope } from "@jini-ai/diagnostics/observability/node";
import type { ObservabilityConfigEnabled } from "@jini-ai/diagnostics/observability";

import { createOtelFactories, createOtelObservabilityAdapter } from "../observability-opentelemetry/opentelemetry.js";
import plugin, { createOpenTelemetryProvider, otlpHeadersOf } from "../observability-opentelemetry/index.js";

const TEST_CONFIG: ObservabilityConfigEnabled = {
  enabled: true,
  serviceName: "tovu-test",
  tracerName: "tovu.observability",
  endpoint: "http://collector.test/v1/traces",
};
const CONFIG = TEST_CONFIG;
const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });

function createPortUnderTest() {
  const exporter = new InMemorySpanExporter();
  const { port, dispose } = createOtelObservabilityAdapter({ config: TEST_CONFIG }, { spanProcessors: [new SimpleSpanProcessor(exporter)] });
  disposers.push(dispose);
  return { port, exporter };
}
const setup = createPortUnderTest;
/** Finished spans as a fixed tuple: each case asserts the count it destructures. */
const finished = (exporter: InMemorySpanExporter) => exporter.getFinishedSpans() as unknown as [ReadableSpan, ReadableSpan, ReadableSpan, ReadableSpan];

test("end() exports exactly one span per trackRequest() call", () => {
  const { port, exporter } = createPortUnderTest();
  const tracker = port.trackRequest({ method: "GET", path: "/welcome" });
  assert.equal(exporter.getFinishedSpans().length, 0, "the span must not be exported before end() is called");

  tracker.end({ statusCode: 200, routePattern: "/welcome" });

  assert.equal(exporter.getFinishedSpans().length, 1);
  const [span] = finished(exporter);
  assert.equal(span!.resource.attributes["service.name"], "tovu-test");
  assert.equal(span.instrumentationScope.name, "tovu.observability");
});
test("the exported span's name combines the method and the FINAL route pattern from end(), not the raw path known at trackRequest() time", () => {
  const { port, exporter } = createPortUnderTest();
  const tracker = port.trackRequest({ method: "GET", path: "/posts/507f191e810c19729de860ea" });
  tracker.end({ statusCode: 200, routePattern: "/api/admin/posts/:id" });

  const [span] = finished(exporter);
  assert.equal(span.name, "GET /api/admin/posts/:id");
});
test("attributes carry method, target, matched route, and status code; kind is SERVER", () => {
  const { port, exporter } = createPortUnderTest();
  const tracker = port.trackRequest({ method: "POST", path: "/api/admin/posts" });
  tracker.end({ statusCode: 201, routePattern: "/api/admin/posts" });

  const [span] = finished(exporter);
  assert.equal(span.kind, SpanKind.SERVER);
  assert.equal(span.attributes["http.method"], "POST");
  assert.equal(span.attributes["http.target"], "/api/admin/posts");
  assert.equal(span.attributes["http.route"], "/api/admin/posts");
  assert.equal(span.attributes["http.status_code"], 201);
});
test("a 5xx outcome sets the span status to ERROR", () => {
  const { port, exporter } = createPortUnderTest();
  const tracker = port.trackRequest({ method: "GET", path: "/boom" });
  tracker.end({ statusCode: 503, routePattern: "unmatched" });

  const [span] = finished(exporter);
  assert.equal(span.status.code, SpanStatusCode.ERROR);
});
test("a 2xx/4xx outcome leaves the span status UNSET — errors are reserved for 5xx, matching the port's contract (client errors are not server failures)", () => {
  const { port, exporter } = createPortUnderTest();
  const okTracker = port.trackRequest({ method: "GET", path: "/ok" });
  okTracker.end({ statusCode: 200, routePattern: "/ok" });
  const notFoundTracker = port.trackRequest({ method: "GET", path: "/missing" });
  notFoundTracker.end({ statusCode: 404, routePattern: "unmatched" });

  const [okSpan, notFoundSpan] = finished(exporter);
  assert.equal(okSpan.status.code, SpanStatusCode.UNSET);
  assert.equal(notFoundSpan.status.code, SpanStatusCode.UNSET);
});
test("multiple concurrent trackRequest() calls produce independently-attributed spans — one call's outcome never leaks into another's", () => {
  const { port, exporter } = createPortUnderTest();
  const first = port.trackRequest({ method: "GET", path: "/a" });
  const second = port.trackRequest({ method: "GET", path: "/b" });

  second.end({ statusCode: 500, routePattern: "/b" });
  first.end({ statusCode: 200, routePattern: "/a" });

  const spans = exporter.getFinishedSpans();
  assert.equal(spans.length, 2);
  const spanA = spans.find((s) => s.name === "GET /a");
  const spanB = spans.find((s) => s.name === "GET /b");
  assert.equal(spanA?.status.code, SpanStatusCode.UNSET);
  assert.equal(spanB?.status.code, SpanStatusCode.ERROR);
});

test("SDK factories reject an exporter of the wrong kind before starting a provider", () => {
  const { tracerProviderFactory } = createOtelFactories({});
  for (const exporter of [undefined, {}]) {
    assert.throws(() => tracerProviderFactory.create({ serviceName: "test", exporter }), {
      name: "TypeError", message: "OpenTelemetry requires an OTLP trace exporter",
    });
  }
});
test("without test processors the SDK factories build a real OTLP exporter and accept it into the batch pipeline", async () => {
  const { exporterFactory, tracerProviderFactory } = createOtelFactories({});
  const exporter = exporterFactory.create({ endpoint: "http://127.0.0.1:9/v1/traces" });
  assert.ok(exporter instanceof OTLPExporterBase);
  const tracer = tracerProviderFactory.create({ serviceName: "tovu-default", exporter }).getTracer({ name: "tovu.test" });
  const span = tracer.startSpan({ name: "unended", kind: "internal", attributes: {} });
  assert.equal(typeof span.end, "function", "a provider built on the OTLP batch processor hands out live spans");
  await exporter.shutdown();
});
test("explicit test processors suppress the network exporter entirely", () => {
  const { exporterFactory } = createOtelFactories({}, { spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())] });
  assert.equal(exporterFactory.create({ endpoint: "http://collector.test/v1/traces" }), undefined);
});
test("structural span methods preserve names, attributes, events and both error description shapes", () => {
  const exporter = new InMemorySpanExporter();
  const factories = createOtelFactories({}, { spanProcessors: [new SimpleSpanProcessor(exporter)] });
  assert.equal(factories.exporterFactory.create({ endpoint: TEST_CONFIG.endpoint }), undefined);
  const provider = factories.tracerProviderFactory.create({ serviceName: "adapter-service", exporter: undefined });
  const tracer = provider.getTracer({ name: "adapter-scope" });
  const parent = tracer.startSpan({ name: "original", kind: "server", attributes: { initial: "yes" } });
  parent.updateName({ name: "renamed" });
  parent.setAttribute({ name: "answer", value: 42 });
  parent.addEvent({ name: "with-details", attributes: { reason: "timeout" } });
  parent.addEvent({ name: "without-details", attributes: {} });
  parent.setStatus({ code: "error", description: "provider unavailable" });
  const child = tracer.startSpan({ name: "child", kind: "client", attributes: {} }, { parent });
  child.setStatus({ code: "error" });
  child.end({});
  parent.end({});
  const [childSpan, parentSpan] = finished(exporter);
  assert.equal(childSpan.parentSpanContext?.spanId, parentSpan.spanContext().spanId);
  assert.deepEqual(childSpan.status, { code: SpanStatusCode.ERROR });
  assert.equal(parentSpan.name, "renamed");
  assert.deepEqual(parentSpan.attributes, { initial: "yes", answer: 42 });
  assert.deepEqual(parentSpan.status, { code: SpanStatusCode.ERROR, message: "provider unavailable" });
  assert.deepEqual(parentSpan.events.map(({ name, attributes }) => ({ name, attributes })), [
    { name: "with-details", attributes: { reason: "timeout" } },
    { name: "without-details", attributes: {} },
  ]);
});
test("an unrecognized structural parent starts an SDK root span", () => {
  const exporter = new InMemorySpanExporter();
  const { tracerProviderFactory } = createOtelFactories({}, { spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const tracer = tracerProviderFactory.create({ serviceName: "test", exporter: undefined }).getTracer({ name: "test" });
  const foreign = {
    updateName() {}, setAttribute() {}, setStatus() {}, addEvent() {}, end() {},
  };
  tracer.startSpan({ name: "root", kind: "internal", attributes: {} }, { parent: foreign }).end({});
  const [span] = finished(exporter);
  assert.equal(span.name, "root");
  assert.equal(span.kind, SpanKind.INTERNAL);
  assert.equal(span.parentSpanContext, undefined);
});
test("async scope releases the active span after rejected work", async () => {
  const scope = createAsyncLocalSpanScope({});
  const span = { updateName() {}, setAttribute() {}, setStatus() {}, addEvent() {}, end() {} };
  assert.equal(scope.active(), undefined);
  await assert.rejects(scope.run({ span, fn: async () => {
    await Promise.resolve();
    assert.equal(scope.active(), span);
    throw new Error("work failed");
  } }), { message: "work failed" });
  assert.equal(scope.active(), undefined);
});

test("a DB span started inside a request's run() is that request span's child in the SDK, with kind CLIENT", async () => {
  const { exporter, port } = setup();
  const request = port.trackRequest({ method: "GET", path: "/posts" });
  await request.run!(async () => {
    await Promise.resolve();
    port.trackDbQuery({ system: "sqlite" }).end({ operation: "select", table: "posts" });
  });
  request.end({ statusCode: 200, routePattern: "/posts" });
  const [db, req] = finished(exporter);
  assert.equal(db.name, "SELECT posts");
  assert.equal(db.kind, SpanKind.CLIENT);
  assert.equal(req.kind, SpanKind.SERVER);
  assert.equal(db.parentSpanContext?.spanId, req.spanContext().spanId);
  assert.equal(db.spanContext().traceId, req.spanContext().traceId);
});

test("an outbound failure exports ERROR status, error.type and an exception event, without the URL path or query", () => {
  const { exporter, port } = setup();
  port.trackOutboundCall({ method: "POST", url: "https://api.example.com/hooks/abc?token=s3cret" }).end({ error: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
  const [span] = finished(exporter);
  assert.equal(span.kind, SpanKind.CLIENT);
  assert.equal(span.status.code, SpanStatusCode.ERROR);
  assert.equal(span.attributes["error.type"], "ECONNREFUSED");
  assert.deepEqual(span.events.map((event) => [event.name, event.attributes?.["exception.type"]]), [["exception", "ECONNREFUSED"]]);
  assert.doesNotMatch(JSON.stringify(span.attributes), /hooks|s3cret/);
});

test("an agent run is an INTERNAL root span even when started inside a request", () => {
  const { exporter, port } = setup();
  const request = port.trackRequest({ method: "PUT", path: "/chats/1" });
  request.run!(() => port.trackAgentRun({ runId: "run-1" }, { conversationId: "c-1" }).end({ status: "failed" }));
  request.end({ statusCode: 200, routePattern: "/chats/:id" });
  const run = exporter.getFinishedSpans().find((span) => span.name === "invoke_agent");
  assert.ok(run);
  assert.equal(run.kind, SpanKind.INTERNAL);
  assert.equal(run.parentSpanContext, undefined);
  assert.equal(run.status.code, SpanStatusCode.ERROR);
  assert.equal(run.attributes["agent.run.id"], "run-1");
});


test("the plugin factory exports through the default OTLP batch pipeline with its configured service identity and generic OTLP headers", async () => {
  const after: Array<() => unknown> = [];
  const t = { signal: new AbortController().signal, after: (fn: () => unknown) => { after.push(fn); } };
  try {
  let receive!: (request: { method: string | undefined; url: string | undefined; contentType: string | undefined; authorization: string | undefined; leak: unknown; encoding: unknown; body: string }) => void;
  const received = new Promise<Parameters<typeof receive>[0]>((resolve, reject) => {
    receive = resolve;
    t.signal.addEventListener("abort", () => reject(t.signal.reason), { once: true });
  });
  // Codex wave-2 HIGH: injected config only. Every standard OTEL_* variable an operator might have
  // set is hostile here; none may change the endpoint, headers, compression, sampling or resource.
  const hostileEnv: Record<string, string> = {
    OTEL_EXPORTER_OTLP_HEADERS: "x-leak=env-secret", OTEL_EXPORTER_OTLP_TRACES_HEADERS: "authorization=Bearer env-token",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9", OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://127.0.0.1:9/env-traces",
    OTEL_EXPORTER_OTLP_TRACES_COMPRESSION: "gzip", OTEL_EXPORTER_OTLP_COMPRESSION: "gzip", OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: "1",
    OTEL_TRACES_SAMPLER: "always_off", OTEL_SERVICE_NAME: "env-service", OTEL_RESOURCE_ATTRIBUTES: "env.leak=1",
    OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "0", OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT: "0",
  };
  const originalEnv = Object.fromEntries(Object.keys(hostileEnv).map((name) => [name, process.env[name]]));
  Object.assign(process.env, hostileEnv);
  t.after(() => {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const collector = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
    receive({ method: request.method, url: request.url, contentType: request.headers["content-type"], authorization: request.headers.authorization, leak: request.headers["x-leak"], encoding: request.headers["content-encoding"], body });
  });
  t.after(() => {
    collector.closeAllConnections();
    return new Promise<void>((resolve, reject) => {
      collector.close((error) => error ? reject(error) : resolve());
    });
  });
  await new Promise<void>((resolve, reject) => {
    collector.once("error", reject);
    collector.listen(0, "127.0.0.1", resolve);
  });
  const address = collector.address();
  assert.ok(address && typeof address === "object");
  const { port, dispose } = createOpenTelemetryProvider({
    serviceName: "tovu-default-pipeline-test", tracerName: "tovu.observability",
    tracesEndpoint: `http://127.0.0.1:${address.port}/configured-traces`, headers: { authorization: "Basic b3duZXI6dG9rZW4=" },
  });
  port.trackRequest({ method: "POST", path: "/posts/42" }).end({ statusCode: 201, routePattern: "/posts/:id" });

  const request = await received;
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/configured-traces");
  assert.equal(request.contentType, "application/json");
  assert.equal(request.authorization, "Basic b3duZXI6dG9rZW4=");
  assert.equal(request.leak, undefined, "OTEL_EXPORTER_OTLP_HEADERS was ignored");
  assert.equal(request.encoding, undefined, "OTEL_*_COMPRESSION was ignored");
  const payload = JSON.parse(request.body);
  assert.equal(payload.resourceSpans.length, 1);
  const [resourceSpans] = payload.resourceSpans;
  const service = resourceSpans.resource.attributes.find((attribute: { key: string }) => attribute.key === "service.name");
  assert.deepEqual(service.value, { stringValue: "tovu-default-pipeline-test" });
  assert.equal(resourceSpans.resource.attributes.some((attribute: { key: string }) => attribute.key === "env.leak"), false, "OTEL_RESOURCE_ATTRIBUTES was ignored");
  assert.equal(resourceSpans.scopeSpans.length, 1);
  const [scope] = resourceSpans.scopeSpans;
  assert.equal(scope.scope.name, "tovu.observability");
  assert.equal(scope.spans.length, 1);
  const [span] = scope.spans;
  assert.equal(span.name, "POST /posts/:id");
  assert.equal(span.kind, 2); // OTLP SERVER
  const attributes = new Map(span.attributes.map((attribute: { key: string; value: { stringValue?: string; intValue?: string | number } }) => [attribute.key, attribute.value]));
  assert.deepEqual(attributes.get("http.method"), { stringValue: "POST" });
  assert.deepEqual(attributes.get("http.target"), { stringValue: "/posts/42" });
  assert.deepEqual(attributes.get("http.route"), { stringValue: "/posts/:id" });
  assert.equal(Number((attributes.get("http.status_code") as { intValue: string | number }).intValue), 201);
  await dispose({});
  } finally { for (const fn of after.reverse()) await fn(); }
}, 15_000);

test("obs #1: a credential-shaped error.code never reaches an exported OTel span", () => {
  const { port, exporter } = setup();
  const code = "AKIA" + "A".repeat(16);
  const error = Object.assign(new Error("request failed"), { code });
  port.trackOutboundCall({ method: "GET", url: "https://api.example.com/x" }).end({ error });
  port.trackDbQuery({ system: "sqlite" }).end({ operation: "select", table: "posts", error });
  port.trackAgentRun({ runId: "run-1" }).end({ status: "failed", error });
  port.reportError({ error, context: { operation: "tool.call" } });
  const spans = exporter.getFinishedSpans();
  assert.equal(spans.length, 4);
  const exported = JSON.stringify(spans.map((span) => ({ name: span.name, attributes: span.attributes, status: span.status, events: span.events })));
  assert.ok(!exported.includes(code), exported);
  assert.ok(exported.includes("[REDACTED:credential]"));
});

test("constructing and disposing the adapter never takes over the process-wide tracer provider", async () => {
  const before = trace.getTracerProvider();
  const { dispose } = createOtelObservabilityAdapter({ config: CONFIG }, { spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())] });
  assert.equal(trace.getTracerProvider(), before);
  await dispose();
  assert.equal(trace.getTracerProvider(), before);
});

test("dispose shuts the provider down: later spans are not exported, and a second dispose resolves", async () => {
  const exporter = new InMemorySpanExporter();
  const { port, dispose } = createOtelObservabilityAdapter({ config: CONFIG }, { spanProcessors: [new SimpleSpanProcessor(exporter)] });
  port.trackRequest({ method: "GET", path: "/a" }).end({ statusCode: 200, routePattern: "/a" });
  assert.deepEqual(exporter.getFinishedSpans().map((span) => span.name), ["GET /a"]);
  await dispose();
  // Shutdown reached the exporter (the in-memory exporter clears on shutdown) and stopped the pipeline.
  assert.deepEqual(exporter.getFinishedSpans(), []);
  port.trackRequest({ method: "GET", path: "/b" }).end({ statusCode: 200, routePattern: "/b" });
  assert.deepEqual(exporter.getFinishedSpans(), []);
  await dispose();
});

test("dispose never throws when the SDK shutdown fails", async () => {
  const failing = new SimpleSpanProcessor(new InMemorySpanExporter());
  failing.shutdown = async () => { throw new Error("collector gone"); };
  const { dispose } = createOtelObservabilityAdapter({ config: CONFIG }, { spanProcessors: [failing] });
  await dispose();
});

test("plugin setup only registers the observability factory; it constructs nothing", () => {
  const registered: unknown[] = [];
  plugin.definition.setup({ providers: { register: (value: unknown) => { registered.push(value); } } } as never);
  assert.deepEqual(registered, [{ contract: "observability", id: "opentelemetry", contractVersion: 1, factory: createOpenTelemetryProvider }]);
});

test("the factory resolves a general endpoint to /v1/traces and serves the port until disposed", async () => {
  const exporter = new InMemorySpanExporter();
  const resource = createOpenTelemetryProvider({ serviceName: " svc ", tracerName: "scope", endpoint: "http://collector.test/" }, { spanProcessors: [new SimpleSpanProcessor(exporter)] });
  resource.port.trackOperation({ name: "op" }).end({ outcome: "completed", failed: false });
  const [span] = finished(exporter);
  assert.equal(span!.resource.attributes["service.name"], "svc");
  assert.equal(span!.instrumentationScope.name, "scope");
  await resource.dispose({});
});

test.each([
  [{ serviceName: "s", tracerName: "t" }, "an OTLP endpoint is required"],
  [{ serviceName: "s", tracerName: "t", endpoint: "  " }, "an OTLP endpoint is required"],
  [{ serviceName: 1, tracerName: "t", endpoint: "http://c" }, "serviceName must be a string"],
  [{ serviceName: "s", tracerName: null, endpoint: "http://c" }, "tracerName must be a string"],
  [{ serviceName: "s", tracerName: "t", endpoint: 5 }, "endpoint must be a string"],
  [{ serviceName: "s", tracerName: "t", tracesEndpoint: [] }, "tracesEndpoint must be a string"],
  [{ serviceName: "", tracerName: "t", endpoint: "http://c" }, "serviceName must be non-empty"],
  [{ tracerName: "t", endpoint: "http://c" }, "serviceName must be non-empty"],
  [{ endpoint: "http://c" }, "serviceName must be non-empty"],
  [{ serviceName: "s", tracerName: "", endpoint: "http://c" }, "tracerName must be non-empty"],
  [{ serviceName: "s", tracerName: "t", endpoint: "http://c", headers: "x" }, "headers must be Name=Value pairs separated by commas"],
  [{ serviceName: "s", tracerName: "t", endpoint: "http://c", headers: null }, "headers must be an object of strings"],
  [{ serviceName: "s", tracerName: "t", endpoint: "http://c", headers: ["a"] }, "headers must be an object of strings"],
  [{ serviceName: "s", tracerName: "t", endpoint: "http://c", headers: { a: "ok", b: 1 } }, "headers must be an object of strings"],
])("the factory refuses malformed input %j", (input, message) => {
  assert.throws(() => createOpenTelemetryProvider(input as Record<string, unknown>), { name: "TypeError", message });
});

test("the factory builds a real OTLP exporter with headers when no test processors are given", async () => {
  const resource = createOpenTelemetryProvider({ serviceName: "s", tracerName: "t", endpoint: "http://127.0.0.1:9", headers: { "x-scope": "a" } });
  await resource.dispose({});
});

test("the factory without headers or test processors builds a plain OTLP exporter", async () => {
  const resource = createOpenTelemetryProvider({ serviceName: "s", tracerName: "t", tracesEndpoint: "http://127.0.0.1:9/v1/traces" });
  await resource.dispose({});
});

test("settings-card headers: the OTLP `Name=Value,Name=Value` text form becomes the same generic headers object", () => {
  assert.deepEqual(otlpHeadersOf("Authorization=Basic b3duZXI6dG9rZW4=, X-Scope-OrgID = tenant=a "), { Authorization: "Basic b3duZXI6dG9rZW4=", "X-Scope-OrgID": "tenant=a" });
  assert.deepEqual(otlpHeadersOf(""), undefined);
  assert.deepEqual(otlpHeadersOf({ a: "b" }), { a: "b" });
  for (const bad of ["novalue", "=x", "a=b,,c"]) assert.throws(() => otlpHeadersOf(bad), { name: "TypeError", message: "headers must be Name=Value pairs separated by commas" });
});

test("a settings card supplies no tracer name: the service name is the tracer name", async () => {
  const exporter = new InMemorySpanExporter();
  const resource = createOpenTelemetryProvider({ serviceName: "svc", endpoint: "http://127.0.0.1:9", headers: "authorization=Bearer t" }, { spanProcessors: [new SimpleSpanProcessor(exporter)] });
  resource.port.trackOperation({ name: "op" }).end({ outcome: "ok", failed: false });
  assert.equal(exporter.getFinishedSpans()[0]?.instrumentationScope.name, "svc");
  await resource.dispose({});
});

test("site attribution: every exported span's resource carries the host's attributes; service.name stays the host's service", async () => {
  const exporter = new InMemorySpanExporter();
  const resource = createOpenTelemetryProvider({ serviceName: "tovu", endpoint: "http://127.0.0.1:9",
    attribution: { attributes: { "tovu.site.id": "site-123", "tovu.site.slug": "blog", "deployment.environment": "local", "tovu.project.id": "proj-9", "service.name": "spoofed" } } },
  { spanProcessors: [new SimpleSpanProcessor(exporter)] });
  resource.port.trackRequest({ method: "GET", path: "/" }).end({ statusCode: 200, routePattern: "/" });
  resource.port.trackOperation({ name: "site.publish" }).end({ outcome: "published", failed: false });
  const spans = exporter.getFinishedSpans();
  assert.equal(spans.length, 2);
  for (const span of spans) {
    assert.deepEqual({ ...span.resource.attributes }, { "service.name": "tovu", "tovu.site.id": "site-123", "tovu.site.slug": "blog", "deployment.environment": "local", "tovu.project.id": "proj-9" });
  }
  await resource.dispose({});
});
