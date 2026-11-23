import assert from "node:assert/strict";
import { test } from "vitest";

import { ToolInputError } from "@jini-ai/core";

import { EXPECTED_VERSION_REJECTION, parseExpectedVersion } from "../expected-version.js";
import { PostValidationError } from "../post.js";

/**
 * @file The post-side `parseExpectedVersion` is a host error adapter over core's one parser
 * (decision KT-DT6): the accepted set is core's — a SAFE non-negative integer — and a refusal keeps
 * reaching each arm's existing malformed-input branch as a `PostValidationError`. The unsafe-integer
 * rows document the one deliberate behaviour change: an integer above 2^53 - 1 used to be accepted
 * here and then lost as a version conflict; it is now refused as invalid input.
 */

test("an integer above the safe range is refused as invalid input, not carried to the repo as a basis", () => {
  for (const raw of [Number.MAX_SAFE_INTEGER + 1, 2 ** 53 + 2, 1e300]) {
    assert.throws(() => parseExpectedVersion({ raw }), { constructor: PostValidationError, message: EXPECTED_VERSION_REJECTION }, String(raw));
  }
});

test("the largest safe integer, zero and omission are accepted exactly as before", () => {
  assert.equal(parseExpectedVersion({ raw: Number.MAX_SAFE_INTEGER }), Number.MAX_SAFE_INTEGER);
  assert.equal(parseExpectedVersion({ raw: 0 }), 0);
  assert.equal(parseExpectedVersion({ raw: undefined }), undefined);
});

test("negative, fractional, string, null and boolean bases are refused with the PostValidationError contract", () => {
  for (const raw of [-1, 3.5, "3", null, true, {}, [3]]) {
    assert.throws(() => parseExpectedVersion({ raw }), { constructor: PostValidationError, message: "'expectedVersion' must be a non-negative integer when present" }, String(raw));
  }
});

test("the refusal keeps core's ToolInputError as its cause", () => {
  assert.throws(() => parseExpectedVersion({ raw: -1 }), (error: unknown) => error instanceof PostValidationError && error.cause instanceof ToolInputError);
});

test("an error the core parser throws that is not a ToolInputError is rethrown untouched", () => {
  const boom = new TypeError("parser broke");
  assert.throws(() => parseExpectedVersion({ raw: 1 }, { parse: () => { throw boom; } }), (error: unknown) => error === boom);
});
