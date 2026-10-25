import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemorySpanExporter, createAsyncScope, createPort } from "./observability-fakes.js";
import { createNoopObservabilityPort } from "../observability/noop.js";
import { createHookObservabilityPort } from "../observability/hooks.js";
import { describeReportedError } from "../observability/errors.js";
import { errorType } from "../observability/otel.js";
import type { ObservabilityConfigEnabled } from "../observability/config.js";

/** Feature-level operations and error reports: the two signals no transport names. */

const CONFIG: ObservabilityConfigEnabled = { enabled: true, serviceName: "svc", tracerName: "svc.ops", endpoint: "http://collector/v1/traces" };
const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

test("noop: trackOperation returns one shared frozen tracker and reportError does nothing", () => {
  const port = createNoopObservabilityPort({});
  const first = port.trackOperation({ name: "tool.call", attributes: { "tool.id": "a" } });
  const second = port.trackOperation({ name: "tool.call" });
  assert.equal(first, second);
  assert.ok(Object.isFrozen(first));
  assert.equal(first.run(() => 7), 7);
  assert.doesNotThrow(() => port.reportError({ error: new Error("x"), context: { operation: "tool.call" } }));
});

test("otel: an operation is one internal span carrying its attributes and outcome; a non-failed outcome leaves status unset", () => {
  const exporter = new InMemorySpanExporter();
  const port = createPort(CONFIG, exporter);
  port.trackOperation({ name: "tool.call", attributes: { "tool.id": "pages_list" } }).end({ outcome: "denied", failed: false });
  const [span] = exporter.getFinishedSpans();
  assert.equal(span?.name, "tool.call");
  assert.equal(span?.kind, "internal");
  assert.deepEqual(span?.attributes, { "tool.id": "pages_list", "operation.outcome": "denied" });
  assert.equal(span?.status.code, "unset");
});

test("otel: a failed outcome sets error status and error.type to the outcome label; end is once-only", () => {
  const exporter = new InMemorySpanExporter();
  const tracker = createPort(CONFIG, exporter).trackOperation({ name: "tool.call" });
  tracker.end({ outcome: "timed-out", failed: true, attributes: { "tool.error_kind": "internal" } });
  tracker.end({ outcome: "completed", failed: false });
  assert.equal(exporter.getFinishedSpans().length, 1);
  const [span] = exporter.getFinishedSpans();
  assert.equal(span?.status.code, "error");
  assert.equal(span?.attributes["error.type"], "timed-out");
  assert.equal(span?.attributes["tool.error_kind"], "internal");
});

test("otel: reportError inside run() adds a type-only exception event to that operation's span", async () => {
  const exporter = new InMemorySpanExporter();
  const port = createPort(CONFIG, exporter, { scope: createAsyncScope() });
  const tracker = port.trackOperation({ name: "tool.call" });
  await tracker.run(async () => { port.reportError({ error: new TypeError(`token ${SECRET}`), context: { operation: "tool.call" } }); });
  tracker.end({ outcome: "failed", failed: true });
  const spans = exporter.getFinishedSpans();
  assert.equal(spans.length, 1);
  assert.deepEqual(spans[0]?.events, [{ name: "exception", attributes: { "exception.type": "TypeError", "operation.name": "tool.call" } }]);
  assert.ok(!JSON.stringify(spans).includes(SECRET));
});

test("otel: reportError outside any tracker is its own ended root span", () => {
  const exporter = new InMemorySpanExporter();
  createPort(CONFIG, exporter, { scope: createAsyncScope() }).reportError({ error: Object.assign(new Error("x"), { code: "ECONNRESET" }), context: { operation: "backup.run", attributes: { "backup.kind": "full" } } });
  const [span] = exporter.getFinishedSpans();
  assert.equal(span?.name, "error backup.run");
  assert.equal(span?.status.code, "error");
  assert.equal(span?.attributes["backup.kind"], "full");
  assert.equal(span?.events[0]?.attributes["exception.type"], "ECONNRESET");
});

test("otel: reportError never throws even when the span sink does", () => {
  const port = createPort(CONFIG, Object.assign(new InMemorySpanExporter(), { spans: { push() { throw new Error("exporter down"); } } }) as unknown as InMemorySpanExporter);
  assert.doesNotThrow(() => port.reportError({ error: new Error("x"), context: { operation: "op" } }));
});

test("hooks: operations and error reports pass straight to the tracing adapter", () => {
  const exporter = new InMemorySpanExporter();
  const port = createHookObservabilityPort({ clock: { nowMs: () => 0 }, requestIdGenerator: { generate: () => "r" } }, { tracing: createPort(CONFIG, exporter) });
  port.trackOperation({ name: "op" }).end({ outcome: "completed", failed: false });
  port.reportError({ error: new Error("x"), context: { operation: "op" } });
  assert.deepEqual(exporter.getFinishedSpans().map((s) => s.name), ["op", "error op"]);
});

test("describeReportedError redacts secret shapes from message and stack, and caps the message", () => {
  const described = describeReportedError({ error: new Error(`auth failed with ${SECRET} ${"x".repeat(5000)}`) });
  assert.equal(described.type, "Error");
  assert.ok(!described.message.includes(SECRET));
  assert.ok(!(described.stack ?? "").includes(SECRET));
  assert.ok(described.message.length <= 1024);
  assert.deepEqual(describeReportedError({ error: "plain" }), { type: "string", message: "plain" });
});

test("combineObservabilityPorts: noop-only is the noop, one live port is returned as-is", async () => {
  const { combineObservabilityPorts } = await import("../observability/fanout.js");
  const { isNoopObservabilityPort } = await import("../observability/noop.js");
  assert.ok(isNoopObservabilityPort(combineObservabilityPorts({ ports: [createNoopObservabilityPort({}), createNoopObservabilityPort({})] })));
  const live = createPort(CONFIG, new InMemorySpanExporter());
  assert.equal(combineObservabilityPorts({ ports: [createNoopObservabilityPort({}), live] }), live);
});

test("combineObservabilityPorts: two live ports each get the operation, its nested report, and its end; a throwing reporter does not stop the other", async () => {
  const { combineObservabilityPorts } = await import("../observability/fanout.js");
  const a = new InMemorySpanExporter(); const b = new InMemorySpanExporter();
  const scopeA = createAsyncScope(); const scopeB = createAsyncScope();
  const broken = { ...createPort(CONFIG, a, { scope: scopeA }), reportError: () => { throw new Error("tracker down"); } };
  const port = combineObservabilityPorts({ ports: [broken, createPort(CONFIG, b, { scope: scopeB })] });
  const tracker = port.trackOperation({ name: "tool.call" });
  assert.equal(tracker.run(() => { port.reportError({ error: new RangeError("x"), context: { operation: "tool.call" } }); return 5; }), 5);
  tracker.end({ outcome: "failed", failed: true });
  assert.deepEqual(a.getFinishedSpans().map((s) => s.name), ["tool.call"]);
  assert.deepEqual(b.getFinishedSpans().map((s) => [s.name, s.events[0]?.attributes["exception.type"]]), [["tool.call", "RangeError"]]);
});

test("review #2: a secret in Error.name is redacted and capped in the error type (OTel export and describeReportedError)", () => {
  const error = new Error("boom"); error.name = `${SECRET}${"X".repeat(200)}`;
  const described = describeReportedError({ error });
  assert.ok(!described.type.includes(SECRET)); assert.ok(described.type.length <= 64);
  const exporter = new InMemorySpanExporter();
  createPort(CONFIG, exporter).reportError({ error, context: { operation: "tool.call" } });
  const exported = JSON.stringify(exporter.getFinishedSpans().map((s) => [s.status, s.events, s.attributes]));
  assert.ok(!exported.includes(SECRET));
});

test("obs2 #1: a credential-shaped error.code is redacted before OTel and error-tracker delivery", () => {
  const code = "AKIA" + "A".repeat(16);
  const error = Object.assign(new TypeError("request failed"), { code });
  const exporter = new InMemorySpanExporter();
  const port = createPort(CONFIG, exporter);
  port.reportError({ error, context: { operation: "tool.call" } });
  port.trackDbQuery({ system: "sqlite" }).end({ operation: "select", error });
  const label = "[REDACTED:credential]";
  assert.equal(describeReportedError({ error }).type, label);
  const spans = exporter.getFinishedSpans();
  assert.equal(spans.length, 2);
  for (const span of spans) {
    assert.equal(span.status.description, label);
    assert.equal(span.events[0]?.attributes["exception.type"], label);
  }
  assert.equal(spans[1]?.attributes["error.type"], label);
  assert.ok(!JSON.stringify(spans).includes(code));
});

test("error labels retain safe code precedence, class fallback and the redact-before-cap order", () => {
  assert.equal(errorType(Object.assign(new TypeError("hidden"), { code: "ECONNRESET" })), "ECONNRESET");
  assert.equal(errorType(Object.assign(new TypeError("hidden"), { code: "invalid code" })), "TypeError");
  const error = new Error("hidden");
  error.name = `${"x".repeat(60)} ${SECRET}`;
  assert.equal(errorType(error), `${"x".repeat(60)} [RE`);
  assert.equal(errorType(null), "object");
});

test("review #1: secret-shaped operation attribute strings are redacted before the SDK sees them", () => {
  const exporter = new InMemorySpanExporter();
  const port = createPort(CONFIG, exporter);
  port.trackOperation({ name: "tool.call", attributes: { "tool.id": SECRET } }).end({ outcome: "completed", failed: false, attributes: { note: SECRET } });
  port.reportError({ error: new Error("x"), context: { operation: "tool.call", attributes: { "tool.id": SECRET } } });
  assert.ok(!JSON.stringify(exporter.getFinishedSpans().map((s) => s.attributes)).includes(SECRET));
});

test("review #3: fan-out isolates each adapter's tracker creation and end; the caller never sees an adapter's throw", async () => {
  const { combineObservabilityPorts } = await import("../observability/fanout.js");
  const b = new InMemorySpanExporter(); const c = new InMemorySpanExporter();
  const throwsOnStart = { ...createPort(CONFIG, new InMemorySpanExporter()), trackOperation: () => { throw new Error("start down"); } };
  const throwsOnEnd = { ...createPort(CONFIG, b), trackOperation: () => ({ run: <T>(fn: () => T) => fn(), end: () => { throw new Error("end down"); } }) };
  const port = combineObservabilityPorts({ ports: [throwsOnStart, throwsOnEnd, createPort(CONFIG, c)] });
  const tracker = port.trackOperation({ name: "tool.call" });
  assert.equal(tracker.run(() => "done"), "done");
  assert.doesNotThrow(() => tracker.end({ outcome: "completed", failed: false }));
  assert.deepEqual(c.getFinishedSpans().map((s) => s.name), ["tool.call"]);
});
