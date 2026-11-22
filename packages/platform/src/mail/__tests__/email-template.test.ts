import assert from "node:assert/strict";
import { test } from "vitest";

import {
  emailHtmlToText,
  emailTemplateSkeleton,
  escapeHtml,
  fillPlaceholders,
  formatFieldDeclarations,
  parseFieldDeclarations,
  placeholdersIn,
  previewValues,
  readTemplateDeclarations,
  renderEmailForSend,
  renderEmailPreview,
  sanitizeEmailHtml,
  undeclaredFieldsIn,
} from "../email-template.js";

const TEMPLATE = `<!doctype html><html><head>
<meta name="email-fields" content="name=Ada, orderId">
<title>Order {{orderId}} for {{name}}</title></head>
<body><p>Hi {{name}}, order {{orderId}} {{extra}}.</p><a href="{{url}}">Track</a>
<script>alert(1)</script></body></html>`;

test("placeholdersIn lists each field once, in first-use order, tolerating inner spaces", () => {
  assert.deepEqual(placeholdersIn({ text: "{{ b }} {{a}} {{b}} {{ not valid }} {{x.y-z}}" }), ["b", "a", "x.y-z"]);
});

test("escapeHtml escapes text and quoted-attribute metacharacters", () => {
  assert.equal(escapeHtml({ value: `<a href="x">'&'</a>` }), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

test("fillPlaceholders escapes given values, renders unknown fields empty and reports them once", () => {
  const filled = fillPlaceholders({ text: "{{a}}|{{b}}|{{b}}", values: { a: "<x>" }, escape: escapeHtml });
  assert.deepEqual(filled, { text: "&lt;x&gt;||", missingFields: ["b"] });
});

test("fillPlaceholders does not treat inherited object keys as values", () => {
  assert.deepEqual(fillPlaceholders({ text: "{{toString}}", values: {}, escape: ({ value: v }) => v }), { text: "", missingFields: ["toString"] });
});

test("field declarations parse names and samples, drop malformed names, first declaration wins", () => {
  assert.deepEqual(parseFieldDeclarations({ content: " name = Ada Lovelace, orderId, 9bad, , name=Other, url=" }), [
    { name: "name", sample: "Ada Lovelace" },
    { name: "orderId" },
    { name: "url", sample: "" },
  ]);
});

test("formatFieldDeclarations round-trips through parseFieldDeclarations", () => {
  const fields = [{ name: "name", sample: "Ada" }, { name: "orderId" }];
  const content = formatFieldDeclarations({ fields });
  assert.equal(content, "name=Ada, orderId");
  assert.deepEqual(parseFieldDeclarations({ content }), fields);
});

test("readTemplateDeclarations reads the first <title> and the first email-fields meta", () => {
  const html = `<html><head><meta charset="utf-8"><meta name="description" content="x"><meta content="no name">
<meta name="EMAIL-FIELDS" content="a"><meta name="email-fields" content="b"><title> Hi &amp; {{a}} </title></head>
<body><svg><title>svg tooltip</title></svg><title>second</title></body></html>`;
  assert.deepEqual(readTemplateDeclarations({ html }), { subject: "Hi & {{a}}", fields: [{ name: "a" }] });
});

test("readTemplateDeclarations defaults: no title is an empty subject; a meta without content declares nothing", () => {
  assert.deepEqual(readTemplateDeclarations({ html: '<p>x</p><meta name="email-fields">' }), { subject: "", fields: [] });
});

test("undeclaredFieldsIn names placeholders the meta does not declare", () => {
  assert.deepEqual(undeclaredFieldsIn({ html: TEMPLATE, declarations: readTemplateDeclarations({ html: TEMPLATE }) }), ["extra", "url"]);
});

test("previewValues: declared samples, overridden by given values; a field without a sample adds nothing", () => {
  const declarations = readTemplateDeclarations({ html: TEMPLATE });
  assert.deepEqual(previewValues({ declarations, values: {} }), { name: "Ada" });
  assert.deepEqual(previewValues({ declarations, values: { name: "Grace", orderId: "7" } }), { name: "Grace", orderId: "7" });
});

test("renderEmailPreview fills samples, keeps scripts, and reports what is still missing", () => {
  const preview = renderEmailPreview({ html: TEMPLATE, values: { orderId: "A-1" } });
  assert.equal(preview.subject, "Order A-1 for Ada");
  assert.match(preview.html, /<p>Hi Ada, order A-1 \.<\/p>/);
  assert.match(preview.html, /<script>alert\(1\)<\/script>/);
  assert.deepEqual(preview.missingFields, ["extra", "url"]);
});

test("renderEmailForSend: static html, no samples, subject unescaped and on one line, text alternative", () => {
  const sent = renderEmailForSend({ html: TEMPLATE, values: { name: "Tom & <Jerry>\r\nBcc: x@y", orderId: "9", url: "https://example.test/t" } });
  assert.equal(sent.subject, "Order 9 for Tom & <Jerry> Bcc: x@y");
  assert.doesNotMatch(sent.html, /script|email-fields/);
  assert.match(sent.html, /Hi Tom &amp; &lt;Jerry&gt;/);
  assert.match(sent.html, /<a href="https:\/\/example.test\/t">Track<\/a>/);
  assert.deepEqual(sent.missingFields, ["extra"]);
  // The value's own line break survives into the text part, where it is harmless.
  assert.equal(sent.text, "Hi Tom & <Jerry>\nBcc: x@y, order 9 .\nTrack (https://example.test/t)");
});

test("renderEmailForSend reports a field missing from the subject only", () => {
  assert.deepEqual(renderEmailForSend({ html: "<title>{{s}}</title><p>b</p>", values: {} }).missingFields, ["s"]);
});

test("renderEmailForSend removes a script URL smuggled in through a field value", () => {
  const sent = renderEmailForSend({ html: TEMPLATE, values: { name: "a", orderId: "1", url: "java\nscript:alert(1)" } });
  assert.match(sent.html, /<a>Track<\/a>/);
});

test("sanitizeEmailHtml strips handlers, script URLs (even obfuscated), embeds and comments but keeps styles", () => {
  const html = sanitizeEmailHtml({ html: `<html><head><style>p{color:red}</style></head><body>
<p onclick="x()" style="color:blue" class="c">a</p><a href=" javascript:x()">j</a><a href="VBScript:x">v</a>
<img src="java&#x09;script:x" alt="i"><iframe src="https://x"></iframe><object data="x"></object><embed src="x">
<!-- secret --><noscript>n</noscript><template>t</template><div><frameset></frameset></div></body></html>` });
  assert.match(html, /<style>p\{color:red\}<\/style>/);
  assert.match(html, /<p style="color:blue" class="c">a<\/p>/);
  assert.match(html, /<a>j<\/a><a>v<\/a>/);
  assert.match(html, /<img alt="i">/);
  assert.doesNotMatch(html, /iframe|object|embed|secret|noscript|template|onclick|frameset/);
});

test("emailHtmlToText writes link targets after their text, except when the text is already the URL", () => {
  const text = emailHtmlToText({ html: `<p><a href="https://a.test">Site</a> <a href="mailto:me@a.test">Mail</a>
<a href="https://b.test">https://b.test</a> <a href="/relative">Rel</a> <a>None</a> <a href="https://c.test"><b>Bold</b></a></p>` });
  assert.equal(text, "Site (https://a.test) Mail (me@a.test)\nhttps://b.test Rel None Bold (https://c.test)");
});

test("emailTemplateSkeleton declares fields, greets with the first one, and escapes the subject", () => {
  const html = emailTemplateSkeleton({ subject: "Hi <you>", fields: [{ name: "name", sample: "A\"da" }, { name: "code" }] });
  assert.deepEqual(readTemplateDeclarations({ html }), { subject: "Hi <you>", fields: [{ name: "name", sample: 'A"da' }, { name: "code" }] });
  assert.match(html, /<p>Hello \{\{name\}\},<\/p>/);
});

test("emailTemplateSkeleton without fields has no fields meta and a plain greeting", () => {
  const html = emailTemplateSkeleton({ subject: "S", fields: [] });
  assert.doesNotMatch(html, /email-fields/);
  assert.match(html, /<p>Hello,<\/p>/);
});

test("an empty first fields declaration wins over a later nonempty declaration", () => {
  assert.deepEqual(readTemplateDeclarations({ html: '<head><meta name="email-fields" content=""><meta name="email-fields" content="name=Ada"></head>' }).fields, []);
});

test("the starter contains a real newline and no visible backslash-n text", () => {
  const html = emailTemplateSkeleton({ subject: "Welcome", fields: [{ name: "name", sample: "Ada" }] });
  assert.ok(html.includes('\n<meta name="email-fields"'));
  const sent = renderEmailForSend({ html, values: { name: "Ada" } }); assert.equal(sent.text, "Hello Ada,"); assert.doesNotMatch(sent.text, /\\n/);
});


test("send sanitizer removes active data URLs, navigation, forms and linked styles but keeps inline images", () => {
  const html = `<html><head><base href="https://attacker.test/"><meta http-equiv="refresh" content="0;url=javascript:alert(1)"><link rel="stylesheet" href="https://attacker.test/x.css"><meta name="viewport" content="width=device-width"></head><body><form action="https://attacker.test"><input name="secret"></form><a href="data:text/html,evil">bad</a><a href="d&#x09;ata:text/html,evil">obfuscated</a><img src="data:image/png;base64,AAAA"><style>p{color:red}</style><p>kept</p></body></html>`;
  const safe = sanitizeEmailHtml({ html });
  assert.doesNotMatch(safe, /<base|http-equiv|<link|<form|<input|data:text|attacker\.test/i);
  assert.match(safe, /data:image\/png;base64,AAAA/);
  assert.match(safe, /name="viewport"/); assert.match(safe, /<style>/); assert.match(safe, /<p>kept<\/p>/);
});
