import { describe, expect, it } from "vitest";

import { parseIdentityToolInput } from "../agent-tool-input.js";

/**
 * @file Characterization pins for `agent-tool-input.ts` — every schema-interpretation refusal and
 * every input-verdict branch, called directly so each rule is pinned by its exact message.
 *
 * The parser is a validation boundary (agent tool input reaches identity transitions through it),
 * so every refusal here asserts the precise message: a refactor that reorders, merges or drops a
 * check must change one of these expectations to get through.
 */

/** A conforming closed schema with one required and one optional `minLength` property. */
const SCHEMA = {
  type: "object",
  description: "pins",
  properties: {
    principalId: { type: "string", minLength: 1, description: "who" },
    note: { type: "string" },
  },
  required: ["principalId"],
  additionalProperties: false,
} as const;

function parse(schema: Readonly<Record<string, unknown>>, input: unknown) {
  return parseIdentityToolInput({ schema, input });
}

function rejection(schema: Readonly<Record<string, unknown>>, input: unknown): string {
  const result = parse(schema, input);
  if (result.ok) throw new Error("expected the input to be rejected");
  return result.error.message;
}

describe("schema interpretation (developer errors throw)", () => {
  // Malformed-schema fixtures: deliberately not schema-shaped, so they bypass the record type.
  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "object"],
  ])("refuses a schema that is %s", (_label, schema) => {
    expect(() => parse(schema as unknown as Record<string, unknown>, {})).toThrow(
      /^identity agent-tool schema must be an object$/,
    );
  });

  it("refuses an unimplemented top-level keyword before anything else", () => {
    expect(() => parse({ ...SCHEMA, pattern: "x", type: "array" }, {})).toThrow(
      "identity agent-tool schema uses unimplemented keyword 'pattern' — extend agent-tool-input.ts rather than publishing a contract it cannot enforce",
    );
  });

  it("refuses a property-level keyword that is only valid on the object (misplaced keyword)", () => {
    expect(() => parse({ ...SCHEMA, properties: { a: { type: "string", required: [] } }, required: [] }, {})).toThrow(
      "identity agent-tool schema uses unimplemented keyword 'required' — extend agent-tool-input.ts rather than publishing a contract it cannot enforce",
    );
  });

  it("refuses a non-string top-level description", () => {
    expect(() => parse({ ...SCHEMA, description: 7 }, {})).toThrow(/^identity agent-tool schema description must be a string$/);
  });

  it("refuses a non-string property description", () => {
    expect(() => parse({ ...SCHEMA, properties: { a: { type: "string", description: null } }, required: [] }, {})).toThrow(
      /^identity agent-tool schema description must be a string$/,
    );
  });

  it("refuses a non-object schema type, naming the type", () => {
    expect(() => parse({ ...SCHEMA, type: "array" }, {})).toThrow(
      /^identity agent-tool schema must be an object schema, got type 'array'$/,
    );
  });

  it("refuses a schema with no type, naming it as undefined", () => {
    const { type: _type, ...untyped } = SCHEMA;
    expect(() => parse(untyped, {})).toThrow(/^identity agent-tool schema must be an object schema, got type 'undefined'$/);
  });

  it.each([["absent", undefined], ["true", true], ["an object", {}]])(
    "refuses additionalProperties that is %s (only a closed schema is interpretable)",
    (_label, additionalProperties) => {
      const schema: Record<string, unknown> = { ...SCHEMA };
      if (additionalProperties === undefined) delete schema.additionalProperties;
      else schema.additionalProperties = additionalProperties;
      expect(() => parse(schema, {})).toThrow(/^identity agent-tool schema must declare additionalProperties: false$/);
    },
  );

  it.each([["null", null], ["an array", []], ["a string", "x"]])("refuses properties that is %s", (_label, properties) => {
    expect(() => parse({ ...SCHEMA, properties, required: [] }, {})).toThrow(
      /^identity agent-tool schema properties must be an object$/,
    );
  });

  it.each([
    ["not an array", "principalId"],
    ["an array with a non-string", ["principalId", 3]],
    ["an array with duplicates", ["principalId", "principalId"]],
  ])("refuses required that is %s", (_label, required) => {
    expect(() => parse({ ...SCHEMA, required }, {})).toThrow(
      /^identity agent-tool schema required must be an array of unique strings$/,
    );
  });

  it("refuses a required key that is not a declared property", () => {
    expect(() => parse({ ...SCHEMA, required: ["principalId", "ghost"] }, {})).toThrow(
      /^identity agent-tool schema requires undeclared property 'ghost'$/,
    );
  });

  it("refuses a required key declared only on the prototype of properties", () => {
    const properties = Object.create({ inherited: { type: "string" } }) as Record<string, unknown>;
    expect(() => parse({ ...SCHEMA, properties, required: ["inherited"] }, {})).toThrow(
      /^identity agent-tool schema requires undeclared property 'inherited'$/,
    );
  });

  it.each([["null", null], ["an array", []], ["a string", "string"]])("refuses a property sub-schema that is %s", (_label, sub) => {
    expect(() => parse({ ...SCHEMA, properties: { a: sub }, required: [] }, {})).toThrow(
      /^identity agent-tool schema property 'a' must be an object$/,
    );
  });

  it("refuses a non-string property type", () => {
    expect(() => parse({ ...SCHEMA, properties: { a: { type: "number" } }, required: [] }, {})).toThrow(
      /^identity agent-tool schema declares non-string property 'a' — this parser only implements string properties$/,
    );
  });

  it.each([["a string", "1"], ["a fraction", 1.5], ["negative", -1], ["NaN", Number.NaN], ["null", null]])(
    "refuses a minLength that is %s",
    (_label, minLength) => {
      expect(() => parse({ ...SCHEMA, properties: { a: { type: "string", minLength } }, required: [] }, {})).toThrow(
        /^identity agent-tool schema minLength for 'a' must be a nonnegative integer$/,
      );
    },
  );

  it("throws for an uninterpretable schema even when the input itself is invalid", () => {
    expect(() => parse({ ...SCHEMA, type: "string" }, null)).toThrow(
      /^identity agent-tool schema must be an object schema, got type 'string'$/,
    );
  });

  it("accepts a schema with no properties and no required keys as a closed empty object", () => {
    expect(parse({ type: "object", additionalProperties: false }, {})).toEqual({ ok: true, value: {} });
    expect(rejection({ type: "object", additionalProperties: false }, { x: "1" })).toBe("'x' is not a recognized input key");
  });

  it("accepts minLength 0 and an integer-valued float", () => {
    const schema = { ...SCHEMA, properties: { a: { type: "string", minLength: 0 }, b: { type: "string", minLength: 2.0 } }, required: [] };
    expect(parse(schema, { a: "", b: "xy" })).toEqual({ ok: true, value: { a: "", b: "xy" } });
  });
});

describe("input verdicts (Result, never throws)", () => {
  it.each([["null", null], ["an array", []], ["a string", "x"], ["undefined", undefined], ["a number", 1]])(
    "rejects an input that is %s",
    (_label, input) => {
      expect(rejection(SCHEMA, input)).toBe("input must be an object");
    },
  );

  it("rejects an unknown own key before checking required keys", () => {
    expect(rejection(SCHEMA, { extra: "1" })).toBe("'extra' is not a recognized input key");
  });

  it("ignores keys inherited through the prototype (own keys only)", () => {
    const input = Object.create({ principalId: "p-1", extra: "1" }) as Record<string, unknown>;
    expect(rejection(SCHEMA, input)).toBe("'principalId' is required");
  });

  it("rejects a missing required key", () => {
    expect(rejection(SCHEMA, { note: "n" })).toBe("'principalId' is required");
  });

  it("rejects a required key that is present but undefined", () => {
    expect(rejection(SCHEMA, { principalId: undefined })).toBe("'principalId' is required");
  });

  it.each([
    ["null", null, "null"],
    ["an array", ["p"], "an array"],
    ["a number", 5, "a number"],
    ["an object", {}, "a object"],
    ["a boolean", true, "a boolean"],
  ])("rejects a %s value naming only its type", (_label, value, described) => {
    expect(rejection(SCHEMA, { principalId: value })).toBe(`'principalId' must be a string, received ${described}`);
  });

  it("rejects an optional key present as undefined as a non-string", () => {
    expect(rejection(SCHEMA, { principalId: "p", note: undefined })).toBe("'note' must be a string, received a undefined");
  });

  it("rejects a value shorter than minLength, counting Unicode code points", () => {
    expect(rejection(SCHEMA, { principalId: "" })).toBe("'principalId' must contain at least 1 Unicode code point(s)");
    const schema = { ...SCHEMA, properties: { principalId: { type: "string", minLength: 2 } } };
    // One astral code point is two UTF-16 units; code-point counting must still call it length 1.
    expect(rejection(schema, { principalId: "\u{1F600}" })).toBe("'principalId' must contain at least 2 Unicode code point(s)");
    expect(parse(schema, { principalId: "\u{1F600}\u{1F600}" })).toEqual({ ok: true, value: { principalId: "\u{1F600}\u{1F600}" } });
  });

  it("returns only present declared keys, in declaration order", () => {
    const result = parse(SCHEMA, { note: "n", principalId: "p" });
    expect(result).toEqual({ ok: true, value: { principalId: "p", note: "n" } });
    expect(result.ok && Object.keys(result.value)).toEqual(["principalId", "note"]);
    expect(parse(SCHEMA, { principalId: "p" })).toEqual({ ok: true, value: { principalId: "p" } });
  });

  it("stores a `__proto__` property as an own data key without touching the prototype", () => {
    const schema = { type: "object", additionalProperties: false, properties: JSON.parse('{"__proto__":{"type":"string"}}') as Record<string, unknown> };
    const result = parse(schema, JSON.parse('{"__proto__":"x"}'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(result.value, "__proto__")).toEqual({ value: "x", enumerable: true, writable: true, configurable: true });
  });

  it("reports the first violation in key order and never echoes the value", () => {
    const secretish = "operator-content-" + "x".repeat(8);
    const message = rejection(SCHEMA, { principalId: 1, note: secretish, extra: secretish });
    expect(message).toBe("'extra' is not a recognized input key");
    expect(rejection(SCHEMA, { principalId: [secretish] })).not.toContain(secretish);
  });
});
