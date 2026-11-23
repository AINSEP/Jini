import assert from "node:assert/strict";
import { test } from "vitest";
import { shapePageBody } from "../page-body.js";

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
    assert.deepEqual(shapePageBody({ body: html }, { textOnly: true }), {
      body: text, bodyBytes: Buffer.byteLength(text), truncated: false,
    });
  });
}

test("T4-07: iterative traversal handles deeply nested blocks without recursion", () => {
  const html = '<div>'.repeat(5000) + '<span>A</span><br><span>B</span>' + '</div>'.repeat(5000);
  assert.deepEqual(shapePageBody({ body: html }, { textOnly: true }), {
    body: "A B", bodyBytes: 3, truncated: false,
  });
});
