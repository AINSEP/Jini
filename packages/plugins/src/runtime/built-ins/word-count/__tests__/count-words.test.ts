import assert from "node:assert/strict";
import { test } from "vitest";

import { countWords } from "../count-words.js";

/**
 * @file `word-count` tokenizer — SPEC-005 REQ-09, AC-01, RT-005's pinned tokenization algorithm.
 * Pins the separator (every collected text-node value joined with a single space), whitespace
 * collapsing, and malformed-node tolerance.
 */

function textNode(text: string) {
  return { type: "text", text };
}

function paragraph(...children: unknown[]) {
  return { type: "paragraph", content: children };
}

test("RT-005/AC-01: a 5-word single-paragraph body counts exactly 5", () => {
  const bodyJson = { type: "doc", content: [paragraph(textNode("the quick brown fox jumps"))] };
  assert.equal(countWords({ bodyJson }), 5);
});

test("RT-005: text nodes are concatenated depth-first ACROSS multiple paragraphs with a single space, then re-tokenized", () => {
  const bodyJson = {
    type: "doc",
    content: [paragraph(textNode("hello world")), paragraph(textNode("goodbye"), textNode("moon"))],
  };
  // "hello world" + " " + "goodbye" + "moon" (two text nodes in one paragraph, no separator
  // between them per RT-005's literal wording — "concatenating all text-node string values...
  // with single spaces" describes the join between EVERY collected text-node value, not just
  // between paragraphs) → "hello world goodbye moon" → 4 tokens.
  assert.equal(countWords({ bodyJson }), 4);
});

test("RT-005: an empty document (no text nodes) counts 0", () => {
  assert.equal(countWords({ bodyJson: { type: "doc", content: [] } }), 0);
});

test("RT-005: consecutive/irregular whitespace inside a single text node collapses to the correct token count (split on /\\s+/)", () => {
  const bodyJson = { type: "doc", content: [paragraph(textNode("one   two\tthree\nfour"))] };
  assert.equal(countWords({ bodyJson }), 4);
});

test("RT-005: punctuation tokens count as tokens and Unicode whitespace separates them", () => {
  assert.equal(countWords({ bodyJson: paragraph(textNode("a - b")) }), 3);
  assert.equal(countWords({ bodyJson: paragraph(textNode("one\u00a0two\u2003three")) }), 3);
});

test("RT-005: missing text and non-array content are ignored without losing valid sibling text", () => {
  assert.equal(countWords({ bodyJson: { type: "doc", content: [{ type: "text", text: undefined }, { type: "paragraph", content: { type: "text", text: "ignored" } }, textNode("real words")] } }), 2);
});

test("RT-005: null and primitive children are skipped, and a nested array of nodes is walked in document order", () => {
  assert.equal(countWords({ bodyJson: { type: "doc", content: [null, 42, "loose string", textNode("one two"), [textNode("three"), [textNode("four five")]]] } }), 5);
  assert.equal(countWords({ bodyJson: [textNode("top level"), null] }), 2);
  assert.equal(countWords({ bodyJson: null }), 0);
});

test("RT-005: a text node containing only whitespace contributes zero tokens, not an empty-string token", () => {
  const bodyJson = { type: "doc", content: [paragraph(textNode("   "), textNode("real word"))] };
  assert.equal(countWords({ bodyJson }), 2);
});

test("RT-005: non-text nodes (e.g. an image node with no `text` property) are ignored, not counted or errored on", () => {
  const bodyJson = {
    type: "doc",
    content: [{ type: "image", attrs: { src: "x.png" } }, paragraph(textNode("caption text"))],
  };
  assert.equal(countWords({ bodyJson }), 2);
});

test("RT-005: nested content (a blockquote containing a paragraph containing text) is walked depth-first regardless of nesting depth", () => {
  const bodyJson = {
    type: "doc",
    content: [{ type: "blockquote", content: [paragraph(textNode("deeply nested five word text"))] }],
  };
  assert.equal(countWords({ bodyJson }), 5);
});
