import assert from "node:assert/strict";
import { test } from "vitest";

import { MAX_PASSWORD_LENGTH, validatePasswordPolicy } from "../password-policy.js";

/**
 * @file Direct unit coverage for the password policy after the owner decision to drop the
 * 12-character minimum (MSG-04): presence is still required, `MAX_PASSWORD_LENGTH` is still
 * enforced, no minimum length remains.
 */

test("validatePasswordPolicy: a password shorter than the former 12-character minimum is now accepted", () => {
  assert.equal(validatePasswordPolicy("a"), null);
  assert.equal(validatePasswordPolicy("short7"), null);
});

test("validatePasswordPolicy: an empty password is still rejected", () => {
  assert.equal(validatePasswordPolicy(""), "Password is required.");
});

test("validatePasswordPolicy: a password over MAX_PASSWORD_LENGTH is still rejected", () => {
  const tooLong = "a".repeat(MAX_PASSWORD_LENGTH + 1);
  assert.equal(
    validatePasswordPolicy(tooLong),
    `Password must be no more than ${MAX_PASSWORD_LENGTH} characters.`
  );
});

test("validatePasswordPolicy: a password at exactly MAX_PASSWORD_LENGTH is still accepted", () => {
  const atMax = "a".repeat(MAX_PASSWORD_LENGTH);
  assert.equal(validatePasswordPolicy(atMax), null);
});
