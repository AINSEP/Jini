---
"@jini-ai/server": major
"@jini-ai/platform": minor
"@jini-ai/db": minor
---

The legacy owner-store decoder and its vault policy moved out of the server preset to their owners. `@jini-ai/platform/secrets/legacy-owner` (new) holds `readLegacyOwnerBackup`, `OwnerStoreBackupError`, `OwnerStoreRecoveryError`, `ownerContext`, `OWNER_WORKSPACE_ID`, `LegacyOwnerSnapshot`, `LegacyOwnerDestination`, `openLegacyOwnerVault` and `readLegacyOwnerEntry`. `@jini-ai/db/owner-store` gains `countOwnerStoreRows`, `listOwnerEntryRows`, `listOwnerDestinations` and `LegacyOwnerDatabase`. `@jini-ai/server/owner-store` keeps only `countLegacyOwnerStore` and `readLegacyOwnerStore` (file wiring) with `LegacyOwnerCounts` and `LegacyOwnerStoreFile`; the names above are removed from it, the old `LegacyOwner` entry type is replaced by platform's identical `VaultArchiveEntry`, and `kysely` is no longer a peer of `@jini-ai/server`.
