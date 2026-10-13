import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isNonArrayRecord as leafNonArrayRecord, isRecord as leafRecord } from "../records.js";
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

it("exports the same predicates through the pure records entry and compatibility surface", () => {
  expect(leafRecord).toBe(isRecord);
  expect(leafNonArrayRecord).toBe(isNonArrayRecord);
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  expect(manifest.jini.entries["./records"]).toBe("universal");
  expect(manifest.exports["./records"]).toEqual({
    types: "./dist/records.d.ts", import: "./dist/records.js", default: "./dist/records.js",
  });
});
