import assert from "node:assert/strict";
import { test } from "vitest";

import {
  describeMediaHtmlAttributeError,
  isAllowedMediaHtmlAttributeName,
  parseMediaHtmlAttributes,
} from "../html-attributes.js";

/**
 * @file `html-attributes.ts`'s allowlist — the server-side (Node) copy of the identical validator
 * the consuming product's admin carries in `apps/admin/src/features/media/rules.ts`. See that file's header and this
 * one's for why the two copies are deliberately duplicated rather than shared through one import.
 *
 * Ported verbatim from the admin copy's own test suite
 * (`apps/admin/src/features/media/__tests__/media-html-attributes.unit.test.tsx`) so both copies are
 * proven against the identical adversarial cases — mixed valid+invalid tokens, case variation, quote
 * styles, boolean attributes, malformed fragments. A validator whose whole job is refusing input has
 * not been tested at all if only the happy path is covered.
 */

test("isAllowedMediaHtmlAttributeName: allows the data- prefix family regardless of suffix", () => {
  assert.equal(isAllowedMediaHtmlAttributeName("data-motion"), true);
  assert.equal(isAllowedMediaHtmlAttributeName("data-anything-at-all"), true);
});

test("isAllowedMediaHtmlAttributeName: allows the aria- prefix family regardless of suffix", () => {
  assert.equal(isAllowedMediaHtmlAttributeName("aria-hidden"), true);
  assert.equal(isAllowedMediaHtmlAttributeName("aria-label"), true);
});

test("isAllowedMediaHtmlAttributeName: allows every exact-match name on the fixed list", () => {
  for (const name of ["loading", "decoding", "playsinline", "muted", "loop", "autoplay", "poster"]) {
    assert.equal(isAllowedMediaHtmlAttributeName(name), true);
  }
});

test("isAllowedMediaHtmlAttributeName: is case-insensitive in both directions", () => {
  assert.equal(isAllowedMediaHtmlAttributeName("DATA-FOO"), true);
  assert.equal(isAllowedMediaHtmlAttributeName("ARIA-LABEL"), true);
  assert.equal(isAllowedMediaHtmlAttributeName("LOADING"), true);
});

test("isAllowedMediaHtmlAttributeName: rejects a name that is not on the allowlist", () => {
  assert.equal(isAllowedMediaHtmlAttributeName("style"), false);
  assert.equal(isAllowedMediaHtmlAttributeName("href"), false);
  assert.equal(isAllowedMediaHtmlAttributeName("srcdoc"), false);
  // Not a data-/aria- prefix, and not on the exact list — a prefix check that matched a substring
  // anywhere in the name (rather than anchored at the start) would wrongly admit this.
  assert.equal(isAllowedMediaHtmlAttributeName("x-data-foo"), false);
});

test("isAllowedMediaHtmlAttributeName: rejects on* handlers even though this check runs independently of the event-handler check", () => {
  assert.equal(isAllowedMediaHtmlAttributeName("onerror"), false);
  assert.equal(isAllowedMediaHtmlAttributeName("onclick"), false);
});

test("parseMediaHtmlAttributes: returns no attributes and no error for an empty (or whitespace-only) draft", () => {
  assert.deepEqual(parseMediaHtmlAttributes(""), { attributes: {}, error: null });
  assert.deepEqual(parseMediaHtmlAttributes("   "), { attributes: {}, error: null });
});

test("parseMediaHtmlAttributes: parses one allowed quoted attribute", () => {
  assert.deepEqual(parseMediaHtmlAttributes('data-motion="fade-in"'), {
    attributes: { "data-motion": "fade-in" },
    error: null,
  });
});

test("parseMediaHtmlAttributes: parses multiple allowed attributes, including single-quoted and unquoted values", () => {
  const result = parseMediaHtmlAttributes(`data-motion="fade-in" aria-label='hello' loading=lazy`);
  assert.deepEqual(result, {
    attributes: { "data-motion": "fade-in", "aria-label": "hello", loading: "lazy" },
    error: null,
  });
});

test("parseMediaHtmlAttributes: parses a bare boolean attribute (no value) as present with an empty string value", () => {
  assert.deepEqual(parseMediaHtmlAttributes("muted"), { attributes: { muted: "" }, error: null });
});

test("parseMediaHtmlAttributes: lowercases attribute names on the way in", () => {
  assert.deepEqual(parseMediaHtmlAttributes('DATA-Motion="Fade"'), {
    attributes: { "data-motion": "Fade" },
    error: null,
  });
});

test("parseMediaHtmlAttributes: rejects an on* handler with the specific event-handler reason, naming the attribute", () => {
  assert.deepEqual(parseMediaHtmlAttributes('onerror="alert(1)"'), {
    attributes: {},
    error: { reason: "event-handler", attribute: "onerror" },
  });
});

test("parseMediaHtmlAttributes: rejects on* case-insensitively", () => {
  assert.deepEqual(parseMediaHtmlAttributes('OnClick="doThing()"'), {
    attributes: {},
    error: { reason: "event-handler", attribute: "onclick" },
  });
});

test("parseMediaHtmlAttributes: rejects a javascript: value on an otherwise-allowed name", () => {
  // `poster` is a real, allowed <video> attribute — the value, not the name, is what's dangerous
  // here, so this must report `javascript-url`, not let the allowed name mask the bad value.
  assert.deepEqual(parseMediaHtmlAttributes('poster="javascript:alert(1)"'), {
    attributes: {},
    error: { reason: "javascript-url", attribute: "poster" },
  });
});

test("parseMediaHtmlAttributes: catches a javascript: value regardless of case or leading whitespace", () => {
  assert.deepEqual(parseMediaHtmlAttributes('poster="  JavaScript:alert(1)"'), {
    attributes: {},
    error: { reason: "javascript-url", attribute: "poster" },
  });
});

test("parseMediaHtmlAttributes: rejects a name that is not on the allowlist, naming it", () => {
  assert.deepEqual(parseMediaHtmlAttributes('style="color:red"'), {
    attributes: {},
    error: { reason: "disallowed-name", attribute: "style" },
  });
});

test("parseMediaHtmlAttributes: reports the FIRST rejection when several tokens would each fail, not a batch", () => {
  // `style` (disallowed) comes before `onerror` (event handler) in the input — the first offender
  // scanning left to right must win, proving this doesn't silently continue past a rejection.
  assert.deepEqual(parseMediaHtmlAttributes('style="color:red" onerror="alert(1)"'), {
    attributes: {},
    error: { reason: "disallowed-name", attribute: "style" },
  });
});

test("parseMediaHtmlAttributes: stops at the first bad token even when good tokens came before it", () => {
  // Adversarial: an operator (or an attacker relying on a reviewer skimming only the start of the
  // string) could front-load safe-looking attributes before a smuggled one. Every already-parsed
  // attribute must be discarded, not partially accepted.
  assert.deepEqual(parseMediaHtmlAttributes('data-motion="fade-in" loading="lazy" onerror="alert(1)"'), {
    attributes: {},
    error: { reason: "event-handler", attribute: "onerror" },
  });
});

test("parseMediaHtmlAttributes: reports a malformed fragment it cannot tokenize as a name/value pair", () => {
  const result = parseMediaHtmlAttributes('data-motion="fade-in" "stray-quote"');
  assert.deepEqual(result.attributes, {});
  assert.equal(result.error?.reason, "malformed");
});

test("describeMediaHtmlAttributeError: names the rejected attribute in the event-handler message", () => {
  assert.match(describeMediaHtmlAttributeError({ reason: "event-handler", attribute: "onerror" }), /onerror/);
});

test("describeMediaHtmlAttributeError: names the rejected attribute in the javascript-url message", () => {
  assert.match(describeMediaHtmlAttributeError({ reason: "javascript-url", attribute: "poster" }), /poster/);
});

test("describeMediaHtmlAttributeError: names the rejected attribute in the disallowed-name message", () => {
  assert.match(describeMediaHtmlAttributeError({ reason: "disallowed-name", attribute: "style" }), /style/);
});

test("describeMediaHtmlAttributeError: names the unparsable fragment in the malformed message", () => {
  assert.match(describeMediaHtmlAttributeError({ reason: "malformed", attribute: "stray-quote" }), /stray-quote/);
});

// ---------------------------------------------------------------------------
// Attribute-NAME shape (2026-09-07 stored-XSS fix). The `data-`/`aria-` prefix families accepted
// ANY suffix, and the tokenizer's name class excludes only whitespace/`=`/quotes — so `<`, `>` and
// `/` were legal in a name a renderer then interpolates RAW into ` name="value"`.
// ---------------------------------------------------------------------------

test("isAllowedMediaHtmlAttributeName: rejects a data-/aria- name carrying tag-breaking characters", () => {
  for (const name of ["data-x><svg/onload", "data-a/onerror", "aria-x<img", "data-x`y", "data-x>", "aria-]"]) {
    assert.equal(isAllowedMediaHtmlAttributeName(name), false, `${name} must not be allowed`);
  }
});

test("isAllowedMediaHtmlAttributeName: still accepts every well-formed name the field exists for", () => {
  for (const name of ["data-motion", "aria-label", "DATA-FOO", "loading", "decoding", "poster", "data-x-1"]) {
    assert.equal(isAllowedMediaHtmlAttributeName(name), true, `${name} must stay allowed`);
  }
});

test("parseMediaHtmlAttributes: an attribute name that would close the tag is rejected, not parsed into the map", () => {
  const result = parseMediaHtmlAttributes("data-x><svg/onload=alert(1)");
  assert.deepEqual(result.attributes, {});
  assert.deepEqual(result.error, { reason: "disallowed-name", attribute: "data-x><svg/onload" });
});
