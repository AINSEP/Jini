import assert from "node:assert/strict";
import { test } from "vitest";

import { EMBED_HTML_ATTRIBUTE_ALLOWED_NAMES, isAllowedEmbedHtmlAttributeName, parseEmbedHtmlAttributes } from "./support/compat/markers-html-attributes.js";

/**
 * @file RED-first unit coverage for the shared render-time attribute allowlist (2026-09-23
 * embed-attributes-everywhere plan, slice S1). Every case here is drawn from the plan's own
 * attack/acceptance list (`ADS-memory/.local-artifacts/widget-attrs-plan-2026-09-23.md` §S1) — see
 * `../html-attributes.ts`'s own header for the two behavior changes these tests pin: a widened
 * allowlist (`class`/`id`/`style`/… on top of `data-*`/`aria-*`), and per-token (not whole-string)
 * failure, except `malformed`.
 */

test("parseEmbedHtmlAttributes accepts style, id, class, title, role, tabindex and data-*", () => {
  const { attributes, errors, error } = parseEmbedHtmlAttributes(
    'style="color:red" id="hero" class="a b" title="t" role="button" tabindex="0" data-x="1"'
  );
  assert.deepEqual(attributes, {
    style: "color:red",
    id: "hero",
    class: "a b",
    title: "t",
    role: "button",
    tabindex: "0",
    "data-x": "1",
  });
  assert.deepEqual(errors, []);
  assert.equal(error, null);
});

test("isAllowedEmbedHtmlAttributeName agrees with the exported allowed-names list for every entry", () => {
  for (const name of EMBED_HTML_ATTRIBUTE_ALLOWED_NAMES) {
    assert.equal(isAllowedEmbedHtmlAttributeName(name), true, `expected ${name} to be allowed`);
  }
  assert.equal(isAllowedEmbedHtmlAttributeName("data-anything"), true);
  assert.equal(isAllowedEmbedHtmlAttributeName("aria-anything"), true);
});

test("parseEmbedHtmlAttributes drops onclick alone, keeping data-x and style — one bad token, not the whole string", () => {
  const { attributes, errors, error } = parseEmbedHtmlAttributes('data-x="1" onclick="alert(1)" style="color:red"');
  assert.deepEqual(attributes, { "data-x": "1", style: "color:red" });
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.reason, "event-handler");
  assert.equal(errors[0]!.attribute, "onclick");
  assert.equal(error, errors[0]);
});

test("parseEmbedHtmlAttributes rejects a poster value whose scheme is javascript: even split by a tab (whitespace-obfuscation hardening)", () => {
  const { attributes, errors } = parseEmbedHtmlAttributes('poster="java\tscript:x"');
  assert.deepEqual(attributes, {});
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.reason, "unsafe-url");
  assert.equal(errors[0]!.attribute, "poster");
});

test("parseEmbedHtmlAttributes rejects a poster value with a data: scheme", () => {
  const { attributes, errors } = parseEmbedHtmlAttributes('poster="data:text/html,<script>alert(1)</script>"');
  assert.deepEqual(attributes, {});
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.reason, "unsafe-url");
  assert.equal(errors[0]!.attribute, "poster");
});

test("parseEmbedHtmlAttributes rejects a style value carrying expression(...)", () => {
  const { attributes, errors } = parseEmbedHtmlAttributes('style="width:expression(1)"');
  assert.deepEqual(attributes, {});
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.reason, "unsafe-style");
  assert.equal(errors[0]!.attribute, "style");
});

test("parseEmbedHtmlAttributes rejects a style value using a CSS-escape backslash to respell expression(...)", () => {
  const { attributes, errors } = parseEmbedHtmlAttributes('style="a:\\65 xpression(1)"');
  assert.deepEqual(attributes, {});
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.reason, "unsafe-style");
  assert.equal(errors[0]!.attribute, "style");
});

test("parseEmbedHtmlAttributes fails closed on a stray quote — malformed, attributes is {}", () => {
  const { attributes, errors, error } = parseEmbedHtmlAttributes('"');
  assert.deepEqual(attributes, {});
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.reason, "malformed");
  assert.equal(error, errors[0]);
});

test("parseEmbedHtmlAttributes malformed detection discards attributes already accepted before the stray quote", () => {
  const { attributes, error } = parseEmbedHtmlAttributes('data-x="1" "bogus="y"');
  assert.deepEqual(attributes, {});
  assert.equal(error?.reason, "malformed");
});

test("parseEmbedHtmlAttributes rejects srcdoc, href, xlink:href and a name containing '>' — never emitted", () => {
  for (const text of ['srcdoc="x"', 'href="/y"', 'xlink:href="/y"', "data-x><svg"]) {
    const { attributes } = parseEmbedHtmlAttributes(text);
    assert.deepEqual(attributes, {}, `expected ${JSON.stringify(text)} to be fully rejected`);
  }
});

test("parseEmbedHtmlAttributes treats a bare boolean attribute as an empty-string value", () => {
  const { attributes, errors } = parseEmbedHtmlAttributes("muted");
  assert.deepEqual(attributes, { muted: "" });
  assert.deepEqual(errors, []);
});

test("parseEmbedHtmlAttributes on an empty/whitespace-only string returns no attributes and no errors", () => {
  assert.deepEqual(parseEmbedHtmlAttributes(""), { attributes: {}, errors: [], error: null });
  assert.deepEqual(parseEmbedHtmlAttributes("   "), { attributes: {}, errors: [], error: null });
});

for (const [text, reason, attribute] of [
  ['style="background:url(javascript:x)"', "unsafe-style", "style"],
  ['style="background:url(vbscript:x)"', "unsafe-style", "style"],
  ['style="-moz-binding:url(x)"', "unsafe-style", "style"],
  ['style="behavior:url(x)"', "unsafe-style", "style"],
  ["style=\"@import 'x'\"", "unsafe-style", "style"],
  ['poster="vbscript:x"', "unsafe-url", "poster"],
  ['ONCLICK="alert(1)"', "event-handler", "onclick"],
] as const) {
  test(`parseEmbedHtmlAttributes drops ${text} and preserves the safe sibling`, () => {
    const parsed = parseEmbedHtmlAttributes(`data-safe="kept" ${text}`);
    assert.deepEqual(parsed.attributes, { "data-safe": "kept" });
    assert.deepEqual(parsed.errors, [{ reason, attribute }]);
    assert.deepEqual(parsed.error, { reason, attribute });
  });
}
