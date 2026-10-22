import assert from "node:assert/strict";
import { test } from "vitest";
import { renderHtmlForm, renderHtmlFormBody } from "../html-render.js";

test("URL controls accept scheme-less typing and keep URL keyboard hints on the input", () => {
  const body = renderHtmlFormBody({ fields: [{ id: "website", label: "Website", type: "url", required: false, default: "aui.la", attributes: { inputmode: "email", autocomplete: "off", spellcheck: "true", "data-hint": "<site>" } }], hooks: { field: "data-tovu-field" } });
  const input = body.match(/<input[^>]*>/)?.[0] ?? "";
  for (const attribute of ['type="text"', 'inputmode="url"', 'autocomplete="url"', 'spellcheck="false"', 'autocapitalize="off"', 'value="aui.la"', 'data-hint="&lt;site&gt;"']) assert.ok(input.includes(attribute), attribute);
  for (const attribute of ["inputmode", "autocomplete", "spellcheck", "autocapitalize"]) assert.equal(input.match(new RegExp(` ${attribute}=`, "g"))?.length, 1, attribute);
  assert.ok(!input.includes('type="url"'));
});

test("nonempty generated bodies render input and textarea with the host's field hook", () => {
  const fields = [
    { id: "name", label: "Name & title", type: "text" as const, required: true, maxLength: 80 },
    { id: "message", label: "Message", type: "textarea" as const, required: false },
  ];
  const body = renderHtmlFormBody({ fields, hooks: { field: "data-tovu-field" } }, {});
  assert.match(body, /<label for="form-name">Name &amp; title \*<\/label>/);
  assert.match(body, /<input type="text" id="form-name" name="name" data-tovu-field="name" toolparamtitle="Name &amp; title" toolparamdescription="Name &amp; title" aria-describedby="form-name-error" required maxlength="80">/);
  assert.match(body, /<label for="form-message">Message<\/label><textarea id="form-message" name="message" data-tovu-field="message" toolparamtitle="Message" toolparamdescription="Message" aria-describedby="form-message-error"><\/textarea>/);
  assert.match(body, /<button type="submit">Send<\/button>$/);
  const form = renderHtmlForm({ slug: "contact", fields, action: "/forms/contact/submit", hooks: {
    field: "data-tovu-field", form: "data-tovu-form", success: "data-tovu-form-success", error: "data-tovu-form-error",
  } }, {});
  assert.ok(form.includes(renderHtmlFormBody({ fields, hooks: { field: "data-tovu-field" } }, { idPrefix: "form-contact" })));
  assert.ok(form.includes('method="post" action="/forms/contact/submit"'));
  assert.ok(form.includes('name="_hp"'));
});
