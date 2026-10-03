import type { SealedSecret } from "./types.js";

/** Generation identity only: a sealed record never carries root-key bytes. */
export interface RootKeyHandle {
  readonly keyId: string;
}

/** Swappable root-key adapter with two stable HKDF info layouts. */
export interface KeyringPort {
  activeKey(_required: Record<string, never>): Promise<RootKeyHandle>;
  deriveSigningSecret(input: { workspaceId: string; subscriptionId: string; version: number }): Promise<Uint8Array>;
  derive(input: { workspaceId: string; purpose: string; info: string }): Promise<Uint8Array>;
}

/** AAD binds new ciphertext to its context; absent open AAD supports historical records only. */
export interface SecretSealerPort {
  seal(input: { plaintext: string; key: RootKeyHandle; aad: string }): Promise<SealedSecret>;
  open(input: { sealed: SealedSecret }, optional?: { aad?: string }): Promise<string>;
}
