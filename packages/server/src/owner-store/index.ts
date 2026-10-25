/** Owner-only store composition entry for server hosts; the implementation lives in @jini-ai/db/owner-store
 * (kept there for published-host compatibility, see that entry's header). Downward L6 -> L2 re-export.
 */
export { openOwnerStore, OwnerStoreRecoveryError, type OpenOwnerStoreInput, type OpenOwnerStoreOptions, type OpenedOwnerStore,
  OwnerStoreService, OWNER_WORKSPACE_ID, ownerContext, type OwnerStoreDatabase, type OwnerGrant, type OwnerPutInput, type OwnerSyncTarget,
  exportOwnerStore, restoreOwnerStore, OwnerStoreBackupError } from "@jini-ai/db/owner-store";
