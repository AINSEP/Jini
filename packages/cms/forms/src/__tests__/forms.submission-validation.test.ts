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

test("validateSubmissionPayload: accepts a payload with all required fields present", () => {
  const result = validateSubmissionPayload({
    definition: definition(),
    body: { name: "Ada", email: "ada@example.com" },
  });
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.deepEqual(result.data, { name: "Ada", email: "ada@example.com" });
  }
});

test("validateSubmissionPayload: EC-01 — accepts a payload that omits every optional field", () => {
  const result = validateSubmissionPayload({
    definition: definition(),
    body: { name: "Ada", email: "ada@example.com" },
  });
  assert.equal(result.valid, true);
});

test("validateSubmissionPayload: AC-08/EC-02 — rejects a payload missing a required field, naming it", () => {
  const result = validateSubmissionPayload({
    definition: definition(),
    body: { name: "Ada" },
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.fieldErrors.some((e) => e.field === "email" && e.reason === "required"));
  }
});

test("validateSubmissionPayload: AC-09 — rejects a key not among the declared field ids", () => {
  const result = validateSubmissionPayload({
    definition: definition(),
    body: { name: "Ada", email: "ada@example.com", unregistered: "x" },
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.fieldErrors.some((e) => e.field === "unregistered" && e.reason === "unregistered_key"));
  }
});

test("validateSubmissionPayload: `_hp` is always accepted even though it is not a declared field", () => {
  const result = validateSubmissionPayload({
    definition: definition(),
    body: { name: "Ada", email: "ada@example.com", _hp: "" },
  });
  assert.equal(result.valid, true);
});

test("validateSubmissionPayload: AC-10 — rejects a value exceeding its field's declared maxLength", () => {
  const result = validateSubmissionPayload({
    definition: definition(),
    body: { name: "Ada", email: "ada@example.com", message: "x".repeat(101) },
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.fieldErrors.some((e) => e.field === "message" && e.reason === "too_long"));
  }
});

test("validateSubmissionPayload: accepts a value at exactly its field's declared maxLength", () => {
  const result = validateSubmissionPayload({
    definition: definition(),
    body: { name: "Ada", email: "ada@example.com", message: "x".repeat(100) },
  });
  assert.equal(result.valid, true);
});

test("validateSubmissionPayload: accepts a boolean value for a checkbox field", () => {
  const result = validateSubmissionPayload({
    definition: definition(),
    body: { name: "Ada", email: "ada@example.com", subscribe: true },
  });
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.data.subscribe, true);
  }
});

test("validateSubmissionPayload: accepts the HTML checkbox's default submitted value 'on' as true (a native form POST never sends a boolean)", () => {
  const result = validateSubmissionPayload({
    definition: definition(),
    body: { name: "Ada", email: "ada@example.com", subscribe: "on" },
  });
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.data.subscribe, true);
  }
});

test("validateSubmissionPayload: still rejects any other string for a checkbox field with the exact reason", () => {
  const result = validateSubmissionPayload({
    definition: definition(),
    body: { name: "Ada", email: "ada@example.com", subscribe: "yes please" },
  });
  assert.deepEqual(result, { valid: false, fieldErrors: [{ field: "subscribe", reason: "must be a boolean" }] });
});

test("validateSubmissionPayload: rejects a non-string value for a text field", () => {
  const result = validateSubmissionPayload({
    definition: definition(),
    body: { name: 123 as unknown as string, email: "ada@example.com" },
  });
  assert.equal(result.valid, false);
});
