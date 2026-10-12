import assert from "node:assert/strict";
import { test } from "vitest";
import { deriveHtmlForm } from "../html/html-authoring.js";
import { htmlSubmissionDefinition } from "../html/html-submission-adapter.js";
import { validateFieldDescriptors, validateSubmissionPayload } from "../forms.js";
import { FormSubmissionValidationError } from "../errors.js";
import { createFormSubmitHandler } from "../express/handler.js";
import type { FormDefinitionRecord } from "../types.js";
import type { Request, Response } from "express";

const baseDefinition: FormDefinitionRecord = {
  id: "form", workspaceId: "ws", name: "Common", slug: "common", fields: [],
  notify: { enabled: false, recipients: [] }, status: "active", version: 1,
  createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z",
};

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
