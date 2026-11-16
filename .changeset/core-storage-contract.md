---
"@jini-ai/core": minor
"@jini-ai/db": patch
"@jini-ai/chat": patch
"@jini-ai/cms": patch
"@jini-ai/commerce": patch
"@jini-ai/daemon": patch
"@jini-ai/plugins": patch
"@jini-ai/registry": patch
"@jini-ai/integrations": patch
"@jini-ai/server": patch
"@jini-ai/sqlite": patch
"@jini-ai/infra": patch
---

The storage kernel contract moves to `@jini-ai/core/contracts/storage` and names no query library or driver: `StorageKernel<Handle, Schema>`, the row/value helpers, the SQLite client shapes and `MigrationStep`/`MigrationContext`. `@jini-ai/db` binds a Kysely handle as `KyselyKernel` (which keeps `query`/`execute`) and no longer exports the moved names. Commerce migration ledger checksums are unchanged; its source digests are re-pinned for import-only edits.
