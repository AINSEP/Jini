---
"@jini-ai/server": minor
"@jini-ai/db": minor
---

BREAKING (`@jini-ai/server/owner-store`): the owner store is now a read-only legacy reader. Shared keys are project
references in the host, so nothing writes, migrates, grants, syncs or revokes an owner store any more. Removed:
`openOwnerStore`, `OwnerStoreService`, `exportOwnerStore`, `restoreOwnerStore`, `OwnerRevocationPendingError`,
`OwnerUnreconciledError`, `OWNER_REVOCATION_AUTO_ATTEMPTS` and their types. Added: `countLegacyOwnerStore`
(entry/grant counts, no key), `readLegacyOwnerStore` (decrypted entries plus recorded destinations, opened with
SQLite's read-only mode and never migrated) and `readLegacyOwnerBackup` (authenticates and validates a v1 or v2
backup exactly as restore did, without writing). `OwnerStoreRecoveryError`, `OwnerStoreBackupError`,
`OWNER_WORKSPACE_ID` and `ownerContext` stay. `@jini-ai/db/owner-store` drops the unpublished
`0001_owner_revocations` step (`ownerRevocationsDdl`, `ownerRevocationsMigration`); `0000_owner_store` stays.

Migration: hosts that opened an owner store import its entries into their own store through the reader.
