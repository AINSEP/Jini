/**
 * Defensive branches of `forms.ts` that the static types rule out but parsed request bodies can
 * still reach. Each test pins one exact refusal so the validation split cannot drift.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { validateFieldDescriptors, validateSubmissionPayload } from "../forms.js";
import type { FieldDescriptor, FormDefinitionRecord } from "../types.js";

function field(overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return { id: "name", label: "Name", type: "text", required: false, ...overrides };
}

function definition(fields: FieldDescriptor[]): FormDefinitionRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
    slug: "contact",
    name: "Contact",
    status: "active",
    fields,
    notify: { enabled: false, recipients: [] },
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("validateFieldDescriptors: a non-array fields value is refused as a whole", () => {
  const fields = { 0: field() } as unknown;
  assert.deepEqual(validateFieldDescriptors({ fields: fields as FieldDescriptor[] }), {
    valid: false,
    fieldErrors: [{ field: "fields", reason: "must be an array" }],
  });
});

test("validateFieldDescriptors: an array in a descriptor slot is refused as a non-object field", () => {
  const nested = [field()] as unknown;
  assert.deepEqual(validateFieldDescriptors({ fields: [nested as FieldDescriptor] }), {
    valid: false,
    fieldErrors: [{ field: "fields", reason: "each field must be an object" }],
  });
});

test("validateFieldDescriptors: a non-object descriptor does not stop later descriptors from being checked", () => {
  const blank = null as unknown;
  assert.deepEqual(validateFieldDescriptors({ fields: [blank as FieldDescriptor, field({ id: "Bad" })] }), {
    valid: false,
    fieldErrors: [
      { field: "fields", reason: "each field must be an object" },
      { field: "Bad", reason: "id must match ^[a-z][a-z0-9_]*$" },
    ],
  });
});

test("validateFieldDescriptors: a non-string label is refused as a type error, not a length error", () => {
  const label = 7 as unknown;
  assert.deepEqual(validateFieldDescriptors({ fields: [field({ label: label as string })] }), {
    valid: false,
    fieldErrors: [{ field: "name", reason: "label must be a string" }],
  });
});

test("validateFieldDescriptors: checkboxValue on a non-checkbox field is refused", () => {
  assert.deepEqual(validateFieldDescriptors({ fields: [field({ checkboxValue: "yes" })] }), {
    valid: false,
    fieldErrors: [{ field: "name", reason: "checkboxValue must be a string on a checkbox field" }],
  });
});

test("validateFieldDescriptors: a non-string checkboxValue on a checkbox field is refused", () => {
  const checkboxValue = 1 as unknown;
  assert.deepEqual(validateFieldDescriptors({ fields: [field({ type: "checkbox", checkboxValue: checkboxValue as string })] }), {
    valid: false,
    fieldErrors: [{ field: "name", reason: "checkboxValue must be a string on a checkbox field" }],
  });
});

test("validateSubmissionPayload: an array body is refused before any field is resolved", () => {
  const body = [] as unknown;
  assert.deepEqual(validateSubmissionPayload({ definition: definition([field()]), body: body as Record<string, unknown> }), {
    valid: false,
    fieldErrors: [{ field: "body", reason: "must be an object" }],
  });
});

test("validateSubmissionPayload: an omitted optional field is neither an error nor a stored answer", () => {
  assert.deepEqual(validateSubmissionPayload({ definition: definition([field(), field({ id: "note" })]), body: { name: "Ada" } }), {
    valid: true,
    data: { name: "Ada" },
  });
});

test("validateFieldDescriptors: a string checkboxValue on a checkbox field is accepted", () => {
  assert.deepEqual(validateFieldDescriptors({ fields: [field({ type: "checkbox", checkboxValue: "yes" })] }), { valid: true });
});
