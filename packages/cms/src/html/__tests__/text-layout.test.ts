import assert from "node:assert/strict";
import { test } from "vitest";
import type { JsonValue } from "@jini-ai/core/primitives";
import { headingAnchorId, dedupeHeadingIds, styleForAlign, alignStyleAttr, tableCellAlignAttr, tableSpanAttrs } from "../text-layout.js";

test("heading text is flattened before the injected canonical slugger is called", () => {
  const calls: string[] = [];
  const node: JsonValue = { type: "heading", content: [
    { type: "text", text: "C++ & ", marks: [{ type: "bold" }] },
    { type: "link", content: [{ type: "text", text: "Rust" }] }, null, [],
  ] };
  assert.equal(headingAnchorId({ node, toSlug: ({ text }) => { calls.push(text); return "c-rust"; } }), "c-rust");
  assert.deepEqual(calls, ["C++ & Rust"]);
  assert.equal(headingAnchorId({ node: [], toSlug: ({ text }) => text }), "");
});

test("heading suffixes skip literal ids already emitted", () => {
  assert.equal(dedupeHeadingIds({ html: '<h2 id="foo">Foo</h2><h2 id="foo-2">Foo-2</h2><h3 id="foo">Foo</h3>' }),
    '<h2 id="foo">Foo</h2><h2 id="foo-2">Foo-2</h2><h3 id="foo-3">Foo</h3>');
  assert.equal(dedupeHeadingIds({ html: '<h2 id="foo">A</h2><h2 id="foo">B</h2><h3 id="foo-2">C</h3><h4 id="foo-2-2">D</h4><h5 id="foo-2">E</h5>' }),
    '<h2 id="foo">A</h2><h2 id="foo-2">B</h2><h3 id="foo-2-2">C</h3><h4 id="foo-2-2-2">D</h4><h5 id="foo-2-3">E</h5>');
});

test("heading dedupe keeps styles and only touches generated id-first tags", () => {
  const html = '<h2 id="overview" style="text-align:right">A</h2><h3 id="overview" style="text-align:center">B</h3><h2 class="authored" id="overview">C</h2>';
  assert.equal(dedupeHeadingIds({ html }), '<h2 id="overview" style="text-align:right">A</h2><h3 id="overview-2" style="text-align:center">B</h3><h2 class="authored" id="overview">C</h2>');
  assert.equal(dedupeHeadingIds({ html: '<h1 id="first">A</h1><h2 id="second">B</h2>' }), '<h1 id="first">A</h1><h2 id="second">B</h2>');
});

test("paragraph alignment admits justify while table cells only admit center and right", () => {
  assert.equal(alignStyleAttr({ node: { attrs: { textAlign: "justify" } } }), ' style="text-align:justify"');
  assert.equal(alignStyleAttr({ node: { attrs: [] } }), "");
  for (const align of ["left", "justify", "center;position:fixed"]) assert.equal(tableCellAlignAttr({ node: { attrs: { align } } }), "");
  for (const align of ["center", "right"]) assert.equal(tableCellAlignAttr({ node: { attrs: { align } } }), ` style="text-align:${align}"`);
  assert.equal(styleForAlign({ align: null }), "");
});

test("table spans preserve column-before-row order and independent numeric bounds", () => {
  assert.equal(tableSpanAttrs({ attrs: { colspan: 2, rowspan: 3 } }), ' colspan="2" rowspan="3"');
  assert.equal(tableSpanAttrs({ attrs: { colspan: 1000, rowspan: 1 } }), ' colspan="1000"');
  for (const colspan of [1001, 999999, 0, -1, 1.5, "3", null]) assert.equal(tableSpanAttrs({ attrs: { colspan, rowspan: 3 } }), ' rowspan="3"');
  assert.equal(tableSpanAttrs({ attrs: {} }), "");
});

test("record-shaped nodes with missing or non-string alignment do not emit a table or paragraph style", () => {
  const variations: JsonValue[] = [{}, { align: 2, textAlign: 2 }, [], null];
  for (const attrs of variations) {
    assert.equal(tableCellAlignAttr({ node: { attrs } }), "");
    assert.equal(alignStyleAttr({ node: { attrs } }), "");
  }
  assert.equal(headingAnchorId({ node: { type: "heading", content: { text: "not inline content" } }, toSlug: ({ text }) => text }), "");
});
