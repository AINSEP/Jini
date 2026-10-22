import assert from "node:assert/strict";
import { test } from "vitest";

import { validateFieldDescriptors as validateFields } from "../forms.js";
import type { FieldDescriptor } from "../types.js";

function field(overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return { id: "name", label: "Name", type: "text", required: false, ...overrides };
}

test("validateFieldDescriptors: accepts a single valid text field", () => {
  const result = validateFieldDescriptors([field()]);
  assert.equal(result.valid, true);
});

test("validateFieldDescriptors: accepts every vocabulary type (text/email/textarea/checkbox)", () => {
  const fields: FieldDescriptor[] = [
    field({ id: "a", type: "text" }),
    field({ id: "b", type: "email" }),
    field({ id: "c", type: "textarea" }),
    field({ id: "d", type: "checkbox" }),
  ];
  const result = validateFieldDescriptors(fields);
  assert.equal(result.valid, true);
});

test("validateFieldDescriptors: rejects a field type outside the registered vocabulary (AC-03)", () => {
  const result = validateFieldDescriptors([field({ type: "date" as FieldDescriptor["type"] })]);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.fieldErrors.some((e) => e.field === "name" && e.reason.includes("type")));
  }
});

test("validateFieldDescriptors: rejects zero fields", () => {
  const result = validateFieldDescriptors([]);
  assert.equal(result.valid, false);
});

test("validateFieldDescriptors: accepts exactly 20 fields (behavior.spec.md §7 boundary)", () => {
  const fields = Array.from({ length: 20 }, (_, i) => field({ id: `f${i}`, label: `Field ${i}` }));
  const result = validateFieldDescriptors(fields);
  assert.equal(result.valid, true);
});

test("validateFieldDescriptors: rejects 21 fields (behavior.spec.md §7 boundary)", () => {
  const fields = Array.from({ length: 21 }, (_, i) => field({ id: `f${i}`, label: `Field ${i}` }));
  const result = validateFieldDescriptors(fields);
  assert.equal(result.valid, false);
});

test("validateFieldDescriptors: rejects an empty label", () => {
  const result = validateFieldDescriptors([field({ label: "" })]);
  assert.equal(result.valid, false);
});

test("validateFieldDescriptors: rejects a label over 200 chars", () => {
  const result = validateFieldDescriptors([field({ label: "x".repeat(201) })]);
  assert.equal(result.valid, false);
});

test("validateFieldDescriptors: accepts a label at exactly 200 chars", () => {
  const result = validateFieldDescriptors([field({ label: "x".repeat(200) })]);
  assert.equal(result.valid, true);
});

test("validateFieldDescriptors: accepts maxLength within 1..5000 for a text field", () => {
  const result = validateFieldDescriptors([field({ maxLength: 100 })]);
  assert.equal(result.valid, true);
});

test("validateFieldDescriptors: rejects maxLength 0", () => {
  const result = validateFieldDescriptors([field({ maxLength: 0 })]);
  assert.equal(result.valid, false);
});

test("validateFieldDescriptors: rejects maxLength over 5000", () => {
  const result = validateFieldDescriptors([field({ maxLength: 5001 })]);
  assert.equal(result.valid, false);
});

test("validateFieldDescriptors: rejects maxLength set on a checkbox field (behavior.spec.md §4)", () => {
  const result = validateFieldDescriptors([field({ type: "checkbox", maxLength: 100 })]);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.fieldErrors.some((e) => e.reason.toLowerCase().includes("checkbox")));
  }
});

test("validateFieldDescriptors: accepts a checkbox field with no maxLength", () => {
  const result = validateFieldDescriptors([field({ type: "checkbox" })]);
  assert.equal(result.valid, true);
});

test("validateFieldDescriptors: rejects duplicate field ids", () => {
  const result = validateFieldDescriptors([field({ id: "dup" }), field({ id: "dup", label: "Dup 2" })]);
  assert.equal(result.valid, false);
});

test("validateFieldDescriptors: rejects a field id outside ^[a-z][a-z0-9_]*$", () => {
  const result = validateFieldDescriptors([field({ id: "1bad" })]);
  assert.equal(result.valid, false);
});

// ---------------------------------------------------------------------------
// className/attributes (per-field CSS classes + HTML attributes, admin "field attributes" modal).
// See forms.ts's `ATTRIBUTE_NAME_PATTERN` header comment for why attribute NAMES are deny-by-
// default rather than a sanitize pass — an attribute value is inert once escaped, a name is not.
// ---------------------------------------------------------------------------

test("validateFieldDescriptors: accepts a Tailwind-style className string unchanged", () => {
  const result = validateFieldDescriptors([field({ className: "md:col-span-2 w-1/2 focus:ring-2" })]);
  assert.equal(result.valid, true);
});

test("validateFieldDescriptors: rejects a className over the length cap", () => {
  const result = validateFieldDescriptors([field({ className: "x".repeat(301) })]);
  assert.equal(result.valid, false);
});

test("validateFieldDescriptors: accepts every allowlisted attribute name", () => {
  const allowlisted = [
    "placeholder",
    "autocomplete",
    "inputmode",
    "pattern",
    "title",
    "min",
    "max",
    "step",
    "minlength",
    "spellcheck",
    "readonly",
  ];
  const attributes = Object.fromEntries(allowlisted.map((name) => [name, "value"]));
  const result = validateFieldDescriptors([field({ attributes })]);
  assert.equal(result.valid, true);
});

test("validateFieldDescriptors: accepts aria-* and data-* prefixed attribute names", () => {
  const result = validateFieldDescriptors([
    field({ attributes: { "aria-label": "Email address", "data-testid": "email-field" } }),
  ]);
  assert.equal(result.valid, true);
});

for (const rejected of ["onclick", "onerror", "style", "formaction", "href", "src", "srcdoc", "id", "name", "type"]) {
  test(`validateFieldDescriptors: rejects the '${rejected}' attribute name`, () => {
    const result = validateFieldDescriptors([field({ attributes: { [rejected]: "x" } })]);
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(result.fieldErrors.some((e) => e.reason.includes(rejected)));
    }
  });
}

for (const rejected of ['data-x onclick', 'data-x"y', 'aria-', 'DATA-Foo', 'data-a=b', 'data-']) {
  test(`validateFieldDescriptors: rejects the malformed '${rejected}' attribute name`, () => {
    assert.deepEqual(validateFieldDescriptors([field({ attributes: { [rejected]: "x" } })]), {
      valid: false,
      fieldErrors: [{ field: "name", reason: `attribute '${rejected}' is not allowed` }],
    });
  });
}

test("validateFieldDescriptors: rejects an attribute name outside the allowlist entirely", () => {
  const result = validateFieldDescriptors([field({ attributes: { colspan: "2" } })]);
  assert.equal(result.valid, false);
});

test("validateFieldDescriptors: accepts exactly 12 valid attributes", () => {
  const attributes = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`data-a${i}`, "x"]));
  assert.deepEqual(validateFieldDescriptors([field({ attributes })]), { valid: true });
});

test("validateFieldDescriptors: rejects more than the max attributes per field", () => {
  const attributes = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`data-a${i}`, "x"]));
  const result = validateFieldDescriptors([field({ attributes })]);
  assert.equal(result.valid, false);
});

test("validateFieldDescriptors: rejects an attribute value over the length cap", () => {
  const result = validateFieldDescriptors([field({ attributes: { title: "x".repeat(301) } })]);
  assert.equal(result.valid, false);
});

function validateFieldDescriptors(fields: import("../types.js").FieldDescriptor[]) { return validateFields({ fields }); }
