import assert from "node:assert/strict";
import { test } from "vitest";
import { parseExpectedVersion, VERSION_CONFLICT_CODE, versionConflictEnvelope } from "../expected-version.js";
import { PostValidationError, PostVersionConflictError } from "../post.js";

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

test("the 409 envelope asks the host outward-message port for its error copy and keeps both versions as fields", () => {
  const err = new PostVersionConflictError({ message: "stored text with a row id", expectedVersion: 2, currentVersion: 5 });
  const asked: Error[] = [];
  const envelope = versionConflictEnvelope({ err, outwardErrorMessage: ({ error }) => { asked.push(error); return "worded by host"; } });
  assert.deepEqual(envelope, { error: "worded by host", code: VERSION_CONFLICT_CODE, details: { expectedVersion: 2, currentVersion: 5 } });
  assert.deepEqual(asked, [err]);
});
