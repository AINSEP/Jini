import assert from "node:assert/strict";
import { test } from "vitest";
import { deriveHtmlForm } from "../html/html-authoring.js";
import { htmlSubmissionDefinition } from "../html/html-submission-adapter.js";
import { validateFieldDescriptors, validateSubmissionPayload } from "../forms.js";
import { FormSubmissionValidationError } from "../errors.js";
import { createFormSubmitHandler } from "../express/handler.js";
import type { FormDefinitionRecord } from "../types.js";
import type { HtmlFormDefinitionRecord } from "../fields-json.js";
import { renderHtmlForm } from "../html-render.js";
import { toDefinitionRecord, toDefinitionRow, type FormDefinitionRow } from "../sql/repo.rows.js";
import type { Request, Response } from "express";

const baseDefinition: FormDefinitionRecord = {
  id: "form", workspaceId: "ws", name: "Common", slug: "common", fields: [],
  notify: { enabled: false, recipients: [] }, status: "active", version: 1,
  createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z",
};

test("HTML URL controls retain URL validation and use text controls for domains and handles", () => {
  for (const input of ['<input type="url" name="website">', '<input type="text" inputmode="url" name="website">']) {
    const authored = deriveHtmlForm({ html: input });
    assert.equal(authored.fields[0]?.type, "url");
    assert.ok(!authored.html.includes('type="url"'));
    for (const attribute of ['type="text"', 'inputmode="url"', 'autocomplete="url"', 'spellcheck="false"', 'autocapitalize="off"']) assert.ok(authored.html.includes(attribute), attribute);
    const definition = { ...baseDefinition, ...authored };
    for (const website of ["aui.la", "tovu.dev", "@name", "http://example.com"]) assert.deepEqual(validateSubmissionPayload({ definition, body: { website } }), { valid: true, data: { website } });
    for (const website of ["hello", "javascript:alert(1)", "example.com/a b"]) assert.deepEqual(validateSubmissionPayload({ definition, body: { website } }), { valid: false, fieldErrors: [{ field: "website", reason: "invalid_url" }] });
    assert.equal(deriveHtmlForm({ html: authored.html }).fields[0]?.type, "url");
  }
  assert.equal(deriveHtmlForm({ html: '<input type="text" name="plain">' }).fields[0]?.type, "text");
});

test("a stored legacy type=url control renders as a text control, so the browser accepts bare domains", () => {
  const stored = { ...baseDefinition, mode: "html" as const, html: '<label>Site <input type="URL" name="website" required placeholder="https://"></label>', fields: [{ id: "website", label: "Site", type: "url" as const, required: true }] };
  const read = toDefinitionRecord(toDefinitionRow(stored) as FormDefinitionRow) as HtmlFormDefinitionRecord;
  const input = renderHtmlForm({ slug: "common", action: "/submit", fields: read.fields, hooks: { field: "f", form: "fm", success: "s", error: "e" } }, { html: read.html ?? "" }).match(/<input[^>]*name="website"[^>]*>/)?.[0] ?? "";
  for (const attribute of ['type="text"', 'inputmode="url"', 'autocomplete="url"', 'spellcheck="false"', 'autocapitalize="off"', "required", 'placeholder="https://"']) assert.ok(input.includes(attribute), attribute);
  assert.ok(!/type="url"/i.test(input));
  const plain = { ...stored, html: '<input type="text" name="website">' };
  assert.equal((toDefinitionRecord(toDefinitionRow(plain) as FormDefinitionRow) as HtmlFormDefinitionRecord).html, plain.html);
});

test("HTML authoring derives typed dropdowns, arrays and group option allowlists from real controls", () => {
  const authored = deriveHtmlForm({ html: '<label>Topic<select name="topic" required><option value="">Choose</option><option value="sales">Sales</option></select></label><select name="many" multiple><option value="help">Help</option></select><label>Yes<input type="radio" name="radio" value="yes" required></label><label>No<input type="radio" name="radio" value="no"></label><label>A<input type="checkbox" name="group" value="a"></label><label>B<input type="checkbox" name="group" value="b"></label><input type="tel" name="phone"><input type="datetime-local" name="when"><input type="file" name="file" accept="image/*">' });
  assert.deepEqual(authored.fields.map(({ type }) => type), ["select", "multi-select", "radio", "checkbox-group", "phone", "datetime", "file"]);
  assert.deepEqual(validateFieldDescriptors({ fields: authored.fields }), { valid: true });
  const definition = { ...baseDefinition, ...authored };
  assert.equal(validateSubmissionPayload({ definition, body: { topic: "sales", radio: "yes", many: ["help"], group: ["a", "b"] } }).valid, true);
  assert.equal(validateSubmissionPayload({ definition, body: { topic: "unlisted", radio: "yes" } }).valid, false);
  assert.equal(validateSubmissionPayload({ definition, body: { topic: "sales", radio: "unlisted" } }).valid, false);
});
test("HTML compatibility adapter preserves checkbox type so unlisted authored values are refused", () => {
  const definition = { ...baseDefinition, ...deriveHtmlForm({ html: '<input type="checkbox" name="consent" value="yes" required>' }) };
  const view = htmlSubmissionDefinition({ definition, body: { consent: "forged" } });
  assert.equal(view, definition);
  assert.equal(validateSubmissionPayload({ definition: view, body: { consent: "forged" } }).valid, false);
});
test("HTTP handler never truncates an oversized answer into an accepted value", async () => {
  const body = { message: "x".repeat(5001) }; let seen: unknown; let status = 0;
  const handler = createFormSubmitHandler({ workspaceId: "ws", definitionRepo: { findBySlug: async () => null }, submit: async ({ input }) => { seen = input.body; throw new FormSubmissionValidationError({ message: "too long", fieldErrors: [{ field: "message", reason: "too_long" }] }); }, resolveClientIp: () => "127.0.0.1", isHttpsRequest: () => false, targetRefusalReason: () => null, resultCodec: { encodeResultQuery: () => [], clearResultQueryParams() {}, encodeFlashCookie: () => undefined, flashCookieName: "flash" } });
  await handler({ params: { slug: "common" }, body, get: () => "application/json" } as unknown as Request, { status(value: number) { status = value; return this; }, json() {} } as unknown as Response);
  assert.equal((seen as typeof body).message.length, 5001); assert.equal(status, 400);
});
