Spec ID: SPEC-JINI-DB-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:d69cc691a1e46df3a56d3f55c804ed2a01da257b614e417ea14c4282568b4e73
spec_mode: reverse_spec


# Database state and ownership contract

## Connections and kernels

Acquisition returns an owned connection/kernel or a wrapper over a borrowed connection. `openSqliteConnection` returns a raw host handle whose lifetime belongs to its caller. `sqliteKernel(raw or {$client})` memoizes on raw handle, does not migrate/configure/close it, and shares transaction context only with that kernel. `openSqliteFileKernel`/`openMemorySqliteKernel` close their owned raw handle. `closeSqliteConnection` removes memoization then closes; existing references are not revoked. Weak reverse mappings and per-file turn-lock maps have no exported reset/prune operation.

PGlite kernels open one engine; ready waits for engine readiness then optional prepare. Postgres/socket kernels ready resolves immediately and does not establish that remote connectivity is healthy. All query/transaction work awaits readiness. Generic kernel close delegates to driver and adds no universal closed-state/idempotency guard. Hosts must stop new work before close; retaining a kernel after close is unsupported by this lifecycle.

Kernel scopes are per-instance AsyncLocalStorage values: outside -> run or transaction -> outside. Nested run reuses current executor; nested transaction joins. A driver begin commits resolved bodies and rolls back thrown bodies. TurnLock queues shared/exclusive acquisitions FIFO; callers of its public low-level release must match acquisitions. No timeout/cancellation protects an abandoned lock holder.

## Migration ledger

Persistence is consumer-named `<ledgerTable>(id TEXT primary key, checksum TEXT not null, applied_at TEXT not null)`, optionally in a Postgres schema. Each step transitions pending -> applied atomically with up effects. Failure leaves that step pending and retains earlier committed steps. Concurrency uses the schema-qualified ledger lock key and rechecks rows per step. Unknown ids or changed checksums halt rather than editing persisted history. prepare/backup effects occur outside that atomic transition and may survive a failed migration.

## Restore artifacts

SQLite captures persist beside the live file, or in OS temp for memory connections. Artifact refs are opaque paths to the same adapter; no retention sweep, ledger or reference validation exists. Physical file restore transitions artifact copy -> same-directory temp -> rename live -> best-effort sidecar removal -> restart required. It neither invalidates existing descriptors nor performs application restart. Failed copy/rename can leave temporary artifacts. A memory restore is a no-op.

Kernel SQLite backups are ordinary consistent SQLite files; PGlite backups are data-dir tarballs. PGlite copy operations restore a new data directory, remove partial output on failure and optionally drop copied owner locks. Caller owns artifact permissions, cleanup and retention.

## Served PGlite owner

Startup: validate socket path -> create data dir -> acquire pid lock -> private socket directory -> open engine -> start listener -> verify socket permissions -> register process-local owner. Persistent state is the PGlite data directory and consumer-named lock. Runtime state is process-local owner map, listener/connections and message queue. Different resolved data dirs can own independent engines.

One queued client's transaction pins queue access to that connection. Disconnect/timeout drops its pending messages and schedules rollback; other clients then proceed. Owner-only jobs run when no client transaction owns the session. runExclusive callbacks must not leave a transaction open. A callback/connection error does not permanently wedge the queue. Per-connection buffers and queue have no enforced capacity limit beyond connection count.

Owner close memoizes one promise, removes process-local registration, stops clients/listener, closes engine, removes socket and releases its inode-bound lock. No automatic signal hooks invoke it. Hard death leaves lock/socket; a subsequent start can recover a dead-pid lock and stale socket. An abandoned reaping guard fails closed and is not automatically removed. A direct PgliteSocketServer stop borrows its db and never closes the engine; consumer handles that lifecycle separately.

Pooled Postgres clients use transaction-scoped advisory locks released on commit/rollback; no process-wide migration cache exists. Socket clients must avoid session state because all connections share a backend session.

## Transfer plans, copies and journal ports

DatabaseTransferPlanStore is process-local only: save -> waiting -> matching take -> gone. TTL is 10 minutes, count cap two with oldest insertion eviction; purge is lazy. Wrong principal/workspace leaves the existing plan intact. Snapshot buffers and secret address live in the returned/stored object by reference; no encryption, clone, byte cap, reset method or persistent plan storage exists. Restart loses all plans. Consuming precedes confirmation/copy, so declined/failed work requires new planning.

Transfer sources borrow snapshot bytes and own handles acquired by SnapshotOpener; close is delegated without an idempotency guard. The engine never closes sources. The target writes consumer-named schema/marker/unvalidated-constraint metadata in one transaction; replacement rollback retains the previous copy. Copies preserve source runtime; no destination cutover or source deletion occurs. Store copy borrows both kernels; its target transaction can join a host transaction, whose outer commit controls durability.

DatabaseDestinationStorePort owns persisted secret addresses and run summaries. Save is required to replace destination and forget prior lastRun; whether state survives restart depends on host implementation. Restore-point/ledger ports own append-only persistence and ordering. Direct createRestorePoint captures and generates a summary without saving it; the read tool separately persists manual provenance and artifact reference, leaving a non-atomic capture/save interval. No package sweep removes restore artifacts or old copy schemas.

SurfaceExchange lifetime is host-owned: resolveDecision must close after classification/errors; askThenReport must close in finally and prevent outcome-delivery errors from replacing a settled result. Tool code registers/removes abort listeners but relies on those port guarantees for normal cleanup. Surface transport, UI components, expiry scheduler and authenticated decision validation are not stored or implemented here.
