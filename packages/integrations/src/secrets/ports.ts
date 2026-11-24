/** Secret custody ports: the host injects the keyring and sealer; integrations never import a root key. */
import type { UUID } from "@jini-ai/core/primitives";

import type { SealedSecret } from "./types.js";

export interface RootKeyHandle {
  readonly keyId: string;
}

export interface KeyringPort {
  activeKey(): Promise<RootKeyHandle>;

  deriveSigningSecret(input: {
    workspaceId: UUID;
    subscriptionId: UUID;
    version: number;
  }): Promise<Uint8Array>;

  derive(input: { workspaceId: UUID; purpose: string; info: string }): Promise<Uint8Array>;
}

export interface SecretSealerPort {
  seal(input: { plaintext: string; key: RootKeyHandle; aad: string }): Promise<SealedSecret>;
  open(input: { sealed: SealedSecret }, optional?: { aad?: string }): Promise<string>;
}
