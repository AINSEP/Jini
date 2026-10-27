/** Owner-only store composition. Database adapters and crypto implementations retain their original owners. */
export { openOwnerStore, OwnerStoreRecoveryError, type OpenOwnerStoreInput, type OpenOwnerStoreOptions, type OpenedOwnerStore } from "./open.js";
export { OwnerStoreService, OwnerRevocationPendingError, OwnerUnreconciledError, OWNER_REVOCATION_AUTO_ATTEMPTS, OWNER_WORKSPACE_ID, ownerContext, type OwnerStoreDatabase, type OwnerGrant, type OwnerRevocation, type OwnerUnreconciled, type OwnerPutInput, type OwnerSyncTarget } from "./service.js";
export { exportOwnerStore, restoreOwnerStore, OwnerStoreBackupError } from "./backup.js";
