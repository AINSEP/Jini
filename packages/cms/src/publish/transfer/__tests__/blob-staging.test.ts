import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";

import {
  bytesMatchSha256,
  PUBLISH_CONTENT_BLOB_PROBE_MAX_SHAS,
  isValidSha256Hex,
  sha256Hex,
} from "../blob-staging.js";

/**
 * @file Task 6 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §4 task 6.
 *
 * Pins the security property `blob-staging.ts`'s own header states: bytes that do not actually hash
 * to their claimed sha256 are detected here, directly, with no route/HTTP/BlobStorePort involved —
 * see that file's header for why `putIfAbsent` cannot be relied on to catch this itself.
 */

test("sha256Hex hashes bytes to their lowercase hex digest", () => {
  const bytes = new TextEncoder().encode("hello publish-content");
  const expected = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha256Hex({ bytes }), expected);
});

test("bytesMatchSha256 is true for bytes that really do hash to the claimed sha256", () => {
  const bytes = new TextEncoder().encode("real blob bytes");
  const realSha = sha256Hex({ bytes });
  assert.equal(bytesMatchSha256({ bytes, claimedSha256: realSha }), true);
});

test("bytesMatchSha256 REFUSES bytes whose digest does not match the claimed sha256 (the security property)", () => {
  const bytes = new TextEncoder().encode("attacker-controlled bytes");
  const someOtherEntitysSha = sha256Hex({ bytes: new TextEncoder().encode("victim content") });
  assert.equal(bytesMatchSha256({ bytes, claimedSha256: someOtherEntitysSha }), false);
});

test("bytesMatchSha256 compares case-insensitively on the claimed side, always against lowercase hex", () => {
  const bytes = new TextEncoder().encode("case check");
  const realSha = sha256Hex({ bytes });
  assert.equal(bytesMatchSha256({ bytes, claimedSha256: realSha.toUpperCase() }), true);
});

test("isValidSha256Hex accepts exactly 64 lowercase hex characters", () => {
  const valid = "a".repeat(64);
  assert.equal(isValidSha256Hex({ value: valid }), true);
});

test("isValidSha256Hex rejects the wrong length, uppercase, and non-hex input", () => {
  assert.equal(isValidSha256Hex({ value: "a".repeat(63) }), false);
  assert.equal(isValidSha256Hex({ value: "a".repeat(65) }), false);
  assert.equal(isValidSha256Hex({ value: "A".repeat(64) }), false);
  assert.equal(isValidSha256Hex({ value: "g".repeat(64) }), false);
  assert.equal(isValidSha256Hex({ value: "" }), false);
});

test("PUBLISH_CONTENT_BLOB_PROBE_MAX_SHAS is a real positive bound, not accidentally zero/Infinity", () => {
  assert.ok(Number.isFinite(PUBLISH_CONTENT_BLOB_PROBE_MAX_SHAS));
  assert.ok(PUBLISH_CONTENT_BLOB_PROBE_MAX_SHAS > 0);
});
