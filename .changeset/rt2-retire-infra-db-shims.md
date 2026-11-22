---
"@jini-ai/infra": major
"@jini-ai/db": patch
---

The `@jini-ai/infra/db/core` and `@jini-ai/infra/db/sqlite` compatibility entries are removed (owner retire order, RT-2), with the optional `@jini-ai/db` peer they needed. Import from the owner instead: `@jini-ai/db/core` (`DbOpsPort`, `RestoreCapability`, `RestoreCostClass`, `RestoreKind`, `RestorePoint`, `WatermarkReader`, `restorePointFilename`, `sanitizeForFilename`), `@jini-ai/db/sqlite` (`DEFAULT_PRAGMAS`, `openSqliteConnection`, `SqliteDbOpsAdapter`, `SqliteDbOpsAdapterDeps`) and `@jini-ai/core/contracts/storage` (`OpenSqliteConnectionOptions`, `SqliteBackupSource`, `SqliteRecoveryHook`). `@jini-ai/infra/events/outbox` is unchanged and the package is no longer marked deprecated. `@jini-ai/db` only renames two test describe strings.
