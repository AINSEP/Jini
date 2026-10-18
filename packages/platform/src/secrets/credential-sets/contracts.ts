/** Universal vault contracts and invariants, without service, keyring or storage adapters.
 * Re-export the owner so aggregate callers and persistence adapters share VaultError identity.
 * @example import { VaultError, type VaultRepoPort } from "@jini-ai/platform/secrets/credential-sets/contracts";
 */
export * from "./vault.types.js";
export { suggestCredentialWorksFor } from "./provider-matches.js";
