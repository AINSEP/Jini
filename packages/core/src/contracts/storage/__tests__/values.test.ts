import { describe, expect, it } from "vitest";

import { isUniqueViolation, toBool, toBytes } from "../values.js";

describe("toBool", () => {
  it("reads null and undefined as null", () => {
    expect(toBool(null)).toBeNull();
    expect(toBool(undefined)).toBeNull();
  });

  it("reads 1 and true as true, 0 and false as false", () => {
    expect(toBool(1)).toBe(true);
    expect(toBool(true)).toBe(true);
    expect(toBool(0)).toBe(false);
    expect(toBool(false)).toBe(false);
  });
});

describe("isUniqueViolation", () => {
  it("recognises the SQLite constraint code", () => {
    expect(isUniqueViolation(Object.assign(new Error("x"), { code: "SQLITE_CONSTRAINT_UNIQUE" }))).toBe(true);
  });

  it("recognises Postgres SQLSTATE 23505", () => {
    expect(isUniqueViolation(Object.assign(new Error("x"), { code: "23505" }))).toBe(true);
  });

  it("falls back to the SQLite message wording", () => {
    expect(isUniqueViolation(new Error("UNIQUE constraint failed: t.id"))).toBe(true);
  });

  it("rejects other errors and non-errors", () => {
    expect(isUniqueViolation(Object.assign(new Error("x"), { code: "23503" }))).toBe(false);
    expect(isUniqueViolation("UNIQUE constraint failed")).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("toBytes", () => {
  it("returns a view over a Uint8Array at its own offset and length", () => {
    const backing = new Uint8Array([9, 1, 2, 3, 9]);
    const bytes = toBytes(backing.subarray(1, 4));
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(bytes.byteOffset).toBe(1);
  });

  it("throws on a non-binary value", () => {
    expect(() => toBytes("abc")).toThrow("expected a binary column value, got string");
  });
});
