/** Secret custody ports: the host injects the keyring and sealer; integrations never import a root key. */
import type { KeyringPort as VaultKeyringPort } from "@jini-ai/core/contracts/vault";

import type { SealedSecret } from "./types.js";

export interface RootKeyHandle {
  readonly keyId: string;
}

/**
 * The keyring is owned by the vault contract (`@jini-ai/core/contracts/vault`), including its
 * `activeKey({})` options argument: a host's one keyring object plugs into every integrations seam
 * and back without an adapter. Never redeclare it here; a second shape split the two (XM-01/PK-02).
 */
export type KeyringPort = VaultKeyringPort;

export interface SecretSealerPort {
  seal(input: { plaintext: string; key: RootKeyHandle; aad: string }): Promise<SealedSecret>;
  open(input: { sealed: SealedSecret }, optional?: { aad?: string }): Promise<string>;
}
