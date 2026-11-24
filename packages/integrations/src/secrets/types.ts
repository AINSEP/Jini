/** keyId identifies the wrapping-key generation so export adapters can rewrap or strip a secret
 * explicitly instead of silently transporting it with ordinary content. Ciphertext/nonce are
 * base64 AEAD data; alg identifies the authenticated cipher. */
export interface SealedSecret {
  keyId: string;
  ciphertext: string;
  nonce: string;
  alg: string;
}
