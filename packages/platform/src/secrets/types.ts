/** Persisted envelope: base64 ciphertext followed by the GCM tag, plus a base64 IV. */
export interface SealedSecret {
  keyId: string;
  /** Base64 of encrypted bytes followed by the 16-byte authentication tag. */
  ciphertext: string;
  /** Base64 of the 12-byte IV. */
  nonce: string;
  alg: string;
}
