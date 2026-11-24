import type { SealedSecret } from "@jini-ai/core/contracts/vault";

/** Job 2 owns encryption, vault capture, recipient re-sealing and password AAD.
 * The archive orchestrator supplies the SAME snapshot used for content projection.
 * Passwords never enter a plan, archive, job result or registry in plaintext.
 */
export interface SiteSavedKeysPort {
  capture(required: { snapshot: Buffer; shareId: string; workspaceId: string }, optional?: { signal?: AbortSignal }): Promise<{ encryptedKeys: Buffer; sealedPassword: SealedSecret; notices: readonly string[] }>;
  reveal(required: { sealedPassword: SealedSecret; shareId: string; workspaceId: string }, optional?: Record<string, never>): Promise<{ password: string }>;
  /** siteId is the lifecycle's allocated identity. Restore runs BEFORE its final metadata commit;
   * recipient key setup must use this id without minting a replacement site identity/commit marker.
   * Missing/wrong passwords and invalid optional payloads return safe notices, with no partial keys.
   */
  restore(required: { encryptedKeys: Buffer; password?: string; siteId: string; dir: string; dbPath: string }, optional?: { signal?: AbortSignal }): Promise<{ notices: readonly string[] }>;
}

export const SAVED_KEYS_PATH = "secrets/saved-keys.json";
export const ENCRYPTED_KEYS_DESCRIPTOR = { version: 1, path: SAVED_KEYS_PATH, format: "jini-passphrase-envelope" } as const;
