import assert from "node:assert/strict";
import { test, beforeEach, vi } from "vitest";

import { signPayload, verifySignature } from "../signing.js";

const secret = Buffer.from("test-signing-secret");
const rawBody = JSON.stringify({ topic: "post.published", data: { id: "post-1" } });
const timestampSeconds = 1720000000;
// Pin the wall clock so the default `timestampSeconds` is deterministic in every test.
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(timestampSeconds * 1000); });

// F4.1: independently calculated with Python hmac/sha256 over the literal UTF-8 wire bytes.
test("signPayload matches the published timestamp-dot-body HMAC-SHA256 wire format", () => {
  const body = '{"topic":"post.published","data":{"id":"post-1"}}';
  const expected = "t=1720000000,v1=0abfec753eb9bc10c30880638c61b6c0b8a9943bd774fa3f78f5850964c7a059";
  assert.equal(signPayload({ secret: Buffer.from("test-signing-secret"), rawBody: body, timestampSeconds: 1720000000 }), expected);
  assert.equal(verifySignature({ secret: Buffer.from("test-signing-secret"), rawBody: body, header: expected, toleranceSeconds: 300 }), true);
});

test("signPayload then verifySignature round-trips for the same secret and body", () => {
  const header = signPayload({ secret, rawBody, timestampSeconds });

  assert.match(header, /^t=\d+,v1=[0-9a-f]{64}$/);
  assert.equal(
    verifySignature({ secret, rawBody, header, toleranceSeconds: 300 }),
    true
  );
});

test("verifySignature rejects a tampered body", () => {
  const header = signPayload({ secret, rawBody, timestampSeconds });
  const tamperedBody = JSON.stringify({ topic: "post.published", data: { id: "post-2" } });

  assert.equal(
    verifySignature({ secret, rawBody: tamperedBody, header, toleranceSeconds: 300 }),
    false
  );
});

test("verifySignature rejects a signature made with a different secret", () => {
  const header = signPayload({ secret, rawBody, timestampSeconds });
  const otherSecret = Buffer.from("a-different-secret");

  assert.equal(
    verifySignature({ secret: otherSecret, rawBody, header, toleranceSeconds: 300 }),
    false
  );
});

test("verifySignature rejects timestamps outside either side of the tolerance window and accepts its exact boundaries", () => {
  for (const offset of [-10_000, 10_000]) {
    const header = signPayload({ secret, rawBody, timestampSeconds: timestampSeconds + offset });
    assert.equal(verifySignature({ secret, rawBody, header, toleranceSeconds: 300 }), false);
    assert.equal(verifySignature({ secret, rawBody, header, toleranceSeconds: 20_000 }), true);
  }
  for (const [offset, accepted] of [[-301, false], [-300, true], [0, true], [300, true], [301, false]] as const) {
    const header = signPayload({ secret, rawBody, timestampSeconds: timestampSeconds + offset });
    assert.equal(verifySignature({ secret, rawBody, header, toleranceSeconds: 300 }), accepted, `timestamp offset ${offset}`);
  }
});

test("verifySignature accepts a header carrying two v1 values (rotation overlap) if either matches", () => {
  const header = signPayload({ secret, rawBody, timestampSeconds });
  const otherSecret = Buffer.from("previous-generation-secret");
  const otherHeader = signPayload({ secret: otherSecret, rawBody, timestampSeconds });
  const otherHex = otherHeader.split(",")[1];

  const combinedHeader = `${header},${otherHex}`;

  assert.equal(
    verifySignature({ secret, rawBody, header: combinedHeader, toleranceSeconds: 300 }),
    true
  );
  assert.equal(
    verifySignature({ secret: otherSecret, rawBody, header: combinedHeader, toleranceSeconds: 300 }),
    true
  );
});

test("verifySignature rejects a malformed header", () => {
  assert.equal(
    verifySignature({ secret, rawBody, header: "not-a-real-header", toleranceSeconds: 300 }),
    false
  );
  assert.equal(
    verifySignature({ secret, rawBody, header: "t=abc,v1=deadbeef", toleranceSeconds: 300 }),
    false
  );
});

test("signPayload stamps the current wall-clock second when no timestampSeconds is supplied", () => {
  const header = signPayload({ secret, rawBody });

  assert.equal(header, signPayload({ secret, rawBody, timestampSeconds }));
  assert.equal(verifySignature({ secret, rawBody, header, toleranceSeconds: 0 }), true);
});
