import assert from "node:assert/strict";
import { onTestFinished, test, vi } from "vitest";
import { createServer, Server, type RequestListener, type ServerResponse } from "node:http";

import { fetchPublishedPage, type PublishedPageFetchTracker } from "../published-page.js";
import { DEFAULT_MAX_BODY_BYTES, MAX_MAX_BODY_BYTES } from "../page-body.js";
import { MAX_PATH_LENGTH, readBoundedBody, SameOriginPathError as PublishedPagePathError, toCookieShapes } from "../index.js";
import { resolveSitePath as resolveSameOriginPath } from "../site-path-policy.js";
import { createNoopObservabilityPort } from "@jini-ai/core/contracts/observability";

/** The host's reserved first path segments, as the host binds them in production. */
const RESERVED_SEGMENTS: ReadonlySet<string> = new Set(["admin", "api"]);

/**
 * @file `fetch_published_page`'s same-origin restriction and response projection.
 *
 * The path validator is tested directly (it is the whole SSRF story and deserves per-rule
 * assertions), and the fetch is tested against a REAL `node:http` app booted through the same
 * `createSiteApp` seam the production path uses — so "the origin is one this process minted" is
 * exercised rather than asserted.
 */

const BASE = "http://127.0.0.1:53142";

/** Writes one complete response, with the `content-type`/`content-length` a site framework would send. */
function send(res: ServerResponse, { status, type, body }: { status: number; type: string; body: string }): void {
  res.statusCode = status;
  res.setHeader("content-type", `${type}; charset=utf-8`);
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

/**
 * A stand-in for the site app: enough real routes to observe status, headers, cookies and bodies.
 * A plain `node:http` request listener — the exact shape `createSiteApp` is typed as — so this
 * package carries no server framework just to describe its own fixture.
 */
function makeFakeSiteApp(): RequestListener {
  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    switch (req.method === "GET" ? url.pathname : "") {
      case "/":
        res.setHeader("content-security-policy", "default-src 'self'");
        res.setHeader("set-cookie", ["sid=SUPER_SECRET_SESSION_VALUE; Path=/; HttpOnly; SameSite=Lax", "ab=1; Path=/"]);
        return send(res, { status: 200, type: "text/html", body: "<!doctype html><html><body>home</body></html>" });
      case "/big": return send(res, { status: 200, type: "text/plain", body: "z".repeat(50_000) });
      case "/over-hard-cap": return send(res, { status: 200, type: "text/plain", body: "abcdef".repeat(200_000) });
      case "/administer-survey": return send(res, { status: 200, type: "text/html", body: "<h1>Survey</h1>" });
      case "/echo": return send(res, { status: 200, type: "text/plain", body: `query=${url.searchParams.get("q") ?? ""}` });
      case "/old":
        res.setHeader("location", "/new");
        return send(res, { status: 301, type: "text/plain", body: "Moved Permanently. Redirecting to /new" });
      case "/api/admin/v1/secret": return send(res, { status: 200, type: "application/json", body: JSON.stringify({ leaked: "ADMIN_API_CANARY" }) });
      default: return send(res, { status: 404, type: "text/html", body: "<h1>not found</h1>" });
    }
  };
}

/** The transport untraced: these tests are about the render, not the span (the host owns that proof). */
const UNTRACKED: PublishedPageFetchTracker = ({ fetch }) => fetch;

const DEPS = { createSiteApp: () => makeFakeSiteApp(), reservedSegments: RESERVED_SEGMENTS, trackFetch: UNTRACKED };

test("fetchPublishedPage preserves the original non-timeout transport failure", async () => {
  const failure = new Error("transport disconnected");
  const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw failure; });
  await assert.rejects(fetchPublishedPage({ deps: { ...DEPS, fetch }, input: { path: "/echo?q=broken" } }),
    error => error === failure);
  assert.equal(fetch.mock.calls.length, 1);
  const [url, init] = fetch.mock.calls[0]!;
  assert.match(String(url), /^http:\/\/127\.0\.0\.1:\d+\/echo\?q=broken$/);
  assert.equal(init?.redirect, "manual");
});

// ---------------------------------------------------------------------------
// resolveSameOriginPath — one assertion per rule, because each rule closes a different hole.
// ---------------------------------------------------------------------------

test("resolveSameOriginPath: accepts ordinary root-relative site paths", () => {
  assert.equal(resolveSameOriginPath({ raw: "/", base: BASE, reservedSegments: RESERVED_SEGMENTS }), "/");
  assert.equal(resolveSameOriginPath({ raw: "/about", base: BASE, reservedSegments: RESERVED_SEGMENTS }), "/about");
  assert.equal(resolveSameOriginPath({ raw: "/blog/hello?page=2", base: BASE, reservedSegments: RESERVED_SEGMENTS }), "/blog/hello?page=2");
  assert.equal(resolveSameOriginPath({ raw: "/robots.txt", base: BASE, reservedSegments: RESERVED_SEGMENTS }), "/robots.txt");
});

test("resolveSameOriginPath: refuses an absolute URL, whatever the scheme", () => {
  for (const candidate of [
    "http://evil.example/x",
    "https://evil.example/x",
    "HTTP://evil.example/x",
    "file:///etc/passwd",
    "gopher://127.0.0.1:11211/",
    "http://169.254.169.254/latest/meta-data/",
  ]) {
    assert.throws(() => resolveSameOriginPath({ raw: candidate, base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError, `should refuse '${candidate}'`);
  }
});

test("resolveSameOriginPath: refuses a protocol-relative path — the classic same-origin bypass", () => {
  assert.throws(() => resolveSameOriginPath({ raw: "//evil.example/x", base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
  assert.throws(() => resolveSameOriginPath({ raw: "//169.254.169.254/", base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
});

test("resolveSameOriginPath: refuses a backslash, which URL parsers treat as a slash", () => {
  assert.throws(() => resolveSameOriginPath({ raw: "/\\evil.example/x", base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
  assert.throws(() => resolveSameOriginPath({ raw: "\\\\evil.example/x", base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
});

test("resolveSameOriginPath: refuses control characters, including CR/LF request splitting", () => {
  const cr = String.fromCharCode(13);
  const lf = String.fromCharCode(10);
  const nul = String.fromCharCode(0);
  assert.throws(() => resolveSameOriginPath({ raw: `/ok${cr}${lf}X-Injected: 1`, base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
  assert.throws(() => resolveSameOriginPath({ raw: `/ok${nul}`, base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
  assert.throws(() => resolveSameOriginPath({ raw: `/ok${String.fromCharCode(127)}`, base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
});

test("resolveSameOriginPath: refuses traversal, raw and percent-encoded", () => {
  assert.throws(() => resolveSameOriginPath({ raw: "/a/../../etc/passwd", base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
  assert.throws(() => resolveSameOriginPath({ raw: "/a/%2e%2e/%2e%2e/etc/passwd", base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
  assert.throws(() => resolveSameOriginPath({ raw: "/a/%2E%2E/b", base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
});

test("resolveSameOriginPath: refuses a malformed percent-encoding rather than silently repairing it", () => {
  assert.throws(() => resolveSameOriginPath({ raw: "/a/%zz", base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
});

test("resolveSameOriginPath: refuses the authenticated API surface", () => {
  assert.throws(() => resolveSameOriginPath({ raw: "/api/admin/v1/workspaces/x/settings", base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
  assert.throws(() => resolveSameOriginPath({ raw: "/API/admin/v1/x", base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
  assert.throws(() => resolveSameOriginPath({ raw: "/%61pi/admin/v1/x", base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
});

test("resolveSameOriginPath: refuses empty, non-string and oversized paths", () => {
  assert.throws(() => resolveSameOriginPath({ raw: "", base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
  assert.throws(() => resolveSameOriginPath({ raw: undefined, base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
  assert.throws(() => resolveSameOriginPath({ raw: 42, base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
  assert.throws(() => resolveSameOriginPath({ raw: `/${"a".repeat(MAX_PATH_LENGTH)}`, base: BASE, reservedSegments: RESERVED_SEGMENTS }), PublishedPagePathError);
});

test("resolveSameOriginPath: a rejection names the rule so a model can fix the input in one turn", () => {
  assert.throws(
    () => resolveSameOriginPath({ raw: "https://evil.example/x", base: BASE, reservedSegments: RESERVED_SEGMENTS }),
    (err: unknown) => err instanceof PublishedPagePathError && err.message.includes("must start with '/'"),
  );
  assert.throws(
    () => resolveSameOriginPath({ raw: "//evil.example/x", base: BASE, reservedSegments: RESERVED_SEGMENTS }),
    (err: unknown) => err instanceof PublishedPagePathError && err.message.includes("different host"),
  );
});

// ---------------------------------------------------------------------------
// resolveSameOriginPath — SI-1a characterization: path shape, host-policy binding.
// Pins what the guard does TODAY (one decode pass, canonical output, exact refusal wording).
// ---------------------------------------------------------------------------

/** The refusal sentence `disallowedFormReason` builds for a reserved surface. */
function reservedMessage(surface: string): string {
  return `path must not target '/${surface}' — that is the authenticated admin/API surface, not a published page.`;
}

function refusalMessage(raw: unknown): string {
  try {
    resolveSameOriginPath({ raw, base: BASE, reservedSegments: RESERVED_SEGMENTS });
  } catch (err) {
    assert.ok(err instanceof PublishedPagePathError, `expected a PublishedPagePathError for ${String(raw)}`);
    return err.message;
  }
  throw new assert.AssertionError({ message: `expected '${String(raw)}' to be refused` });
}

test("resolveSameOriginPath: a double-encoded traversal is ACCEPTED as a literal filename (one decode pass, by design)", () => {
  // Pins published-page.ts's own comment: "One decode pass is the right depth: a double-encoded
  // `%252e%252e` decodes to the literal text `%2e%2e`, which a static-file handler treats as a
  // filename, not as traversal."
  assert.equal(resolveSameOriginPath({ raw: "/a/%252e%252e/b", base: BASE, reservedSegments: RESERVED_SEGMENTS }), "/a/%252e%252e/b");
  assert.equal(resolveSameOriginPath({ raw: "/%252E%252E", base: BASE, reservedSegments: RESERVED_SEGMENTS }), "/%252E%252E");
});

test("resolveSameOriginPath: raw and singly-encoded traversal name the '..' rule, quoting the caller's string", () => {
  for (const raw of ["/a/../b", "/a/%2e%2e/b", "/a/%2E%2E/b", "/a/%2e./b", "/a/.%2E/b", "/..", "/a/%2e%2e"]) {
    assert.equal(refusalMessage(raw), `path must not contain a '..' segment (encoded or not): '${raw}'.`);
  }
});

test("resolveSameOriginPath: a segment that merely contains dots is an ordinary filename", () => {
  assert.equal(resolveSameOriginPath({ raw: "/a/..b/c...", base: BASE, reservedSegments: RESERVED_SEGMENTS }), "/a/..b/c...");
  assert.equal(resolveSameOriginPath({ raw: "/a/%2e%2e%2e", base: BASE, reservedSegments: RESERVED_SEGMENTS }), "/a/%2e%2e%2e");
});

test("resolveSameOriginPath: a malformed percent-encoding is refused with its own message", () => {
  for (const raw of ["/a/%zz", "/%", "/a%2/b", "/a/%E0%A4%A"]) {
    assert.equal(refusalMessage(raw), `path contains a malformed percent-encoding: '${raw}'.`);
  }
});

test("resolveSameOriginPath: only the path is validated, so the query is kept verbatim", () => {
  assert.equal(resolveSameOriginPath({ raw: "/blog?page=2&q=a%20b", base: BASE, reservedSegments: RESERVED_SEGMENTS }), "/blog?page=2&q=a%20b");
  assert.equal(resolveSameOriginPath({ raw: "/a?back=/../x", base: BASE, reservedSegments: RESERVED_SEGMENTS }), "/a?back=/../x");
  assert.equal(resolveSameOriginPath({ raw: "/a?q=%zz", base: BASE, reservedSegments: RESERVED_SEGMENTS }), "/a?q=%zz");
  assert.equal(resolveSameOriginPath({ raw: "/?", base: BASE, reservedSegments: RESERVED_SEGMENTS }), "/");
});

test("resolveSameOriginPath: the fragment is dropped from the canonical path, but is still scanned for '..'", () => {
  assert.equal(resolveSameOriginPath({ raw: "/a#frag", base: BASE, reservedSegments: RESERVED_SEGMENTS }), "/a");
  assert.equal(resolveSameOriginPath({ raw: "/a?x=1#frag", base: BASE, reservedSegments: RESERVED_SEGMENTS }), "/a?x=1");
  // The traversal scan runs on the raw string up to the first '?', which still contains the fragment.
  assert.equal(refusalMessage("/a#/../b"), "path must not contain a '..' segment (encoded or not): '/a#/../b'.");
});

test("resolveSameOriginPath: wording for a relative, protocol-relative, backslash and control-character refusal", () => {
  assert.equal(refusalMessage("blog/hello"), "path must start with '/' — this tool fetches a route on THIS site and never accepts a full URL or a remote host. Got 'blog/hello'.");
  assert.equal(refusalMessage("//evil.example/x"), "path must not start with '//' — a protocol-relative path resolves to a different host, which this tool never fetches.");
  assert.equal(refusalMessage("/a\\b"), "path must not contain a backslash — URL parsers treat '\\' as '/'.");
  assert.equal(refusalMessage("/a\nb"), "path must not contain control characters (including CR/LF).");
  assert.equal(refusalMessage(""), "path must be a non-empty string, e.g. '/' or '/blog/hello'.");
  assert.equal(refusalMessage(null), "path must be a non-empty string, e.g. '/' or '/blog/hello'.");
});

test("resolveSameOriginPath: an absolute URL to another origin is refused by the leading-slash rule, never fetched", () => {
  for (const raw of ["http://127.0.0.1:53142/x", "http://evil.example:53142/x", "https://127.0.0.1/x"]) {
    assert.match(refusalMessage(raw), /^path must start with '\/'/);
  }
});

test("resolveSameOriginPath: length is bounded by MAX_PATH_LENGTH (2047 and 2048 pass, 2049 is refused)", () => {
  assert.equal(MAX_PATH_LENGTH, 2_048);
  for (const length of [MAX_PATH_LENGTH - 1, MAX_PATH_LENGTH]) {
    const raw = `/${"a".repeat(length - 1)}`;
    assert.equal(raw.length, length);
    assert.equal(resolveSameOriginPath({ raw, base: BASE, reservedSegments: RESERVED_SEGMENTS }), raw);
  }
  const tooLong = `/${"a".repeat(MAX_PATH_LENGTH)}`;
  assert.equal(tooLong.length, MAX_PATH_LENGTH + 1);
  assert.equal(refusalMessage(tooLong), `path must be at most ${MAX_PATH_LENGTH} characters, got ${MAX_PATH_LENGTH + 1}.`);
});

test("resolveSameOriginPath: the host policy refuses /admin and /api in every spelling, naming the surface", () => {
  const cases: Array<[string, string]> = [
    ["/admin", "admin"],
    ["/Admin", "admin"],
    ["/ADMIN/settings", "admin"],
    ["/admin/", "admin"],
    ["/%61dmin", "admin"],
    ["/%41dmin/x", "admin"],
    ["/api", "api"],
    ["/api/x", "api"],
    ["/API/x", "api"],
    ["/%61pi", "api"],
    ["/%61pi/x", "api"],
    ["/api/admin/v1/secret?x=1", "api"],
  ];
  for (const [raw, surface] of cases) {
    assert.equal(refusalMessage(raw), reservedMessage(surface), `expected '${raw}' to be refused as '/${surface}'`);
  }
});

test("resolveSameOriginPath: the host policy compares a whole segment, so look-alike content stays fetchable", () => {
  for (const raw of ["/administer-survey", "/apiary", "/admins", "/api-docs", "/blog/admin"]) {
    assert.equal(resolveSameOriginPath({ raw, base: BASE, reservedSegments: RESERVED_SEGMENTS }), raw);
  }
});

test("resolveSameOriginPath: a decoded backslash or control character is refused through the host check", () => {
  // These pass every raw-string rule (no literal backslash or control character) and only show up
  // once the pathname is decoded, which is the host policy's job.
  for (const raw of ["/a%5Cb", "/a%5cb", "/a%00b", "/a%0D%0AX-Injected:%201", "/a%1Fb", "/a%7Fb"]) {
    assert.equal(refusalMessage(raw), "path decodes to a backslash or control character, which is refused.", `expected '${raw}' to be refused`);
  }
});

// ---------------------------------------------------------------------------
// toCookieShapes / readBoundedBody
// ---------------------------------------------------------------------------

test("toCookieShapes: keeps the cookie name and attributes and drops the value", () => {
  const headers = new Headers();
  headers.append("set-cookie", "sid=SUPER_SECRET_SESSION_VALUE; Path=/; HttpOnly; SameSite=Lax");
  headers.append("set-cookie", "consent=; Max-Age=0");

  const shapes = toCookieShapes({ headers });
  assert.deepEqual(shapes, [
    { name: "sid", attributes: ["Path=/", "HttpOnly", "SameSite=Lax"] },
    { name: "consent", attributes: ["Max-Age=0"] },
  ]);
  assert.ok(!JSON.stringify(shapes).includes("SUPER_SECRET_SESSION_VALUE"));
});

test("readBoundedBody: stops at the cap and reports it, rather than buffering the whole response", async () => {
  const chunks = ["alpha", "-beta-gamma", "unread-tail"];
  let pulls = 0;
  let cancellations = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode(chunks[pulls++]));
    },
    cancel() { cancellations += 1; },
  }, { highWaterMark: 0 }));
  const read = await readBoundedBody({ response, maxBytes: 10 });
  assert.equal(read.bodyBytes, 10);
  assert.equal(read.body.length, 10);
  assert.equal(read.body, "alpha-beta");
  assert.equal(pulls, 2);
  assert.equal(cancellations, 1);
  assert.equal(read.truncated, true);
});

test("readBoundedBody: a response under the cap is returned whole and not flagged", async () => {
  const read = await readBoundedBody({ response: new Response("hello"), maxBytes: 100 });
  assert.deepEqual(read, { body: "hello", bodyBytes: 5, truncated: false });
});

/** A response whose body arrives as the given chunks, one per pull, with an observable cancel. */
function chunkedResponse(chunks: string[], hooks: { onCancel?: () => void } = {}): Response {
  let pulls = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulls];
      pulls += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(new TextEncoder().encode(chunk));
    },
    cancel() { hooks.onCancel?.(); },
  }, { highWaterMark: 0 }));
}

test("readBoundedBody: maxBytes-1 truncates, maxBytes and maxBytes+1 return the body whole", async () => {
  const body = "0123456789";
  const below = await readBoundedBody({ response: new Response(body), maxBytes: body.length - 1 });
  assert.deepEqual(below, { body: "012345678", bodyBytes: 9, truncated: true });
  const exact = await readBoundedBody({ response: new Response(body), maxBytes: body.length });
  assert.deepEqual(exact, { body, bodyBytes: 10, truncated: false });
  const above = await readBoundedBody({ response: new Response(body), maxBytes: body.length + 1 });
  assert.deepEqual(above, { body, bodyBytes: 10, truncated: false });
});

test("readBoundedBody: the same boundary holds when the body arrives in several chunks", async () => {
  const chunks = ["alpha", "-beta"];
  assert.deepEqual(await readBoundedBody({ response: chunkedResponse(chunks), maxBytes: 9 }), { body: "alpha-bet", bodyBytes: 9, truncated: true });
  assert.deepEqual(await readBoundedBody({ response: chunkedResponse(chunks), maxBytes: 10 }), { body: "alpha-beta", bodyBytes: 10, truncated: false });
  assert.deepEqual(await readBoundedBody({ response: chunkedResponse(chunks), maxBytes: 11 }), { body: "alpha-beta", bodyBytes: 10, truncated: false });
});

test("readBoundedBody: a single chunk larger than the cap is cut at the cap and the reader is cancelled once", async () => {
  let cancellations = 0;
  const read = await readBoundedBody({ response: chunkedResponse(["abcdefghij"], { onCancel: () => { cancellations += 1; } }), maxBytes: 4 });
  assert.deepEqual(read, { body: "abcd", bodyBytes: 4, truncated: true });
  assert.equal(cancellations, 1);
});

test("readBoundedBody: a cancel failure after overflow is swallowed, the capped body is still returned", async () => {
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new TextEncoder().encode("abcdefghij")); },
    cancel() { throw new Error("cancel failed"); },
  }, { highWaterMark: 0 }));
  const read = await readBoundedBody({ response, maxBytes: 3 });
  assert.deepEqual(read, { body: "abc", bodyBytes: 3, truncated: true });
});

test("readBoundedBody: a stream error is rethrown to the caller unchanged, not turned into a partial body", async () => {
  const boom = new Error("socket reset mid-body");
  let pulls = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) controller.enqueue(new TextEncoder().encode("partial"));
      else controller.error(boom);
    },
  }, { highWaterMark: 0 }));
  await assert.rejects(() => readBoundedBody({ response, maxBytes: 100 }), (err: unknown) => err === boom);
});

test("readBoundedBody: a response with no body is empty and not flagged", async () => {
  assert.deepEqual(await readBoundedBody({ response: new Response(null, { status: 204 }), maxBytes: 10 }), { body: "", bodyBytes: 0, truncated: false });
});

test("readBoundedBody: a multi-byte character split by the cap degrades to a replacement character", async () => {
  const read = await readBoundedBody({ response: new Response("a\u00e9"), maxBytes: 2 });
  assert.deepEqual(read, { body: "a\ufffd", bodyBytes: 2, truncated: true });
});

test("toCookieShapes: no cookie VALUE survives, whatever shape the value has", () => {
  const sentinel = "SENTINEL_COOKIE_VALUE_8f3a";
  const headers = new Headers();
  headers.append("set-cookie", `plain=${sentinel}; Path=/; HttpOnly`);
  headers.append("set-cookie", `with-equals=${sentinel}=${sentinel}==; Secure`);
  headers.append("set-cookie", `quoted="${sentinel}"; Max-Age=60`);
  headers.append("set-cookie", `__Host-dated=${sentinel}; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/`);
  headers.append("set-cookie", "bare; Secure");

  const shapes = toCookieShapes({ headers });
  assert.deepEqual(shapes, [
    { name: "plain", attributes: ["Path=/", "HttpOnly"] },
    { name: "with-equals", attributes: ["Secure"] },
    { name: "quoted", attributes: ["Max-Age=60"] },
    { name: "__Host-dated", attributes: ["Expires=Wed, 21 Oct 2026 07:28:00 GMT", "Path=/"] },
    { name: "bare", attributes: ["Secure"] },
  ]);
  assert.ok(!JSON.stringify(shapes).includes(sentinel), "a cookie VALUE must never appear in a cookie shape");
});

test("toCookieShapes: attributes are trimmed, empty ones dropped, and no Set-Cookie header gives no shapes", () => {
  const headers = new Headers();
  headers.append("set-cookie", " spaced = v ;; Path=/ ;  ; SameSite=Lax ");
  assert.deepEqual(toCookieShapes({ headers }), [{ name: "spaced", attributes: ["Path=/", "SameSite=Lax"] }]);
  assert.deepEqual(toCookieShapes({ headers: new Headers({ "content-type": "text/html" }) }), []);
});

// ---------------------------------------------------------------------------
// fetchPublishedPage — against a real booted app
// ---------------------------------------------------------------------------

test("fetchPublishedPage: returns the live status, headers and body of a real route", async () => {
  const result = await fetchPublishedPage({ deps: DEPS, input: { path: "/" } });

  assert.equal(result.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.path, "/");
  assert.equal(result.body, "<!doctype html><html><body>home</body></html>");
  assert.equal(result.headers["content-security-policy"], "default-src 'self'");
  assert.match(result.headers["content-type"] ?? "", /text\/html/);
  assert.equal(result.truncated, false);
  assert.equal(result.bodyBytes, 45);
});

test("fetchPublishedPage: reports cookie SHAPES and never a cookie value, in headers or anywhere else", async () => {
  const result = await fetchPublishedPage({ deps: DEPS, input: { path: "/" } });

  assert.deepEqual(
    result.cookies.map((cookie) => cookie.name).sort(),
    ["ab", "sid"],
  );
  const sid = result.cookies.find((cookie) => cookie.name === "sid");
  assert.deepEqual(sid?.attributes, ["Path=/", "HttpOnly", "SameSite=Lax"]);
  assert.equal(result.headers["set-cookie"], undefined, "set-cookie must not survive in the raw header map");
  assert.ok(
    !JSON.stringify(result).includes("SUPER_SECRET_SESSION_VALUE"),
    "a cookie VALUE must never appear anywhere in the result",
  );
});

test("fetchPublishedPage: preserves the query string through validation", async () => {
  const result = await fetchPublishedPage({ deps: DEPS, input: { path: "/echo?q=hello" } });
  assert.equal(result.path, "/echo?q=hello");
  assert.equal(result.body, "query=hello");
});

test("fetchPublishedPage: a 404 is a RESULT, not a thrown error", async () => {
  const result = await fetchPublishedPage({ deps: DEPS, input: { path: "/nope" } });
  assert.equal(result.status, 404);
  assert.equal(result.ok, false);
  assert.match(result.body ?? "", /not found/);
});

test("fetchPublishedPage: a redirect is reported, never followed", async () => {
  const result = await fetchPublishedPage({ deps: DEPS, input: { path: "/old" } });
  assert.equal(result.status, 301);
  assert.equal(result.ok, false);
  assert.equal(result.headers["location"], "/new");
});

test("fetchPublishedPage: caps the body at maxBytes and flags the truncation", async () => {
  const result = await fetchPublishedPage({ deps: DEPS, input: { path: "/big" } }, { maxBytes: 1_000 });
  assert.equal(result.bodyBytes, 1_000);
  assert.equal(result.body, "z".repeat(1_000));
  assert.equal(result.truncated, true);

  const defaulted = await fetchPublishedPage({ deps: DEPS, input: { path: "/big" } });
  assert.equal(defaulted.bodyBytes, DEFAULT_MAX_BODY_BYTES);
  assert.equal(defaulted.truncated, true);

  const requested = await fetchPublishedPage({ deps: DEPS, input: { path: "/big" } }, { maxBytes: 60_000 });
  assert.equal(requested.bodyBytes, 50_000);
  assert.equal(requested.truncated, false);
});

test("fetchPublishedPage: maxBytes is clamped to the hard maximum and defaulted for nonsense", async () => {
  const huge = await fetchPublishedPage({ deps: DEPS, input: { path: "/over-hard-cap" } }, { maxBytes: MAX_MAX_BODY_BYTES * 10 });
  assert.equal(huge.bodyBytes, 1_000_000);
  assert.equal(huge.body, "abcdef".repeat(200_000).slice(0, 1_000_000));
  assert.equal(huge.truncated, true);

  const negative = await fetchPublishedPage({ deps: DEPS, input: { path: "/big" } }, { maxBytes: -1 });
  assert.equal(negative.bodyBytes, DEFAULT_MAX_BODY_BYTES);
});

test("fetchPublishedPage: refuses an off-site path and never issues the request", async () => {
  const attempted: string[] = [];
  const spyDeps = {
    reservedSegments: RESERVED_SEGMENTS,
    trackFetch: UNTRACKED,
    createSiteApp: (): RequestListener => (req, res) => {
      attempted.push(req.url ?? "");
      send(res, { status: 200, type: "text/html", body: "ok" });
    },
  };

  for (const candidate of ["https://evil.example/x", "//evil.example/x", "/a/../../etc/passwd", "/api/admin/v1/x"]) {
    await assert.rejects(() => fetchPublishedPage({ deps: spyDeps, input: { path: candidate } }), PublishedPagePathError);
  }
  assert.deepEqual(attempted, [], "a refused path must never reach the app");
});

test("fetchPublishedPage: the /api guard holds even though the admin API is mounted on the same app", async () => {
  await assert.rejects(
    () => fetchPublishedPage({ deps: DEPS, input: { path: "/api/admin/v1/secret" } }),
    (err: unknown) =>
      err instanceof PublishedPagePathError &&
      err.message ===
        "path must not target '/api' — that is the authenticated admin/API surface, not a published page.",
  );
});

test("fetchPublishedPage: the same guard covers /admin, the admin SPA mounted on that same app", async () => {
  // Widened from `/api/` only when `platform/routing/reserved-paths.ts` became the single copy of
  // this rule (`redirects` needs the identical answer for a stored redirect target). `/admin` is
  // `app.use("/admin", express.static(...))` in `admin-static.ts` — as much "not a published page"
  // as the API is.
  for (const path of ["/admin", "/admin/settings", "/%61dmin", "/ADMIN/settings"]) {
    await assert.rejects(
      () => fetchPublishedPage({ deps: DEPS, input: { path } }),
      (err: unknown) =>
        err instanceof PublishedPagePathError &&
        err.message ===
          "path must not target '/admin' — that is the authenticated admin/API surface, not a published page.",
      `expected '${path}' to be refused`,
    );
  }
});

test("fetchPublishedPage: a published page whose slug merely starts with 'admin' still fetches", async () => {
  const ok = await fetchPublishedPage({ deps: DEPS, input: { path: "/administer-survey" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body, "<h1>Survey</h1>");
});

test("fetchPublishedPage: closes the server after success, validation rejection and a stalled render timeout", async () => {
  const closed: Server[] = [];
  const originalClose = Server.prototype.close;
  const closeSpy = vi.spyOn(Server.prototype, "close").mockImplementation(function (this: Server, callback?: (error?: Error) => void) {
    return originalClose.call(this, (error?: Error) => {
      closed.push(this);
      callback?.(error);
    });
  });
  onTestFinished(() => closeSpy.mockRestore());
  const ok = await fetchPublishedPage({ deps: DEPS, input: { path: "/" } });
  assert.equal(ok.status, 200);
  await assert.rejects(() => fetchPublishedPage({ deps: DEPS, input: { path: "//evil.example" } }), PublishedPagePathError);
  let reached = false;
  const stalled = { reservedSegments: RESERVED_SEGMENTS, trackFetch: UNTRACKED, createSiteApp: (): RequestListener => (req, res) => {
    if (req.url === "/stalled") { reached = true; return; }
    send(res, { status: 404, type: "text/html", body: "<h1>not found</h1>" });
  } };
  await assert.rejects(() => fetchPublishedPage({ deps: stalled, input: { path: "/stalled" } }, { timeoutMs: 500 }),
    { name: "PublishedPageTimeoutError", message: "rendering '/stalled' exceeded 500ms" });
  assert.equal(reached, true);
  assert.equal(closed.length, 3);
  assert.equal(new Set(closed).size, 3);
  for (const server of closed) {
    assert.equal(server.listening, false);
    assert.equal(await new Promise<number>((resolve, reject) => server.getConnections((err, count) => err ? reject(err) : resolve(count))), 0);
  }
});

/** A `createServer` seam that records lifecycle events in order, around a real loopback server. */
function recordingServerFactory(events: string[]): (listener: RequestListener) => Server {
  return (listener) => {
    const server = createServer(listener);
    events.push("created");
    server.once("listening", () => events.push("listening"));
    server.once("close", () => events.push("closed"));
    return server;
  };
}

test("fetchPublishedPage: an invalid path still opens the loopback server first, then closes it exactly once", async () => {
  const events: string[] = [];
  const requests: string[] = [];
  const deps = {
    reservedSegments: RESERVED_SEGMENTS,
    trackFetch: UNTRACKED,
    createServer: recordingServerFactory(events),
    createSiteApp: () => {
      events.push("app-built");
      return (req: { url?: string | undefined }, res: { statusCode: number; end(body: string): void }) => {
        requests.push(req.url ?? "");
        res.statusCode = 200;
        res.end("ok");
      };
    },
  } as const;

  for (const path of ["//evil.example/x", "/a/../b", "/admin", "/ok\u0000"]) {
    events.length = 0;
    await assert.rejects(() => fetchPublishedPage({ deps, input: { path } }), PublishedPagePathError, `expected '${path}' to be refused`);
    // Today's order: the app and the socket come first, the path is judged against the origin they minted.
    assert.deepEqual(events, ["app-built", "created", "listening", "closed"], `lifecycle for '${path}'`);
  }
  assert.deepEqual(requests, [], "a refused path must never reach the app");
});

for (const name of ["TimeoutError", "AbortError"]) test(`published page ${name} retains timeout name and private cause`, async () => {
  const cause = new DOMException("transport canary", name);
  await assert.rejects(fetchPublishedPage({ deps: { ...DEPS, fetch: async () => { throw cause; } }, input: { path: "/" } }), error =>
    error instanceof Error && error.name === "PublishedPageTimeoutError" && error.cause === cause && /rendering '\/' exceeded/.test(error.message));
});

test("fetchPublishedPage: the injected tracker wraps the transport once per call, with the call's fetch and the no-op port when untraced", async () => {
  const seen: { fetch: typeof globalThis.fetch; hasPort: boolean }[] = [];
  const sent: string[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init);
  const trackFetch: PublishedPageFetchTracker = ({ fetch: inner, observability }) => {
    seen.push({ fetch: inner, hasPort: typeof observability.trackOutboundCall === "function" });
    return async (input, init) => { sent.push(String(input)); return inner(input, init); };
  };
  const result = await fetchPublishedPage({ deps: { ...DEPS, fetch, trackFetch }, input: { path: "/echo?q=traced" } });
  assert.equal(result.body, "query=traced");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.fetch, fetch);
  assert.equal(seen[0]?.hasPort, true);
  assert.equal(sent.length, 1, "the request must go through the tracked transport, not the bare fetch");
  assert.match(sent[0] ?? "", /^http:\/\/127\.0\.0\.1:\d+\/echo\?q=traced$/);
});

test("fetchPublishedPage: a supplied observability port reaches the injected tracker unchanged", async () => {
  const ports: unknown[] = [];
  // A distinct object: the no-op factory may hand back one shared instance, which would hide a dropped port.
  const observability = { ...createNoopObservabilityPort({}) };
  const trackFetch: PublishedPageFetchTracker = ({ fetch, observability: port }) => { ports.push(port); return fetch; };
  await fetchPublishedPage({ deps: { ...DEPS, observability, trackFetch }, input: { path: "/" } });
  assert.deepEqual(ports.length, 1);
  assert.equal(ports[0], observability);
});
