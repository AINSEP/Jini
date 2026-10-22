/** AES-256-GCM with a fresh 12-byte IV and ciphertext || 16-byte tag, both base64 encoded.
 * Uses purpose "secret-sealer.v1" and scope "secret-sealer" for HKDF domain separation.
 * Seal requires context AAD; open accepts absent AAD solely for historical unbound records.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { KeyringPort, RootKeyHandle, SecretSealerPort } from "./ports.js";
import type { SealedSecret } from "./types.js";

const ALG = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const SEALER_PURPOSE = "secret-sealer.v1";

const SEALER_KEY_SCOPE = "secret-sealer";

export class AesGcmSecretSealer implements SecretSealerPort {
  // Derive one key per root generation, not per tenant. Data-layer ownership checks and context AAD
  // must prevent ciphertext substitution between rows; the shared encryption key alone cannot.
  // Root keys stay behind handles, and the purpose separates this HKDF domain from signing/tokens.
  // Exercise real GCM with an in-memory keyring: a plaintext fake would miss authentication failures.
  private readonly keyring: KeyringPort;
  private readonly randomBytesFn: (input: { byteLength: number }) => Uint8Array;

  /** Inject randomness for wire fixtures; production uses Node's CSPRNG for every fresh IV. */
  constructor({ keyring }: { keyring: KeyringPort }, optional: {
    randomBytesFn?: (input: { byteLength: number }) => Uint8Array;
  } = {}) {
    this.keyring = keyring;
    this.randomBytesFn = optional.randomBytesFn ?? (({ byteLength }) => randomBytes(byteLength));
  }

  /** Encrypts under the requested generation with a fresh IV; AAD must be reconstructed on open. */
  async seal(input: { plaintext: string; key: RootKeyHandle; aad: string }): Promise<SealedSecret> {
    if (typeof input.aad !== "string") throw new TypeError("AesGcmSecretSealer: aad must be a string");
    const aesKey = await this.deriveAesKey(input.key);
    const iv = Buffer.from(this.randomBytesFn({ byteLength: IV_LENGTH_BYTES }));
    if (iv.length !== IV_LENGTH_BYTES) throw new TypeError("AesGcmSecretSealer: IV must contain exactly 12 bytes");
    // GCM must never reuse an IV under the same key. AAD is authenticated but not stored in the
    // envelope, so callers must reconstruct the byte-identical context when opening the record.
    const cipher = createCipheriv(ALG, aesKey, iv);
    cipher.setAAD(Buffer.from(input.aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(input.plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      keyId: input.key.keyId,
      ciphertext: Buffer.concat([ciphertext, authTag]).toString("base64"),
      nonce: iv.toString("base64"),
      alg: ALG,
    };
  }

  /** Opens under the envelope's generation. Wrong key, tag, nonce, or AAD fails authentication. */
  async open(input: { sealed: SealedSecret }, { aad }: { aad?: string } = {}): Promise<string> {
    if (input.sealed.alg !== ALG) {
      throw new Error(`AesGcmSecretSealer cannot open alg '${input.sealed.alg}' (expected '${ALG}')`);
    }
    const aesKey = await this.deriveAesKey({ keyId: input.sealed.keyId });
    // Use the stored generation, not the active one, so rotation does not strand older ciphertext.
    // Derivation/authentication failures propagate; there is no plaintext or partial-output fallback.
    const iv = Buffer.from(input.sealed.nonce, "base64");
    const combined = Buffer.from(input.sealed.ciphertext, "base64");
    if (combined.length < AUTH_TAG_LENGTH_BYTES) {
      throw new Error("AesGcmSecretSealer: ciphertext too short to contain an auth tag");
    }
    const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH_BYTES);
    const ciphertext = combined.subarray(0, combined.length - AUTH_TAG_LENGTH_BYTES);
    const decipher = createDecipheriv(ALG, aesKey, iv);
    if (aad !== undefined) {
      decipher.setAAD(Buffer.from(aad, "utf8"));
    }
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  }

  private async deriveAesKey(key: RootKeyHandle): Promise<Uint8Array> {
    return this.keyring.derive({ workspaceId: SEALER_KEY_SCOPE, purpose: SEALER_PURPOSE, info: key.keyId });
  }
}
