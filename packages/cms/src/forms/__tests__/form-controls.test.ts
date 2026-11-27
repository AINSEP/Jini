import assert from "node:assert/strict";
import { test } from "vitest";
import type { FieldDescriptor } from "../types.js";
import { renderFormSuccessSlot, renderFormErrorSlot, injectFormAttemptTokens, stampFormFieldMaxLengths } from "../form-controls.js";

test("slots retain generic and legacy hooks with their pre-escaped values verbatim", () => {
  assert.equal(renderFormSuccessSlot({ slug: "s&amp;x", className: "form-success", message: "Thanks &amp; bye" },
    { extraClasses: "legacy-success", extraAttrs: 'data-legacy="s"' }),
    '<div class="form-success legacy-success" data-form-slug="s&amp;x" data-legacy="s" hidden>Thanks &amp; bye</div>');
  assert.equal(renderFormErrorSlot({ slug: "s", className: "form-error" }, { extraClasses: "legacy-error", extraAttrs: 'data-legacy="s"' }),
    '<div class="form-error legacy-error" data-form-slug="s" data-legacy="s" hidden></div>');
  assert.equal(renderFormSuccessSlot({ slug: "s", className: "form-success", message: "Thanks" }), '<div class="form-success" data-form-slug="s" hidden>Thanks</div>');
  assert.equal(renderFormErrorSlot({ slug: "s", className: "form-error" }), '<div class="form-error" data-form-slug="s" hidden></div>');
});

test("Builder and authored forms receive their own escaped token as the first child in document order", () => {
  const calls: string[] = [];
  const html = '<main><form class="form" data-form-slug="contact"><div>first</div></form><form data-host-form="signup" data-form-slug="signup"><input name="email"></form><form action="/search"><input name="q"></form></main>';
  assert.equal(injectFormAttemptTokens({ html, newToken: ({ slug }) => { calls.push(slug); return `${slug}\"<&`; } }),
    '<main><form class="form" data-form-slug="contact"><input type="hidden" name="_attempt" value="contact&quot;&lt;&amp;"><div>first</div></form><form data-host-form="signup" data-form-slug="signup"><input type="hidden" name="_attempt" value="signup&quot;&lt;&amp;"><input name="email"></form><form action="/search"><input name="q"></form></main>');
  assert.deepEqual(calls, ["contact", "signup"]);
});

test("ordinary HTML is unchanged and token generation errors propagate", () => {
  const html = '<p>no forms</p><form action="/search"><input name="q"></form>';
  assert.equal(injectFormAttemptTokens({ html, newToken: () => assert.fail("unexpected token") }), html);
  const error = new Error("token generation failed");
  assert.throws(() => injectFormAttemptTokens({ html: '<form data-form-slug="s"></form>', newToken: () => { throw error; } }), (thrown) => thrown === error);
});

const fields: FieldDescriptor[] = [
  { id: "name", label: "Name", type: "text", required: true },
  { id: "note", label: "Note", type: "textarea", required: false },
  { id: "nick", label: "Nick", type: "text", required: false, maxLength: 20 },
  { id: "ref", label: "Ref", type: "hidden", required: false },
];
const fieldMaxChars = ({ field }: { field: FieldDescriptor }) => field.type === "hidden" ? undefined : field.maxLength ?? (field.type === "textarea" ? 2000 : 100);

test("maxlength stamping preserves authored values, control closure and hidden/unknown inputs", () => {
  const html = '<input type="text" name="name"/><textarea name="note"></textarea><input name="nick" maxlength="7"><input type="hidden" name="ref"><input name="other">';
  assert.equal(stampFormFieldMaxLengths({ html, fields, fieldMaxChars }),
    '<input type="text" name="name" maxlength="100"/><textarea name="note" maxlength="2000"></textarea><input name="nick" maxlength="7"><input type="hidden" name="ref"><input name="other">');
});

test("descriptor checks skip null and primitive entries before asking the cap port", () => {
  const calls: string[] = [];
  const rawFields = [null, 1, ...fields] as unknown as FieldDescriptor[];
  assert.equal(stampFormFieldMaxLengths({ html: '<input name="name">', fields: rawFields,
    fieldMaxChars: ({ field }) => { calls.push(field.id); return undefined; },
  }), '<input name="name">');
  assert.deepEqual(calls, ["name", "note", "nick", "ref"]);
});

test("does not add the server cap to unnamed controls or capped fields rendered as hidden", () => {
  const html = '<input type="text"><input name="name" type="hidden"><input name="name" type="text">';
  assert.equal(stampFormFieldMaxLengths({ html, fields, fieldMaxChars }),
    '<input type="text"><input name="name" type="hidden"><input name="name" type="text" maxlength="100">');
});
