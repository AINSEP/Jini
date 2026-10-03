import assert from "node:assert/strict";
import { test } from "vitest";

import { signPayload, verifySignature } from "../signing.js";

const vocabulary = { timestampField: "t", signatureField: "v1" };


const secret = Buffer.from("test-signing-secret");
const rawBody = JSON.stringify({ topic: "post.published", data: { id: "post-1" } });
const timestampSeconds = 1_700_000_000;

test("signPayload then verifySignature round-trips for the same secret and body", () => {
  const header = signPayload({ vocabulary, secret, rawBody, timestampSeconds });

  assert.match(header, /^t=\d+,v1=[0-9a-f]{64}$/);
  assert.equal(
    verifySignature({ vocabulary, nowSeconds: timestampSeconds, secret, rawBody, header, toleranceSeconds: 300 }),
    true
  );
});

test("verifySignature rejects a tampered body", () => {
  const header = signPayload({ vocabulary, secret, rawBody, timestampSeconds });
  const tamperedBody = JSON.stringify({ topic: "post.published", data: { id: "post-2" } });

  assert.equal(
    verifySignature({ vocabulary, nowSeconds: timestampSeconds, secret, rawBody: tamperedBody, header, toleranceSeconds: 300 }),
    false
  );
});

test("verifySignature rejects a signature made with a different secret", () => {
  const header = signPayload({ vocabulary, secret, rawBody, timestampSeconds });
  const otherSecret = Buffer.from("a-different-secret");

  assert.equal(
    verifySignature({ vocabulary, nowSeconds: timestampSeconds, secret: otherSecret, rawBody, header, toleranceSeconds: 300 }),
    false
  );
});

test("verifySignature rejects a timestamp outside the tolerance window", () => {
  const header = signPayload({ vocabulary, secret, rawBody, timestampSeconds });
  const nowSeconds = 1_700_000_000;
  const staleHeader = signPayload({ vocabulary,
    secret,
    rawBody,
    timestampSeconds: nowSeconds - 10_000,
  });

  assert.equal(
    verifySignature({ vocabulary, nowSeconds: timestampSeconds, secret, rawBody, header: staleHeader, toleranceSeconds: 300 }),
    false
  );
  assert.equal(
    verifySignature({ vocabulary, nowSeconds: timestampSeconds, secret, rawBody, header: staleHeader, toleranceSeconds: 20_000 }),
    true
  );
});

test("verifySignature accepts a header carrying two v1 values (rotation overlap) if either matches", () => {
  const header = signPayload({ vocabulary, secret, rawBody, timestampSeconds });
  const otherSecret = Buffer.from("previous-generation-secret");
  const otherHeader = signPayload({ vocabulary, secret: otherSecret, rawBody, timestampSeconds });
  const otherHex = otherHeader.split(",")[1];

  const combinedHeader = `${header},${otherHex}`;

  assert.equal(
    verifySignature({ vocabulary, nowSeconds: timestampSeconds, secret, rawBody, header: combinedHeader, toleranceSeconds: 300 }),
    true
  );
  assert.equal(
    verifySignature({ vocabulary, nowSeconds: timestampSeconds, secret: otherSecret, rawBody, header: combinedHeader, toleranceSeconds: 300 }),
    true
  );
});

test("verifySignature rejects a malformed header", () => {
  assert.equal(
    verifySignature({ vocabulary, nowSeconds: timestampSeconds, secret, rawBody, header: "not-a-real-header", toleranceSeconds: 300 }),
    false
  );
  assert.equal(
    verifySignature({ vocabulary, nowSeconds: timestampSeconds, secret, rawBody, header: "t=abc,v1=deadbeef", toleranceSeconds: 300 }),
    false
  );
});
