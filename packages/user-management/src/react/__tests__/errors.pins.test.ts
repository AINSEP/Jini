import { describe, expect, it } from "vitest";
import { describeIdentityError } from "../errors.js";

// Characterization pins for `describeIdentityError`: every branch of the code -> message mapping,
// written against the pre-refactor implementation so the split into helpers cannot drift.
const translate = (key: string) => `t:${key}`;
const coded = (code: unknown, message = "") => Object.assign(new Error(message), { code });

describe("describeIdentityError — VALIDATION_ERROR", () => {
  it("returns the Error's own message when it has one", () => {
    expect(describeIdentityError({ error: coded("VALIDATION_ERROR", "username is required"), fallback: "fb", translate }))
      .toBe("username is required");
  });

  it("falls back to the translated field hint when the Error message is empty", () => {
    expect(describeIdentityError({ error: coded("VALIDATION_ERROR"), fallback: "fb", translate }))
      .toBe("t:Please correct the highlighted fields.");
  });

  it("uses the translated field hint for a plain (non-Error) object carrying the code", () => {
    expect(describeIdentityError({ error: { code: "VALIDATION_ERROR", message: "ignored" }, fallback: "fb", translate }))
      .toBe("t:Please correct the highlighted fields.");
  });

  it("is not overridden by a messages entry for VALIDATION_ERROR", () => {
    expect(describeIdentityError({ error: coded("VALIDATION_ERROR", "raw"), fallback: "fb", translate },
      { messages: { VALIDATION_ERROR: "mapped" } })).toBe("raw");
  });
});

describe("describeIdentityError — mapped codes", () => {
  it("translates the mapped message for a known code, ignoring the Error message", () => {
    expect(describeIdentityError({ error: coded("FORBIDDEN", "403 raw"), fallback: "fb", translate },
      { messages: { FORBIDDEN: "No permission." } })).toBe("t:No permission.");
  });

  it("maps a code carried by a plain object, not just an Error", () => {
    expect(describeIdentityError({ error: { code: "FORBIDDEN" }, fallback: "fb", translate },
      { messages: { FORBIDDEN: "No permission." } })).toBe("t:No permission.");
  });

  it("treats an empty mapped message as unmapped and uses the Error message", () => {
    expect(describeIdentityError({ error: coded("FORBIDDEN", "raw"), fallback: "fb", translate },
      { messages: { FORBIDDEN: "" } })).toBe("raw");
  });

  it("uses the Error message for an unmapped code", () => {
    expect(describeIdentityError({ error: coded("SOMETHING_ELSE", "raw"), fallback: "fb", translate },
      { messages: { FORBIDDEN: "No permission." } })).toBe("raw");
  });

  it("uses the fallback for an unmapped code on an Error with no message", () => {
    expect(describeIdentityError({ error: coded("SOMETHING_ELSE"), fallback: "fb", translate })).toBe("fb");
  });

  it("ignores a non-string code and uses the Error message", () => {
    expect(describeIdentityError({ error: coded(403, "raw"), fallback: "fb", translate },
      { messages: { 403: "mapped" } })).toBe("raw");
  });

  it("looks a code up through Object.prototype when no messages map is given (reported, not fixed)", () => {
    // `messages[code]` reads inherited keys: a server code of "constructor" resolves to
    // `Object` itself, so the caller's translator receives a function instead of a string.
    const received: unknown[] = [];
    const recording = (key: string) => { received.push(key); return "translated"; };
    expect(describeIdentityError({ error: coded("constructor", "raw"), fallback: "fb", translate: recording })).toBe("translated");
    expect(received).toEqual([Object]);
  });
});

describe("describeIdentityError — uncoded errors", () => {
  it("returns an Error's message", () => {
    expect(describeIdentityError({ error: new Error("connection lost"), fallback: "fb", translate })).toBe("connection lost");
  });

  it("returns the fallback for an Error with an empty message", () => {
    expect(describeIdentityError({ error: new Error(""), fallback: "fb", translate })).toBe("fb");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "boom"],
    ["a number", 0],
    ["an object without code", { message: "not an Error" }],
  ])("returns the fallback for %s", (_label, error) => {
    expect(describeIdentityError({ error, fallback: "fb", translate })).toBe("fb");
  });
});
