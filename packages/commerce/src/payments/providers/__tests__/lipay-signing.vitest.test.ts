import { describe, expect, test } from "vitest";

import { signLipayWebhook } from "../lipay-gateway.js";

describe("LiPay timestamped raw-byte signatures", () => {
  // Fixed vectors calculated independently with Python's standard-library HMAC-SHA256.
  test("signs the timestamp, separator and exact JSON bytes", () => {
    expect(signLipayWebhook({ secret: "webhook-secret", rawBody: Buffer.from('{"amount":1234}'), timestampSeconds: 1_800_000_000 }))
      .toBe("t=1800000000,v1=2f4194e7ebf0cc33a6171f05944987b61a0e3e2d1ffc77cccfbc839a29a5d5cc");
  });

  test("preserves non-UTF8 bytes and a zero timestamp without decoding the body", () => {
    const rawBody = Buffer.from([0, 255, 195, 40, 10]);
    expect(signLipayWebhook({ secret: "webhook-secret", rawBody, timestampSeconds: 0 }))
      .toBe("t=0,v1=18377d5eab80aed0e23403097545429e97ba60dea3548a83ad65c4911d15c0f8");
    expect([...rawBody]).toEqual([0, 255, 195, 40, 10]);
  });

  test("an empty body still signs the timestamp and separator", () => {
    expect(signLipayWebhook({ secret: "webhook-secret", rawBody: Buffer.alloc(0), timestampSeconds: 1_800_000_000 }))
      .toBe("t=1800000000,v1=10f0f5fe62a2b7e4dd5930da7c85ab11c211605fc77d10a3766c52713330ecf4");
  });
});
