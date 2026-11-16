import { describe, expect, it } from "vitest";
import { isAbortError } from "../is-abort-error.js";

describe("isAbortError", () => {
  it("duck-types the AbortError name across realms and rejects everything else", () => {
    expect(isAbortError({ error: new DOMException("stop", "AbortError") })).toBe(true);
    expect(isAbortError({ error: { name: "AbortError" } }, {})).toBe(true);
    expect(isAbortError({ error: new Error("boom") })).toBe(false);
    expect(isAbortError({ error: null })).toBe(false);
    expect(isAbortError({ error: "AbortError" })).toBe(false);
  });
});
