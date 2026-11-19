import assert from "node:assert/strict";
import { test } from "vitest";
import { injectFormSubmissionResultIntoHtml } from "../result-html.js";

const markup = { successClass: "form-success", errorClass: "form-error", fieldErrorClass: "field-error",
  hooks: { form: "data-host-form", success: "data-host-success", error: "data-host-error" } };
const feedback = {
  validationMessages: ({ errors }: { html: string; formHtml: string; errors: ReadonlyArray<{ field: string; reason: string }> }) => errors.map(({ field }) => ({ field, message: `Check ${field || "this field"} <& $& $1 $$.` })),
  validationSummary: "Fix the fields.", tooFast: "Wait, then submit again.",
  rateLimited: ({ retryAfterSeconds }: { retryAfterSeconds: number }) => `Retry in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`,
  error: "Try again.",
};
const builder = '<div class="form-success legacy" data-form-slug="s" hidden>Thanks $&</div><form class="form" data-form-slug="s"><div class="form-error" data-form-slug="s" hidden></div><div class="field-error" data-field="name" hidden></div><input name="name" value="old"></form>';
const authored = '<div data-host-success data-form-slug="s" hidden>Thanks</div><form data-host-form="s" data-form-slug="s"><div data-host-error data-form-slug="s" hidden></div><input name="name"></form>';

test("success reveals both slot shapes and hides only the first same-slug form", () => {
  assert.equal(injectFormSubmissionResultIntoHtml({ html: builder + builder, result: { kind: "success", slug: "s" }, markup, feedback }),
    '<div class="form-success legacy" data-form-slug="s">Thanks $&</div><form hidden class="form" data-form-slug="s"><div class="form-error" data-form-slug="s" hidden></div><div class="field-error" data-field="name" hidden></div><input name="name" value="old"></form>' + builder);
  assert.equal(injectFormSubmissionResultIntoHtml({ html: authored, result: { kind: "success", slug: "s" }, markup, feedback }),
    '<div data-host-success data-form-slug="s">Thanks</div><form hidden data-host-form="s" data-form-slug="s"><div data-host-error data-form-slug="s" hidden></div><input name="name"></form>');
});

test("undefined results and a foreign slug leave every byte unchanged", () => {
  assert.equal(injectFormSubmissionResultIntoHtml({ html: builder, result: undefined, markup, feedback }), builder);
  assert.equal(injectFormSubmissionResultIntoHtml({ html: builder, result: { kind: "error", slug: "foreign" }, markup, feedback }), builder);
});

test("Builder validation escapes field errors and restores values without a second value or replacement expansion", () => {
  assert.equal(injectFormSubmissionResultIntoHtml({ html: builder, result: { kind: "validation", slug: "s",
    fieldErrors: [{ field: "name", reason: "required" }], values: { name: '$& $1 $$ <&"' } }, markup, feedback }),
    '<div class="form-success legacy" data-form-slug="s" hidden>Thanks $&</div><form class="form" data-form-slug="s"><div class="form-error" data-form-slug="s">Fix the fields.</div><div class="field-error" data-field="name">Check name &lt;&amp; $& $1 $$.</div><input name="name" value="$& $1 $$ &lt;&amp;&quot;"></form>');
});

test("authored validation lists messages in order; empty errors get the fallback entry", () => {
  assert.equal(injectFormSubmissionResultIntoHtml({ html: authored, result: { kind: "validation", slug: "s",
    fieldErrors: [{ field: "name", reason: "required" }, { field: "email", reason: "invalid" }] }, markup, feedback }),
    '<div data-host-success data-form-slug="s" hidden>Thanks</div><form data-host-form="s" data-form-slug="s"><div data-host-error data-form-slug="s">Check name &lt;&amp; $& $1 $$. Check email &lt;&amp; $& $1 $$.</div><input name="name"></form>');
  const calls: unknown[] = [];
  injectFormSubmissionResultIntoHtml({ html: authored, result: { kind: "validation", slug: "s", fieldErrors: [] }, markup,
    feedback: { ...feedback, validationMessages: (input) => { calls.push(input); return feedback.validationMessages(input); } } });
  assert.deepEqual(calls, [{ html: authored, formHtml: authored.slice(authored.indexOf("<form")), errors: [{ field: "", reason: "invalid" }] }]);
});

test("restoration preserves other quote styles, data attributes, textarea content and input closure", () => {
  const form = `<form data-form-slug="s"><input name="a" value='old'><input name="b" value="Don't know"><input name="c" data-default-value="keep"/><textarea name="d">old</textarea></form>`;
  assert.equal(injectFormSubmissionResultIntoHtml({ html: form, result: { kind: "too-fast", slug: "s", values: { a: "$&", b: "$1", c: "$$", d: "<& $&" } }, markup, feedback }),
    '<form data-form-slug="s"><input name="a" value="$&"><input name="b" value="$1"><input name="c" data-default-value="keep" value="$$"/><textarea name="d">&lt;&amp; $&</textarea></form>');
});

test("timing, rate-limit and error outcomes use the supplied copy without disturbing other content", () => {
  for (const [result, message] of [
    [{ kind: "too-fast", slug: "s" }, "Wait, then submit again."],
    [{ kind: "rate-limited", slug: "s", retryAfterSeconds: 1 }, "Retry in 1 second."],
    [{ kind: "rate-limited", slug: "s", retryAfterSeconds: 2 }, "Retry in 2 seconds."],
    [{ kind: "error", slug: "s" }, "Try again."],
  ] as const) assert.equal(injectFormSubmissionResultIntoHtml({ html: authored, result, markup, feedback }),
    `<div data-host-success data-form-slug="s" hidden>Thanks</div><form data-host-form="s" data-form-slug="s"><div data-host-error data-form-slug="s">${message}</div><input name="name"></form>`);
});
