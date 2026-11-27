import { expect, it } from "vitest";
import { errorCodeOf, fallbackIf, fallbackIfMissing } from "../errno.js";

it.each([
  [null, undefined],
  [undefined, undefined],
  ["ENOENT", undefined],
  [{ message: "missing" }, undefined],
  [{ code: 13 }, undefined],
  [Object.assign(new Error("denied"), { code: "EACCES" }), "EACCES"],
])("extracts only a string system error code from %j", (error, code) => {
  expect(errorCodeOf({ error })).toBe(code);
});

it("returns a fallback for a matching error and rethrows an unrelated failure unchanged", () => {
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  const denied = Object.assign(new Error("denied"), { code: "EACCES" });
  const matches = (error: unknown) => error === missing;
  expect(fallbackIf({ error: missing, matches, fallback: "default" })).toBe("default");
  expect(fallbackIfMissing({ error: missing, fallback: "default" })).toBe("default");
  expect(() => fallbackIf({ error: denied, matches, fallback: "default" })).toThrow(denied);
  expect(() => fallbackIfMissing({ error: denied, fallback: "default" })).toThrow(denied);
});
