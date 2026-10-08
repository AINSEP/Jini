import assert from "node:assert/strict";
import { test } from "vitest";
import { renderHtmlForm, renderHtmlFormBody } from "../html-render.js";

test("nonempty generated bodies render input and textarea with the host's field hook", () => {
  const fields = [
    { id: "name", label: "Name & title", type: "text" as const, required: true, maxLength: 80 },
    { id: "message", label: "Message", type: "textarea" as const, required: false },
  ];
  const body = renderHtmlFormBody({ fields, hooks: { field: "data-tovu-field" } }, {});
  assert.equal(body,
    '<label>Name &amp; title<input type="text" name="name" data-tovu-field="name" toolparamtitle="Name &amp; title" toolparamdescription="Name &amp; title" required maxlength="80"></label>\n' +
    '<label>Message<textarea name="message" data-tovu-field="message" toolparamtitle="Message" toolparamdescription="Message"></textarea></label>\n' +
    '<button type="submit">Send</button>');
  const form = renderHtmlForm({ slug: "contact", fields, action: "/forms/contact/submit", hooks: {
    field: "data-tovu-field", form: "data-tovu-form", success: "data-tovu-form-success", error: "data-tovu-form-error",
  } }, {});
  assert.ok(form.includes(body));
  assert.ok(form.includes('method="post" action="/forms/contact/submit"'));
  assert.ok(form.includes('name="_hp"'));
});
