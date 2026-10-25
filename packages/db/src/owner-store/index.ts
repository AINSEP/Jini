/** Owner-only SQLite store. Native driver dependencies are supplied by the host.
 * Compatibility: published hosts (0.6.12) import the composition from this entry, so it stays here.
 * Moving it to @jini-ai/server/owner-store would clear db's platform sibling edges, but a db facade
 * re-exporting from server is an upward edge AND a db<->server build cycle. Server re-exports this
 * entry instead; move the implementation once hosts import @jini-ai/server/owner-store.
 */
export { openOwnerStore, OwnerStoreRecoveryError, type OpenOwnerStoreInput, type OpenOwnerStoreOptions, type OpenedOwnerStore } from "./open.js";
export { OwnerStoreService, OWNER_WORKSPACE_ID, ownerContext, type OwnerStoreDatabase, type OwnerGrant, type OwnerPutInput, type OwnerSyncTarget } from "./service.js";
export { exportOwnerStore, restoreOwnerStore, OwnerStoreBackupError } from "./backup.js";
export { OWNER_STORE_LEDGER, ownerStoreMigrations } from "./migrations/index.js";
export { ownerStoreDdl, ownerStoreMigration } from "./migrations/0000_owner_store.js";
