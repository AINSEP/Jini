import assert from "node:assert/strict";
import { test } from "vitest";
import { parseExpectedVersion } from "../expected-version.js";
import { PostValidationError } from "../post.js";

// F4.4/F6.2: zero is a valid OCC basis, distinct from an omitted basis.
test("version parsing preserves zero and positive integers while omission remains opt-in", () => {
  assert.equal(parseExpectedVersion({ raw: 0 }), 0);
  assert.equal(parseExpectedVersion({ raw: 7 }), 7);
  assert.equal(parseExpectedVersion({ raw: undefined }), undefined);
});

for (const raw of [NaN, Infinity, -Infinity]) {
  test(`version parsing rejects ${String(raw)} with the validation contract`, () => {
    assert.throws(() => parseExpectedVersion({ raw }), {
      constructor: PostValidationError,
      message: "'expectedVersion' must be a non-negative integer when present",
    });
  });
}
