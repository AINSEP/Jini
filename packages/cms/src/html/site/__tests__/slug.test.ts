import assert from "node:assert/strict";
import { test } from "vitest";

import { toSlug } from "../slug.js";

// `toSlug` replaced five hand-rolled `[^a-z0-9]+ → -` copies (post slugs, form slugs, widget slugs,
// region handles, heading anchors). Stored slugs are never recomputed, but heading anchors are, at
// every render — so for ASCII input the output must stay byte-identical to the old rule, or existing
// `#fragment` links break. This file keeps that old rule inline as the oracle.
function oldSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const ASCII_CORPUS = [
  "",
  "   ",
  "Hello World",
  "fooBar",
  "iPhone",
  "AT&T",
  "Don't stop",
  "C++ & Rust",
  "a^b`c",
  "--leading and trailing--",
  "Already-a-slug-123",
  "UPPER_snake_Case",
  "tabs\tand\nnewlines",
  "100% (guaranteed) [really] {ok}",
  "email@example.com / path?q=1#frag",
  "~!@#$%^&*()_+=-`|\\\"';:<>,./?",
  "\x00\x1f\x7f control",
];

test("toSlug: every ASCII corpus string matches the old rule byte for byte", () => {
  for (const text of ASCII_CORPUS) assert.equal(toSlug({ text }), oldSlug(text), JSON.stringify(text));
});

test("toSlug: 10,000 seeded random ASCII strings match the old rule byte for byte", () => {
  // Park–Miller LCG: deterministic, so a failure reproduces exactly.
  let seed = 20260928;
  const next = () => (seed = (seed * 48271) % 2147483647);
  for (let i = 0; i < 10_000; i += 1) {
    const length = next() % 24;
    let text = "";
    for (let j = 0; j < length; j += 1) text += String.fromCharCode(next() % 128);
    assert.equal(toSlug({ text }), oldSlug(text), JSON.stringify(text));
  }
});

test("toSlug: non-ASCII letters transliterate instead of becoming separators", () => {
  assert.equal(toSlug({ text: "Café Münster" }), "cafe-muenster");
  assert.equal(toSlug({ text: "Привет" }), "privet");
  assert.equal(toSlug({ text: "Ελληνικά" }), "ellinika");
  assert.equal(toSlug({ text: "Łódź" }), "lodz");
});

test("toSlug: scripts with no transliteration still yield empty, so callers' fallbacks apply", () => {
  assert.equal(toSlug({ text: "日本語" }), "");
  assert.equal(toSlug({ text: "עברית" }), "");
});
