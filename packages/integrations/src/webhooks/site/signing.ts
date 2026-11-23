// Signing, replay-window and rotation rationale: ../signing.ts.
/** Bind the host signature header's t/v1 vocabulary and host clock to canonical HMAC signing/verification.
 * The worker must send the exact signed bytes. Fixed secret maps are dev/test fixtures;
 * production signing derives bytes through KeyringPort instead of persisting signing secrets.
 */
import {
  signPayload as signWebhookPayload,
  verifySignature as verifyWebhookSignature,
  createFixedSecretSigner as createWebhookFixedSigner,
  type SignPayloadInput as JiniSignPayloadInput,
  type VerifySignatureInput as JiniVerifySignatureInput,
  type WebhookSigner,
} from "../index.js";

export type { WebhookSigner } from "../index.js";
export { DEFAULT_SIGNATURE_TOLERANCE_SECONDS } from "../index.js";

export const SIGNATURE_VOCABULARY = { timestampField: "t", signatureField: "v1" } as const;
export interface SignPayloadInput extends Omit<JiniSignPayloadInput, "vocabulary" | "timestampSeconds"> {
  timestampSeconds?: number;
}
export type VerifySignatureInput = Omit<JiniVerifySignatureInput, "vocabulary" | "nowSeconds">;

/** Supply the t/v1 protocol and wall-clock default for existing host callers.
 * @complexity O(raw body bytes), delegated to Jini HMAC-SHA256.
 */
export function signPayload(input: SignPayloadInput, _optional: Record<string, never> = {}): string {
  return signWebhookPayload({ ...input, vocabulary: SIGNATURE_VOCABULARY,
    timestampSeconds: input.timestampSeconds ?? Math.floor(Date.now() / 1000),
  });
}

/** Keep the receiver's host vocabulary and current replay-window clock.
 * @complexity O(raw body bytes + signature entries).
 */
export function verifySignature(input: VerifySignatureInput, _optional: Record<string, never> = {}): boolean {
  return verifyWebhookSignature({ ...input, vocabulary: SIGNATURE_VOCABULARY, nowSeconds: Math.floor(Date.now() / 1000) });
}

/** Fixed-map host signer supplies protocol policy; production uses a keyring-backed signer. */
export function createFixedSecretSigner({ secrets }: { secrets: ReadonlyMap<string, Buffer> }, _optional: Record<string, never> = {}): WebhookSigner {
  return createWebhookFixedSigner({ secrets, vocabulary: SIGNATURE_VOCABULARY });
}
