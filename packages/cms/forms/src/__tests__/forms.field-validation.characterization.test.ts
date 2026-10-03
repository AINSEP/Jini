
import assert from "node:assert/strict";
import { test } from "vitest";

import {
  MAX_ATTRIBUTE_VALUE_LENGTH,
  MAX_ATTRIBUTES_PER_FIELD,
  MAX_CLASS_NAME_LENGTH,
  validateFieldDescriptors as validateFields,
} from "../forms.js";
import type { FieldDescriptor } from "../types.js";

function field(overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return { id: "name", label: "Name", type: "text", required: false, ...overrides };
}

function errorsOf(fields: FieldDescriptor[]) {
  const result = validateFieldDescriptors(fields);
  assert.equal(result.valid, false, "expected these descriptors to be rejected");
  return result.valid === false ? result.fieldErrors : [];
}

// ---------------------------------------------------------------------------
// Exact reason text, one branch at a time.
// ---------------------------------------------------------------------------

test("validateFieldDescriptors: zero fields reports the exact arity reason", () => {
  assert.deepEqual(errorsOf([]), [{ field: "fields", reason: "at least 1 field is required" }]);
});

test("validateFieldDescriptors: over-arity reports the exact reason, keyed to 'fields'", () => {
  const fields = Array.from({ length: 21 }, (_, i) => field({ id: `f${i}` }));
  assert.deepEqual(errorsOf(fields), [{ field: "fields", reason: "at most 20 fields are allowed" }]);
});

test("validateFieldDescriptors: each per-field branch reports its exact reason", () => {
  assert.deepEqual(errorsOf([field({ id: "1bad" })]), [{ field: "1bad", reason: "id must match ^[a-z][a-z0-9_]*$" }]);

  assert.deepEqual(errorsOf([field({ id: "dup" }), field({ id: "dup" })]), [
    { field: "dup", reason: "duplicate field id" },
  ]);

  assert.deepEqual(errorsOf([field({ type: "date" as FieldDescriptor["type"] })]), [
    { field: "name", reason: "type 'date' is not in the registered vocabulary" },
  ]);

  assert.deepEqual(errorsOf([field({ label: "" })]), [{ field: "name", reason: "label must be 1-200 characters" }]);

  assert.deepEqual(errorsOf([field({ type: "checkbox", maxLength: 10 })]), [
    { field: "name", reason: "maxLength is forbidden for checkbox fields" },
  ]);

  assert.deepEqual(errorsOf([field({ maxLength: 0 })]), [{ field: "name", reason: "maxLength must be 1-5000" }]);

  assert.deepEqual(errorsOf([field({ className: "x".repeat(MAX_CLASS_NAME_LENGTH + 1) })]), [
    { field: "name", reason: "className must be at most 300 characters" },
  ]);

  assert.deepEqual(errorsOf([field({ attributes: { onclick: "x" } })]), [
    { field: "name", reason: "attribute 'onclick' is not allowed" },
  ]);

  assert.deepEqual(errorsOf([field({ attributes: { title: "x".repeat(MAX_ATTRIBUTE_VALUE_LENGTH + 1) } })]), [
    { field: "name", reason: "attribute 'title' value must be at most 300 characters" },
  ]);
});

// ---------------------------------------------------------------------------
// Accumulation and ordering — the function is a collector, not a fail-fast guard.
// ---------------------------------------------------------------------------

test("validateFieldDescriptors: one descriptor accumulates every failing branch, id -> type -> label -> maxLength -> className -> attributes", () => {
  const broken = {
    id: "1bad",
    label: "",
    type: "date",
    required: false,
    maxLength: 99999,
    className: "x".repeat(MAX_CLASS_NAME_LENGTH + 1),
    attributes: { onclick: "x" },
  } as unknown as FieldDescriptor;

  assert.deepEqual(errorsOf([broken]), [
    { field: "1bad", reason: "id must match ^[a-z][a-z0-9_]*$" },
    { field: "1bad", reason: "type 'date' is not in the registered vocabulary" },
    { field: "1bad", reason: "label must be 1-200 characters" },
    { field: "1bad", reason: "maxLength must be 1-5000" },
    { field: "1bad", reason: "className must be at most 300 characters" },
    { field: "1bad", reason: "attribute 'onclick' is not allowed" },
  ]);
});

test("validateFieldDescriptors: arity errors precede per-descriptor errors, and descriptors report in array order", () => {
  const fields = [field({ id: "1bad" }), field({ id: "2bad" })];
  assert.deepEqual(errorsOf(fields), [
    { field: "1bad", reason: "id must match ^[a-z][a-z0-9_]*$" },
    { field: "2bad", reason: "id must match ^[a-z][a-z0-9_]*$" },
  ]);

  const tooMany = Array.from({ length: 21 }, (_, i) => field({ id: i === 0 ? "1bad" : `f${i}` }));
  assert.deepEqual(errorsOf(tooMany), [
    { field: "fields", reason: "at most 20 fields are allowed" },
    { field: "1bad", reason: "id must match ^[a-z][a-z0-9_]*$" },
  ]);
});

test("validateFieldDescriptors: an id that fails the pattern is never claimed, so a repeat is a second pattern error rather than a duplicate", () => {
  assert.deepEqual(errorsOf([field({ id: "BAD" }), field({ id: "BAD" })]), [
    { field: "BAD", reason: "id must match ^[a-z][a-z0-9_]*$" },
    { field: "BAD", reason: "id must match ^[a-z][a-z0-9_]*$" },
  ]);
});

test("validateFieldDescriptors: a third occurrence of a duplicated id reports again — the claim set is not consumed", () => {
  assert.deepEqual(errorsOf([field({ id: "dup" }), field({ id: "dup" }), field({ id: "dup" })]), [
    { field: "dup", reason: "duplicate field id" },
    { field: "dup", reason: "duplicate field id" },
  ]);
});

test("validateFieldDescriptors: an empty id labels its errors '(unknown)'", () => {
  assert.deepEqual(errorsOf([field({ id: "", label: "" })]), [
    { field: "(unknown)", reason: "id must match ^[a-z][a-z0-9_]*$" },
    { field: "(unknown)", reason: "label must be 1-200 characters" },
  ]);
});

test("validateFieldDescriptors: exceeding the attribute cap does not stop per-attribute checking", () => {
  const attributes: Record<string, string> = { onclick: "x" };
  for (let i = 0; i < MAX_ATTRIBUTES_PER_FIELD; i += 1) attributes[`data-a${i}`] = "x";

  assert.deepEqual(errorsOf([field({ attributes })]), [
    { field: "name", reason: "at most 12 attributes are allowed" },
    { field: "name", reason: "attribute 'onclick' is not allowed" },
  ]);
});

test("validateFieldDescriptors: a disallowed attribute name short-circuits its own value check", () => {
  const attributes = { onclick: "x".repeat(MAX_ATTRIBUTE_VALUE_LENGTH + 1) };
  assert.deepEqual(errorsOf([field({ attributes })]), [{ field: "name", reason: "attribute 'onclick' is not allowed" }]);
});

// ---------------------------------------------------------------------------
// Defensive branches: unreachable through `FieldDescriptor`, reachable from a request body.
// ---------------------------------------------------------------------------

test("validateFieldDescriptors: a non-string className is rejected as a type error, not a length error", () => {
  const descriptor = { ...field(), className: 42 } as unknown as FieldDescriptor;
  assert.deepEqual(errorsOf([descriptor]), [{ field: "name", reason: "className must be a string" }]);
});

test("validateFieldDescriptors: a non-string attribute value is rejected as a type error", () => {
  const descriptor = { ...field(), attributes: { title: 42 } } as unknown as FieldDescriptor;
  assert.deepEqual(errorsOf([descriptor]), [{ field: "name", reason: "attribute 'title' value must be a string" }]);
});

// ---------------------------------------------------------------------------
// Accepted shapes that a stricter rewrite could accidentally start rejecting.
// ---------------------------------------------------------------------------

test("validateFieldDescriptors: null/absent optionals and an empty attributes map are all accepted", () => {
  const nullMaxLength = { ...field(), maxLength: null } as FieldDescriptor;
  assert.equal(validateFieldDescriptors([nullMaxLength]).valid, true);
  assert.equal(validateFieldDescriptors([field({ type: "checkbox", maxLength: null })]).valid, true);
  assert.equal(validateFieldDescriptors([field({ attributes: {} })]).valid, true);
  assert.equal(validateFieldDescriptors([field({ className: "" })]).valid, true);
  assert.equal(validateFieldDescriptors([field({ maxLength: 1 })]).valid, true);
  assert.equal(validateFieldDescriptors([field({ maxLength: 5000 })]).valid, true);
});

test("validateFieldDescriptors: a valid input returns the bare `{ valid: true }` shape, with no fieldErrors key", () => {
  assert.deepEqual(validateFieldDescriptors([field()]), { valid: true });
});

function validateFieldDescriptors(fields: import("../types.js").FieldDescriptor[]) { return validateFields({ fields }); }
