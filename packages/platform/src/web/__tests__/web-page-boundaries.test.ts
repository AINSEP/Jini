/** Boundary pins for web-page.ts: input validation edges, decoding, sitemap facts, failure mapping and rendered caps. */
import { describe, expect, test } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import { htmlToMarkdown } from "../html-to-markdown.js";
import { MAX_IMAGES, MAX_LINKS } from "../html-document.js";
import { fetchWebPage, isAllowedContentType, readWebFetchInput, type RenderedWebPage, type WebFetchEvent, type WebFetchPorts } from "../web-page.js";

const url = "https://a.example/";
function harness(response: HttpResponse) {
  const events: WebFetchEvent[] = [];
  const ports: WebFetchPorts = {
    httpClient: { send: async () => response },
    htmlToMarkdown, nowMs: () => 0, observeFetch: event => events.push(event),
  };
  return { ports, events };
}
const ok = (bodyText: string, headers: Record<string, string> = { "content-type": "text/html" }, extra: Partial<HttpResponse> = {}): HttpResponse => ({ status: 200, headers, bodyText, ...extra });
const fetch = (ports: WebFetchPorts, input: Record<string, unknown>, optional: { signal?: AbortSignal; timeoutMs?: number } = {}) =>
  fetchWebPage({ input: readWebFetchInput({ url, ...input }), ports, rateLimitScope: "w" }, optional);
const failing = (error: unknown): WebFetchPorts["httpClient"] => ({ send: async () => { throw error; } });

describe("readWebFetchInput page-option edges", () => {
  const urlMessage = "web_fetch_page: url must be an absolute http(s) URL of at most 2048 characters.";
  test.each([[undefined], [1], [""], ["h".repeat(2049)]])("url %s is refused", bad => {
    expect(() => readWebFetchInput({ url: bad })).toThrow(new ToolInputError({ message: urlMessage }));
  });
  test("a url of exactly 2048 characters is accepted", () => {
    expect(readWebFetchInput({ url: "h".repeat(2048) }).url).toHaveLength(2048);
  });
  test.each([[1], ["pdf"]])("format %s is refused", format => {
    expect(() => readWebFetchInput({ url, format })).toThrow(new ToolInputError({ message: "web_fetch_page: format must be one of markdown, text, html, raw." }));
  });
  test.each([["5"], [1.5], [0]])("maxChars %s is refused", maxChars => {
    expect(() => readWebFetchInput({ url, maxChars })).toThrow(new ToolInputError({ message: "web_fetch_page: maxChars must be an integer from 1 to 200000." }));
  });
  test("maxChars bounds 1 and 200000 are accepted", () => {
    expect([readWebFetchInput({ url, maxChars: 1 }).maxChars, readWebFetchInput({ url, maxChars: 200_000 }).maxChars]).toEqual([1, 200_000]);
  });
  test("a boolean option names itself when it is not a boolean", () => {
    expect(() => readWebFetchInput({ url, render: true, screenshot: 1 })).toThrow(new ToolInputError({ message: "web_fetch_page: screenshot must be a boolean." }));
  });
  test("a 500-character selector is accepted and trimmed", () => {
    expect(readWebFetchInput({ url, render: true, waitFor: "x".repeat(500) }).waitFor).toHaveLength(500);
  });
  test("captureDataMatch as a single string keeps the original string", () => {
    expect(readWebFetchInput({ url, render: true, captureDataMatch: " /rows " }).captureDataMatch).toBe(" /rows ");
  });
  test("captureDataMatch arrays are copied, not retained", () => {
    const patterns = ["/rows"];
    const read = readWebFetchInput({ url, render: true, captureDataMatch: patterns }).captureDataMatch;
    expect(read).toEqual(["/rows"]);
    expect(read).not.toBe(patterns);
  });
});

describe("URL pre-flight", () => {
  test("an unparsable url gets an example of an absolute URL", async () => {
    await expect(fetch(harness(ok("")).ports, { url: "not a url" })).rejects.toThrow(new ToolInputError({ message: "web_fetch_page: url must be an absolute http(s) URL, e.g. https://example.com/about." }));
  });
  test("a non-http scheme names the scheme", async () => {
    await expect(fetch(harness(ok("")).ports, { url: "ftp://a.example/" })).rejects.toThrow(new ToolInputError({ message: "web_fetch_page: only http and https URLs can be fetched, not 'ftp:'." }));
  });
  test("a username alone counts as embedded credentials", async () => {
    await expect(fetch(harness(ok("")).ports, { url: "https://user@a.example/" })).rejects.toThrow(new ToolInputError({ message: "web_fetch_page: URLs with embedded credentials (user:password@) are refused." }));
  });
  test("an allowed rate-limit verdict lets the fetch proceed", async () => {
    const { ports } = harness(ok("hi", { "content-type": "text/plain" }));
    ports.rateLimiter = { check: async () => ({ allowed: true }) };
    expect((await fetch(ports, {})).content).toBe("hi");
  });
});

describe("isAllowedContentType", () => {
  test.each([["", true], ["text/css", true], ["application/xhtml+xml", true], ["application/xml", true], ["application/json", true], ["application/rss+xml", true], ["application/ld+json", true], ["application/pdf", false], ["image/svg+xml", false]])("%s -> %s", (mediaType, expected) => {
    expect(isAllowedContentType({ mediaType })).toBe(expected);
  });
});

describe("response projection", () => {
  test("header lookup is case-insensitive and a parameterised media type is normalised", async () => {
    const result = await fetch(harness(ok("<p>x</p>", { "Content-Type": "TEXT/HTML; charset=utf-8" })).ports, { format: "text" });
    expect([result.contentType, result.content]).toEqual(["TEXT/HTML; charset=utf-8", "x"]);
  });
  test("a missing content type with an HTML doctype body is projected as HTML", async () => {
    const result = await fetch(harness(ok("<!DOCTYPE html><title>T</title><p>x</p>", {})).ports, { format: "text" });
    expect([result.contentType, result.title, result.content]).toEqual(["", "T", "x"]);
  });
  test("a missing content type with a non-HTML body is returned verbatim", async () => {
    const result = await fetch(harness(ok("<p>x</p>", {})).ports, { format: "text" });
    expect([result.content, result.title]).toEqual(["<p>x</p>", undefined]);
  });
  test("application/xhtml+xml is projected as HTML", async () => {
    expect((await fetch(harness(ok("<p>x</p>", { "content-type": "application/xhtml+xml" })).ports, { format: "text" })).content).toBe("x");
  });
  test("description and lang facts are returned when present", async () => {
    const result = await fetch(harness(ok('<html lang="en"><head><meta name="description" content="About"></head></html>')).ports, {});
    expect([result.description, result.lang]).toEqual(["About", "en"]);
  });
  test("JSON gets empty page facts", async () => {
    const result = await fetch(harness(ok('{"a":1}', { "content-type": "application/json" })).ports, {});
    expect(result).toMatchObject({ content: '{"a":1}', links: [], images: [], stylesheets: [], meta: {}, linksTruncated: false, imagesTruncated: false });
  });
});

describe("charset decoding", () => {
  const latin1 = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]);
  test("a header charset re-decodes the raw bytes", async () => {
    const result = await fetch(harness(ok("caf?", { "content-type": "text/plain; charset=ISO-8859-1" }, { bodyBytes: latin1 })).ports, {});
    expect(result.content).toBe("café");
  });
  test("an HTML meta charset re-decodes the raw bytes", async () => {
    const html = Uint8Array.from([...new TextEncoder().encode('<meta charset="windows-1252"><p>'), 0xe9, ...new TextEncoder().encode("</p>")]);
    const result = await fetch(harness(ok('<meta charset="windows-1252"><p>?</p>', { "content-type": "text/html" }, { bodyBytes: html })).ports, { format: "text" });
    expect(result.content).toBe("é");
  });
  test("a meta charset is ignored for non-HTML bodies", async () => {
    const result = await fetch(harness(ok('<meta charset="latin1">?', { "content-type": "text/plain" }, { bodyBytes: latin1 })).ports, {});
    expect(result.content).toBe('<meta charset="latin1">?');
  });
  test.each([["utf-8"], ["utf8"]])("declared %s keeps the transport text", async charset => {
    const result = await fetch(harness(ok("text", { "content-type": `text/plain; charset=${charset}` }, { bodyBytes: latin1 })).ports, {});
    expect(result.content).toBe("text");
  });
  test("a declared charset without raw bytes keeps the transport text", async () => {
    expect((await fetch(harness(ok("text", { "content-type": "text/plain; charset=latin1" })).ports, {})).content).toBe("text");
  });
  test("an unsupported charset falls back to the transport text", async () => {
    expect((await fetch(harness(ok("text", { "content-type": "text/plain; charset=x-nope" }, { bodyBytes: latin1 })).ports, {})).content).toBe("text");
  });
});

describe("sitemap facts", () => {
  const sitemapPorts = (xml: string, finalUrl = "https://www.a.example/sitemap.xml") => harness(ok(xml, { "content-type": "application/xml" }, { finalUrl })).ports;
  test("loc entries become deduplicated http(s) links marked internal by host", async () => {
    const xml = "<urlset><loc> https://a.example/x?a=1&amp;b=2 </loc><loc>https://a.example/x?a=1&amp;b=2</loc><loc>mailto:me@a.example</loc><loc>http://[bad</loc><loc>/rel</loc><loc>https://other.example/</loc></urlset>";
    const result = await fetch(sitemapPorts(xml), { format: "raw" });
    expect(result.links).toEqual([
      { href: "https://a.example/x?a=1&b=2", text: "", internal: true },
      { href: "https://www.a.example/rel", text: "", internal: true },
      { href: "https://other.example/", text: "", internal: false },
    ]);
    expect([result.linksTruncated, result.content]).toEqual([false, xml]);
  });
  test("more than MAX_LINKS unique entries are truncated", async () => {
    const xml = Array.from({ length: MAX_LINKS + 1 }, (_, i) => `<loc>https://a.example/${i}</loc>`).join("");
    const result = await fetch(sitemapPorts(xml), {});
    expect([result.links.length, result.linksTruncated]).toEqual([MAX_LINKS, true]);
  });
  test("exactly MAX_LINKS entries are not truncated", async () => {
    const xml = Array.from({ length: MAX_LINKS }, (_, i) => `<loc>https://a.example/${i}</loc>`).join("");
    const result = await fetch(sitemapPorts(xml), {});
    expect([result.links.length, result.linksTruncated]).toEqual([MAX_LINKS, false]);
  });
});

describe("failure mapping", () => {
  test("an uppercase transport code is surfaced and observed as failed", async () => {
    const { ports, events } = harness(ok(""));
    ports.httpClient = failing(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1"), { code: "ECONNREFUSED" }));
    await expect(fetch(ports, {})).rejects.toThrow(new ToolInputError({ message: "web_fetch_page: could not fetch https://a.example (ECONNREFUSED). Check the address and that the site is up." }));
    expect(events).toEqual([{ origin: "https://a.example", durationMs: 0, outcome: "failed" }]);
  });
  test("a code on the cause is surfaced", async () => {
    const { ports } = harness(ok(""));
    ports.httpClient = failing(new Error("fetch failed", { cause: { code: "ENOTFOUND" } }));
    await expect(fetch(ports, {})).rejects.toThrow(new ToolInputError({ message: "web_fetch_page: could not fetch https://a.example (ENOTFOUND). Check the address and that the site is up." }));
  });
  test("a lowercase code is not trusted and an idle message wins", async () => {
    const { ports } = harness(ok(""));
    ports.httpClient = failing(Object.assign(new Error("socket timed out"), { code: "lower" }));
    await expect(fetch(ports, {})).rejects.toThrow(new ToolInputError({ message: "web_fetch_page: could not fetch https://a.example (connection went idle). Check the address and that the site is up." }));
  });
  test("a non-Error throw is a network error", async () => {
    const { ports } = harness(ok(""));
    ports.httpClient = failing(null);
    await expect(fetch(ports, {})).rejects.toThrow(new ToolInputError({ message: "web_fetch_page: could not fetch https://a.example (network error). Check the address and that the site is up." }));
  });
  test("a TimeoutError is a timeout and is observed as one", async () => {
    const { ports, events } = harness(ok(""));
    const error = new Error("t"); error.name = "TimeoutError";
    ports.httpClient = failing(error);
    await expect(fetch(ports, {})).rejects.toThrow(new ToolInputError({ message: "web_fetch_page: https://a.example did not finish responding within 15 seconds." }));
    expect(events.map(event => event.outcome)).toEqual(["timeout"]);
  });
  test("the whole-operation deadline aborts the request and reports a timeout", async () => {
    const { ports } = harness(ok(""));
    let seen: HttpRequest | undefined;
    ports.httpClient = { send: ({ request }) => { seen = request; return new Promise((_, reject) => request.signal!.addEventListener("abort", () => reject(new Error("aborted")))); } };
    await expect(fetch(ports, {}, { timeoutMs: 5 })).rejects.toThrow(new ToolInputError({ message: "web_fetch_page: https://a.example did not finish responding within 0.005 seconds." }));
    expect(seen?.timeoutMs).toBe(5);
  });
  test("a caller cancellation rethrows the original error", async () => {
    const { ports, events } = harness(ok(""));
    const original = new Error("caller aborted");
    ports.httpClient = failing(original);
    const controller = new AbortController(); controller.abort();
    await expect(fetch(ports, {}, { signal: controller.signal })).rejects.toBe(original);
    expect(events.map(event => event.outcome)).toEqual(["failed"]);
  });
  test("a caller signal is combined with the deadline for raw fetches", async () => {
    const { ports } = harness(ok("x", { "content-type": "text/plain" }));
    let signal: AbortSignal | undefined;
    ports.httpClient = { send: async ({ request }) => { signal = request.signal; return ok("x", { "content-type": "text/plain" }); } };
    const controller = new AbortController();
    await fetch(ports, {}, { signal: controller.signal });
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });
  test("a render refusal code is observed as refused", async () => {
    const { ports, events } = harness(ok(""));
    ports.renderPage = async () => { throw Object.assign(new Error("x"), { code: "WEB_RENDER_REFUSED" }); };
    await expect(fetch(ports, { render: true })).rejects.toThrow(new ToolInputError({ message: "web_fetch_page: the rendered page target is not a public internet address (including after redirects). Localhost, private-network and cloud-metadata addresses are refused." }));
    expect(events.map(event => event.outcome)).toEqual(["refused"]);
  });
});

describe("rendered projection caps", () => {
  const base: RenderedWebPage = { finalUrl: url, status: 201, title: "T", html: "<p>x</p>", text: "x", truncated: false, images: [], imagesTruncated: false, data: [], dataTruncated: false };
  const render = async (page: Partial<RenderedWebPage>, input: Record<string, unknown> = {}, optional: { signal?: AbortSignal; timeoutMs?: number } = {}) => {
    const { ports, events } = harness(ok(""));
    let seen: { signal?: AbortSignal; timeoutMs?: number } | undefined;
    ports.renderPage = async (_required, opts) => { seen = opts; return { ...base, ...page }; };
    return { result: await fetch(ports, { render: true, ...input }, optional), events, seen };
  };
  test("an untruncated render reports defaults and observes the page status", async () => {
    const { result, events } = await render({});
    expect(result).toMatchObject({ status: 201, truncated: false, blockedDataRequests: {}, imagesTruncated: false, linksTruncated: false });
    expect([result.dataUnmatched, result.screenshot, result.description, result.lang]).toEqual([undefined, undefined, undefined, undefined]);
    expect(events).toEqual([{ origin: "https://a.example", durationMs: 0, outcome: "response", status: 201 }]);
  });
  test("render timeouts are capped at 30 seconds and combine the caller signal", async () => {
    const controller = new AbortController();
    const { seen } = await render({}, {}, { timeoutMs: 60_000, signal: controller.signal });
    controller.abort();
    expect([seen?.timeoutMs, seen?.signal?.aborted]).toEqual([30_000, true]);
  });
  test("a shorter render timeout is kept", async () => {
    expect((await render({}, {}, { timeoutMs: 1000 })).seen?.timeoutMs).toBe(1000);
  });
  test("duplicate image sources keep the browser fact", async () => {
    const { result } = await render({ images: [{ src: "https://a.example/i.png", alt: "browser" }, { src: "https://a.example/i.png", alt: "dup" }] });
    expect([result.images, result.imagesTruncated, result.truncated]).toEqual([[{ src: "https://a.example/i.png", alt: "browser" }], false, false]);
  });
  test("more than MAX_IMAGES images are capped and flagged", async () => {
    const images = Array.from({ length: MAX_IMAGES + 1 }, (_, i) => ({ src: `https://a.example/${i}.png`, alt: "" }));
    const { result } = await render({ images });
    expect([result.images.length, result.imagesTruncated, result.truncated]).toEqual([MAX_IMAGES, true, true]);
  });
  test("a browser-reported image truncation is propagated", async () => {
    const { result } = await render({ imagesTruncated: true });
    expect([result.imagesTruncated, result.truncated]).toEqual([true, true]);
  });
  test("an alt of 301 characters is clipped and flagged", async () => {
    const { result } = await render({ images: [{ src: "https://a.example/i.png", alt: "a".repeat(301) }] });
    expect([result.images[0]!.alt.length, result.imagesTruncated, result.truncated]).toEqual([300, true, true]);
  });
  test("an overlong stylesheet is dropped and flagged", async () => {
    const { result } = await render({ html: `<link rel="stylesheet" href="/${"s".repeat(2100)}"><link rel="stylesheet" href="/ok.css">` });
    expect([result.stylesheets, result.truncated]).toEqual([["https://a.example/ok.css"], true]);
  });
  test("an overlong meta key is dropped and flagged", async () => {
    const { result } = await render({ html: `<meta property="og:${"k".repeat(100)}" content="v"><meta property="og:ok" content="v">` });
    expect([result.meta, result.truncated]).toEqual([{ "og:ok": "v" }, true]);
  });
  test("a 500-character description and 100-character lang are kept untruncated", async () => {
    const { result } = await render({ html: `<html lang="${"l".repeat(100)}"><head><meta name="description" content="${"d".repeat(500)}"></head></html>` });
    expect([result.description?.length, result.lang?.length, result.truncated]).toEqual([500, 100, false]);
  });
  test("a 300-character title is not truncated", async () => {
    const { result } = await render({ title: "t".repeat(300) });
    expect([result.title?.length, result.truncated]).toEqual([300, false]);
  });
  test("a browser HTML truncation is propagated", async () => {
    expect((await render({ truncated: true })).result.truncated).toBe(true);
  });
  test("a browser data truncation is propagated", async () => {
    expect((await render({ dataTruncated: true })).result.truncated).toBe(true);
  });
  test("full markdown content ignores a longer visible text", async () => {
    const { result } = await render({ text: "much longer visible text" });
    expect([result.content, result.truncated]).toEqual(["x", false]);
  });
  test("textMode none ignores visible text length for truncation", async () => {
    const { result } = await render({ text: "a".repeat(5000) }, { textMode: "none" });
    expect([result.content, result.truncated]).toEqual(["", false]);
  });
  test("html format with full text mode returns the inert HTML", async () => {
    const { result } = await render({ text: "a".repeat(5000) }, { format: "html" });
    expect([result.content, result.truncated, result.format]).toEqual(["<html><head></head><body><p>x</p></body></html>", false, "html"]);
  });
  test("non-full text modes report the requested format", async () => {
    expect((await render({}, { format: "raw", textMode: "summary" })).result.format).toBe("raw");
  });
});

test("a raw response is observed before projection, so a refused content type still records the status", async () => {
  const { ports, events } = harness({ status: 200, headers: { "content-type": "image/png" }, bodyText: "x" });
  await expect(fetch(ports, {})).rejects.toThrow(new ToolInputError({ message: "web_fetch_page: 'image/png' is not a text page. Only HTML, text, XML, JSON and CSS can be read; use media_import_from_url for images." }));
  expect(events).toEqual([{ origin: "https://a.example", durationMs: 0, outcome: "response", status: 200 }]);
});

test("a rendered projection failure is observed as failed and keeps its precise message", async () => {
  const { ports, events } = harness({ status: 200, headers: {}, bodyText: "" });
  ports.renderPage = async () => ({ finalUrl: url, status: 200, title: "", html: "<p>\u0000</p>", text: "", truncated: false, images: [], imagesTruncated: false, data: [], dataTruncated: false });
  await expect(fetch(ports, { render: true })).rejects.toThrow(new ToolInputError({ message: "web_fetch_page: the response is binary, not a text page." }));
  expect(events.map(event => event.outcome)).toEqual(["failed"]);
});

test("absent page facts are absent keys, not undefined values", async () => {
  const result = await fetch(harness({ status: 200, headers: { "content-type": "text/plain" }, bodyText: "x" }).ports, {});
  expect(["title", "description", "lang"].filter(key => key in result)).toEqual([]);
});
