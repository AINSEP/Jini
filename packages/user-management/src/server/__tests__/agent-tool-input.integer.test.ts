import { describe, expect, it } from "vitest";

import { parseIdentityToolInput } from "../agent-tool-input.js";

// Why: identity write tools must accept the record `version` an editor read (lost-update pattern,
// `expectedVersion`), so the schema interpreter implements integer properties too. Strings stay in
// `value` (unchanged public shape); integers come back in a separate, additive `integers` map.
const schema = (version: Record<string, unknown>) => ({
  type: "object", additionalProperties: false, required: ["policyId", "expectedVersion"],
  properties: { policyId: { type: "string", minLength: 1 }, expectedVersion: version },
});
const VERSION = { type: "integer", minimum: 0, description: "The policy's version from identity_policy_list." };

describe("identity tool input — integer properties", () => {
  it("accepts an integer at or above its minimum and returns it separately from the strings", () => {
    const parsed = parseIdentityToolInput({ schema: schema(VERSION), input: { policyId: "p1", expectedVersion: 0 } });
    expect(parsed).toEqual({ ok: true, value: { policyId: "p1" }, integers: { expectedVersion: 0 } });
  });

  it("returns an empty integers map for a string-only schema", () => {
    const parsed = parseIdentityToolInput({
      schema: { type: "object", additionalProperties: false, required: [], properties: { a: { type: "string" } } },
      input: { a: "x" },
    });
    expect(parsed).toEqual({ ok: true, value: { a: "x" }, integers: {} });
  });

  it.each([["a fraction", 1.5, "a number"], ["a string", "3", "a string"], ["NaN", Number.NaN, "a number"], ["null", null, "null"], ["unsafe", 2 ** 60, "a number"]])(
    "refuses %s without echoing it",
    (_label, value, described) => {
      const parsed = parseIdentityToolInput({ schema: schema(VERSION), input: { policyId: "p1", expectedVersion: value } });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error.message).toBe(`'expectedVersion' must be an integer, received ${described}`);
    },
  );

  it("refuses a value below the minimum", () => {
    const parsed = parseIdentityToolInput({ schema: schema(VERSION), input: { policyId: "p1", expectedVersion: -1 } });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.message).toBe("'expectedVersion' must be at least 0");
  });

  it("still treats a missing required integer as missing", () => {
    const parsed = parseIdentityToolInput({ schema: schema(VERSION), input: { policyId: "p1" } });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.message).toBe("'expectedVersion' is required");
  });

  it("refuses an integer schema keyword it does not implement", () => {
    expect(() => parseIdentityToolInput({ schema: schema({ ...VERSION, maximum: 9 }), input: {} })).toThrow(/unimplemented keyword 'maximum'/);
  });

  it.each([["a fraction", 0.5], ["a string", "0"]])("refuses a minimum that is %s", (_label, minimum) => {
    expect(() => parseIdentityToolInput({ schema: schema({ type: "integer", minimum }), input: {} })).toThrow(
      /^identity agent-tool schema minimum for 'expectedVersion' must be an integer$/,
    );
  });

  it("refuses a string keyword on an integer property", () => {
    expect(() => parseIdentityToolInput({ schema: schema({ type: "integer", minLength: 1 }), input: {} })).toThrow(/unimplemented keyword 'minLength'/);
  });
});
