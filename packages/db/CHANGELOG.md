## 0.6.15

### Minor Changes

- BREAKING (`@jini-ai/server/owner-store`): the owner store is now a read-only legacy reader. Shared keys are project
  references in the host, so nothing writes, migrates, grants, syncs or revokes an owner store any more. Removed:
  `openOwnerStore`, `OwnerStoreService`, `exportOwnerStore`, `restoreOwnerStore`, `OwnerRevocationPendingError`,
  `OwnerUnreconciledError`, `OWNER_REVOCATION_AUTO_ATTEMPTS` and their types. Added: `countLegacyOwnerStore`
  (entry/grant counts, no key), `readLegacyOwnerStore` (decrypted entries plus recorded destinations, opened with
  SQLite's read-only mode and never migrated) and `readLegacyOwnerBackup` (authenticates and validates a v1 or v2
  backup exactly as restore did, without writing). `OwnerStoreRecoveryError`, `OwnerStoreBackupError`,
  `OWNER_WORKSPACE_ID` and `ownerContext` stay. `@jini-ai/db/owner-store` drops the unpublished
  `0001_owner_revocations` step (`ownerRevocationsDdl`, `ownerRevocationsMigration`); `0000_owner_store` stays.

  Migration: hosts that opened an owner store import its entries into their own store through the reader.

## 0.6.13

### Patch Changes

- 9138c3b: Leased SQLite transactions release their lease before the next queued kernel transaction takes its turn, so it no longer fails with `transaction_busy`. Checked clients quarantine only uncertain outcomes: a failed COMMIT followed by a successful ROLLBACK, or a stray ROLLBACK with nothing open, leaves the handle usable.
- aa8de3d: Add opt-in checked SQLite clients and leased transaction sessions, plus batch migration atomicity,
  ordered-prefix history checks, injected clocks and explicit legacy ledger mappings. Existing raw
  clients, transaction signatures and default per-step migration behavior are unchanged.
- 03dec0a: Preserve credential hint metadata across owner-store backup restores and reject database/key path aliases on Windows and macOS.
- 506196f: BREAKING (host import path): the owner-store composition moved from `@jini-ai/db/owner-store` to the new
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

- Updated dependencies [7479159]
- Updated dependencies [c31264d]
- Updated dependencies [0728914]
- Updated dependencies [6ecbdb2]
- Updated dependencies [63bacc5]
  - @jini-ai/core@0.6.13

## 0.6.12

### Patch Changes

- db: new `@jini-ai/db/owner-store` entry — owner-only SQLite vault with grants, copy-to-site sync and passphrase-sealed backup (uses the optional `better-sqlite3` peer or an injected opener).
  - @jini-ai/core@0.6.12

## 0.6.11

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @jini-ai/core@0.6.11

## 0.6.10

### Patch Changes

- Updated dependencies [22f0619]
- Updated dependencies [82ed2d3]
- Updated dependencies [5a3de86]
  - @jini-ai/core@0.6.10

## 0.3.6 — 2026-10-22

- 2026-10-22: Security queue fixes, testing helper reads os.userInfo() only when PGUSER is unset, complexity refactors, coverage.

## 0.3.5 — 2026-10-16

- Store copy lets the host exclude retained restore tables from the catalog, emptiness check and copy (b0b13de4); copy only builds indexes for tables it created (d748cf67).

## 0.3.4 — 2026-10-13

- Vault SQL repo imports `@jini-ai/platform/secrets/credential-sets/contracts`; requires @jini-ai/platform >=0.5.6 (credential-sets/contracts); publish platform first.
- `@jini-ai/platform` is now an optional peer: only `./secrets-vault` loads it. Hosts using the vault list platform themselves.

## 0.3.3 — 2026-10-12

- Vault `findDefault` restates the default group in the normalized expressions and binds `is_default` as a dialect literal, so a host's partial default index is matched (SQLite and Postgres). Raw-column filters stay; results are unchanged.

## 0.3.1 — 2026-10-08

- Tovu clean-up release: code Tovu moved into Jini, plus the Jini clean-up (see the commit log).

## 0.3.0 — 2026-10-05

### BREAKING

- `createRestorePoint` takes a required `kind` (the host passes `getCapabilities().restorePoint.kind`, the same source as `costClass`) and returns it as-is. It always returned `"file-snapshot"` before, so a Postgres host's logical dump was returned and persisted as a file snapshot. `backup_create_restore_point` passes it.
- `getTimeline` refuses a non-integer or non-positive `limit` instead of passing it to the query.

### Fixed

- `database_query_timeline` reads `limit` through core's `readToolLimit` (default 50, cap 200): `0` or a non-integer is a model-facing input error and an over-cap value is capped, instead of a redacted plain `Error`. Needs `@jini-ai/core` ^0.4.1.
- `database_transfer_run` hands the exchange's deadline to `TransferSurfacePorts.confirmation` (new optional third argument `{ expiresAtMs }`) when the exchange reports one through the new optional `SurfaceExchange.expiresAtMs()`, so a host's confirmation card can count down and close on time.
- SQLite JSON equality (`jsonScalarEquals`) checks `json_type` first, so `true`/`false` never equal `1`/`0`.
- Internal `@jini-ai/core` dependency is a caret range (`workspace:^`) instead of an exact pin.

## 0.2.0 — 2026-10-02

### BREAKING

- Driver-only storage entries and native runtime licenses remain explicit; extraction ledgers are archived outside distributable packages.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

- BREAKING: Import AgentToolDefinition, AgentToolSideEffect and AgentToolActorClassRule from core; db no longer declares or exports duplicate catalog types.
- Transfer descriptions derive from host naming and replaceable `defaultDbMessages`; the display catalog defaults to neutral `app` / `app_` names. Persisted naming is unchanged.

### Also shipped in 0.2.0 (published 2026-10-03; was listed under Unreleased)

#### BREAKING

- `DatabaseReadToolPorts.clock` now takes core `Clock.nowMs()`; restore-point timestamps use `nowIso({ clock })` at the existing sampling point.

#### Fixed

- Add a `default` condition to every JavaScript subpath, pointing to its existing ESM entry, so tsx CommonJS bootstraps can resolve the package without `ERR_PACKAGE_PATH_NOT_EXPORTED`.

- `databaseFile<DB>` accepts `StorageKernel<DB>` so hosts can pass typed kernels without casting or erasing their schema. Query and null behavior are unchanged.

- Align transfer handlers with core's second-argument `ToolExecutionOptions.emitSurface` and canonical `SurfaceEmitter`; preserve fail-closed confirmation behavior. Forward resolved catalog messages and adapt native SQLite snapshot fixtures with explicit raw-row result types.
- Move the canonical `defaultDbMessages` definition to a driver-free core module and export `DbMessages` through the existing tools entry. Extend optional host copy to the 16 remaining consumer-facing prose sites, including read-tool registration and copy preflight.
- Neutral runtime defaults now refer to the source; hosts can supply their exact prior wording. Tool IDs, permissions, refusal/cost gates, persisted naming, SQL bytes and schema vectors are unchanged.

## Unreleased — C2 generic additions

- Remove specification identifiers from timeline and restore-point errors and restore-point tool descriptions; limits, refusal behavior and error classes stay unchanged.
- Moved generic SQLite inspection and synchronous structural contracts into `./sqlite`.
- Moved unchanged tolerant JSON and row helpers into `./core`; kernel types remain unchanged.
