import assert from "node:assert/strict";
import { test } from "vitest";

import { callerSafeErrorMessage, type CallerSafeErrorRule } from "../model-facing-tool-errors.js";

class SafeValidationError extends Error {}
class WrapsInnerTextError extends Error {}
class UnlistedError extends Error {}

const RULES: readonly CallerSafeErrorRule[] = [
  { error: SafeValidationError },
  { error: WrapsInnerTextError, message: "the secret store is unavailable" },
];
const FALLBACK = "internal error";

test("a listed class without a fixed message publishes its own message", () => {
  assert.equal(callerSafeErrorMessage({ err: new SafeValidationError("label must be a non-empty string"), rules: RULES, fallback: FALLBACK }), "label must be a non-empty string");
});

test("a listed class with a fixed message publishes the fixed message, never its own text", () => {
  const message = callerSafeErrorMessage({ err: new WrapsInnerTextError(`unconfigured: "LEAK-TOKEN" is not valid JSON`), rules: RULES, fallback: FALLBACK });
  assert.equal(message, "the secret store is unavailable");
});

test("unknown means redacted: an unlisted class, a plain Error, a subclass of nothing listed, and a non-Error throw all get the fallback", () => {
  for (const thrown of [new UnlistedError("LEAK-A"), new Error("LEAK-B"), new TypeError("LEAK-C"), "LEAK-D", { message: "LEAK-E" }, undefined]) {
    assert.equal(callerSafeErrorMessage({ err: thrown, rules: RULES, fallback: FALLBACK }), FALLBACK, String(thrown));
  }
});

test("a subclass of a listed class matches that rule", () => {
  class NarrowerValidationError extends SafeValidationError {}
  assert.equal(callerSafeErrorMessage({ err: new NarrowerValidationError("branch is required"), rules: RULES, fallback: FALLBACK }), "branch is required");
});

