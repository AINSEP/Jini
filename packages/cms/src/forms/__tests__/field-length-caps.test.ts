/** Public form length caps (owner 2026-10-25): the submit path refuses over-long text per field. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { FormSubmissionValidationError, InMemoryFormSubmissionRepo, type FieldDescriptor, type FormDefinitionRecord } from "../index.js";
import { FORM_LONG_TEXT_MAX_CHARS, FORM_TEXT_MAX_CHARS, fieldMaxChars, capSubmissionFieldLengths } from "../field-length-caps.js";
import { submitForm } from "../index.js";

const FIELDS: FieldDescriptor[] = [
  { id: "name", label: "Name", type: "text", required: false },
  { id: "message", label: "Message", type: "textarea", required: false },
  { id: "code", label: "Code", type: "text", required: false, maxLength: 5 },
  { id: "bio", label: "Bio", type: "text", required: false, maxLength: 300 },
  { id: "topic", label: "Topic", type: "select", required: false, options: [{ value: "sales", label: "Sales" }] },
];

function submitter() {
  const definition: FormDefinitionRecord = { id: "def-1", workspaceId: "ws", name: "Contact", slug: "contact", fields: FIELDS, status: "active", version: 1, notify: { enabled: false, recipients: [] }, createdAt: "t", updatedAt: "t" };
  let id = 0;
  const deps: Parameters<typeof submitForm>[0]["deps"] = {
    crypto: globalThis.crypto, // the Jini submit-form deps take the crypto port explicitly
    definitionRepo: { findBySlug: async () => definition, findById: async () => definition, list: async () => [definition], create: async () => {}, update: async () => {}, isSlugTaken: async () => false }, submissionRepo: new InMemoryFormSubmissionRepo(),
    clock: { nowMs: () => 1000 }, idGen: { newId: () => `id-${++id}` },
    outbox: { enqueue: async () => {} }, dispatcher: { dispatch: async () => {} }, logger: { warn: () => {} },
    rateLimiter: { check: async () => ({ allowed: true as const }) },
  };
  return (body: Record<string, unknown>) => submitForm({ deps, input: { workspaceId: "ws", slug: "contact", sourceIp: "127.0.0.1", body } }, { definitionView: capSubmissionFieldLengths });
}

async function fieldErrors(submit: ReturnType<typeof submitter>, body: Record<string, unknown>) {
  try {
    await submit(body);
    return [];
  } catch (error) {
    assert.ok(error instanceof FormSubmissionValidationError, String(error));
    return error.fieldErrors;
  }
}

test("defaults: one-line text 100, long text 2000, non-text uncapped; a field's own maxLength wins", () => {
  assert.equal(FORM_TEXT_MAX_CHARS, 100);
  assert.equal(FORM_LONG_TEXT_MAX_CHARS, 2000);
  for (const type of ["text", "email", "phone", "url"] as const) assert.equal(fieldMaxChars({ field: { type } }), 100);
  assert.equal(fieldMaxChars({ field: { type: "textarea" } }), 2000);
  assert.equal(fieldMaxChars({ field: { type: "hidden" } }), 2000);
  assert.equal(fieldMaxChars({ field: { type: "select" } }), undefined);
  assert.equal(fieldMaxChars({ field: { type: "text", maxLength: 7 } }), 7);
});

test("server accepts text exactly at the cap and refuses one character over with too_long", async () => {
  const submit = submitter();
  assert.deepEqual(await fieldErrors(submit, { name: "a".repeat(100), message: "m".repeat(2000) }), []);
  assert.deepEqual(await fieldErrors(submit, { name: "a".repeat(101), message: "m".repeat(2001) }), [
    { field: "name", reason: "too_long" }, { field: "message", reason: "too_long" },
  ]);
});

test("emoji count as one character each (code points, not UTF-16 units)", async () => {
  const submit = submitter();
  assert.deepEqual(await fieldErrors(submit, { name: "😀".repeat(100), message: "🎉".repeat(2000) }), []);
  assert.deepEqual(await fieldErrors(submit, { name: "😀".repeat(101) }), [{ field: "name", reason: "too_long" }]);
  assert.deepEqual(await fieldErrors(submit, { name: `${"a".repeat(99)}😀😀` }), [{ field: "name", reason: "too_long" }]);
});

test("a per-field maxLength overrides the default in both directions", async () => {
  const submit = submitter();
  assert.deepEqual(await fieldErrors(submit, { code: "12345", bio: "b".repeat(300) }), []);
  assert.deepEqual(await fieldErrors(submit, { code: "123456", bio: "b".repeat(301) }), [
    { field: "code", reason: "too_long" }, { field: "bio", reason: "too_long" },
  ]);
});

test("choice fields keep their option check and are not length-capped", async () => {
  const submit = submitter();
  assert.deepEqual(await fieldErrors(submit, { topic: "sales" }), []);
  assert.deepEqual(await fieldErrors(submit, { topic: "x".repeat(101) }), [{ field: "topic", reason: "invalid_option" }]);
});
