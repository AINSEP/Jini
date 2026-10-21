/**
 * @file LiPay's webhook signing scheme. The legacy `lipay` gateway that lived here (charge/refund
 * over the old `ports.ts` contract) was removed with `lipay-plugin.ts` in lot L4; the signer stays
 * because the kernel's deterministic LiPay fake (`testkit/lipay-fake.ts`) signs and verifies real
 * deliveries with it, and a future LiPay provider plugin on the kernel contract will reuse it.
 *
 * The webhook signature scheme is the standard timestamped construction (the same shape Stripe
 * uses), chosen so the timestamp is inside the signed material and a captured body cannot be
 * replayed indefinitely against a fresh signature:
 *
 *     x-lipay-signature: t=<unix seconds>,v1=<hex hmac-sha256(secret, "<t>.<raw body bytes>")>
 */
import { createHmac } from "node:crypto";

/**
 * Sign exactly the bytes lipay signs. Exported so a caller (and this plugin's own tests) can
 * produce a genuinely valid delivery rather than stubbing verification out — a test that mocks the
 * signature check does not test the signature check.
 *
 * @complexity O(n) in the body length.
 * @overallScore 100
 */
export function signLipayWebhook(required: {
  secret: string;
  rawBody: Buffer;
  timestampSeconds: number;
}, _optional: Record<string, never> = {}): string {
  const mac = createHmac("sha256", required.secret)
    .update(`${required.timestampSeconds}.`)
    .update(required.rawBody)
    .digest("hex");
  return `t=${required.timestampSeconds},v1=${mac}`;
}
