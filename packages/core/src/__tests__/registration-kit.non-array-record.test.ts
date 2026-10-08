import { describe, expect, it } from "vitest";
import { isNonArrayRecord, isRecord } from "../registration-kit.js";

describe("non-array record shape", () => {
  it("rejects arrays, null, primitives and functions", () => {
    for (const value of [[], [1], null, undefined, "record", 1, true, () => ({})]) {
      expect(isNonArrayRecord({ value })).toBe(false);
    }
  });
  it("accepts ordinary, null-prototype and class objects without sanitizing them", () => {
    class Instance { field = "value"; }
    for (const value of [{}, Object.create(null), new Instance()]) {
      const candidate = { value };
      expect(isNonArrayRecord(candidate)).toBe(true);
      expect(candidate.value).toBe(value);
    }
  });
  it("preserves the existing broader isRecord contract", () => {
    expect(isRecord({ value: [] })).toBe(true);
    expect(isRecord({ value: null })).toBe(false);
  });
});
