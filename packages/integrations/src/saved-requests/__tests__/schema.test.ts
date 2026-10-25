import { expect, test } from "vitest";
import { compileInputSchema } from "../schema.js";
import { SavedRequestError } from "../index.js";

test.each([NaN, Infinity, -Infinity])("the schema compiler independently refuses non-finite numeric ranges %s", value => {
  const root = (minimum: number, maximum: number) => ({ type: "object", properties: { n: { type: "number", minimum, maximum } }, additionalProperties: false });
  expect(() => compileInputSchema({ schema: root(value, 10) })).toThrow(SavedRequestError);
  expect(() => compileInputSchema({ schema: root(0, value) })).toThrow(SavedRequestError);
});

test("the installed validator enforces enum, numeric, array, nested closure and required contracts", () => {
  const validator = compileInputSchema({ schema: {
    type: "object", additionalProperties: false, required: ["choice", "count", "rows"], properties: {
      choice: { type: "string", maxLength: 10, enum: ["public"] },
      count: { type: "integer", minimum: 1, maximum: 2 },
      rows: { type: "array", minItems: 1, maxItems: 2, items: {
        type: "object", additionalProperties: false, required: ["live"], properties: { live: { type: "boolean" } },
      } },
    },
  } });
  const valid = { choice: "public", count: 1, rows: [{ live: false }] };
  expect(validator.validate(valid).valid).toBe(true);
  // The interpreter snapshots input as JSON before validation; a missing required field
  // must be represented by an absent property, not JavaScript's unsupported undefined type.
  for (const input of [
    { ...valid, choice: "private" }, { ...valid, count: 0 }, { ...valid, count: 3 }, { ...valid, count: 1.5 },
    { ...valid, rows: [] }, { ...valid, rows: [{ live: true }, { live: true }, { live: true }] },
    { ...valid, rows: [{ live: true, secret: "no" }] }, { ...valid, rows: [{}] }, { choice: valid.choice, rows: valid.rows },
  ]) expect(validator.validate(input).valid).toBe(false);
});

test("an integer enum must list numbers: numeric values compile, a string value is refused as invalid_definition", () => {
  const root = (values: unknown[]) => ({ type: "object", additionalProperties: false, properties: { n: { type: "integer", minimum: 1, maximum: 3, enum: values } } });
  const validator = compileInputSchema({ schema: root([1, 3]) });
  expect(validator.validate({ n: 3 }).valid).toBe(true);
  expect(validator.validate({ n: 2 }).valid).toBe(false);
  expect(() => compileInputSchema({ schema: root([1, "3"]) })).toThrow(expect.objectContaining({ code: "invalid_definition" }));
  expect(() => compileInputSchema({ schema: root([]) })).toThrow(SavedRequestError);
});
