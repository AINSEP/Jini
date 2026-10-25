---
"@jini-ai/db": patch
"@jini-ai/server": patch
---

BREAKING (host import path): the owner-store composition moved from `@jini-ai/db/owner-store` to the new
`@jini-ai/server/owner-store` entry, so `@jini-ai/db` no longer reaches `@jini-ai/platform` or its own
sibling domains (guard L1 / SI-domain). Moved: `openOwnerStore`, `OwnerStoreRecoveryError`, `OwnerStoreService`,
`OWNER_WORKSPACE_ID`, `ownerContext`, `exportOwnerStore`, `restoreOwnerStore`, `OwnerStoreBackupError` and the
`OpenOwnerStore*` / `OwnerStoreDatabase` / `OwnerGrant` / `OwnerPutInput` / `OwnerSyncTarget` types. Behaviour is
unchanged. `@jini-ai/db/owner-store` keeps `OWNER_STORE_LEDGER`, `ownerStoreMigrations`, `ownerStoreDdl` and
`ownerStoreMigration`.

Migration: import those names from `@jini-ai/server/owner-store` and add `@jini-ai/server` (same version as
`@jini-ai/db`) to the host's dependencies; that entry uses the optional `@jini-ai/db`, `@jini-ai/platform`
and `kysely` peers. `OwnerStoreService` additionally accepts an optional `repo`; existing kernel-only
constructions still work.
