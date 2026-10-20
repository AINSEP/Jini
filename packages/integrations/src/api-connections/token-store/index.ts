/** @file Folder surface of the vault-backed OAuth token store; the api-connections entry re-exports
 * all of it except the `OAuthTokenStoreError` class (hosts read its `code`). */
export { createVaultOAuthTokenStore, type VaultOAuthTokenStore, type VaultOAuthTokenStoreDeps,
  type OAuthTokenVaultPort, type ReadConnectionGeneration } from "./vault-token-store.js";
export { parseOAuthTokenVaultMeta, type OAuthConnectionOwner,
  type OAuthConnectionStatus } from "./record.js";
export { OAuthTokenStoreError, type OAuthTokenStoreErrorCode } from "./errors.js";
