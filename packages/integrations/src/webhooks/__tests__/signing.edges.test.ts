import { describe, expect, it } from "vitest";

import { signPayload, verifySignature } from "../signing.js";

/**
 * Edges of `verifySignature` (Stryker L6: 17 survivors). Webhook signature verification is a
 * security boundary, so each malformed-input class gets its own refusal case.
 */

const vocabulary = { timestampField: "t", signatureField: "v1" };
const secret = Buffer.from("edge-secret");
const rawBody = '{"id":1}';
const ts = 1_700_000_000;
const header = signPayload({ vocabulary, secret, rawBody, timestampSeconds: ts });
const sig = header.split(",v1=")[1]!;
const verify = (over: Partial<Parameters<typeof verifySignature>[0]> = {}) =>
  verifySignature({ vocabulary, nowSeconds: ts, secret, rawBody, header, toleranceSeconds: 300, ...over });

describe("verifySignature: signature value must be exactly the canonical hex digest", () => {
  it("the canonical header verifies", () => {
    expect(verify()).toBe(true);
  });

  it.each([
    ["one trailing hex char (odd length)", `${sig}a`],
    ["one trailing zero", `${sig}0`],
    ["two trailing hex chars", `${sig}00`],
    ["trailing non-hex", `${sig}zz`],
    ["leading non-hex", `zz${sig}`],
    ["leading hex pair", `00${sig}`],
    ["truncated by one char", sig.slice(0, -1)],
    ["truncated by one byte", sig.slice(0, -2)],
    ["embedded junk", `${sig.slice(0, 10)}-${sig.slice(10)}`],
    ["empty", ""],
  ])("%s is refused", (_label, candidate) => {
    expect(verify({ header: `t=${ts},v1=${candidate}` })).toBe(false);
  });

  it("uppercase hex of the same digest is accepted (hex is case-insensitive)", () => {
    expect(verify({ header: `t=${ts},v1=${sig.toUpperCase()}` })).toBe(true);
  });
});

describe("verifySignature: header parsing", () => {
  it("tolerates whitespace around parts, keys and values", () => {
    expect(verify({ header: `  t = ${ts} ,  v1 = ${sig}  ` })).toBe(true);
  });

  it("ignores parts without '=' and unknown keys", () => {
    expect(verify({ header: `garbage,t=${ts},x=1,v1=${sig}` })).toBe(true);
  });

  it("a part order of signature-before-timestamp still verifies", () => {
    expect(verify({ header: `v1=${sig},t=${ts}` })).toBe(true);
  });

  it.each([
    ["no timestamp", `v1=${sig}`],
    ["no signature", `t=${ts}`],
    ["non-numeric timestamp", `t=abc,v1=${sig}`],
    ["malformed timestamp AFTER a valid one", `t=${ts},t=nope,v1=${sig}`],
    ["empty header", ""],
    ["key with '=' only", `=${ts},v1=${sig}`],
  ])("%s → false", (_label, h) => {
    expect(verify({ header: h })).toBe(false);
  });

  it("the last valid timestamp wins", () => {
    expect(verify({ header: `t=1,t=${ts},v1=${sig}` })).toBe(true);
    expect(verify({ header: `t=${ts},t=1,v1=${sig}` })).toBe(false);
  });

  it("one bad and one good signature (rotation overlap) verifies, in either order", () => {
    expect(verify({ header: `t=${ts},v1=${"0".repeat(64)},v1=${sig}` })).toBe(true);
    expect(verify({ header: `t=${ts},v1=${sig},v1=zz` })).toBe(true);
  });
});

describe("verifySignature: time window", () => {
  it.each([
    ["exactly at +tolerance", ts + 300, true],
    ["exactly at -tolerance", ts - 300, true],
    ["one past +tolerance", ts + 301, false],
    ["one past -tolerance", ts - 301, false],
  ])("now %s → %s", (_label, nowSeconds, ok) => {
    expect(verify({ nowSeconds })).toBe(ok);
  });

  it.each([
    ["NaN now", { nowSeconds: Number.NaN }],
    ["Infinity now", { nowSeconds: Number.POSITIVE_INFINITY }],
    ["NaN tolerance", { toleranceSeconds: Number.NaN }],
    ["Infinity tolerance", { toleranceSeconds: Number.POSITIVE_INFINITY }],
    ["negative tolerance", { toleranceSeconds: -1 }],
  ])("%s → false even with a valid signature", (_label, over) => {
    expect(verify(over)).toBe(false);
  });

  it("zero tolerance accepts only the exact second", () => {
    expect(verify({ toleranceSeconds: 0 })).toBe(true);
    expect(verify({ toleranceSeconds: 0, nowSeconds: ts + 1 })).toBe(false);
  });
});

describe("verifySignature: survivor follow-ups", () => {
  it("a valid digest under an unknown key is not a signature", () => {
    expect(verify({ header: `t=${ts},v2=${sig}` })).toBe(false);
    expect(verify({ header: `t=${ts},x=${sig},v1=${"0".repeat(64)}` })).toBe(false);
  });

  it("a header signed with a non-finite timestamp never verifies, even with a matching HMAC", () => {
    const nanHeader = signPayload({ vocabulary, secret, rawBody, timestampSeconds: Number.NaN });
    expect(verify({ header: nanHeader })).toBe(false);
    const infHeader = signPayload({ vocabulary, secret, rawBody, timestampSeconds: Number.POSITIVE_INFINITY });
    expect(verify({ header: infHeader, nowSeconds: Number.POSITIVE_INFINITY })).toBe(false);
  });
});
