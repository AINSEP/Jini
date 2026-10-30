import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeSignature } from "../webhook-signature.js";

const secret = "whsec_test_only";
const ctx = { now: () => 1_700_000_000_000 };
const timestamp = "1700000000";
const rawBody = Buffer.from('{ "id": "evt_1", "name": "café" }\n');
// Independent signing assembles the bytes as the sender would, without calling plugin code.
const digest = (body: Uint8Array = rawBody, t = timestamp) => createHmac("sha256", secret)
  .update(Buffer.concat([Buffer.from(`${t}.`), body])).digest("hex");
const header = `t=${timestamp},v1=${digest()}`;
const input = { rawBody, header, secret, nowMs: ctx.now() };

describe("Stripe webhook signatures", () => {
  it("verifies independently signed exact UTF-8 bytes", () => {
    expect(verifyStripeSignature(input, {})).toBe(true);
  });
  it("rejects one changed byte", () => {
    const tampered = Buffer.from(rawBody);
    tampered[tampered.length - 1] = 32;
    expect(verifyStripeSignature({ ...input, rawBody: tampered })).toBe(false);
  });
  it("rejects JSON reserialization even when its meaning is unchanged", () => {
    const serialized = Buffer.from(JSON.stringify(JSON.parse(rawBody.toString("utf8"))));
    expect(verifyStripeSignature(input)).toBe(true);
    expect(verifyStripeSignature({ ...input, rawBody: serialized })).toBe(false);
  });
  it("rejects a different secret", () => {
    expect(verifyStripeSignature({ ...input, secret: "whsec_wrong" })).toBe(false);
  });
  it.each([[-301_000, false], [-300_001, false], [-300_000, true], [0, true], [300_000, true], [300_001, false], [301_000, false]] as const)("checks the inclusive window using injected time: %i ms", (offset, expected) => {
    expect(verifyStripeSignature({ ...input, nowMs: ctx.now() + offset })).toBe(expected);
  });
  it("accepts any matching v1 among malformed and old signatures", () => {
    expect(verifyStripeSignature({ ...input, header: `v1=bad,t=${timestamp},v1=${"0".repeat(64)},v1=${digest()},v1=${"f".repeat(64)}` })).toBe(true);
    expect(verifyStripeSignature({ ...input, header: ` t=${timestamp}, v0=ignored, v1=${digest().toUpperCase()} ` })).toBe(true);
  });
  it.each(["", "0".repeat(63), "0".repeat(65), "0".repeat(66), "g".repeat(64), `${digest()}0`, "0".repeat(64)])("rejects wrong-length, non-hex or incorrect v1: %s", signature => {
    expect(verifyStripeSignature({ ...input, header: `t=${timestamp},v1=${signature}` })).toBe(false);
  });
  it.each([
    undefined, "", "garbage", `v1=${digest()}`, `t=${timestamp}`, `t=${timestamp},v0=${digest()}`,
    `t=garbled,v1=${digest()}`, `t=,v1=${digest()}`, `t=-1,v1=${digest()}`, `t=1.5,v1=${digest()}`,
    `t=1e9,v1=${digest()}`, `t=9007199254740992,v1=${digest()}`, `t=${"9".repeat(400)},v1=${digest()}`,
    `t=${timestamp},t=${timestamp},v1=${digest()}`,
  ])("refuses missing, malformed or ambiguous headers: %s", candidate => {
    expect(verifyStripeSignature({ ...input, header: candidate })).toBe(false);
  });
  it.each([NaN, Infinity, -Infinity])("rejects invalid injected time %s", nowMs => {
    expect(verifyStripeSignature({ ...input, nowMs })).toBe(false);
  });
  it("refuses an empty signing secret", () => {
    const signature = createHmac("sha256", "").update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody])).digest("hex");
    expect(verifyStripeSignature({ ...input, secret: "", header: `t=${timestamp},v1=${signature}` })).toBe(false);
  });
  it("preserves arbitrary bytes and a Uint8Array slice's exact boundaries", () => {
    const bytes = Uint8Array.from([99, 0, 255, 128, 13, 10, 99]).subarray(1, 6);
    expect(verifyStripeSignature({ ...input, rawBody: bytes, header: `t=${timestamp},v1=${digest(bytes)}` })).toBe(true);
    expect(verifyStripeSignature({ ...input, rawBody: Buffer.from(Buffer.from(bytes).toString("utf8")), header: `t=${timestamp},v1=${digest(bytes)}` })).toBe(false);
  });
  it("signs the literal timestamp text, including leading zeros", () => {
    const t = `0${timestamp}`;
    expect(verifyStripeSignature({ ...input, header: `t=${t},v1=${digest(rawBody, t)}` })).toBe(true);
  });
});
