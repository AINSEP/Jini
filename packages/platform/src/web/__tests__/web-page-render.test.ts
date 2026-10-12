/** rendr: input contract and rendered projection over a DI renderer, no sockets/module mocks. */
import { test, expect } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import { fetchWebPage, readWebFetchInput, type WebFetchPorts, type RenderedWebPage } from "../web-page.js";
import { htmlToMarkdown } from "../html-to-markdown.js";
const url = "https://public.example/";
const page: RenderedWebPage = {
  finalUrl: "https://public.example/final", status: 200, title: "Live title",
  html: '<h1>Live content</h1><a href="/next">Next</a><img src="/one.png" alt="One">', text: "Live content\nNext",
  images: [{ src: "https://cdn.example/background.png", alt: "" }], imagesTruncated: false, truncated: false,
  data: [{ url: "https://data.example/rows", status: 200, body: '{"rows":[]}', truncated: false }], dataTruncated: false,
};
function fixture() {
  const calls: unknown[] = [];
  const ports: WebFetchPorts = {
    httpClient: { send: async () => { throw new Error("render mode must not perform a raw fetch"); } },
    htmlToMarkdown, nowMs: () => 0,
    renderPage: async (required, optional) => { calls.push({ required, optional }); return page; },
  };
  const fetch = (input: Record<string, unknown>) => fetchWebPage({ input: readWebFetchInput({ url, ...input }), ports, rateLimitScope: "workspace" });
  return { ports, calls, fetch };
}

test("render options accept booleans and selector/seconds waits; raw input defaults stay compatible", () => {
  expect(readWebFetchInput({ url })).toEqual({ url, format: "markdown", maxChars: 60_000 });
  expect(readWebFetchInput({ url, render: true, waitFor: " #items ", captureData: false, dismissCookieBanners: false, screenshot: true })).toMatchObject({ render: true, waitFor: "#items", captureData: false, dismissCookieBanners: false, screenshot: true });
  for (const waitFor of [0, 0.5, 10]) expect(readWebFetchInput({ url, render: true, waitFor }).waitFor).toBe(waitFor);
  for (const key of ["render", "captureData", "dismissCookieBanners", "screenshot"]) {
    expect(() => readWebFetchInput({ url, render: true, [key]: "true" })).toThrow(ToolInputError);
  }
  for (const waitFor of ["", "  ", "x".repeat(501), -1, 11, Number.NaN, Number.POSITIVE_INFINITY, {}, true]) {
    expect(() => readWebFetchInput({ url, render: true, waitFor })).toThrow("waitFor");
  }
  expect(() => readWebFetchInput({ url, screenshot: true })).toThrow("require render: true");
  expect(() => readWebFetchInput({ url, render: false, waitFor: 1 })).toThrow("require render: true");
});

test("render mode reuses markdown/facts projection with final URL, live images and captured JSON", async () => {
  const fake = fixture(); const result = await fake.fetch({ render: true, waitFor: "#items" });
  expect(result.content).toContain("# Live content"); expect(result.title).toBe("Live title");
  expect(result.finalUrl).toBe(page.finalUrl); expect(result.rendered).toBe(true); expect(result.untrusted).toBe(true);
  expect(result.links).toEqual([{ href: "https://public.example/next", text: "Next", internal: true }]);
  expect(result.images.map(i => i.src)).toEqual(["https://cdn.example/background.png", "https://public.example/one.png"]);
  expect(result.data).toEqual(page.data); expect(result.dataTruncated).toBe(false);
  const call = fake.calls[0] as { required: { input: { waitFor: string } }; optional: { timeoutMs: number; signal: AbortSignal } };
  expect(call.required.input.waitFor).toBe("#items"); expect(call.optional.timeoutMs).toBe(30_000); expect(call.optional.signal).toBeInstanceOf(AbortSignal);
});

test("live text truncation, JSON truncation and screenshot are retained in the bounded result", async () => {
  const fake = fixture(); fake.ports.renderPage = async () => ({ ...page, dataTruncated: true, blockedDataRequests: { refused: 2 }, screenshot: { mimeType: "image/jpeg", data: "cG5n" } });
  const result = await fake.fetch({ render: true, format: "text", maxChars: 4, screenshot: true });
  expect(result.blockedDataRequests).toEqual({ refused: 2 });
  expect(result.content).toBe("Live"); expect(result.truncated).toBe(true); expect(result.dataTruncated).toBe(true);
  expect(result.screenshot).toEqual({ mimeType: "image/jpeg", data: "cG5n" });
});

test("missing browser capability and transport failures remain caller-safe errors; rate limiting precedes render", async () => {
  const fake = fixture(); delete fake.ports.renderPage;
  await expect(fake.fetch({ render: true })).rejects.toThrow("unavailable in this deployment");
  fake.ports.renderPage = async () => { throw new Error("internal DNS address 10.0.0.1"); };
  await expect(fake.fetch({ render: true })).rejects.toThrow("network error");
  fake.ports.rateLimiter = { check: async () => ({ allowed: false, retryAfterSeconds: 20 }) };
  await expect(fake.fetch({ render: true })).rejects.toThrow("too many fetches"); expect(fake.calls).toHaveLength(0);
});

test("renderer refusal and total-timeout codes retain actionable messages without private peer details", async () => {
  const fake = fixture();
  fake.ports.renderPage = async () => { const error = Object.assign(new Error("private peer 10.0.0.1"), { code: "WEB_RENDER_REFUSED" }); throw error; };
  await expect(fake.fetch({ render: true })).rejects.toThrow("not a public internet address");
  fake.ports.renderPage = async () => { const error = new Error("30s elapsed"); error.name = "PageWorkTimeout"; throw error; };
  await expect(fake.fetch({ render: true })).rejects.toThrow("within 30 seconds");
});

test("rendered structured facts cap strings as well as counts, and browser image facts take precedence", async () => {
  const fake = fixture();
  fake.ports.renderPage = async () => ({ ...page, title: "T".repeat(500),
    html: `<html lang="${'x'.repeat(101)}"><head><meta name="description" content="${'d'.repeat(501)}"></head><body><a href="/${'p'.repeat(2100)}">Long link</a><img src="/one.png" alt="${'a'.repeat(400)}"></body></html>`,
    images: [{ src: "https://public.example/one.png", alt: "browser alt" }, { src: `https://cdn.example/${'i'.repeat(2100)}`, alt: "" }],
  });
  const result = await fake.fetch({ render: true });
  expect(result.title).toHaveLength(300); expect(result.description).toHaveLength(500); expect(result.lang).toHaveLength(100);
  expect(result.links).toEqual([]); expect(result.linksTruncated).toBe(true);
  expect(result.images).toEqual([{ src: "https://public.example/one.png", alt: "browser alt" }]);
  expect(result.imagesTruncated).toBe(true); expect(result.truncated).toBe(true);
});

test("an unavailable renderer reports the missing browser capability instead of a generic network failure", async () => {
  const fake = fixture(); fake.ports.renderPage = async () => { throw Object.assign(new Error("unavailable"), { code: "WEB_RENDER_UNAVAILABLE" }); };
  await expect(fake.fetch({ render: true })).rejects.toThrow("headless browser (Playwright Chromium) is not installed or failed to start");
});


test("shared render capacity reports a retryable busy message", async () => {
  const fake = fixture(); fake.ports.renderPage = async () => { throw Object.assign(new Error("busy"), { code: "WEB_RENDER_BUSY" }); };
  await expect(fake.fetch({ render: true })).rejects.toThrow("render capacity is busy; retry shortly");
});

test("render filters and text modes validate at the shared reader boundary while omitted defaults stay unchanged", () => {
  for (const captureDataMatch of ["/v1/datasource/", ["*/rows*", "/records"]]) {
    expect(readWebFetchInput({ url, render: true, captureDataMatch }).captureDataMatch).toEqual(captureDataMatch);
  }
  for (const textMode of ["full", "none", "summary"]) expect(readWebFetchInput({ url, render: true, textMode }).textMode).toBe(textMode);
  for (const captureDataMatch of ["", " ", "x".repeat(501), [], [""], ["/rows", 1], Array(21).fill("/rows"), null, 1, {}]) {
    expect(() => readWebFetchInput({ url, render: true, captureDataMatch })).toThrow("captureDataMatch");
  }
  expect(readWebFetchInput({ url, render: true, captureDataMatch: Array(20).fill("x".repeat(500)) }).captureDataMatch).toHaveLength(20);
  for (const textMode of ["", "short", null, 1, {}]) expect(() => readWebFetchInput({ url, render: true, textMode })).toThrow("textMode");
  for (const options of [{ captureDataMatch: "/rows" }, { textMode: "none" }]) {
    expect(() => readWebFetchInput({ url, ...options })).toThrow("require render: true");
  }
  expect(readWebFetchInput({ url, render: true })).toEqual({ url, format: "markdown", maxChars: 60_000, render: true });
});

test.each(["markdown", "text", "html", "raw"])("textMode none suppresses %s content but preserves data, inventory and page facts", async format => {
  const fake = fixture();
  fake.ports.htmlToMarkdown = () => { throw new Error("data-only renders must not convert the page to Markdown"); };
  const dataUnmatched = [{ url: "https://noise.example/checkout", status: 200, size: 90_000 }];
  fake.ports.renderPage = async ({ input }) => {
    expect(input.captureDataMatch).toEqual(["/rows"]); expect(input.textMode).toBe("none");
    return { ...page, text: "", dataUnmatched };
  };
  const result = await fake.fetch({ render: true, format, captureDataMatch: ["/rows"], textMode: "none" });
  expect(result.content).toBe(""); expect(result.title).toBe("Live title"); expect(result.links).toHaveLength(1);
  expect(result.data).toEqual(page.data); expect(result.dataUnmatched).toEqual(dataUnmatched); expect(result.truncated).toBe(false);
});

test.each(["markdown", "text", "html", "raw"])("textMode summary returns bounded visible text for %s", async format => {
  const fake = fixture();
  fake.ports.htmlToMarkdown = () => { throw new Error("summaries use visible text"); };
  fake.ports.renderPage = async () => ({ ...page, text: "a".repeat(999) + "😀tail" });
  const result = await fake.fetch({ render: true, format, textMode: "summary" });
  expect(result.content).toBe("a".repeat(999)); expect(result.truncated).toBe(true); expect(result.data).toEqual(page.data);
  const small = await fake.fetch({ render: true, format, textMode: "summary", maxChars: 4 });
  expect(small.content).toBe("aaaa"); expect(small.truncated).toBe(true);
});

test("explicit full preserves the default content, facts and truncation", async () => {
  const fake = fixture();
  expect(await fake.fetch({ render: true, textMode: "full" })).toEqual(await fake.fetch({ render: true }));
});
