/**
 * @file Stripe webhook signatures (https://docs.stripe.com/webhooks#verify-manually).
 *
 * Header: `Stripe-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>…]` (other schemes such as `v0`
 * are ignored). The signature is HMAC-SHA256, keyed by the endpoint secret, over
 * `${t}.${rawBody}` — the EXACT bytes received, never a re-serialized JSON. Several `v1` entries
 * appear while Stripe rolls an endpoint secret; we in turn hold up to two secrets (current and
 * previous) while the host rotates ours. A delivery is genuine when ANY v1 matches ANY active
 * secret, compared in constant time, and its timestamp is within the tolerance of `now` (replay).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface StripeSignatureHeader {
  readonly timestamp: number;
  readonly signatures: readonly string[];
}

const HEX_SHA256 = /^[0-9a-f]{64}$/;

/**
 * Parse the header, or `undefined` when it has no numeric `t` or no well-formed `v1`.
 * @complexity O(n) in the header length.
 */
export function parseStripeSignatureHeader({ header }: { header: string }, _optional: Record<string, never> = {}): StripeSignatureHeader | undefined {
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value = ""] = part.trim().split("=", 2);
    if (key === "t" && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    if (key === "v1" && HEX_SHA256.test(value)) signatures.push(value);
  }
  return timestamp === undefined || signatures.length === 0 ? undefined : { timestamp, signatures };
}

/** The hex `v1` signature Stripe would send for these bytes. Exported so host tests can sign fixtures. */
export function signStripePayload(
  { secret, timestamp, rawBody }: { secret: string; timestamp: number; rawBody: Uint8Array },
  _optional: Record<string, never> = {}
): string {
  return createHmac("sha256", secret).update(`${timestamp}.`, "utf8").update(rawBody).digest("hex");
}

/** Constant-time equality of two well-formed hex digests (both 64 chars, so lengths always match). */
const sameDigest = (a: string, b: string): boolean => timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));

export type SignatureVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Verify a delivery. Empty secrets are dropped first, so an unset rotation slot can never match.
 * @param required.secrets - The active endpoint secrets (current, previous).
 * @param required.nowMs - The host clock (epoch ms).
 * @param required.toleranceSec - Maximum |now − t| in seconds.
 * @complexity O(s × v) HMAC comparisons for s secrets and v signatures (both ≤ 2 in practice).
 */
export function verifyStripeSignature(
  required: { rawBody: Uint8Array; header: string | undefined; secrets: readonly (string | undefined)[]; nowMs: number; toleranceSec: number },
  _optional: Record<string, never> = {}
): SignatureVerdict {
  const secrets = required.secrets.filter((secret): secret is string => typeof secret === "string" && secret.length > 0);
  if (secrets.length === 0) return { ok: false, reason: "no webhook secret is configured" };
  const parsed = parseStripeSignatureHeader({ header: required.header ?? "" });
  if (parsed === undefined) return { ok: false, reason: "Stripe-Signature header is missing or malformed" };
  if (Math.abs(required.nowMs - parsed.timestamp * 1000) > required.toleranceSec * 1000) {
    return { ok: false, reason: "signature timestamp is outside the tolerance window" };
  }
  const expected = secrets.map((secret) => signStripePayload({ secret, timestamp: parsed.timestamp, rawBody: required.rawBody }));
  const matches = expected.some((digest) => parsed.signatures.some((candidate) => sameDigest(digest, candidate)));
  return matches ? { ok: true } : { ok: false, reason: "no v1 signature matches an active webhook secret" };
}
