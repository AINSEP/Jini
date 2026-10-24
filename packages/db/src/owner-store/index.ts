/** Owner-only SQLite store. Native driver dependencies are supplied by the host. */
export { openOwnerStore, OwnerStoreRecoveryError, type OpenOwnerStoreInput, type OpenOwnerStoreOptions, type OpenedOwnerStore } from "./open.js";
export { OwnerStoreService, OWNER_WORKSPACE_ID, ownerContext, type OwnerStoreDatabase, type OwnerGrant, type OwnerPutInput, type OwnerSyncTarget } from "./service.js";
export { exportOwnerStore, restoreOwnerStore, OwnerStoreBackupError } from "./backup.js";
