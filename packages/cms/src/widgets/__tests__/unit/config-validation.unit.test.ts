import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import { validateWidgetConfig } from "../../config-validation.js";
import { getWidgetTypeRegistration } from "../support/compat/registry.js";

/**
 * @file `validateWidgetConfig` — the small JSON-Schema-subset validator `write-service.ts` runs
 * before every widget-instance write (REQ-02). `write-service.integration.test.ts` exercises this
 * indirectly through real `registry.ts` schemas, but only the branches those 5 v1 registrations
 * happen to touch. This file gives the validator itself direct, per-branch unit coverage: every
 * schema `type` (`object`/`string`/`integer`/`array`/unspecified), `required`, `additionalProperties`,
 * `minimum`/`maximum`, `maxItems`, `items` recursion, and nested-path composition.
 */

test("validateWidgetConfig: a config matching its schema is valid with no field errors", () => {
  const result = validateWidgetConfig({
    schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    config: { title: "Hello" },
  });
  assert.deepEqual(result, { valid: true, fieldErrors: [] });
});

test("validateWidgetConfig: a non-object config against an object schema is rejected at the top-level path", () => {
  const result = validateWidgetConfig({
    schema: { type: "object", properties: {} },
    config: null as unknown as Record<string, unknown>,
  });
  assert.deepEqual(result, { valid: false, fieldErrors: [{ field: "config", reason: "expected an object" }] });
});

test("validateWidgetConfig: an array value against an object schema is rejected (arrays are not plain objects)", () => {
  const result = validateWidgetConfig({
    schema: { type: "object", properties: {} },
    config: [] as unknown as Record<string, unknown>,
  });
  assert.deepEqual(result, { valid: false, fieldErrors: [{ field: "config", reason: "expected an object" }] });
});

test("validateWidgetConfig: a missing required key is reported by name at the object's path", () => {
  const result = validateWidgetConfig({
    schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    config: {},
  });
  assert.deepEqual(result, {
    valid: false,
    fieldErrors: [{ field: "config.title", reason: "required field is missing" }],
  });
});

test("validateWidgetConfig: additionalProperties: false rejects a key with no matching schema property", () => {
  const result = validateWidgetConfig({
    schema: { type: "object", properties: { title: { type: "string" } }, additionalProperties: false },
    config: { title: "Hello", extra: "not allowed" },
  });
  assert.deepEqual(result, {
    valid: false,
    fieldErrors: [{ field: "config.extra", reason: "unrecognized field: not present in the registered schema" }],
  });
});

test("validateWidgetConfig: an unrecognized key is silently accepted when additionalProperties is not false", () => {
  const result = validateWidgetConfig({
    schema: { type: "object", properties: { title: { type: "string" } } },
    config: { title: "Hello", extra: "fine" },
  });
  assert.deepEqual(result, { valid: true, fieldErrors: [] });
});

test("validateWidgetConfig: a non-string value against a string property is rejected", () => {
  const result = validateWidgetConfig({
    schema: { type: "object", properties: { title: { type: "string" } } },
    config: { title: 42 },
  });
  assert.deepEqual(result, { valid: false, fieldErrors: [{ field: "config.title", reason: "expected a string" }] });
});

test("validateWidgetConfig: a non-integer number against an integer property is rejected", () => {
  const result = validateWidgetConfig({
    schema: { type: "object", properties: { count: { type: "integer" } } },
    config: { count: 1.5 },
  });
  assert.deepEqual(result, { valid: false, fieldErrors: [{ field: "config.count", reason: "expected an integer" }] });
});

test("validateWidgetConfig: a non-number value against an integer property is rejected with the same message as a non-integer", () => {
  const result = validateWidgetConfig({
    schema: { type: "object", properties: { count: { type: "integer" } } },
    config: { count: "5" },
  });
  assert.deepEqual(result, { valid: false, fieldErrors: [{ field: "config.count", reason: "expected an integer" }] });
});

test("validateWidgetConfig: an integer below its schema minimum is rejected with the exact bound in the message", () => {
  const result = validateWidgetConfig({
    schema: { type: "object", properties: { count: { type: "integer", minimum: 1 } } },
    config: { count: 0 },
  });
  assert.deepEqual(result, { valid: false, fieldErrors: [{ field: "config.count", reason: "below the minimum of 1" }] });
});

test("validateWidgetConfig: an integer above its schema maximum is rejected with the exact bound in the message", () => {
  const result = validateWidgetConfig({
    schema: { type: "object", properties: { count: { type: "integer", maximum: 20 } } },
    config: { count: 21 },
  });
  assert.deepEqual(result, { valid: false, fieldErrors: [{ field: "config.count", reason: "above the maximum of 20" }] });
});

test("validateWidgetConfig: an integer exactly at minimum/maximum is valid (bounds are inclusive)", () => {
  for (const count of [1, 20]) {
    const result = validateWidgetConfig({
      schema: { type: "object", properties: { count: { type: "integer", minimum: 1, maximum: 20 } } },
      config: { count },
    });
    assert.deepEqual(result, { valid: true, fieldErrors: [] });
  }
});

test("validateWidgetConfig: a non-array value against an array property is rejected", () => {
  const result = validateWidgetConfig({
    schema: { type: "object", properties: { tags: { type: "array" } } },
    config: { tags: "not-an-array" },
  });
  assert.deepEqual(result, { valid: false, fieldErrors: [{ field: "config.tags", reason: "expected an array" }] });
});

test("validateWidgetConfig: an array exceeding maxItems is rejected with the exact bound in the message", () => {
  const result = validateWidgetConfig({
    schema: { type: "object", properties: { tags: { type: "array", maxItems: 2 } } },
    config: { tags: ["a", "b", "c"] },
  });
  assert.deepEqual(result, {
    valid: false,
    fieldErrors: [{ field: "config.tags", reason: "exceeds the maximum item count of 2" }],
  });
});

test("validateWidgetConfig: an array within maxItems is valid, and each item is recursed into via `items`", () => {
  const result = validateWidgetConfig({
    schema: { type: "object", properties: { counts: { type: "array", maxItems: 5, items: { type: "integer" } } } },
    config: { counts: [1, 2, 3] },
  });
  assert.deepEqual(result, { valid: true, fieldErrors: [] });
});

test("validateWidgetConfig: an invalid item inside an array is reported at its indexed path", () => {
  const result = validateWidgetConfig({
    schema: { type: "object", properties: { counts: { type: "array", items: { type: "integer" } } } },
    config: { counts: [1, "not-a-number", 3] },
  });
  assert.deepEqual(result, {
    valid: false,
    fieldErrors: [{ field: "config.counts[1]", reason: "expected an integer" }],
  });
});

test("validateWidgetConfig: a value under an unspecified/boolean schema type accepts anything", () => {
  const result = validateWidgetConfig({
    schema: { type: "object", properties: { anything: {} } },
    config: { anything: { deeply: { nested: [1, 2, "x"] } } },
  });
  assert.deepEqual(result, { valid: true, fieldErrors: [] });
});

test("validateWidgetConfig: nested object -> array -> object recursion composes the full dotted/indexed path and collects every error, not just the first", () => {
  const result = validateWidgetConfig({
    schema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["label"],
            properties: { label: { type: "string" } },
          },
        },
      },
    },
    config: { items: [{ label: "ok" }, {}, { label: 42 }, {}] },
  });
  assert.deepEqual(result, {
    valid: false,
    fieldErrors: [
      { field: "config.items[1].label", reason: "required field is missing" },
      { field: "config.items[2].label", reason: "expected a string" },
      { field: "config.items[3].label", reason: "required field is missing" },
    ],
  });
});

/**
 * Collections plan R1 — `recent-entries`'s registered schema against the REAL validator (not an
 * ad-hoc schema like every test above), proving the six new "Collection list" keys are declared
 * correctly and an old `{maxItems}`-only config still validates unchanged.
 */
test("recent-entries schema: the new collection/where/sort/fields/layout/columns keys are all accepted alongside maxItems", () => {
  const schema = getWidgetTypeRegistration("recent-entries").configSchema;
  const result = validateWidgetConfig({
    schema,
    config: {
      maxItems: 6,
      collection: "recipe",
      where: { cuisine: "Italian" },
      sort: "-published",
      fields: ["cuisine", "spiceLevel"],
      layout: "cards",
      columns: 2,
    },
  });
  assert.deepEqual(result, { valid: true, fieldErrors: [] });
});

test("recent-entries schema (AW-7): an FAQ accordion config with structuredData validates", () => {
  const schema = getWidgetTypeRegistration("recent-entries").configSchema;
  const result = validateWidgetConfig({ schema, config: { maxItems: 10, collection: "faq", layout: "accordion", structuredData: "faq-page", sort: "order" } });
  assert.deepEqual(result, { valid: true, fieldErrors: [] });
});

test("recent-entries schema: an old maxItems-only config (no collection keys at all) still validates unchanged", () => {
  const schema = getWidgetTypeRegistration("recent-entries").configSchema;
  const result = validateWidgetConfig({ schema, config: { maxItems: 5 } });
  assert.deepEqual(result, { valid: true, fieldErrors: [] });
});

test("recent-entries schema: an unrecognized key is still rejected (additionalProperties: false is unchanged)", () => {
  const schema = getWidgetTypeRegistration("recent-entries").configSchema;
  const result = validateWidgetConfig({ schema, config: { maxItems: 5, carousel: true } });
  assert.deepEqual(result, {
    valid: false,
    fieldErrors: [{ field: "config.carousel", reason: "unrecognized field: not present in the registered schema" }],
  });
});

test("recent-entries schema: maxItems is still required even when collection keys are present", () => {
  const schema = getWidgetTypeRegistration("recent-entries").configSchema;
  const result = validateWidgetConfig({ schema, config: { collection: "recipe" } });
  assert.deepEqual(result, {
    valid: false,
    fieldErrors: [{ field: "config.maxItems", reason: "required field is missing" }],
  });
});

test("recent-entries schema: where, sort and columns reject wrong types", () => {
  const schema = getWidgetTypeRegistration("recent-entries").configSchema;
  for (const [field, value, reason] of [["where", "cuisine", "expected an object"], ["sort", 42, "expected a string"], ["columns", "2", "expected an integer"]] as const) {
    assert.deepEqual(validateWidgetConfig({ schema, config: { maxItems: 5, [field]: value } }), {
      valid: false, fieldErrors: [{ field: `config.${field}`, reason }],
    });
  }
});
