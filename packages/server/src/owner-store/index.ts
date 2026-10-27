/** Read-only legacy owner-store access. Shared keys are project references now: nothing writes,
 * migrates or syncs an owner store; hosts only read one (or its backup) to import its entries.
 */
export { countLegacyOwnerStore, readLegacyOwnerStore, ownerContext, OwnerStoreRecoveryError, OWNER_WORKSPACE_ID,
  type LegacyOwnerCounts, type LegacyOwnerDestination, type LegacyOwnerEntry, type LegacyOwnerSnapshot, type LegacyOwnerStoreFile } from "./legacy.js";
export { readLegacyOwnerBackup, OwnerStoreBackupError } from "./backup.js";
