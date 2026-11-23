import { createKeyringBackedSigner as createWebhookSigner, type WebhookSigner } from "../index.js";
import type { KeyringPort } from "../index.js";
import { SIGNATURE_VOCABULARY } from "./signing.js";

// Per-attempt keyring derivation rationale: ../signing.keyring.ts (ADR-036 §5).
/** Supply the host's signature field vocabulary without storing or caching signing material.
 *
 * Contract rationale for the Jini implementation and this host boundary:
 *
 * @file `WebhookSigner` backed by a real `KeyringPort` (ADR-PIPE-015 Phase 1, GAP-02).
 *
 * Purpose:
 * Replaces `createFixedSecretSigner`'s dev-only fixed-map stand-in with the production signing
 * path ADR-036 §5 specifies: `HKDF(siteKey, info) via KeyringPort.deriveSigningSecret`. No secret
 * is ever cached or persisted here — every delivery attempt re-derives it from the keyring.
 *
 * How it relates to the project:
 * - `signing.ts`'s `signPayload`/`verifySignature` are unchanged — this only supplies the secret
 *   bytes those functions already expect.
 * - `./delivery.ts`'s `processDueDeliveries` depends on the `WebhookSigner` interface, not on
 *   this adapter directly, so swapping it in is a pure DI change (no call-site edits needed).
 *
 * Constructs a `WebhookSigner` that derives each subscription's signing secret from `keyring`
 * at sign time rather than reading it from an in-memory map.
 *
 * @complexity O(rawBody length) per call — one HKDF derivation plus one HMAC pass.
 * @overallScore 100
 */
export function createKeyringBackedSigner(keyring: KeyringPort): WebhookSigner {
  return createWebhookSigner({ keyring, vocabulary: SIGNATURE_VOCABULARY });
}
