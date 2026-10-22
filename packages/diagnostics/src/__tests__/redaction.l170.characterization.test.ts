import { describe, expect, it } from "vitest";
import { redactJsonValue } from "../redaction.js";

describe("JSON redaction characterization", () => {
  it("redacts nonempty sensitive string properties and recursively visits other values without mutation", () => {
    const value = {
      TOKEN: "private", password: "", keyCount: 3, secretFlag: false, cookie: null,
      authorization: ["plain", { password: "private" }],
      nested: { harmless: "Bearer abcd~efgh", body: "/Users/alice/code" },
      list: ["/home/alice/code", null, true, 0, { dsn: "private" }],
      monkey: "an ordinary value under a key containing key",
    };
    expect(redactJsonValue({ value }, { username: "alice" })).toEqual({
      TOKEN: "[REDACTED]", password: "", keyCount: 3, secretFlag: false, cookie: null,
      authorization: ["plain", { password: "[REDACTED]" }],
      nested: { harmless: "Bearer [REDACTED]", body: "/Users/<USER>/code" },
      list: ["/home/<USER>/code", null, true, 0, { dsn: "[REDACTED]" }],
      monkey: "[REDACTED]",
    });
    expect(value.TOKEN).toBe("private");
    expect(value.authorization).toEqual(["plain", { password: "private" }]);
    expect(value.nested.body).toBe("/Users/alice/code");
  });

  it.each([null, undefined, false, true, 0, 42])("preserves primitive %s", (value) => {
    expect(redactJsonValue({ value })).toBe(value);
  });

  it("redacts root arrays and strings using the supplied username policy", () => {
    expect(redactJsonValue({ value: ["/Users/alice/log", { token: "private" }, ["safe"]] }, { username: "alice" }))
      .toEqual(["/Users/<USER>/log", { token: "[REDACTED]" }, ["safe"]]);
    expect(redactJsonValue({ value: "/home/alice/log" }, { username: "alice" })).toBe("/home/<USER>/log");
    expect(redactJsonValue({ value: "/Users/a/log" }, { username: "a" })).toBe("/Users/a/log");
  });

  it("assigns a JSON __proto__ property as the returned object's prototype (reported, not fixed)", () => {
    const value: unknown = JSON.parse('{"__proto__":{"note":"inherited","token":"private"},"body":"safe"}');
    const result = redactJsonValue({ value });
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(result)).toEqual({ note: "inherited", token: "[REDACTED]" });
    expect(JSON.stringify(result)).toBe('{"body":"safe"}');
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});
