/** Derive signing material through a local structural platform/secrets port; raw root keys stay in the adapter. */
import { signPayload, type SignatureVocabulary, type WebhookSigner } from "./signing.js";
import type { KeyringPort } from "./ports.js";

// Re-derive each subscription's secret for every delivery attempt; never cache or persist signing
// material here. The keyring owns root-key derivation, while delivery depends on WebhookSigner
// so replacing a fixed-secret development signer requires only dependency injection.
export function createKeyringBackedSigner(required: { keyring: Pick<KeyringPort, "deriveSigningSecret">; vocabulary: SignatureVocabulary }): WebhookSigner {
  return {
    async signForSubscription({ subscription, rawBody, timestampSeconds }) {
      const secret = await required.keyring.deriveSigningSecret({
        workspaceId: subscription.workspaceId,
        subscriptionId: subscription.id,
        version: subscription.secretVersion,
      });
      return signPayload({ secret: Buffer.from(secret), rawBody, timestampSeconds, vocabulary: required.vocabulary });
    },
  };
}
