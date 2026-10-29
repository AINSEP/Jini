import { createHmac, timingSafeEqual } from "node:crypto";

/** Verifies Stripe's timestamped HMAC over exact bytes with a fixed five-minute replay window.
 * @param required Raw body, signature header, account secret and host-supplied epoch milliseconds.
 * @returns False for missing/malformed credentials, headers, timestamps or signatures; no I/O.
 * @complexity O(b + h) time/space in body/header bytes; one HMAC regardless of signature count.
 * @example verifyStripeSignature({ rawBody, header, secret, nowMs: ctx.now() })
 */
export function verifyStripeSignature(
  { rawBody, header, secret, nowMs }: { rawBody: Uint8Array; header: string | undefined; secret: string; nowMs: number },
  _optional: Record<string, never> = {}
): boolean {
  if (header === undefined || secret.length === 0 || !Number.isFinite(nowMs)) return false;
  const parts = header.split(",").map(part => part.trim());
  const timestamps = parts.filter(part => part.startsWith("t="));
  if (timestamps.length !== 1) return false;
  const timestamp = timestamps[0]!.slice(2);
  const seconds = Number(timestamp);
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(seconds)) return false;
  if (Math.abs(nowMs / 1000 - seconds) > 300) return false;
  // Never decode/re-serialize: UTF-8 replacement or JSON normalization changes the signed bytes.
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest();
  return parts.some(part => {
    if (!part.startsWith("v1=")) return false;
    const signature = part.slice(3);
    // Exact hex length also rejects odd-nibble truncation before timingSafeEqual can throw.
    if (signature.length !== expected.length * 2 || !/^[0-9a-f]+$/i.test(signature)) return false;
    return timingSafeEqual(Buffer.from(signature, "hex"), expected);
  });
}
