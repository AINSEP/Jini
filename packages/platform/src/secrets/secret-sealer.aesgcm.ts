/**
 * @file `SecretSealerPort`'s real adapter (ADR-058): AES-256-GCM with a fresh 12-byte IV and
 * ciphertext || 16-byte tag, both base64 encoded. Uses purpose "secret-sealer.v1" and scope
 * "secret-sealer" for HKDF domain separation.
 *
 * Bare `node:crypto`, no extra dependency. The AES key is never held or generated here: it is
 * re-derived on every `seal`/`open` from the injected `KeyringPort` (by-handle discipline: raw
 * root-key bytes never cross this class's boundary, only the handle's `keyId` does). The purpose
 * binds this derivation into its own HKDF domain, separate from webhook signing
 * (`deriveSigningSecret`) and token derivations sharing the same root key: `purpose` MUST be a
 * real separation boundary, not decorative.
 *
 * One shared sealing capability per root-key generation, not one key per tenant. Multi-tenant
 * separation is a property of the DATA layer (each row carries its own owner columns), matching
 * `SealedSecret.keyId`'s meaning: the generation the value was wrapped under, for the whole store.
 *
 * `aad`: because the key is shared, the key alone does not separate one row's ciphertext from
 * another's. A caller-supplied `aad` closes that gap per CALL: it is bound into the GCM tag via
 * `setAAD` (RFC 5116 §5.1), so opening with a different or absent `aad` fails exactly like a
 * tampered ciphertext. `seal` with `aad` omitted authenticates zero AAD bytes, which yields the
 * same tag as the original implementation that never called `setAAD`, so rows sealed before AAD
 * existed keep opening byte-for-byte. The ports (`SecretSealerPort`) still type `aad` as required:
 * the omission default exists for hosts' historical unbound format and direct primitive use, and a
 * host that wants "every credential store binds a row" enforces it at its call sites.
 *
 * Rule-of-two: deliberately no plaintext-passthrough test double for this port. A fake that skips
 * encryption would defeat the one thing worth testing (a value round-trips through REAL AES-GCM);
 * the lightweight test path is this class over the in-memory keyring.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { KeyringPort, RootKeyHandle, SecretSealerPort } from "@jini-ai/core/contracts/vault";
import type { SealedSecret } from "./types.js";

const ALG = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const SEALER_PURPOSE = "secret-sealer.v1";

const SEALER_KEY_SCOPE = "secret-sealer";

/**
 * `code` on what {@link AesGcmSecretSealer.open} throws when the sealed value itself can't be opened:
 * a wrong, lost or re-minted key (the GCM auth tag fails), a tampered or damaged envelope, an
 * unsupported `alg`. Callers classify by this code, never by the message: the auth-tag failure's
 * wording is the crypto runtime's own (OpenSSL in Node, BoringSSL in Electron) and may change. A
 * keyring that can't derive at all (no key, an unusable key) is NOT this: its error passes through.
 */
export const SECRET_OPEN_FAILED = "SECRET_OPEN_FAILED";

/** A sealed value that could not be opened ({@link SECRET_OPEN_FAILED}); the message is the cause's. */
export class SecretOpenError extends Error {
  readonly code = SECRET_OPEN_FAILED;

  constructor(required: { cause: unknown }, _optional: Record<string, never> = {}) {
    super(required.cause instanceof Error ? required.cause.message : String(required.cause), { cause: required.cause });
    this.name = "SecretOpenError";
  }
}

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

  /** Encrypts under the requested generation with a fresh IV; AAD must be reconstructed on open.
   * @param input.aad - Bound into the GCM tag, never stored. Omitted means zero AAD bytes: the
   *   historical unbound format (see the file header). Present but not a string is refused.
   * @returns `{keyId, ciphertext, nonce, alg}`; `ciphertext` is base64(ciphertext || 16-byte tag).
   * @throws Whatever `KeyringPort.derive()` throws (e.g. a missing root key), never swallowed into a
   *   plaintext fallback; `TypeError` for a non-string `aad` or a non-12-byte injected IV.
   * @complexity O(plaintext bytes).
   */
  async seal(input: { plaintext: string; key: RootKeyHandle; aad?: string }): Promise<SealedSecret> {
    const aad = input.aad === undefined ? "" : input.aad; // only an omitted AAD defaults; null is a caller bug
    if (typeof aad !== "string") throw new TypeError("AesGcmSecretSealer: aad must be a string");
    const aesKey = await this.deriveAesKey(input.key);
    const iv = Buffer.from(this.randomBytesFn({ byteLength: IV_LENGTH_BYTES }));
    if (iv.length !== IV_LENGTH_BYTES) throw new TypeError("AesGcmSecretSealer: IV must contain exactly 12 bytes");
    // GCM must never reuse an IV under the same key. AAD is authenticated but not stored in the
    // envelope, so callers must reconstruct the byte-identical context when opening the record.
    const cipher = createCipheriv(ALG, aesKey, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(input.plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      keyId: input.key.keyId,
      ciphertext: Buffer.concat([ciphertext, authTag]).toString("base64"),
      nonce: iv.toString("base64"),
      alg: ALG,
    };
  }

  /** Opens under the envelope's generation. Wrong key, tag, nonce, or AAD fails authentication.
   * @param optional.aad - The byte-identical string the value was sealed with; omitted iff it was
   *   sealed with none. Any mismatch, in either direction, fails the auth tag.
   * @throws {SecretOpenError} Unsupported `alg`, a malformed/short envelope, or a failed auth tag
   *   (wrong key, tampering, changed AAD), with the runtime's error kept as `cause`.
   * @throws Whatever `KeyringPort.derive()` throws, as itself (an unconfigured store, not a bad row).
   * @complexity O(ciphertext bytes).
   */
  async open(input: { sealed: SealedSecret }, { aad }: { aad?: string } = {}): Promise<string> {
    if (input.sealed.alg !== ALG) {
      throw new SecretOpenError({ cause: new Error(`AesGcmSecretSealer cannot open alg '${input.sealed.alg}' (expected '${ALG}')`) });
    }
    // Use the stored generation, not the active one, so rotation does not strand older ciphertext.
    // Derivation failures propagate as themselves; only the opening itself is SECRET_OPEN_FAILED.
    const aesKey = await this.deriveAesKey({ keyId: input.sealed.keyId });
    try {
      return decrypt({ sealed: input.sealed, aesKey, aad });
    } catch (error) {
      throw new SecretOpenError({ cause: error });
    }
  }

  private async deriveAesKey(key: RootKeyHandle): Promise<Uint8Array> {
    return this.keyring.derive({ workspaceId: SEALER_KEY_SCOPE, purpose: SEALER_PURPOSE, info: key.keyId });
  }
}

/** GCM-decrypts one envelope; no plaintext or partial-output fallback on any failure. */
function decrypt({ sealed, aesKey, aad }: { sealed: SealedSecret; aesKey: Uint8Array; aad: string | undefined }, _optional: Record<string, never> = {}): string {
  const iv = Buffer.from(sealed.nonce, "base64");
  const combined = Buffer.from(sealed.ciphertext, "base64");
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
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
