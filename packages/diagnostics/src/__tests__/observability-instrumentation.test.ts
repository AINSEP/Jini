import { describe, expect, it } from "vitest";

import { InMemorySpanExporter, createAsyncScope, createPort } from "./observability-fakes.js";

import { describeQueryNode, instrumentStorageKernel, trackFetch, trackHttpClient } from "../observability/instrumentation.js";
import { createNoopObservabilityPort } from "../observability/noop.js";
import type { ObservabilityConfigEnabled } from "../observability/config.js";
import type { HttpClientPort, HttpRequest } from "@jini-ai/core/primitives";

/**
 * @file Decorators that put the DB kernel and the guarded HTTP client on the port. The kernel and
 * query-builder are structural fakes shaped like the real Kysely objects (`withPlugin`,
 * `transformQuery({ node })`, `toOperationNode()`); a host test exercises the real driver.
 */

const CONFIG: ObservabilityConfigEnabled = { enabled: true, serviceName: "svc", tracerName: "svc.tracer", endpoint: "http://collector/v1/traces" };
const table = (name: string) => ({ kind: "TableNode", table: { kind: "SchemableIdentifierNode", identifier: { kind: "IdentifierNode", name } } });

type Plugin = { transformQuery(args: { node: unknown; queryId: unknown }): unknown; transformResult(args: { result: unknown; queryId: unknown }): Promise<unknown> };
/** A query builder that, like Kysely, hands every compiled query node to its plugins. */
function fakeDb(plugins: Plugin[] = []) {
 return {
  plugins,
  withPlugin(plugin: Plugin) { return fakeDb([...plugins, plugin]); },
  async execute(node: unknown) {
   for (const plugin of plugins) plugin.transformQuery({ node, queryId: {} });
   let result: unknown = { rows: [] };
   for (const plugin of plugins) result = await plugin.transformResult({ result, queryId: {} });
   return result;
  },
 };
}
type FakeDb = ReturnType<typeof fakeDb>;
function fakeKernel(dialect = "sqlite") {
 const calls: string[] = [];
 return {
  calls,
  dialect,
  async run<T>(fn: (db: FakeDb) => T | Promise<T>): Promise<T> { calls.push("run"); return fn(fakeDb()); },
  async transaction<T>(fn: () => Promise<T>): Promise<T> { calls.push("transaction"); return fn(); },
  async query(statement: unknown): Promise<unknown[]> { calls.push("query"); if (statement === "explode") throw new Error("bad"); return []; },
  async execute(_statement: unknown): Promise<void> { calls.push("execute"); },
 };
}
const raw = (text: string) => ({ toOperationNode: () => ({ kind: "RawNode", sqlFragments: [text], parameters: [] }) });

describe("describeQueryNode", () => {
 it("reads operation and table from Kysely's select/insert/update/delete/raw nodes and never returns values", () => {
  expect(describeQueryNode({ node: { kind: "SelectQueryNode", from: { kind: "FromNode", froms: [table("posts")] } } })).toEqual({ operation: "select", table: "posts" });
  expect(describeQueryNode({ node: { kind: "InsertQueryNode", into: table("media") } })).toEqual({ operation: "insert", table: "media" });
  expect(describeQueryNode({ node: { kind: "UpdateQueryNode", table: { kind: "AliasNode", node: table("users"), alias: {} } } })).toEqual({ operation: "update", table: "users" });
  expect(describeQueryNode({ node: { kind: "DeleteQueryNode", from: { kind: "FromNode", froms: [table("trash")] } } })).toEqual({ operation: "delete", table: "trash" });
  expect(describeQueryNode({ node: { kind: "SelectQueryNode" } })).toEqual({ operation: "select" });
  expect(describeQueryNode({ node: { kind: "RawNode", sqlFragments: ["  pragma table_info('x')"], parameters: [] } })).toEqual({ operation: "pragma" });
  expect(describeQueryNode({ node: { kind: "RawNode", sqlFragments: ["'secret' || x"], parameters: [] } })).toEqual({ operation: "raw" });
  expect(describeQueryNode({ node: { kind: "RawNode", sqlFragments: [], parameters: [] } })).toEqual({ operation: "raw" });
  expect(describeQueryNode({ node: { kind: "CreateTableNode" } })).toEqual({ operation: "create_table" });
  expect(describeQueryNode({ node: null })).toEqual({ operation: "query" });
 });
});

describe("instrumentStorageKernel", () => {
 it("run() emits one span named from the first query the body builds, as a child of the active span", async () => {
  const exporter = new InMemorySpanExporter();
  const port = createPort(CONFIG, exporter, { scope: createAsyncScope() });
  const kernel = fakeKernel();
  const same = instrumentStorageKernel({ kernel, observability: port });
  expect(same).toBe(kernel);
  const request = port.trackRequest({ method: "GET", path: "/" });
  const result = await request.run!(() => kernel.run(async (db) => {
   expect(await db.execute({ kind: "SelectQueryNode", from: { kind: "FromNode", froms: [table("posts")] } })).toEqual({ rows: [] });
   await db.execute({ kind: "DeleteQueryNode", from: { kind: "FromNode", froms: [table("other")] } });
   return "rows";
  }));
  request.end({ statusCode: 200, routePattern: "/" });
  expect(result).toBe("rows");
  const [db, req] = exporter.getFinishedSpans();
  expect(db!.name).toBe("SELECT posts");
  expect(db!.attributes["db.system.name"]).toBe("sqlite");
  expect(db!.parent).toBe(req);
 });

 it("a body that builds no query reports operation run; a rejected body ends the span as an error and rethrows", async () => {
  const exporter = new InMemorySpanExporter();
  const kernel = fakeKernel("postgres");
  instrumentStorageKernel({ kernel, observability: createPort(CONFIG, exporter) });
  await kernel.run(() => 1);
  await expect(kernel.run(() => { throw new SyntaxError("near 'x'"); })).rejects.toThrow("near 'x'");
  const [empty, failed] = exporter.getFinishedSpans();
  expect(empty!.name).toBe("RUN");
  expect(empty!.attributes["db.system.name"]).toBe("postgresql");
  expect(failed!.status).toEqual({ code: "error", description: "SyntaxError" });
 });

 it("passes the builder through untouched when it has no withPlugin", async () => {
  const exporter = new InMemorySpanExporter();
  const plain = { tag: "plain" };
  const kernel = { ...fakeKernel(), run: async <T>(fn: (db: typeof plain) => T) => fn(plain) };
  instrumentStorageKernel({ kernel, observability: createPort(CONFIG, exporter) });
  expect(await kernel.run((db) => db)).toBe(plain);
 });

 it("transaction() is one span whose inner run() spans are its children", async () => {
  const exporter = new InMemorySpanExporter();
  const kernel = fakeKernel();
  instrumentStorageKernel({ kernel, observability: createPort(CONFIG, exporter, { scope: createAsyncScope() }) });
  await kernel.transaction(async () => kernel.run((db) => db.execute({ kind: "InsertQueryNode", into: table("posts") })));
  const [insert, tx] = exporter.getFinishedSpans();
  expect(tx!.name).toBe("TRANSACTION");
  expect(insert!.name).toBe("INSERT posts");
  expect(insert!.parent).toBe(tx);
  await expect(kernel.transaction(async () => { throw new Error("rollback"); })).rejects.toThrow("rollback");
  expect(exporter.getFinishedSpans()[2]!.status.code).toBe("error");
 });

 it("query()/execute() take the operation from the raw statement's leading keyword only", async () => {
  const exporter = new InMemorySpanExporter();
  const kernel = fakeKernel();
  instrumentStorageKernel({ kernel, observability: createPort(CONFIG, exporter) });
  await kernel.query(raw("SELECT * FROM posts WHERE secret = 'x'"));
  await kernel.execute(raw("CREATE INDEX i ON t(c)"));
  await kernel.execute({ not: "a raw builder" });
  await expect(kernel.query("explode")).rejects.toThrow("bad");
  expect(exporter.getFinishedSpans().map((span) => [span.name, span.status.code])).toEqual([["SELECT", "unset"], ["CREATE", "unset"], ["QUERY", "unset"], ["QUERY", "error"]]);
  expect(JSON.stringify(exporter.getFinishedSpans())).not.toContain("secret");
  expect(kernel.calls).toEqual(["query", "execute", "execute", "query"]);
 });

 it("is a no-op for the disabled port and is never applied twice", async () => {
  const kernel = fakeKernel();
  const original = kernel.run;
  instrumentStorageKernel({ kernel, observability: createNoopObservabilityPort({}) });
  expect(kernel.run).toBe(original);
  const exporter = new InMemorySpanExporter();
  const port = createPort(CONFIG, exporter);
  instrumentStorageKernel({ kernel, observability: port });
  const once = kernel.run;
  instrumentStorageKernel({ kernel, observability: port });
  expect(kernel.run).toBe(once);
  await kernel.run(() => 0);
  expect(exporter.getFinishedSpans()).toHaveLength(1);
 });
});

describe("trackHttpClient", () => {
 const request: HttpRequest = { method: "GET", url: "https://api.example.com/v1/x?api_key=k", headers: { authorization: "Bearer zzz" }, idleTimeoutMs: 1000 };
 const respond = (status: number): HttpClientPort => ({ send: async () => ({ status, headers: {}, bodyText: "" }) });

 it("emits one outbound span per send with the response status, forwarding the redirect option", async () => {
  const exporter = new InMemorySpanExporter();
  let seen: unknown;
  const client: HttpClientPort = { send: async (required, optional) => { seen = optional; return { status: 503, headers: {}, bodyText: "" }; } };
  const tracked = trackHttpClient({ client, observability: createPort(CONFIG, exporter) });
  expect((await tracked.send({ request }, { redirect: "error" })).status).toBe(503);
  expect(seen).toEqual({ redirect: "error" });
  const [span] = exporter.getFinishedSpans();
  expect(span!.name).toBe("GET api.example.com");
  expect(span!.attributes["http.response.status_code"]).toBe(503);
  expect(span!.status.code).toBe("error");
  expect(JSON.stringify(span)).not.toMatch(/zzz|api_key|v1/);
 });

 it("records a transport failure and rethrows it", async () => {
  const exporter = new InMemorySpanExporter();
  const client: HttpClientPort = { send: async () => { throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" }); } };
  await expect(trackHttpClient({ client, observability: createPort(CONFIG, exporter) }).send({ request })).rejects.toThrow("refused");
  expect(exporter.getFinishedSpans()[0]!.attributes["error.type"]).toBe("ECONNREFUSED");
 });

 it("returns the client itself for the disabled port", () => {
  const client = respond(200);
  expect(trackHttpClient({ client, observability: createNoopObservabilityPort({}) })).toBe(client);
 });
});

describe("trackFetch", () => {
 type Init = { method?: string; headers?: Record<string, string> };
 const responding = (status: number) => {
  const calls: Array<[unknown, Init | undefined]> = [];
  const fetch = async (input: unknown, init?: Init) => { calls.push([input, init]); return { status }; };
  return { fetch, calls };
 };

 it("emits one outbound span per call with the response status, passing input and init through untouched", async () => {
  const exporter = new InMemorySpanExporter();
  const { fetch, calls } = responding(201);
  const init = { method: "put", headers: { authorization: "Bearer zzz" } };
  const response = await trackFetch({ fetch, observability: createPort(CONFIG, exporter) })("https://user:pw@api.example.com:8443/v1/x?api_key=k", init);
  expect(response.status).toBe(201);
  expect(calls).toEqual([["https://user:pw@api.example.com:8443/v1/x?api_key=k", init]]);
  const [span] = exporter.getFinishedSpans();
  expect(span!.name).toBe("PUT api.example.com");
  expect(span!.kind).toBe("client");
  expect(span!.attributes).toEqual({ "http.request.method": "PUT", "url.scheme": "https", "server.address": "api.example.com", "server.port": 8443, "http.response.status_code": 201 });
  expect(span!.status.code).toBe("unset");
  expect(JSON.stringify(span)).not.toMatch(/zzz|api_key|v1|user|pw/);
 });

 it("reads the URL and method from a URL or Request-shaped input, defaulting to GET", async () => {
  const exporter = new InMemorySpanExporter();
  const tracked = trackFetch({ fetch: responding(200).fetch, observability: createPort(CONFIG, exporter) });
  await tracked(new URL("https://a.example/p"));
  await tracked({ url: "https://b.example/q", method: "DELETE" });
  await tracked({ url: "https://c.example/r", method: "DELETE" }, { method: "PATCH" });
  await tracked(42);
  expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(["GET a.example", "DELETE b.example", "PATCH c.example", "GET invalid-url"]);
 });

 it("marks a 4xx/5xx response as an error span", async () => {
  const exporter = new InMemorySpanExporter();
  await trackFetch({ fetch: responding(503).fetch, observability: createPort(CONFIG, exporter) })("https://api.example.com/");
  expect(exporter.getFinishedSpans()[0]!.status.code).toBe("error");
 });

 it("records a rejected call by error type only and rethrows it", async () => {
  const exporter = new InMemorySpanExporter();
  const fetch = async (_input: unknown) => { throw Object.assign(new Error("connect to https://api.example.com/secret failed"), { code: "ECONNREFUSED" }); };
  await expect(trackFetch({ fetch, observability: createPort(CONFIG, exporter) })("https://api.example.com/secret")).rejects.toThrow("connect");
  const [span] = exporter.getFinishedSpans();
  expect(span!.attributes["error.type"]).toBe("ECONNREFUSED");
  expect(span!.status.code).toBe("error");
  expect(JSON.stringify(span)).not.toMatch(/secret/);
 });

 it("nests spans the wrapped call starts under its own span", async () => {
  const exporter = new InMemorySpanExporter();
  const port = createPort(CONFIG, exporter, { scope: createAsyncScope() });
  const fetch = async (_input: unknown) => { port.trackDbQuery({ system: "sqlite" }).end({ operation: "select" }); return { status: 200 }; };
  await trackFetch({ fetch, observability: port })("https://api.example.com/");
  const [inner, outer] = exporter.getFinishedSpans();
  expect(inner!.parent).toBe(outer);
 });

 it("returns the fetch itself for the disabled port", () => {
  const { fetch } = responding(200);
  expect(trackFetch({ fetch, observability: createNoopObservabilityPort({}) })).toBe(fetch);
 });
});
