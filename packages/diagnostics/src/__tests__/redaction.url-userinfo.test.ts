import { describe, expect, it } from "vitest";

import { redactJsonValue, redactText } from "../redaction.js";

// Connection strings carry their password in the URL's userinfo, whatever its length or shape; host and path stay readable.
describe("URL userinfo in bundle text", () => {
  it.each([
    ["postgres://user:Hx7short@db.example/path", "postgres://[REDACTED]@db.example/path"],
    ["redis://:Hx7short@cache.example:6379", "redis://[REDACTED]@cache.example:6379"],
    ["connect mysql://app:p@ss4@db.example/x failed", "connect mysql://[REDACTED]@db.example/x failed"],
  ])("masks %j", (input, expected) => {
    expect(redactText({ text: input })).toBe(expected);
    expect(redactJsonValue({ value: { note: input } })).toEqual({ note: expected });
  });

  it.each(["https://db.example/path", "see //comment: a@b", "user@example.com"])("keeps %j", input => {
    expect(redactText({ text: input })).toBe(input);
  });

  it("scans a long run of authority starts in linear time", () => {
    const input = "//a:".repeat(50_000);
    const started = performance.now();
    redactText({ text: input });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
