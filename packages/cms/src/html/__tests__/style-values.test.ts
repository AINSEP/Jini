import assert from "node:assert/strict";
import { test } from "vitest";

import { safeAspectRatio, safeTextAlign, safeLanguageClass } from "../style-values.js";

// CSS allowlists for the two author-supplied
// values a renderer interpolates straight into a `style="…"` attribute. HTML escaping alone cannot stop
// a value that STAYS inside the attribute's quotes from smuggling a second declaration.

test("safeTextAlign: the three real align keywords pass through unchanged", () => {
  assert.equal(safeTextAlign({ value: "center" }), "center");
  assert.equal(safeTextAlign({ value: "right" }), "right");
  assert.equal(safeTextAlign({ value: "justify" }), "justify");
});

test("safeTextAlign: 'left' (the CSS default) is rejected — the caller omits the attribute for it, same as any other unrecognized value", () => {
  assert.equal(safeTextAlign({ value: "left" }), null);
});

test("safeTextAlign: a value that starts with a real keyword and smuggles a second declaration is rejected whole, not truncated to the keyword", () => {
  assert.equal(safeTextAlign({ value: "center;background:url(x)" }), null);
  assert.equal(safeTextAlign({ value: "left;background:url(x)" }), null);
});

test("safeTextAlign: an unrecognized keyword is rejected", () => {
  assert.equal(safeTextAlign({ value: "start" }), null);
  assert.equal(safeTextAlign({ value: "" }), null);
});

test("safeAspectRatio: a real ratio passes through unchanged, including internal whitespace", () => {
  assert.equal(safeAspectRatio({ value: "4 / 3" }), "4 / 3");
  assert.equal(safeAspectRatio({ value: "16/9" }), "16/9");
  assert.equal(safeAspectRatio({ value: "1.5 / 2.25" }), "1.5 / 2.25");
});

test("safeAspectRatio: a value that starts with a real ratio and smuggles a second declaration is rejected whole", () => {
  assert.equal(safeAspectRatio({ value: "1;background:url(x)" }), null);
  assert.equal(safeAspectRatio({ value: "1/1;position:fixed" }), null);
});

test("safeAspectRatio: non-ratio-shaped values are rejected", () => {
  assert.equal(safeAspectRatio({ value: "auto" }), null);
  assert.equal(safeAspectRatio({ value: "" }), null);
  assert.equal(safeAspectRatio({ value: "16 / " }), null);
});

test("language classes accept one trimmed token and reject internal whitespace", () => {
  assert.equal(safeLanguageClass({ value: " objective-c " }), "objective-c");
  assert.equal(safeLanguageClass({ value: "python repl" }), null);
  assert.equal(safeLanguageClass({ value: "python\trepl" }), null);
  assert.equal(safeLanguageClass({ value: "python\nrepl" }), null);
});
