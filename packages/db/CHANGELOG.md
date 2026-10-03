## Unreleased

### BREAKING

- `DatabaseReadToolPorts.clock` now takes core `Clock.nowMs()`; restore-point timestamps use `nowIso({ clock })` at the existing sampling point.

### Fixed

- Add a `default` condition to every JavaScript subpath, pointing to its existing ESM entry, so tsx CommonJS bootstraps can resolve the package without `ERR_PACKAGE_PATH_NOT_EXPORTED`.

- `databaseFile<DB>` accepts `StorageKernel<DB>` so hosts can pass typed kernels without casting or erasing their schema. Query and null behavior are unchanged.

- Align transfer handlers with core's second-argument `ToolExecutionOptions.emitSurface` and canonical `SurfaceEmitter`; preserve fail-closed confirmation behavior. Forward resolved catalog messages and adapt native SQLite snapshot fixtures with explicit raw-row result types.
- Move the canonical `defaultDbMessages` definition to a driver-free core module and export `DbMessages` through the existing tools entry. Extend optional host copy to the 16 remaining consumer-facing prose sites, including read-tool registration and copy preflight.
- Neutral runtime defaults now refer to the source; hosts can supply their exact prior wording. Tool IDs, permissions, refusal/cost gates, persisted naming, SQL bytes and schema vectors are unchanged.


## 0.2.0 — 2026-10-02

### BREAKING

- Driver-only storage entries and native runtime licenses remain explicit; extraction ledgers are archived outside distributable packages.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

- BREAKING: Import AgentToolDefinition, AgentToolSideEffect and AgentToolActorClassRule from core; db no longer declares or exports duplicate catalog types.
- Transfer descriptions derive from host naming and replaceable `defaultDbMessages`; the display catalog defaults to neutral `app` / `app_` names. Persisted naming is unchanged.


## Unreleased — C2 generic additions

- Remove specification identifiers from timeline and restore-point errors and restore-point tool descriptions; limits, refusal behavior and error classes stay unchanged.
- Moved generic SQLite inspection and synchronous structural contracts into `./sqlite`.
- Moved unchanged tolerant JSON and row helpers into `./core`; kernel types remain unchanged.
