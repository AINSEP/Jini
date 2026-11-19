import assert from "node:assert/strict";
import { test } from "vitest";
import type { JsonObject } from "@jini-ai/core/primitives";
import { MARK_RENDERERS, renderMarks } from "../document-marks.js";
import { toAllowedHref } from "../../navigation/href.js";

const MARK_CASES: Record<string, JsonObject[]> = {
  bold: [{ type: "bold" }],
  italic: [{ type: "italic" }],
  code: [{ type: "code" }],
  underline: [{ type: "underline" }],
  strike: [{ type: "strike" }],
  subscript: [{ type: "subscript" }],
  superscript: [{ type: "superscript" }],
  textStyle: [{ type: "textStyle", attrs: { color: "#ff0000", fontFamily: "Georgia, serif", fontSize: "18px" } }],
  "textStyle-hostile": [{ type: "textStyle", attrs: { color: "red;background:url(x)", fontFamily: "a;b", fontSize: "1em;x" } }],
  highlight: [{ type: "highlight", attrs: { color: "#ffee00" } }],
  link: [{ type: "link", attrs: { href: "https://tovu.dev/a?b=c&d=e" } }],
  "link-hostile": [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
  "bold+link+italic": [{ type: "bold" }, { type: "link", attrs: { href: "/x" } }, { type: "italic" }],
  "unknown-mark": [{ type: "wiggle" }],
};

const EXPECTED: Record<string, string> = {
  bold: "<strong>m &lt;x&gt;</strong>", italic: "<em>m &lt;x&gt;</em>", code: "<code>m &lt;x&gt;</code>",
  underline: "<u>m &lt;x&gt;</u>", strike: "<s>m &lt;x&gt;</s>", subscript: "<sub>m &lt;x&gt;</sub>",
  superscript: "<sup>m &lt;x&gt;</sup>",
  textStyle: '<span style="color:#ff0000;font-family:Georgia, serif;font-size:18px">m &lt;x&gt;</span>',
  "textStyle-hostile": "m &lt;x&gt;", highlight: '<mark style="background-color:#ffee00">m &lt;x&gt;</mark>',
  link: '<a href="https://tovu.dev/a?b=c&amp;d=e">m &lt;x&gt;</a>', "link-hostile": '<a href="#">m &lt;x&gt;</a>',
  "bold+link+italic": '<em><a href="/x"><strong>m &lt;x&gt;</strong></a></em>', "unknown-mark": "m &lt;x&gt;",
};

for (const [name, marks] of Object.entries(MARK_CASES)) {
  test(`golden mark fixture: ${name}`, () => {
    assert.equal(renderMarks({ text: "m <x>", marks, toAllowedHref }), EXPECTED[name]);
  });
}

test("the fixtures cover every published renderer", () => {
  for (const type of Object.keys(MARK_RENDERERS)) assert.ok(Object.hasOwn(MARK_CASES, type));
});

test("link rendering calls the injected href policy with the raw unknown value", () => {
  const calls: unknown[] = [];
  assert.equal(renderMarks({ text: "x", marks: [{ type: "link", attrs: { href: { untrusted: true } } }],
    toAllowedHref: ({ rawHref }) => { calls.push(rawHref); return '/allowed?a="&b'; },
  }), '<a href="/allowed?a=&quot;&amp;b">x</a>');
  assert.deepEqual(calls, [{ untrusted: true }]);
});

test("all five CSS declarations retain their fixed order in one span", () => {
  assert.equal(renderMarks({ text: "t", marks: [{ type: "textStyle", attrs: {
    color: "#ff0000", backgroundColor: "#00ff00", fontFamily: "Georgia, serif", fontSize: "18px", lineHeight: "1.4",
  } }], toAllowedHref }), '<span style="color:#ff0000;background-color:#00ff00;font-family:Georgia, serif;font-size:18px;line-height:1.4">t</span>');
});

test("rejected CSS siblings preserve valid declarations", () => {
  assert.equal(renderMarks({ text: "t", marks: [{ type: "textStyle", attrs: {
    color: "#ff0000", backgroundColor: "red; background-image:url(javascript:alert(1))",
    fontFamily: "</style><script>alert(1)</script>", fontSize: "16px; background:url(x)", lineHeight: "1.4",
  } }], toAllowedHref }), '<span style="color:#ff0000;line-height:1.4">t</span>');
});

test("allowed quoted font stacks still receive HTML escaping", () => {
  assert.equal(renderMarks({ text: "t", marks: [{ type: "textStyle", attrs: { fontFamily: '\"Courier New\", monospace' } }], toAllowedHref }),
    '<span style="font-family:&quot;Courier New&quot;, monospace">t</span>');
});

test("empty styles, missing marks and malformed record shapes preserve escaped text", () => {
  assert.equal(renderMarks({ text: "<&", marks: undefined, toAllowedHref }), "&lt;&amp;");
  assert.equal(renderMarks({ text: "t", marks: [null, [], { type: "textStyle", attrs: [] }, { type: "highlight", attrs: { color: "red;x" } }], toAllowedHref }), "<mark>t</mark>");
});
