/** @file Public surface of the vault-backed OAuth token store (re-exported by the api-connections entry). */
export { createVaultOAuthTokenStore, type VaultOAuthTokenStore, type VaultOAuthTokenStoreDeps,
  type OAuthTokenVaultPort, type ReadConnectionGeneration } from "./vault-token-store.js";
export { parseOAuthTokenVaultMeta, OAUTH_TOKEN_RECORD_FORMAT, type OAuthConnectionOwner,
  type OAuthConnectionStatus } from "./record.js";
export { OAuthTokenStoreError, type OAuthTokenStoreErrorCode } from "./errors.js";
