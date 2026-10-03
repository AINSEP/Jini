Spec ID: SPEC-JINI-DB-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:9577c6a8478b9943c95b9dbfa557ccaec2677e96c442425d43894c94d5ba3c85
spec_mode: reverse_spec


# Database error contract

| Public error class | Current constructor/fields | Trigger | Caller response |
|---|---|---|---|
| `UnsupportedCapabilityError` | `(capability: StorageCapability, transport: StorageTransport)`; fields capability/transport; name matches class | require/transaction/backup asks for unavailable capability, or backup flag lacks implementation | Select a capable driver or disable that feature; no silent fallback |
| `StorageOpNotSupportedError` | `(op: keyof StorageOps, transport, reason?: string)`; op/transport | Remote/server-only copyTo | Use provider backup/transfer, or owner-backed PGlite ops |
| `StorageOpError` | `(message: string)` | Busy SQLite final checkpoint, failed SQLite integrity, unreadable/empty migration ledger after compaction | Stop handing out the artifact; release readers/repair state and verify again |
| `PgliteOwnerLockedError` | `(dataDir: string, pid: number | undefined)`; dataDir/pid | Live/fresh owner lock, concurrent reaper or failed stale-lock identity check | Connect to existing socket; inspect abandoned guards only after confirming no starter is active |
| `MigrationChecksumError` | `(id, recorded, expected)`; string fields | Ledger checksum differs from known step | Restore immutable migration source; do not overwrite ledger to suppress error |
| `UnknownAppliedMigrationError` | `(ids: readonly string[], appName?: string)`; ids | Ledger contains migrations absent from runtime | Run the compatible newer runtime; do not downgrade silently |

These classes have named errors but no package-defined `code` property. All constructors above remain positional exceptions to the requested two-object convention.

## Other thrown failures

Plain Error is used for transaction-inside-run, same-file lock reentry, lockKey outside transaction, backup inside transaction, storage ops inside transaction, foreign driver ops, invalid JSON keys/binary values, non-Postgres schema/typegen, unsupported typegen column, malformed migration ids/checksums/order/missing ledger, existing copy target, invalid owner names/socket permissions/path length, repeated server start and exclusive callback leaving a transaction open. Correct the invocation or host state before retrying. PGlite streaming throws plain Error.

Filesystem/open/pragma/backup/driver/prepare/up failures propagate. No common wrapper, automatic retry or SQLSTATE translation is applied. `parseInt8` propagates BigInt parse errors; PG JSON parsers propagate invalid JSON errors. `isUniqueViolation` recognizes Error instances carrying `SQLITE_CONSTRAINT_UNIQUE` or `23505`, or containing `UNIQUE constraint failed`; it is a predicate, not an exception translator.

## Returned diagnostics and wire errors

SQLite status swallows schema/table/stat failures into null/zero/empty results. Integrity returns `DbIntegrityIssue` kind integrity/foreign_key and `ok: false` for pragma errors/violations; non-string integrity rows are skipped. Consumers must not treat a zero count as proof that the table is empty when inspection failed.

Socket protocol emits FATAL `53300` for connection cap and `25P03` for idle-in-transaction termination. Retry a rolled-back unit through a fresh connection after correcting contention/liveness; an operation whose acknowledgement was lost needs application idempotency. Other database SQL errors are the engine's wire errors. Protocol/framing failures close a connection; the package adds no SQLSTATE catalog for them.

Pool idle errors are consumed (logged on pooled Postgres, silently on socket clients) so they do not crash the process; subsequent acquisition belongs to pg. Query errors still reject their call. Readiness failure rejects operations that await ready; close attempts driver cleanup. No HTTP mapping is specified.

## Transfer and tool errors

| Class/result | Trigger | Caller response |
|---|---|---|
| IncompleteTransferPlanError({missing}, {} = {}) | Source table neither copied nor excluded with nonblank reason | Complete each physical source's catalog; missing contains source/table |
| SourceSchemaMismatchError (inherited Error constructor) | Planned table/column absent or unsupported binary cell | Reconcile host catalog with snapshot; no code/custom name |
| InvalidConnectionStringError (inherited Error constructor) | Invalid URL/scheme/missing host, user or database | Correct private destination input; no code/custom name; malformed escapes can instead throw URIError |
| StoreCopyError(message) | Ledger mismatch, occupied target, differing columns, unsupported sequence default or count/key fingerprint mismatch | Keep target unused and correct compatibility/source stability; transaction failures roll back |
| ValidationError(message) | Expensive restore point without costAck | Obtain the host's explicit cost acknowledgement |
| RestorePointUnavailableError(message) | No available restore-point mechanism | Use another supported backup mechanism; no attestation override |
| TimelineValidationError (internal, not exported) | Requested limit >200 | Reduce limit; no code |
| core ToolInputError | Bad reader input or missing interactive replacement/address channel | Correct input or route to a context with host surfaces |
| COPY result TARGET_NOT_OURS | Marked schema belongs to another source or is unmarked/mixed | Choose an unused area; never overwrite it |
| COPY result COUNT_MISMATCH / COPY_FAILED | Target row counts differ / target rejects script or source-cell conversion | Diagnose private logDetail, repair target schema/types/source, replan |
| PLAN_NOT_FOUND / PLAN_EXPIRED | Missing/consumed/other-principal plan / matching expired plan | Create a fresh plan; same ID cannot be retried |

Tools additionally return NO_DESTINATION, UNREACHABLE, SERVER_TOO_OLD (minimum 14), NO_CREATE_PERMISSION, DATABASE_SNAPSHOT_FAILED, SCHEMA_MISMATCH, UNAVAILABLE and INVALID_CONNECTION_STRING. Correct destination/capabilities/catalogs and replan. Cancellation/declined/expired/abandoned surface outcomes are ordinary results. Permission/repository/surface/clock/log/target exceptions can propagate instead of a refusal result; DestinationUnreadableError is named only by the host port comment, with no package class export.

Plain Error guards reject unsafe schema/tag, duplicate table/marker names, malformed count coverage and tool catalog/risk mismatch. No transfer helper retries. A copy's success warning means commit succeeded but constraint reporting was unavailable; a postcommit JSON-read or recordRun error can reject after durable target mutation. Inspect destination state before retrying an uncertain outcome. Secret-bearing raw target errors and plan contents require host-private handling.
