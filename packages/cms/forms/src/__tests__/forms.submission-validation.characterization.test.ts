
import assert from "node:assert/strict";
import { test } from "vitest";

import { validateSubmissionPayload } from "../forms.js";
import type { FormDefinitionRecord } from "../types.js";

const NOW = "2026-07-13T00:00:00.000Z";

function definition(overrides: Partial<FormDefinitionRecord> = {}): FormDefinitionRecord {
  return {
    id: "def-1",
    workspaceId: "ws-1",
    name: "Contact",
    slug: "contact",
    fields: [
      { id: "name", label: "Name", type: "text", required: true },
      { id: "email", label: "Email", type: "email", required: true },
      { id: "message", label: "Message", type: "textarea", required: false, maxLength: 100 },
      { id: "subscribe", label: "Subscribe", type: "checkbox", required: false },
    ],
    notify: { enabled: false, recipients: [] },
    status: "active",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function errorsOf(body: Record<string, unknown>, def: FormDefinitionRecord = definition()) {
  const result = validateSubmissionPayload({ definition: def, body });
  assert.equal(result.valid, false, "expected this body to be rejected");
  return result.valid === false ? result.fieldErrors : [];
}

// ---------------------------------------------------------------------------
// Exact reason codes.
// ---------------------------------------------------------------------------

test("validateSubmissionPayload: each rejecting branch reports its exact reason code", () => {
  assert.deepEqual(errorsOf({ name: "a", email: "b", nope: "x" }), [{ field: "nope", reason: "unregistered_key" }]);

  assert.deepEqual(errorsOf({ email: "b" }), [{ field: "name", reason: "required" }]);

  assert.deepEqual(errorsOf({ name: 42, email: "b" }), [{ field: "name", reason: "must be a string" }]);

  assert.deepEqual(errorsOf({ name: "a", email: "b", subscribe: "yes" }), [
    { field: "subscribe", reason: "must be a boolean" },
  ]);

  assert.deepEqual(errorsOf({ name: "a", email: "b", message: "x".repeat(101) }), [
    { field: "message", reason: "too_long" },
  ]);
});

// ---------------------------------------------------------------------------
// Absence: `null` and `undefined` are the same signal; requiredness decides.
// ---------------------------------------------------------------------------

test("validateSubmissionPayload: an explicit null is treated exactly like an omitted key", () => {
  assert.deepEqual(errorsOf({ name: null, email: "b" }), [{ field: "name", reason: "required" }]);

  const result = validateSubmissionPayload({ definition: definition(), body: { name: "a", email: "b", message: null } });
  assert.deepEqual(result, { valid: true, data: { name: "a", email: "b" } });
});

test("validateSubmissionPayload: an explicit undefined is treated exactly like an omitted key", () => {
  assert.deepEqual(errorsOf({ name: undefined, email: "b" }), [{ field: "name", reason: "required" }]);
});

test("validateSubmissionPayload: a required field present but whitespace-only is 'required', not accepted", () => {
  assert.deepEqual(errorsOf({ name: "   ", email: "b" }), [{ field: "name", reason: "required" }]);
});

test("validateSubmissionPayload: an OPTIONAL field may be the empty string — the trim check is gated on requiredness", () => {
  const result = validateSubmissionPayload({ definition: definition(), body: { name: "a", email: "b", message: "   " } });
  assert.deepEqual(result, { valid: true, data: { name: "a", email: "b", message: "   " } });
});

test("validateSubmissionPayload: a required checkbox submitted as false is accepted — false is a value, not an absence", () => {
  const def = definition({
    fields: [{ id: "agree", label: "Agree", type: "checkbox", required: true }],
  });
  const result = validateSubmissionPayload({ definition: def, body: { agree: false } });
  assert.deepEqual(result, { valid: true, data: { agree: false } });
});

test("validateSubmissionPayload: maxLength is enforced on optional fields too, and the boundary length is accepted", () => {
  assert.deepEqual(errorsOf({ name: "a", email: "b", message: "x".repeat(101) }), [
    { field: "message", reason: "too_long" },
  ]);
  const atLimit = validateSubmissionPayload({
    definition: definition(),
    body: { name: "a", email: "b", message: "x".repeat(100) },
  });
  assert.equal(atLimit.valid, true);
});

// ---------------------------------------------------------------------------
// Ordering and accumulation.
// ---------------------------------------------------------------------------

test("validateSubmissionPayload: every unregistered key is reported before any declared-field error", () => {
  assert.deepEqual(errorsOf({ zzz: "x", aaa: "y", subscribe: "not-a-boolean" }), [
    { field: "zzz", reason: "unregistered_key" },
    { field: "aaa", reason: "unregistered_key" },
    { field: "name", reason: "required" },
    { field: "email", reason: "required" },
    { field: "subscribe", reason: "must be a boolean" },
  ]);
});

test("validateSubmissionPayload: declared fields report in DEFINITION order, not body key order", () => {
  assert.deepEqual(errorsOf({ subscribe: 1, email: 2, name: 3 }), [
    { field: "name", reason: "must be a string" },
    { field: "email", reason: "must be a string" },
    { field: "subscribe", reason: "must be a boolean" },
  ]);
});

test("validateSubmissionPayload: each field contributes at most one error — a too-long required field is not also 'required'", () => {
  const def = definition({
    fields: [{ id: "note", label: "Note", type: "text", required: true, maxLength: 3 }],
  });
  assert.deepEqual(errorsOf({ note: "abcd" }, def), [{ field: "note", reason: "too_long" }]);
});

// ---------------------------------------------------------------------------
// The success shape. See docs/decisions/DR-001-anonymous-submission-containment.md.
// ---------------------------------------------------------------------------

test("validateSubmissionPayload: `_hp` is accepted as a key but never lands in `data`", () => {
  const result = validateSubmissionPayload({
    definition: definition(),
    body: { name: "a", email: "b", _hp: "bot-filled-this" },
  });
  assert.deepEqual(result, { valid: true, data: { name: "a", email: "b" } });
});

test("validateSubmissionPayload: absent optional fields are omitted from `data` rather than set to null/undefined", () => {
  const result = validateSubmissionPayload({ definition: definition(), body: { name: "a", email: "b" } });
  assert.equal(result.valid, true);
  assert.deepEqual(Object.keys(result.valid === true ? result.data : {}), ["name", "email"]);
});

test("validateSubmissionPayload: a fully-populated body returns every declared field in definition order", () => {
  const result = validateSubmissionPayload({
    definition: definition(),
    body: { subscribe: true, message: "hi", email: "e@x.test", name: "A" },
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.valid === true ? result.data : {}, {
    name: "A",
    email: "e@x.test",
    message: "hi",
    subscribe: true,
  });
  assert.deepEqual(Object.keys(result.valid === true ? result.data : {}), ["name", "email", "message", "subscribe"]);
});

test("validateSubmissionPayload: a rejected payload carries no `data` key at all", () => {
  const result = validateSubmissionPayload({ definition: definition(), body: { email: "b" } });
  assert.deepEqual(result, { valid: false, fieldErrors: [{ field: "name", reason: "required" }] });
});

test("validateSubmissionPayload: a definition with no declared fields accepts an empty body and rejects any key", () => {
  const empty = definition({ fields: [] });
  assert.deepEqual(validateSubmissionPayload({ definition: empty, body: {} }), { valid: true, data: {} });
  assert.deepEqual(errorsOf({ anything: "x" }, empty), [{ field: "anything", reason: "unregistered_key" }]);
});
