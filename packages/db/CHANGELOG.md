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
