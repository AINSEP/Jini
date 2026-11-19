/** t08: output contracts for the shared page body projection. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { Buffer } from "node:buffer";
import { shapePageBody, readPageBodyOptions } from "../page-body.js";

test("no-option body identity includes whitespace, entities and non-ASCII bytes", () => {
  const body = '\n<p title="a>b"> café &amp; 😀 </p>\r\n';
  assert.deepEqual(shapePageBody(body, { maxBytes: 200000 }), { body, bodyBytes: Buffer.byteLength(body), truncated: false });
});
test("textOnly strips executable/inert markup, comments and decodes entities before capping", () => {
  const html = '<style>x</style><SCRIPT>evil <b>bad</b></SCRIPT><!--secret--><noscript>hidden</noscript><p title="a>b">A &amp; B&nbsp; &lt;go&gt; &#39; &#x1f600;</p>';
  assert.deepEqual(shapePageBody(html, { textOnly: true, maxBytes: 100 }), { body: "A & B <go> ' 😀", bodyBytes: 17, truncated: false });
  assert.deepEqual(shapePageBody('<script>' + 'x'.repeat(300) + '</script><p>Hello</p>', { textOnly: true, maxBytes: 5 }), { body: "Hello", bodyBytes: 5, truncated: false });
});
test("find is a case-insensitive literal substring with exact offsets and 160-character context", () => {
  const body = 'a'.repeat(170) + 'N.e' + 'z'.repeat(170) + 'n.E';
  assert.deepEqual(shapePageBody(body, { find: "n.e", maxBytes: 200000 }), {
    matches: [{ offset: 170, snippet: 'a'.repeat(160) + 'N.e' + 'z'.repeat(160) }, { offset: 343, snippet: 'z'.repeat(160) + 'n.E' }], matchCount: 2, bodyBytes: 346, truncated: false,
  });
});
test("find matches regex punctuation literally rather than treating it as a wildcard", () => {
  assert.deepEqual(shapePageBody('N.e nae Nxe n.E', { find: 'n.e', maxBytes: 100 }), {
    matches: [{ offset: 0, snippet: 'N.e nae Nxe n.E' }, { offset: 12, snippet: 'N.e nae Nxe n.E' }],
    matchCount: 2, bodyBytes: 15, truncated: false,
  });
});
test("find counts all matches but returns at most 20 and respects the byte budget", () => {
  const result = shapePageBody('X '.repeat(25), { find: "x", maxBytes: 200000 });
  assert.equal(result.matchCount, 25);
  assert.deepEqual(result.matches, Array.from({ length: 20 }, (_, i) => ({ offset: i * 2, snippet: 'X '.repeat(25) })));
  assert.equal(result.truncated, true);
  assert.equal('body' in result, false);
  const capped = shapePageBody('needle ' + 'é'.repeat(100), { find: 'needle', maxBytes: 10 });
  assert.deepEqual(capped.matches, [{ offset: 0, snippet: 'needle é' }]);
  assert.equal(capped.matchCount, 1);
  assert.equal(capped.truncated, true);
});
test("find follows textOnly and has an explicit empty result", () => {
  assert.deepEqual(shapePageBody('<script>needle</script><p>Needle</p>', { textOnly: true, find: "needle", maxBytes: 100 }), { matches: [{ offset: 0, snippet: "Needle" }], matchCount: 1, bodyBytes: 6, truncated: false });
  assert.deepEqual(shapePageBody('abc', { find: "missing", maxBytes: 100 }), { matches: [], matchCount: 0, bodyBytes: 3, truncated: false });
});
test("page shaping refuses invalid optional inputs rather than silently dropping them", () => {
  for (const find of ['', 'a'.repeat(201), 1, null]) assert.throws(() => readPageBodyOptions({ find }), { message: "find must be a string of 1..200 characters." });
  for (const maxBytes of [0, 1.2, 1000001, '20', null]) assert.throws(() => readPageBodyOptions({ maxBytes }), { message: "maxBytes must be an integer of 1..1000000." });
  assert.throws(() => readPageBodyOptions({ textOnly: "yes" }), { message: "textOnly must be a boolean." });
});
test("the default model-facing body is 20 KB and callers can explicitly request more", () => {
  const body = 'x'.repeat(25_000);
  assert.deepEqual(shapePageBody(body, {}), { body: body.slice(0, 20_000), bodyBytes: 20_000, truncated: true });
  assert.deepEqual(shapePageBody(body, { maxBytes: 30_000 }), { body, bodyBytes: 25_000, truncated: false });
});

// Pin the existing traversal through its public projection before splitting node dispatch.
const cases = [
  { name: "document, doctype and comment nodes", html: '<!doctype html><!--before--><html><head></head><body><!--inside--></body></html>', text: "" },
  { name: "text nodes, decoded entities and whitespace normalization", html: '  A\n &amp;\t café &#x1f600;  ', text: "A & café 😀" },
  { name: "inline children in document order without added spaces", html: '<span>A<b>B<i>C</i>D</b>E</span><img alt="hidden"><input value="hidden"><span>F</span>', text: "ABCDEF" },
  { name: "block entry and exit separators, including empty blocks", html: '<span>A</span><div>B<span>C</span><p>D</p>E</div><span>F</span><br><span>G</span><div></div><span>H</span>', text: "A BC D E F G H" },
  { name: "omitted subtrees and comment leaves between visible text", html: '<span>A<script>bad</script>B<style>bad</style>C<noscript>bad</noscript>D<template><p>bad</p></template>E<!--hidden-->F</span>', text: "ABCDEF" },
];

for (const { name, html, text } of cases) {
  test(`T4-07: visible traversal preserves ${name}`, () => {
    assert.deepEqual(shapePageBody(html, { textOnly: true }), {
      body: text, bodyBytes: Buffer.byteLength(text), truncated: false,
    });
  });
}

test("T4-07: iterative traversal handles deeply nested blocks without recursion", () => {
  const html = '<div>'.repeat(5000) + '<span>A</span><br><span>B</span>' + '</div>'.repeat(5000);
  assert.deepEqual(shapePageBody(html, { textOnly: true }), {
    body: "A B", bodyBytes: 3, truncated: false,
  });
});

test("L131: option validation preserves boundaries, omitted keys and first failure", () => {
  assert.deepEqual(readPageBodyOptions({}), { find: undefined, textOnly: undefined, maxBytes: undefined });
  for (const maxBytes of [1, 1_000_000]) {
    assert.deepEqual(readPageBodyOptions({ find: "a".repeat(200), textOnly: false, maxBytes }), { find: "a".repeat(200), textOnly: false, maxBytes });
  }
  for (const maxBytes of [null, "1", NaN, Infinity, 0, -1, 1.5, 1_000_001]) {
    assert.throws(() => readPageBodyOptions({ maxBytes }), { message: "maxBytes must be an integer of 1..1000000." });
  }
  for (const find of [null, 1, "", "x".repeat(201)]) {
    assert.throws(() => readPageBodyOptions({ find, textOnly: "bad", maxBytes: 0 }), { message: "find must be a string of 1..200 characters." });
  }
  assert.throws(() => readPageBodyOptions({ textOnly: null, maxBytes: 0 }), { message: "textOnly must be a boolean." });
  assert.deepEqual(readPageBodyOptions({ find: "x", textOnly: true }), { find: "x", textOnly: true, maxBytes: undefined });
});

test("L131: visible traversal keeps inline order, block gaps and decoded text while omitting inert nodes", () => {
  const html = '<!--hidden--><title>Title</title><main>A<span>B</span><br>C<div>D &amp; é</div><script>bad</script><style>bad</style><noscript>bad</noscript><template><p>bad</p></template><img alt="bad"><!--hidden-->E</main>';
  assert.deepEqual(shapePageBody(html, { textOnly: true }), { body: "Title AB C D & é E", bodyBytes: 19, truncated: false });
  assert.deepEqual(shapePageBody("<div>".repeat(5000) + "ok" + "</div>".repeat(5000), { textOnly: true }), { body: "ok", bodyBytes: 2, truncated: false });
  assert.deepEqual(shapePageBody("<!--only--><script>bad</script>", { textOnly: true }), { body: "", bodyBytes: 0, truncated: false });
});


test("textOnly clips at a UTF-8 boundary while raw clipping preserves its replacement character", () => {
  assert.deepEqual(shapePageBody("é", { textOnly: true, maxBytes: 1 }), { body: "", bodyBytes: 0, truncated: true });
  assert.deepEqual(shapePageBody("é", { maxBytes: 1 }), { body: "�", bodyBytes: 1, truncated: true });
  assert.deepEqual(shapePageBody("<p>A😀B</p>", { textOnly: true, maxBytes: 4 }), { body: "A", bodyBytes: 1, truncated: true });
});
