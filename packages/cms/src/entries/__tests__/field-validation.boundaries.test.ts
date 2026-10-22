import { describe, expect, it } from "vitest";

import type { ContentTypeFieldDef } from "../../content-types/types.js";
import { selectVisibleEntryFields, validateFieldsAgainstSchema } from "../field-validation.js";

/**
 * @file Boundary pins for `validateFieldsAgainstSchema`: every envelope-shape refusal, the scalar
 * kinds the main suites do not exercise, the unknown-kind fallback, and the order in which the
 * per-key and required-field passes report their errors.
 */

function def(name: string, kind: ContentTypeFieldDef["kind"], required = false): ContentTypeFieldDef {
  return { name, kind, required, queryable: false };
}

const ENVELOPE_SITE = {
  valid: false,
  fieldErrors: [{ field: "__envelope__", reason: "fieldsJson must be wrapped in the { ext: { site: {...} } } envelope shape" }],
};

describe("envelope shape", () => {
  it("rejects a null fieldsJson with the envelope error", () => {
    expect(validateFieldsAgainstSchema({ schema: [], fieldsJson: null })).toEqual(ENVELOPE_SITE);
  });

  it("rejects an array fieldsJson with the envelope error", () => {
    expect(validateFieldsAgainstSchema({ schema: [], fieldsJson: [] })).toEqual(ENVELOPE_SITE);
  });

  it("rejects a non-object ext with the envelope error", () => {
    expect(validateFieldsAgainstSchema({ schema: [], fieldsJson: { ext: "site" } })).toEqual(ENVELOPE_SITE);
  });

  it("rejects an ext missing the owner bag with the envelope error", () => {
    expect(validateFieldsAgainstSchema({ schema: [], fieldsJson: { ext: { other: {} } } })).toEqual(ENVELOPE_SITE);
  });

  it("rejects a non-object owner bag with the envelope error", () => {
    expect(validateFieldsAgainstSchema({ schema: [], fieldsJson: { ext: { site: 3 } } })).toEqual(ENVELOPE_SITE);
  });

  it("names a non-default owner in the envelope error", () => {
    expect(validateFieldsAgainstSchema({ schema: [], fieldsJson: { ext: { site: {} } } }, { owner: "widget" })).toEqual({
      valid: false,
      fieldErrors: [{ field: "__envelope__", reason: "fieldsJson must be wrapped in the { ext: { widget: {...} } } envelope shape" }],
    });
  });

  it("accepts an empty owner bag against an empty schema", () => {
    expect(validateFieldsAgainstSchema({ schema: [], fieldsJson: { ext: { site: {} } } })).toEqual({ valid: true, fieldErrors: [] });
  });
});

describe("scalar kinds", () => {
  it("real accepts a fractional number", () => {
    expect(validateFieldsAgainstSchema({ schema: [def("r", "real")], fieldsJson: { ext: { site: { r: 1.5 } } } }).valid).toBe(true);
  });

  it("real rejects a numeric string", () => {
    expect(validateFieldsAgainstSchema({ schema: [def("r", "real")], fieldsJson: { ext: { site: { r: "1.5" } } } }).fieldErrors).toEqual([
      { field: "r", reason: "value does not conform to the declared kind 'real'" },
    ]);
  });

  it("integer rejects a fractional number", () => {
    expect(validateFieldsAgainstSchema({ schema: [def("i", "integer")], fieldsJson: { ext: { site: { i: 1.5 } } } }).fieldErrors).toEqual([
      { field: "i", reason: "value does not conform to the declared kind 'integer'" },
    ]);
  });

  it("boolean accepts false", () => {
    expect(validateFieldsAgainstSchema({ schema: [def("b", "boolean")], fieldsJson: { ext: { site: { b: false } } } }).valid).toBe(true);
  });

  it("boolean rejects the number 0", () => {
    expect(validateFieldsAgainstSchema({ schema: [def("b", "boolean")], fieldsJson: { ext: { site: { b: 0 } } } }).fieldErrors).toEqual([
      { field: "b", reason: "value does not conform to the declared kind 'boolean'" },
    ]);
  });

  it("datetime accepts any string", () => {
    expect(validateFieldsAgainstSchema({ schema: [def("d", "datetime")], fieldsJson: { ext: { site: { d: "not-a-date" } } } }).valid).toBe(true);
  });

  it("rejects every value for a kind this module has no arm for (schema drift from persisted data)", () => {
    // Parsed rather than cast: this is the shape a row written by a newer schema version arrives in.
    const drifted: ContentTypeFieldDef = JSON.parse('{"name":"c","kind":"color","required":false,"queryable":false}');
    expect(validateFieldsAgainstSchema({ schema: [drifted], fieldsJson: { ext: { site: { c: "#fff" } } } }).fieldErrors).toEqual([
      { field: "c", reason: "value does not conform to the declared kind 'color'" },
    ]);
  });
});

describe("json kind edges", () => {
  it("json accepts a null-prototype object", () => {
    const bag = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });
    expect(validateFieldsAgainstSchema({ schema: [def("j", "json")], fieldsJson: { ext: { site: { j: bag } } } }).valid).toBe(true);
  });

  it("json rejects an array containing a non-finite number", () => {
    expect(validateFieldsAgainstSchema({ schema: [def("j", "json")], fieldsJson: { ext: { site: { j: [1, Number.NaN] } } } }).fieldErrors).toEqual([
      { field: "j", reason: "value does not conform to the declared kind 'json'" },
    ]);
  });

  it("json accepts exactly 10000 nodes and rejects 10001", () => {
    const ok = new Array<number>(9_999).fill(0);
    const tooMany = new Array<number>(10_000).fill(0);
    expect(validateFieldsAgainstSchema({ schema: [def("j", "json")], fieldsJson: { ext: { site: { j: ok } } } }).valid).toBe(true);
    expect(validateFieldsAgainstSchema({ schema: [def("j", "json")], fieldsJson: { ext: { site: { j: tooMany } } } }).valid).toBe(false);
  });

  it("each json field gets its own node budget", () => {
    const big = new Array<number>(9_999).fill(0);
    const result = validateFieldsAgainstSchema({
      schema: [def("a", "json"), def("b", "json")],
      fieldsJson: { ext: { site: { a: big, b: big } } },
    });
    expect(result).toEqual({ valid: true, fieldErrors: [] });
  });
});

describe("error ordering", () => {
  it("reports per-key errors in submitted-key order, then missing required fields in schema order", () => {
    const result = validateFieldsAgainstSchema({
      schema: [def("req1", "text", true), def("n", "integer"), def("req2", "text", true)],
      fieldsJson: { ext: { site: { zzz: 1, n: "x" } } },
    });
    expect(result).toEqual({
      valid: false,
      fieldErrors: [
        { field: "zzz", reason: "unrecognized field: not present in the current content-type schema" },
        { field: "n", reason: "value does not conform to the declared kind 'integer'" },
        { field: "req1", reason: "required field is missing" },
        { field: "req2", reason: "required field is missing" },
      ],
    });
  });

  it("treats a required field present with a non-conforming value as non-conforming, not missing", () => {
    const result = validateFieldsAgainstSchema({ schema: [def("t", "text", true)], fieldsJson: { ext: { site: { t: 5 } } } });
    expect(result.fieldErrors).toEqual([{ field: "t", reason: "value does not conform to the declared kind 'text'" }]);
  });

  it("treats a required field inherited through the bag's prototype as missing", () => {
    const bag = Object.create({ t: "inherited" }) as Record<string, unknown>;
    const result = validateFieldsAgainstSchema({ schema: [def("t", "text", true)], fieldsJson: { ext: { site: bag } } });
    expect(result.fieldErrors).toEqual([{ field: "t", reason: "required field is missing" }]);
  });
});

describe("selectVisibleEntryFields envelope tolerance", () => {
  const contentType = { fields: [def("title", "text")] };

  it("returns an empty projection for a non-object fieldsJson", () => {
    expect(selectVisibleEntryFields({ entry: { fieldsJson: "x" }, contentType })).toEqual({});
  });

  it("returns an empty projection for a non-object ext", () => {
    expect(selectVisibleEntryFields({ entry: { fieldsJson: { ext: null } }, contentType })).toEqual({});
  });

  it("returns an empty projection for an array site bag", () => {
    expect(selectVisibleEntryFields({ entry: { fieldsJson: { ext: { site: ["title"] } } }, contentType })).toEqual({});
  });

  it("reads only the site namespace, never another owner's bag", () => {
    expect(selectVisibleEntryFields({ entry: { fieldsJson: { ext: { widget: { title: "w" } } } }, contentType })).toEqual({});
  });
});
