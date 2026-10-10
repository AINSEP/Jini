/** 0.1.14 extraction: exercise the injected HTTP/converter seams without sockets or module mocks. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import { EgressRefusedError } from "../../http/guarded/errors.js";
import { htmlToMarkdown } from "../html-to-markdown.js";
import { fetchWebPage, readWebFetchInput, WEB_FETCH_USER_AGENT, UNTRUSTED_NOTICE, type WebFetchPorts, type WebFetchEvent } from "../web-page.js";

const now = Date.parse("2026-10-08T12:00:00.000Z");
function harness(response: HttpResponse) {
  const sent: HttpRequest[] = [];
  const events: WebFetchEvent[] = [];
  const ports: WebFetchPorts = {
    httpClient: { send: async ({ request }) => { sent.push(request); return response; } },
    htmlToMarkdown, nowMs: () => now, observeFetch: event => events.push(event),
  };
  return { ports, sent, events };
}
const response = (bodyText: string, contentType = "text/html"): HttpResponse => ({ status: 200, headers: { "content-type": contentType }, bodyText });
const fetch = (ports: WebFetchPorts, input: Record<string, unknown>) => fetchWebPage({ input: readWebFetchInput(input), ports, rateLimitScope: "workspace" });

test("generic reader uses the injected converter and redirect provenance, and remains anonymous", async () => {
  const { ports, sent, events } = harness({ ...response("<h1>Hi</h1>"), finalUrl: "https://b.example/final" });
  const converted: Array<{ html: string; pageUrl: string }> = [];
  ports.htmlToMarkdown = input => { converted.push(input); return "from injected converter"; };
  ports.userAgent = "Consumer page reader";
  const result = await fetch(ports, { url: "https://a.example/#top" });
  assert.deepEqual(converted, [{ html: "<h1>Hi</h1>", pageUrl: "https://b.example/final" }]);
  assert.equal(result.content, "from injected converter");
  assert.equal(result.finalUrl, "https://b.example/final");
  assert.equal(result.untrustedNotice, UNTRUSTED_NOTICE);
  assert.equal(result.untrusted, true);
  assert.equal(result.fetchedAt, "2026-10-08T12:00:00.000Z");
  assert.deepEqual(sent.map(request => [request.method, request.url, request.headers, request.maxResponseBytes, request.timeoutMs]), [["GET", "https://a.example/", { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5", "User-Agent": "Consumer page reader" }, 5 * 1024 * 1024, 15_000]]);
  assert.equal(sent[0]!.body, undefined);
  assert.ok(sent[0]!.signal instanceof AbortSignal);
  assert.deepEqual(events, [{ origin: "https://a.example", durationMs: 0, outcome: "response", status: 200 }]);
});

test("the library converter is bounded by maxChars after conversion without splitting surrogate pairs", async () => {
  const { ports } = harness(response("<h1>Hello</h1><p>abc😀def</p>"));
  const complete = await fetch(ports, { url: "https://a.example/" });
  assert.equal(complete.content, "# Hello\n\nabc😀def");
  const clipped = await fetch(ports, { url: "https://a.example/", maxChars: 13 });
  assert.deepEqual([clipped.content, clipped.truncated], ["# Hello\n\nabc", true]);
});

test("text, inert HTML and raw projections retain exact outputs and bypass the converter", async () => {
  const html = "<p>One <b>two</b></p><script>hidden</script>";
  const { ports } = harness(response(html));
  ports.htmlToMarkdown = () => { throw new Error("converter must not be called"); };
  assert.equal((await fetch(ports, { url: "https://a.example/", format: "text" })).content, "One two");
  assert.equal((await fetch(ports, { url: "https://a.example/", format: "html" })).content, "<html><head></head><body><p>One <b>two</b></p></body></html>");
  assert.equal((await fetch(ports, { url: "https://a.example/", format: "raw" })).content, html);
});

test("non-HTML transport truncation and engine identity are preserved", async () => {
  const { ports, sent } = harness({ ...response("partial", "text/plain"), bodyTruncated: true });
  const result = await fetch(ports, { url: "https://a.example/" });
  assert.deepEqual([result.content, result.truncated, result.links, result.images], ["partial", true, [], []]);
  assert.equal(sent[0]!.headers["User-Agent"], WEB_FETCH_USER_AGENT);
});

test("recognized Jini egress refusals expose only the caller-safe message", async () => {
  const { ports, events } = harness(response("unused"));
  ports.httpClient = { send: async () => { throw new EgressRefusedError({ message: "internal address details" }, { callerSafeMessage: "target refused" }); } };
  await assert.rejects(fetch(ports, { url: "https://a.example/" }), { constructor: ToolInputError, message: "web_fetch_page: target refused. Only public internet pages can be fetched." });
  assert.deepEqual(events, [{ origin: "https://a.example", durationMs: 0, outcome: "refused" }]);
});

test("rate limiting is scoped to the normalized target host before any HTTP request", async () => {
  const { ports, sent, events } = harness(response("unused"));
  const keys: string[] = [];
  ports.rateLimiter = { check: async ({ key }) => { keys.push(key); return { allowed: false, retryAfterSeconds: 60 }; } };
  await assert.rejects(fetch(ports, { url: "https://www.a.example/" }), { constructor: ToolInputError, message: "web_fetch_page: too many fetches from a.example in the last minute. Retry in 60 seconds." });
  assert.deepEqual(keys, ["workspace|a.example"]);
  assert.deepEqual(sent, []);
  assert.deepEqual(events, [{ origin: "https://www.a.example", durationMs: 0, outcome: "rate-limited" }]);
});

test("input errors and binary/unsupported responses retain precise correction messages", async () => {
  assert.throws(() => readWebFetchInput({ url: "https://a.example/", maxChars: 200001 }), { constructor: ToolInputError, message: "web_fetch_page: maxChars must be an integer from 1 to 200000." });
  const { ports, sent } = harness(response("unused"));
  await assert.rejects(fetch(ports, { url: "https://user:password@a.example/" }), { constructor: ToolInputError, message: "web_fetch_page: URLs with embedded credentials (user:password@) are refused." });
  assert.deepEqual(sent, []);
  await assert.rejects(fetch(harness(response("\u0000", "text/plain")).ports, { url: "https://a.example/" }), { constructor: ToolInputError, message: "web_fetch_page: the response is binary, not a text page." });
  await assert.rejects(fetch(harness(response("bytes", "image/png")).ports, { url: "https://a.example/" }), { constructor: ToolInputError, message: "web_fetch_page: 'image/png' is not a text page. Only HTML, text, XML, JSON and CSS can be read; use media_import_from_url for images." });
});

test('review wf: small output requests cap HTML before facts and the injected converter, and report truncation', async () => {
  const body = '<p>kept</p>' + ' '.repeat(4096) + '<a href="/tail">tail</a>';
  const { ports } = harness(response(body));
  const converted: string[] = [];
  ports.htmlToMarkdown = ({ html }) => { converted.push(html); return 'x'; };
  const result = await fetch(ports, { url: 'https://a.example/', maxChars: 1 });
  assert.deepEqual(converted, [body.slice(0, 4096)]);
  assert.equal(result.content, 'x');
  assert.equal(result.truncated, true);
  assert.deepEqual(result.links, []);
});

test('review wf: HTML input cap uses maxChars and never splits a surrogate pair', async () => {
  const { ports } = harness(response('a'.repeat(799_999) + '😀tail'));
  let received = '';
  ports.htmlToMarkdown = ({ html }) => { received = html; return 'ok'; };
  const result = await fetch(ports, { url: 'https://a.example/', maxChars: 200_000 });
  assert.equal(received, 'a'.repeat(799_999));
  assert.equal(result.truncated, true);
});
