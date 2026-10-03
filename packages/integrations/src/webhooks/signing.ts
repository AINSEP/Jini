import { createHmac, timingSafeEqual } from "node:crypto";

import type { WebhookSubscriptionRecord } from "./types.js";

export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;
// Suggested five-minute replay window only: verification still requires an explicit caller choice.

/** Required wire field names, supplied by the host to preserve its existing protocol. */
export interface SignatureVocabulary { timestampField: string; signatureField: string; }
export interface SignPayloadInput {
  vocabulary: SignatureVocabulary;
  secret: Buffer;
  rawBody: string;
  timestampSeconds: number;
}

/** Sign exact body bytes with timestamp-prefixed HMAC-SHA256 using the required wire vocabulary. */
export function signPayload(input: SignPayloadInput): string {
  // Sign exactly what will be sent; re-serializing afterward invalidates the timestamp/body HMAC.
  const timestamp = input.timestampSeconds;
  const signedContent = `${timestamp}.${input.rawBody}`;
  const digest = createHmac("sha256", input.secret).update(signedContent).digest("hex");
  return `${input.vocabulary.timestampField}=${timestamp},${input.vocabulary.signatureField}=${digest}`;
}

export interface VerifySignatureInput {
  vocabulary: SignatureVocabulary;
  nowSeconds: number;
  secret: Buffer;
  rawBody: string;
  header: string;
  toleranceSeconds: number;
}

/** Verify the raw body and replay window using caller-supplied time; malformed signatures return false. */
export function verifySignature(input: VerifySignatureInput): boolean {
  const parsed = parseSignatureHeader(input.header, input.vocabulary);
  if (!parsed) return false;

  const nowSeconds = input.nowSeconds;
  if (!Number.isFinite(nowSeconds) || !Number.isFinite(input.toleranceSeconds) || input.toleranceSeconds < 0) return false;
  if (Math.abs(nowSeconds - parsed.timestamp) > input.toleranceSeconds) return false;

  const expectedHex = createHmac("sha256", input.secret)
    .update(`${parsed.timestamp}.${input.rawBody}`)
    .digest("hex");
  const expected = Buffer.from(expectedHex, "hex");

  return parsed.signatures.some((candidateHex) => {
    // Multiple signatures allow secret-generation overlap during rotation; any matching one wins.
    // Validate hex/length before timingSafeEqual, which throws rather than returning false on mismatch.
    if (!/^[0-9a-f]+$/i.test(candidateHex)) return false;
    const candidate = Buffer.from(candidateHex, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

interface SignatureHeaderPart {
  readonly key: string;
  readonly value: string;
}

function parseHeaderParts(header: string): SignatureHeaderPart[] {
  const parts: SignatureHeaderPart[] = [];
  for (const rawPart of header.split(",")) {
    const part = rawPart.trim();
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    parts.push({ key: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() });
  }
  return parts;
}

interface SignatureHeaderAccumulator {
  timestamp?: number;
  signatures: string[];
}

function applyHeaderPart(acc: SignatureHeaderAccumulator, part: SignatureHeaderPart, vocabulary: SignatureVocabulary): boolean {
  // A malformed timestamp fails immediately, regardless of part order; repeated valid timestamps
  // intentionally let the last one win to preserve the receiver's parsing contract.
  if (part.key === vocabulary.timestampField) {
    const parsedTimestamp = Number(part.value);
    if (!Number.isFinite(parsedTimestamp)) return false;
    acc.timestamp = parsedTimestamp;
  } else if (part.key === vocabulary.signatureField) {
    acc.signatures.push(part.value);
  }
  return true;
}

function parseSignatureHeader(header: string, vocabulary: SignatureVocabulary): { timestamp: number; signatures: string[] } | null {
  const acc: SignatureHeaderAccumulator = { signatures: [] };

  for (const part of parseHeaderParts(header)) {
    if (!applyHeaderPart(acc, part, vocabulary)) return null;
  }

  if (acc.timestamp === undefined || acc.signatures.length === 0) return null;
  return { timestamp: acc.timestamp, signatures: acc.signatures };
}

export interface WebhookSigner {
  // Workers depend on a signer rather than a keyring; deriving secrets instead of storing them is
  // a wiring change at this seam, not signing or delivery logic.
  signForSubscription(input: {
    subscription: WebhookSubscriptionRecord;
    rawBody: string;
    timestampSeconds: number;
  }): Promise<string>;
}

/** Create a signer from host-supplied subscription secrets; missing secrets throw. */
export function createFixedSecretSigner(required: { secrets: ReadonlyMap<string, Buffer>; vocabulary: SignatureVocabulary }): WebhookSigner {
  // A fixed map is a local/dev fixture. Production should derive signing bytes behind a keyring
  // boundary rather than persist raw secrets; this pure primitive does not own root-key access.
  return {
    async signForSubscription({ subscription, rawBody, timestampSeconds }) {
      const secret = required.secrets.get(subscription.id);
      if (!secret) {
        throw new Error(`no signing secret configured for subscription '${subscription.id}'`);
      }
      return signPayload({ secret, rawBody, timestampSeconds, vocabulary: required.vocabulary });
    },
  };
}
