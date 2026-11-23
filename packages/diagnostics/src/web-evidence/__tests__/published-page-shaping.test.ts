/** t08: output contracts for the shared page body projection. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { Server } from "node:http";
import { shapePageBody, readPageBodyOptions } from "../page-body.js";
import { fetchPublishedPage, type FetchPublishedPageDeps } from "../published-page.js";

test("no-option body identity includes whitespace, entities and non-ASCII bytes", () => {
  const body = '\n<p title="a>b"> café &amp; 😀 </p>\r\n';
  assert.deepEqual(shapePageBody({ body }, { maxBytes: 200000 }), { body, bodyBytes: Buffer.byteLength(body), truncated: false });
});
test("textOnly strips executable/inert markup, comments and decodes entities before capping", () => {
  const html = '<style>x</style><SCRIPT>evil <b>bad</b></SCRIPT><!--secret--><noscript>hidden</noscript><p title="a>b">A &amp; B&nbsp; &lt;go&gt; &#39; &#x1f600;</p>';
  assert.deepEqual(shapePageBody({ body: html }, { textOnly: true, maxBytes: 100 }), { body: "A & B <go> ' 😀", bodyBytes: 17, truncated: false });
  assert.deepEqual(shapePageBody({ body: '<script>' + 'x'.repeat(300) + '</script><p>Hello</p>' }, { textOnly: true, maxBytes: 5 }), { body: "Hello", bodyBytes: 5, truncated: false });
});
test("find is a case-insensitive literal substring with exact offsets and 160-character context", () => {
  const body = 'a'.repeat(170) + 'N.e' + 'z'.repeat(170) + 'n.E';
  assert.deepEqual(shapePageBody({ body }, { find: "n.e", maxBytes: 200000 }), {
    matches: [{ offset: 170, snippet: 'a'.repeat(160) + 'N.e' + 'z'.repeat(160) }, { offset: 343, snippet: 'z'.repeat(160) + 'n.E' }], matchCount: 2, bodyBytes: 346, truncated: false,
  });
});
test("find matches regex punctuation literally rather than treating it as a wildcard", () => {
  assert.deepEqual(shapePageBody({ body: 'N.e nae Nxe n.E' }, { find: 'n.e', maxBytes: 100 }), {
    matches: [{ offset: 0, snippet: 'N.e nae Nxe n.E' }, { offset: 12, snippet: 'N.e nae Nxe n.E' }],
    matchCount: 2, bodyBytes: 15, truncated: false,
  });
});
test("find counts all matches but returns at most 20 and respects the byte budget", () => {
  const result = shapePageBody({ body: 'X '.repeat(25) }, { find: "x", maxBytes: 200000 });
  assert.equal(result.matchCount, 25);
  assert.deepEqual(result.matches, Array.from({ length: 20 }, (_, i) => ({ offset: i * 2, snippet: 'X '.repeat(25) })));
  assert.equal(result.truncated, true);
  assert.equal('body' in result, false);
  const capped = shapePageBody({ body: 'needle ' + 'é'.repeat(100) }, { find: 'needle', maxBytes: 10 });
  assert.deepEqual(capped.matches, [{ offset: 0, snippet: 'needle é' }]);
  assert.equal(capped.matchCount, 1);
  assert.equal(capped.truncated, true);
});
test("find follows textOnly and has an explicit empty result", () => {
  assert.deepEqual(shapePageBody({ body: '<script>needle</script><p>Needle</p>' }, { textOnly: true, find: "needle", maxBytes: 100 }), { matches: [{ offset: 0, snippet: "Needle" }], matchCount: 1, bodyBytes: 6, truncated: false });
  assert.deepEqual(shapePageBody({ body: 'abc' }, { find: "missing", maxBytes: 100 }), { matches: [], matchCount: 0, bodyBytes: 3, truncated: false });
});
test("page shaping refuses invalid optional inputs rather than silently dropping them", () => {
  for (const find of ['', 'a'.repeat(201), 1, null]) assert.throws(() => readPageBodyOptions({ input: { find } }), { message: "find must be a string of 1..200 characters." });
  for (const maxBytes of [0, 1.2, 1000001, '20', null]) assert.throws(() => readPageBodyOptions({ input: { maxBytes } }), { message: "maxBytes must be an integer of 1..1000000." });
  assert.throws(() => readPageBodyOptions({ input: { textOnly: "yes" } }), { message: "textOnly must be a boolean." });
});
test("published-page shaping preserves legacy bytes and applies find/textOnly through the real producer without a socket", async () => {
  let closed = 0;
  let requests = 0;
  // Only socket creation and the HTTP response are faked; the producer and bounded body reader run.
  let html = '\n<p>café &amp; 😀</p>\r\n';
  const deps: FetchPublishedPageDeps = {
    reservedSegments: new Set(["admin", "api"]),
    createSiteApp: () => () => {},
    createServer: listener => {
      const server = new Server(listener);
      Object.assign(server, {
        listen: (port: number, host: string) => {
          assert.equal(port, 0); assert.equal(host, '127.0.0.1');
          queueMicrotask(() => server.emit('listening')); return server;
        },
        address: () => ({ port: 53142, address: '127.0.0.1', family: 'IPv4' }),
        closeAllConnections: () => {},
        close: (done: () => void) => { closed++; done(); return server; },
      });
      return server;
    },
    fetch: async (url, options) => {
      requests++;
      assert.equal(url, 'http://127.0.0.1:53142/about?x=1');
      assert.equal(options?.redirect, 'manual');
      return new Response(html, { headers: { 'X-Test': 'kept' } });
    },
  };
  assert.deepEqual(await fetchPublishedPage({ deps, input: { path: '/about?x=1' } }), {
    path: '/about?x=1', status: 200, ok: true, headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-test': 'kept' },
    cookies: [], body: html, bodyBytes: Buffer.byteLength(html), truncated: false,
  });
  html = 'é';
  assert.deepEqual(await fetchPublishedPage({ deps, input: { path: '/about?x=1' } }, { maxBytes: 1 }), {
    path: '/about?x=1', status: 200, ok: true, headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-test': 'kept' },
    cookies: [], body: '�', bodyBytes: 1, truncated: true,
  });
  html = '<script>' + 'needle'.repeat(100) + '</script><p>Needle</p>';
  const found = await fetchPublishedPage({ deps, input: { path: '/about?x=1' } }, { textOnly: true, find: 'needle' });
  assert.deepEqual({ matches: found.matches, matchCount: found.matchCount, bodyBytes: found.bodyBytes, truncated: found.truncated }, {
    matches: [{ offset: 0, snippet: 'Needle' }], matchCount: 1, bodyBytes: 6, truncated: false,
  });
  assert.equal('body' in found, false);
  const text = await fetchPublishedPage({ deps, input: { path: '/about?x=1' } }, { textOnly: true, maxBytes: 6 });
  assert.equal(text.body, 'Needle'); assert.equal(text.truncated, false);
  assert.equal(closed, 4); assert.equal(requests, 4);
});


test("the default model-facing body is 20 KB and callers can explicitly request more", () => {
  const body = 'x'.repeat(25_000);
  assert.deepEqual(shapePageBody({ body }, {}), { body: body.slice(0, 20_000), bodyBytes: 20_000, truncated: true });
  assert.deepEqual(shapePageBody({ body }, { maxBytes: 30_000 }), { body, bodyBytes: 25_000, truncated: false });
});
