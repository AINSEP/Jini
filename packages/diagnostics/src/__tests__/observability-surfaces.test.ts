import { describe, expect, it } from "vitest";

import { InMemorySpanExporter, SpanKind, SpanStatusCode, createAsyncScope, createPort } from "./observability-fakes.js";

import { createNoopObservabilityPort, isNoopObservabilityPort } from "../observability/noop.js";
import { createHookObservabilityPort } from "../observability/hooks.js";
import type { ObservabilityConfigEnabled } from "../observability/config.js";

/**
 * @file The three signals beyond inbound requests — DB queries, outbound HTTP calls and agent runs —
 * through injected tracer fakes. Each case pins span name, kind, attributes and error status, plus
 * the redaction rules: no SQL text, no URL path/query/userinfo, no error messages.
 */

const CONFIG: ObservabilityConfigEnabled = { enabled: true, serviceName: "svc", tracerName: "svc.tracer", endpoint: "http://collector/v1/traces" };

function setup() {
 const exporter = new InMemorySpanExporter();
 const scope = createAsyncScope();
 return { exporter, port: createPort(CONFIG, exporter, { scope }) };
}

describe("trackDbQuery", () => {
 it("names the span from the operation and table known at end(), with db.* attributes and kind CLIENT", () => {
  const { exporter, port } = setup();
  const tracker = port.trackDbQuery({ system: "sqlite" });
  expect(exporter.getFinishedSpans()).toHaveLength(0);
  tracker.end({ operation: "select", table: "posts" });
  const [span] = exporter.getFinishedSpans();
  expect(span!.name).toBe("SELECT posts");
  expect(span!.kind).toBe(SpanKind.CLIENT);
  expect(span!.attributes).toEqual({ "db.system.name": "sqlite", "db.operation.name": "SELECT", "db.collection.name": "posts" });
  expect(span!.status.code).toBe(SpanStatusCode.UNSET);
 });

 it("omits the table when unknown and records a failure as ERROR status plus an exception event carrying only the error type", () => {
  const { exporter, port } = setup();
  const failure = Object.assign(new Error("UNIQUE constraint failed: users.email = 'a@b.c' token=abc123"), { code: "SQLITE_CONSTRAINT" });
  port.trackDbQuery({ system: "postgresql" }).end({ operation: "transaction", error: failure });
  const [span] = exporter.getFinishedSpans();
  expect(span!.name).toBe("TRANSACTION");
  expect(span!.attributes).toEqual({ "db.system.name": "postgresql", "db.operation.name": "TRANSACTION", "error.type": "SQLITE_CONSTRAINT" });
  expect(span!.status).toEqual({ code: SpanStatusCode.ERROR, description: "SQLITE_CONSTRAINT" });
  expect(span!.events).toEqual([{ name: "exception", attributes: { "exception.type": "SQLITE_CONSTRAINT" } }]);
  expect(JSON.stringify(span)).not.toContain("a@b.c");
  expect(JSON.stringify(span)).not.toContain("abc123");
 });

 it("ends at most once", () => {
  const { exporter, port } = setup();
  const tracker = port.trackDbQuery({ system: "sqlite" });
  tracker.end({ operation: "select" });
  tracker.end({ operation: "delete", error: new Error("late") });
  expect(exporter.getFinishedSpans()).toHaveLength(1);
  expect(exporter.getFinishedSpans()[0]!.name).toBe("SELECT");
 });
});

describe("trackOutboundCall", () => {
 it("keeps only method, scheme, host and port of the URL — never its path, query or userinfo", () => {
  const { exporter, port } = setup();
  port.trackOutboundCall({ method: "POST", url: "https://user:pa55@api.example.com:8443/bot123456:SECRET/send?token=abc&key=k" }).end({ statusCode: 201 });
  const [span] = exporter.getFinishedSpans();
  expect(span!.name).toBe("POST api.example.com");
  expect(span!.kind).toBe(SpanKind.CLIENT);
  expect(span!.attributes).toEqual({
   "http.request.method": "POST", "url.scheme": "https", "server.address": "api.example.com", "server.port": 8443, "http.response.status_code": 201,
  });
  expect(JSON.stringify(span)).not.toMatch(/SECRET|abc|pa55|user|send/);
 });

 it("falls back to a fixed host label for an unparseable URL, and omits server.port when the URL has none", () => {
  const { exporter, port } = setup();
  port.trackOutboundCall({ method: "GET", url: "not a url ?token=zzz" }).end({ statusCode: 200 });
  port.trackOutboundCall({ method: "GET", url: "http://example.org/x" }).end({ statusCode: 200 });
  const [bad, plain] = exporter.getFinishedSpans();
  expect(bad!.attributes["server.address"]).toBe("invalid-url");
  expect(JSON.stringify(bad)).not.toContain("zzz");
  expect(plain!.attributes).not.toHaveProperty("server.port");
 });

 it("marks 4xx/5xx responses and transport failures as ERROR (client-span semantics)", () => {
  const { exporter, port } = setup();
  port.trackOutboundCall({ method: "GET", url: "https://a.test/" }).end({ statusCode: 399 });
  port.trackOutboundCall({ method: "GET", url: "https://a.test/" }).end({ statusCode: 404 });
  port.trackOutboundCall({ method: "GET", url: "https://a.test/" }).end({ error: new TypeError("fetch failed https://a.test/?token=1") });
  port.trackOutboundCall({ method: "GET", url: "https://a.test/" }).end({ error: "boom" });
  const [ok, notFound, failed, odd] = exporter.getFinishedSpans();
  expect(ok!.status.code).toBe(SpanStatusCode.UNSET);
  expect(notFound!.status).toEqual({ code: SpanStatusCode.ERROR, description: "404" });
  expect(notFound!.attributes["error.type"]).toBe("404");
  expect(failed!.status).toEqual({ code: SpanStatusCode.ERROR, description: "TypeError" });
  expect(failed!.attributes).not.toHaveProperty("http.response.status_code");
  expect(failed!.events).toEqual([{ name: "exception", attributes: { "exception.type": "TypeError" } }]);
  expect(odd!.attributes["error.type"]).toBe("string");
 });
});

describe("trackAgentRun", () => {
 it("is a root INTERNAL span named invoke_agent with run/conversation ids and the terminal status", () => {
  const { exporter, port } = setup();
  const request = port.trackRequest({ method: "PUT", path: "/chats/1" });
  request.run!(() => port.trackAgentRun({ runId: "run_1" }, { conversationId: "conv_1", agentName: "writer" }).end({ status: "succeeded" }));
  request.end({ statusCode: 200, routePattern: "/chats/:id" });
  const run = exporter.getFinishedSpans().find((span) => span.name.startsWith("invoke_agent"));
  expect(run!.name).toBe("invoke_agent writer");
  expect(run!.kind).toBe(SpanKind.INTERNAL);
  expect(run!.parent).toBeUndefined();
  expect(run!.attributes).toEqual({
   "gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": "writer", "gen_ai.conversation.id": "conv_1", "agent.run.id": "run_1", "agent.run.status": "succeeded",
  });
  expect(run!.status.code).toBe(SpanStatusCode.UNSET);
 });

 it("failed and interrupted runs are errors; canceled and abandoned are not", () => {
  const { exporter, port } = setup();
  for (const status of ["failed", "interrupted", "canceled", "abandoned"] as const) port.trackAgentRun({ runId: status }).end({ status });
  expect(exporter.getFinishedSpans().map((span) => [span.attributes["agent.run.id"], span.status.code, span.name])).toEqual([
   ["failed", "error", "invoke_agent"], ["interrupted", "error", "invoke_agent"], ["canceled", "unset", "invoke_agent"], ["abandoned", "unset", "invoke_agent"],
  ]);
 });

 it("an error outcome adds the exception event with its type only", () => {
  const { exporter, port } = setup();
  port.trackAgentRun({ runId: "r" }).end({ status: "failed", error: new RangeError("api_key=sk-secret") });
  const [span] = exporter.getFinishedSpans();
  expect(span!.events).toEqual([{ name: "exception", attributes: { "exception.type": "RangeError" } }]);
  expect(JSON.stringify(span)).not.toContain("sk-secret");
 });
});

describe("parenting through the injected scope", () => {
 it("spans started inside a tracker's run() become its children, including across awaits", async () => {
  const { exporter, port } = setup();
  const request = port.trackRequest({ method: "GET", path: "/p" });
  await request.run!(async () => {
   await Promise.resolve();
   const tx = port.trackDbQuery({ system: "sqlite" });
   await tx.run(async () => {
    await Promise.resolve();
    port.trackDbQuery({ system: "sqlite" }).end({ operation: "insert", table: "posts" });
    port.trackOutboundCall({ method: "GET", url: "https://h.test/" }).end({ statusCode: 200 });
   });
   tx.end({ operation: "transaction" });
  });
  request.end({ statusCode: 200, routePattern: "/p" });
  const byName = Object.fromEntries(exporter.getFinishedSpans().map((span) => [span.name, span]));
  expect(byName["INSERT posts"]!.parent).toBe(byName["TRANSACTION"]);
  expect(byName["GET h.test"]!.parent).toBe(byName["TRANSACTION"]);
  expect(byName["TRANSACTION"]!.parent).toBe(byName["GET /p"]);
  expect(byName["GET /p"]!.parent).toBeUndefined();
 });

 it("without a scope port every span is a root and run() just calls through", () => {
  const exporter = new InMemorySpanExporter();
  const port = createPort(CONFIG, exporter);
  const request = port.trackRequest({ method: "GET", path: "/p" });
  expect(request.run!(() => { port.trackDbQuery({ system: "sqlite" }).end({ operation: "select" }); return 7; })).toBe(7);
  expect(exporter.getFinishedSpans()[0]!.parent).toBeUndefined();
 });
});

describe("request target redaction", () => {
 it("strips the query string and blanks secret-shaped path values, keeping ids", () => {
  const { exporter, port } = setup();
  port.trackRequest({ method: "GET", path: "/hooks/ghp_abcdefghijklmnopqrstuvwxyz0123456789/posts/507f191e810c19729de860ea?token=t#frag" })
   .end({ statusCode: 200, routePattern: "/hooks/:secret/posts/:id" });
  expect(exporter.getFinishedSpans()[0]!.attributes["http.target"]).toBe("/hooks/[REDACTED:credential]/posts/507f191e810c19729de860ea");
 });
});

describe("disabled telemetry", () => {
 it("every new signal returns one shared frozen tracker whose run() calls through", async () => {
  const port = createNoopObservabilityPort({});
  const db = port.trackDbQuery({ system: "sqlite" });
  expect(port.trackDbQuery({ system: "postgresql" })).toBe(db);
  expect(port.trackOutboundCall({ method: "GET", url: "x" })).toBe(db);
  expect(port.trackAgentRun({ runId: "r" })).toBe(db);
  expect(Object.isFrozen(db)).toBe(true);
  expect(() => db.end({ operation: "select" })).not.toThrow();
  expect(await db.run(async () => 3)).toBe(3);
  expect(port.trackRequest({ method: "GET", path: "/" }).run!(() => 4)).toBe(4);
  expect(isNoopObservabilityPort(port)).toBe(true);
  expect(isNoopObservabilityPort(createPort(CONFIG, new InMemorySpanExporter()))).toBe(false);
 });

 it("the hook port forwards the new signals to its tracing adapter, or to the no-op without one", () => {
  const exporter = new InMemorySpanExporter();
  const tracing = createPort(CONFIG, exporter);
  const hooks = createHookObservabilityPort({ clock: { nowMs: () => 0 }, requestIdGenerator: { generate: () => "id" } }, { tracing });
  hooks.trackDbQuery({ system: "sqlite" }).end({ operation: "select" });
  hooks.trackOutboundCall({ method: "GET", url: "https://h.test/" }).end({ statusCode: 200 });
  hooks.trackAgentRun({ runId: "r" }, { conversationId: "c" }).end({ status: "succeeded" });
  const request = hooks.trackRequest({ method: "GET", path: "/" });
  expect(request.run!(() => 5)).toBe(5);
  request.end({ statusCode: 200, routePattern: "/" });
  expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(["SELECT", "GET h.test", "invoke_agent", "GET /"]);
  const bare = createHookObservabilityPort({ clock: { nowMs: () => 0 }, requestIdGenerator: { generate: () => "id" } });
  expect(bare.trackDbQuery({ system: "sqlite" })).toBe(createNoopObservabilityPort({}).trackDbQuery({ system: "sqlite" }));
  expect(bare.trackRequest({ method: "GET", path: "/" }).run!(() => 6)).toBe(6);
 });
});
