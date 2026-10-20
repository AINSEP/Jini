import assert from "node:assert/strict";
import { test } from "vitest";
import { commonDescriptorErrors } from "../descriptor-rules.js";
import { MAX_FORM_FILE_BYTES } from "../field-registry.js";
import type { FieldDescriptor } from "../types.js";

const field = (overrides: Partial<FieldDescriptor> = {}): FieldDescriptor => ({ id: "answer", label: "Answer", type: "text", required: false, ...overrides });
/** Stored descriptors are untrusted JSON; parsing keeps ill-typed values without a type assertion. */
const untrusted = (raw: Record<string, unknown>): FieldDescriptor => JSON.parse(JSON.stringify({ id: "answer", label: "Answer", type: "text", required: false, ...raw }));
const reasons = (descriptor: FieldDescriptor): string[] => commonDescriptorErrors({ field: descriptor }).map((error) => error.reason);
const choices = [{ value: "a", label: "A" }, { value: "b", label: "B" }];

const MIN_LENGTH = "minLength must be an integer within the text length bounds";
const MAX_LENGTH = "maxLength is only supported on text fields and must be an integer";
const UNSAFE_PATTERN = "pattern must be a safe text pattern (no groups, alternation, backreferences or multiple repetitions)";
const BROWSER_PATTERN = "pattern is ignored by browsers: escape '-' and other symbols inside [...] with a backslash, e.g. [0-9 +.\\-]";
const OPTION_SHAPE = "options must contain only a non-empty value and label (up to 200 characters)";
const STEP = "step must be a positive finite number on a numeric field";
const ACCEPT = "accept must contain recognized safe MIME types or image/*, video/*, */*";

test("commonDescriptorErrors: a minimal valid text field has no errors", () => {
  assert.deepEqual(commonDescriptorErrors({ field: field() }), []);
});

test("commonDescriptorErrors: errors carry the field id, or (unknown) when the id is empty", () => {
  assert.deepEqual(commonDescriptorErrors({ field: untrusted({ id: "", required: "yes" }) }), [{ field: "(unknown)", reason: "required must be a boolean" }]);
  assert.deepEqual(commonDescriptorErrors({ field: untrusted({ required: "yes" }) }), [{ field: "answer", reason: "required must be a boolean" }]);
});

test("commonDescriptorErrors: every unknown property is named", () => {
  assert.deepEqual(reasons(untrusted({ onclick: "x", style: "y" })), ["property 'onclick' is not allowed", "property 'style' is not allowed"]);
});

test("commonDescriptorErrors: name must equal the id when present", () => {
  assert.deepEqual(reasons(field({ name: "answer" })), []);
  assert.deepEqual(reasons(field({ name: "other" })), ["name must equal the stable field id"]);
});

test("commonDescriptorErrors: placeholder and helpText are strings of at most 500 characters", () => {
  assert.deepEqual(reasons(field({ placeholder: "x".repeat(500), helpText: "y".repeat(500) })), []);
  assert.deepEqual(reasons(field({ placeholder: "x".repeat(501) })), ["placeholder must be a string of at most 500 characters"]);
  assert.deepEqual(reasons(untrusted({ helpText: 5 })), ["helpText must be a string of at most 500 characters"]);
});

test("commonDescriptorErrors: an unregistered type skips type rules but still resolves its default", () => {
  assert.deepEqual(reasons(untrusted({ type: "password", options: [], min: "x" })), []);
  assert.deepEqual(reasons(untrusted({ type: "password", default: "x" })), ["default: invalid_type"]);
});

test("commonDescriptorErrors: minLength accepts integers within 0..maxLength (explicit or attribute)", () => {
  assert.deepEqual(reasons(field({ minLength: 0 })), []);
  assert.deepEqual(reasons(field({ minLength: 5000 })), []);
  assert.deepEqual(reasons(field({ minLength: 3, maxLength: 3 })), []);
  assert.deepEqual(reasons(field({ attributes: { minlength: "2" } })), []);
});

test("commonDescriptorErrors: minLength refusals cover non-text, fractional, negative, oversize and attribute spellings", () => {
  for (const descriptor of [
    field({ type: "number", minLength: 1 }), field({ minLength: 1.5 }), field({ minLength: -1 }), field({ minLength: 5001 }),
    field({ minLength: 4, maxLength: 3 }), field({ attributes: { minlength: "abc" } }),
  ]) assert.deepEqual(reasons(descriptor), [MIN_LENGTH], JSON.stringify(descriptor));
});

test("commonDescriptorErrors: maxLength is refused on non-text fields and non-integers, but ignored on checkboxes", () => {
  assert.deepEqual(reasons(field({ maxLength: 10 })), []);
  assert.deepEqual(reasons(field({ maxLength: null })), []);
  assert.deepEqual(reasons(field({ type: "checkbox", maxLength: 10 })), []);
  assert.deepEqual(reasons(field({ type: "number", maxLength: 10 })), [MAX_LENGTH]);
  assert.deepEqual(reasons(field({ maxLength: 1.5 })), [MAX_LENGTH]);
});

test("commonDescriptorErrors: patterns must be safe text patterns that browsers also honour", () => {
  assert.deepEqual(reasons(field({ pattern: "[a-z]+" })), []);
  assert.deepEqual(reasons(field({ attributes: { pattern: "[a-z]+" } })), []);
  assert.deepEqual(reasons(field({ type: "number", pattern: "[0-9]+" })), [UNSAFE_PATTERN]);
  assert.deepEqual(reasons(untrusted({ pattern: 5 })), [UNSAFE_PATTERN]);
  assert.deepEqual(reasons(field({ pattern: "(a|b)" })), [UNSAFE_PATTERN]);
  assert.deepEqual(reasons(field({ pattern: "[a-z-]" })), [BROWSER_PATTERN]);
});

test("commonDescriptorErrors: options on a non-choice field are refused", () => {
  assert.deepEqual(reasons(field({ options: choices })), ["options are only supported on choice fields"]);
});

test("commonDescriptorErrors: choice fields need 1-100 options", () => {
  assert.deepEqual(reasons(field({ type: "select", options: choices })), []);
  assert.deepEqual(reasons(field({ type: "select", options: Array.from({ length: 100 }, (_, index) => ({ value: `v${index}`, label: "L" })) })), []);
  assert.deepEqual(reasons(field({ type: "radio" })), ["choice fields require 1-100 options"]);
  for (const options of [[], Array.from({ length: 101 }, (_, index) => ({ value: `v${index}`, label: "L" }))]) {
    assert.deepEqual(reasons(field({ type: "radio", options })), ["choice fields require 1-100 options"]);
  }
  assert.deepEqual(reasons(untrusted({ type: "radio", options: "a" })), ["choice fields require 1-100 options"]);
});

test("commonDescriptorErrors: each malformed option is refused once and well-formed duplicates are refused", () => {
  const malformed = [null, 5, { value: "", label: "L" }, { value: "x".repeat(201), label: "L" }, { value: 1, label: "L" }, { value: "v", label: "" }, { value: "v", label: "x".repeat(201) }, { value: "v", label: 2 }, { value: "v", label: "L", extra: 1 }];
  for (const option of malformed) assert.deepEqual(reasons(untrusted({ type: "select", options: [option] })), [OPTION_SHAPE], JSON.stringify(option));
  assert.deepEqual(reasons(field({ type: "select", options: [{ value: "x".repeat(200), label: "y".repeat(200) }] })), []);
  assert.deepEqual(reasons(field({ type: "checkbox-group", options: [...choices, { value: "a", label: "Again" }, { value: "a", label: "Thrice" }] })), ["option values must be unique", "option values must be unique"]);
});

test("commonDescriptorErrors: numeric bounds accept finite numbers and numeric strings", () => {
  assert.deepEqual(reasons(field({ type: "number", min: 0, max: "10", step: 0.5 })), []);
  assert.deepEqual(reasons(field({ type: "range", attributes: { min: "1", max: "1", step: "2" } })), []);
});

test("commonDescriptorErrors: numeric bounds refuse blanks, non-numbers and infinities", () => {
  assert.deepEqual(reasons(field({ type: "number", min: " " })), ["min must be a finite number"]);
  assert.deepEqual(reasons(untrusted({ type: "number", max: true })), ["max must be a finite number"]);
  assert.deepEqual(reasons(field({ type: "number", max: "Infinity" })), ["max must be a finite number"]);
  assert.deepEqual(reasons(field({ type: "number", min: "abc" })), ["min must be a finite number"]);
});

test("commonDescriptorErrors: reversed numeric bounds are refused", () => {
  assert.deepEqual(reasons(field({ type: "number", min: 5, max: 4 })), ["min must not exceed max"]);
  assert.deepEqual(reasons(field({ type: "number", attributes: { min: "5", max: "4" } })), ["min must not exceed max"]);
});

test("commonDescriptorErrors: temporal bounds must use the native format of their field type", () => {
  assert.deepEqual(reasons(field({ type: "date", min: "2026-01-01", max: "2026-12-31" })), []);
  assert.deepEqual(reasons(field({ type: "time", min: "09:00" })), []);
  assert.deepEqual(reasons(field({ type: "datetime", max: "2026-01-01T09:00" })), []);
  assert.deepEqual(reasons(field({ type: "date", min: "2026-02-30" })), ["min must match the field's native date/time format"]);
  assert.deepEqual(reasons(field({ type: "time", max: 9 })), ["max must match the field's native date/time format"]);
});

test("commonDescriptorErrors: reversed temporal bounds are refused while equivalent spellings are equal", () => {
  assert.deepEqual(reasons(field({ type: "date", min: "2026-12-31", max: "2026-01-01" })), ["min must not exceed max"]);
  assert.deepEqual(reasons(field({ type: "time", min: "12:30", max: "12:30:00" })), []);
});

test("commonDescriptorErrors: bounds on non-numeric, non-temporal fields are refused per key", () => {
  assert.deepEqual(reasons(field({ min: 1, max: 0 })), ["min is only supported on numeric and date/time fields", "max is only supported on numeric and date/time fields"]);
});

test("commonDescriptorErrors: step must be a positive finite number on numeric fields", () => {
  assert.deepEqual(reasons(field({ step: 1 })), [STEP]);
  assert.deepEqual(reasons(field({ type: "number", step: 0 })), [STEP]);
  assert.deepEqual(reasons(field({ type: "number", attributes: { step: "abc" } })), [STEP]);
  assert.deepEqual(reasons(field({ type: "date", attributes: { step: "60" } })), [STEP]);
});

test("commonDescriptorErrors: accept/maxFileSize on a non-file field are refused", () => {
  assert.deepEqual(reasons(field({ accept: ["image/png"] })), ["accept/maxFileSize are only supported on file fields"]);
  assert.deepEqual(reasons(field({ maxFileSize: 10 })), ["accept/maxFileSize are only supported on file fields"]);
});

test("commonDescriptorErrors: file fields accept safe narrowing", () => {
  assert.deepEqual(reasons(field({ type: "file", accept: ["image/png", "image/*", "video/*", "*/*"], maxFileSize: MAX_FORM_FILE_BYTES })), []);
  assert.deepEqual(reasons(field({ type: "file", maxFileSize: 1 })), []);
});

test("commonDescriptorErrors: file maxFileSize must be an integer within 1..MAX_FORM_FILE_BYTES", () => {
  for (const maxFileSize of [0, 1.5, MAX_FORM_FILE_BYTES + 1]) assert.deepEqual(reasons(field({ type: "file", maxFileSize })), [`maxFileSize must be 1-${MAX_FORM_FILE_BYTES} bytes`]);
});

test("commonDescriptorErrors: file accept must be 1-20 recognized safe types", () => {
  for (const accept of [[], Array.from({ length: 21 }, () => "image/png"), ["text/html"]]) assert.deepEqual(reasons(field({ type: "file", accept })), [ACCEPT]);
  assert.deepEqual(reasons(untrusted({ type: "file", accept: "image/png" })), [ACCEPT]);
});

test("commonDescriptorErrors: file fields cannot have defaults", () => {
  assert.deepEqual(reasons(field({ type: "file", default: "x" })), ["file fields cannot have defaults"]);
});

test("commonDescriptorErrors: defaults are resolved as optional answers", () => {
  assert.deepEqual(reasons(field({ required: true, default: "" })), []);
  assert.deepEqual(reasons(field({ type: "number", default: "abc" })), ["default: invalid_number"]);
  assert.deepEqual(reasons(field({ type: "select", options: choices, default: ["a", "b"] })), ["default: must be a string"]);
});

test("commonDescriptorErrors: defaults are not resolved once another rule already failed", () => {
  assert.deepEqual(reasons(field({ type: "number", min: 5, max: 4, default: "abc" })), ["min must not exceed max"]);
});
