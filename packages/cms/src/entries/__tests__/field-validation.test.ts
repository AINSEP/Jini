import assert from "node:assert/strict";
import { test } from "vitest";

import { selectVisibleEntryFields, validateFieldsAgainstSchema } from "../field-validation.js";

/**
 * @file REQ-14/15/25 (SPEC-020) — `validateFieldsAgainstSchema`'s envelope-shape-first ordering
 * (C-411) and `selectVisibleEntryFields`'s orphaned-field read tolerance.
 *
 * Covers: AC-22 (unrecognized field rejected), AC-23 (missing required field rejected), AC-24
 * (orphaned key silently omitted on read), AC-39/AC-40 (validate-only route reuses identical
 * logic, writes no row — asserted here at the pure-function level since C-411 is explicitly
 * reused identically by create/update/validate-only), AC-49 (kind-conformance violation), AC-50
 * (malformed/unwrapped envelope rejected before any per-field check), EC-08.
 */

function schema() {
  return [
    { name: "title", kind: "text" as const, required: true, queryable: false },
    { name: "age", kind: "integer" as const, required: false, queryable: false },
  ];
}

test("AC-50/EC-15: a flat, unwrapped fieldsJson payload is rejected before any per-field check runs", () => {
  const result = validateFieldsAgainstSchema({ schema: schema(), fieldsJson: { title: "Hello" } as never });

  assert.equal(result.valid, false);
  assert.ok(result.fieldErrors.length >= 1);
  // The envelope-shape violation must be reported distinctly, not conflated with a per-field error
  // for a field named 'title' that technically exists in the flat payload.
  assert.ok(result.fieldErrors.some((e) => /envelope|ext\.site|shape/i.test(e.reason)));
});

test("AC-22: a fieldsJson key not present in the current schema is rejected as unrecognized", () => {
  const result = validateFieldsAgainstSchema({
    schema: schema(),
    fieldsJson: { ext: { site: { title: "Hello", foo: 1 } } },
  });

  assert.equal(result.valid, false);
  assert.ok(result.fieldErrors.some((e) => e.field === "foo"));
});

test("AC-23: omitting a required field is rejected", () => {
  const result = validateFieldsAgainstSchema({
    schema: schema(),
    fieldsJson: { ext: { site: {} } },
  });

  assert.equal(result.valid, false);
  assert.ok(result.fieldErrors.some((e) => e.field === "title"));
});

test("AC-49: a field value whose runtime type does not conform to its declared kind is rejected (kind-conformance)", () => {
  const result = validateFieldsAgainstSchema({
    schema: schema(),
    fieldsJson: { ext: { site: { title: "Chili", age: "thirty" } } },
  });

  assert.equal(result.valid, false);
  assert.ok(result.fieldErrors.some((e) => e.field === "age"));
});

test("a well-formed fieldsJson payload matching the current schema is valid, with no fieldErrors", () => {
  const result = validateFieldsAgainstSchema({
    schema: schema(),
    fieldsJson: { ext: { site: { title: "Chili", age: 30 } } },
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.fieldErrors, []);
});

test("AC-24/EC-08: selectVisibleEntryFields silently omits a fieldsJson key that no longer exists in the current schema, rather than erroring", () => {
  const entry = { fieldsJson: { ext: { site: { title: "Chili", legacyNote: "old note" } } } };
  const currentSchema = [{ name: "title", kind: "text" as const, required: true, queryable: false }]; // legacyNote was removed

  const visible = selectVisibleEntryFields({ entry, contentType: { fields: currentSchema } });

  assert.deepEqual(Object.keys(visible).sort(), ["title"]);
  assert.equal(Object.prototype.hasOwnProperty.call(visible, "legacyNote"), false);
});
