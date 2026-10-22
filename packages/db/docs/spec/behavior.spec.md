Spec ID: SPEC-JINI-DB-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:9f52ca6a3ce1b66b1c5377d3df213c42162f49350fa3c407ad39969adcbdd508
spec_mode: reverse_spec


# Database guarantees and boundaries

## Driver neutrality and value rules

Core/structural adapter entries shall not load native drivers. Consumers inject their own SQLite opener, pg module or PGlite class; kernel entries import Kysely, tools import core. No ORM schema, environment-based database selection, credentials or application tables are supplied. Testing modules have no public export.

Filename sanitization shall replace characters outside ASCII letters/digits/underscore/hyphen with underscore. Artifact names embed scope/watermark/timestamp; extension is caller-supplied without sanitization. Consumers must not supply untrusted extensions. JSON narrowing returns undefined for absent/non-string/invalid JSON; row accepts any nonnull object, including arrays; rows preserves length with `{}` placeholders.

Postgres int8 shall become number within safe-integer bounds, bigint otherwise; JSON/jsonb parsers emit compact JSON text. Per-pool parser policy shall not change global pg parsers. Typegen currently maps bigint to number despite possible bigint runtime reads; consumers must constrain values or handle the mismatch. JSON helpers accept nonempty identifier-key paths only; objects/arrays/fractional spelling are not a cross-dialect jsonText guarantee. Boolean reads are true/false or 1/0; toBool maps only true/1 to true, null/undefined to null. toBytes returns a view sharing the supplied binary buffer.

## Connection acquisition and inspection

`openSqliteConnection` shall invoke recover for every supplied filePath (including `:memory:`), then open with `{}`, then apply pragmas in order. Explicit pragmas replaces the default list, including an empty list. The exact host handle is returned. The helper does not close a newly opened connection if a pragma throws; hosts must retain enough acquisition context to clean it up.

SQLite status inspection shall inventory non-system, safe ASCII table identifiers alphabetically, report count failures as zero, schema failures as null/empty, and sum file/wal/shm logical sizes while ignoring stat failures. It uses ambient filesystem and Date.now. Integrity shall run integrity_check (default) or quick_check, then foreign_key_check, recording pragma failures as issues; non-string check rows are skipped. These reports are diagnostics, not exhaustive corruption proof or a schema migrator.

## Kernel ordering and transaction rules

Run/transaction/query/execute/backup shall await ready; capability checks happen before the requested effect. Nested run reuses the current executor. Nested transaction joins the outer transaction with no savepoint; a caught nested error does not independently force rollback. Transaction inside run shall throw. lockKey shall require a transaction; SQLite's BEGIN IMMEDIATE is the concurrency lock, Postgres uses transaction-scoped advisory locks. Pooled Postgres requires explicit lockKey for read-then-write serialization.

One-connection kernels shall permit concurrent shared run bodies or one exclusive transaction, in FIFO order; a queued transaction blocks later runs. SQLite memoizes one kernel per raw client and shares turn locks by resolved file path within a process. File identity is not canonicalized through realpath, so path aliases are the host's responsibility. Reentering the same file lock through another kernel in the same async call chain shall fail instead of deadlocking. Legacy raw SQLite transactions are joined when the kernel has no own transaction active; consumers must avoid unrelated work while one is open.

| Driver | Transactions/batch/DDL | Backup | Ownership/defaults |
|---|---|---|---|
| Borrowed SQLite kernel | All true; BEGIN IMMEDIATE | Online file backup | close is no-op; caller owns pragmas/migration/connection |
| Opened SQLite file/memory kernel | All true | Online file backup | Owned close; 5,000 ms busy timeout; foreign keys enabled only for writable opens; no automatic WAL switch |
| In-process PGlite | All true | Uncompressed data-dir dump | Owned close; absent dataDir is memory; optional prepare runs behind ready |
| Pooled Postgres | All true | false | Pool max 10; lazy connectivity; idle errors logged to console |
| PGlite socket | All true | false | Pool max 1, idle timeout 0; owner performs backups |

Read-only SQLite requires an existing file and lets the driver reject writes. PGlite dialect supports no streaming query API. Schema scoping rewrites query-builder run bodies only; raw query/execute remain unscoped and close affects the underlying kernel. Socket clients share one backend session: no persistent SET, temp tables, named prepared statements or session locks; those are consumer constraints, not parsed/enforced SQL guards.

## Storage operations and restore points

Storage ops shall reject use inside a kernel transaction. SQLite copy uses VACUUM INTO; compact performs VACUUM, WAL switch, TRUNCATE checkpoint and integrity check, rejecting busy/non-ok results. Generic checkpointWal issues FULL checkpoint but does not inspect its busy result; it alone does not establish a sealed/durable main-file guarantee.

PGlite copy shall require an absent target, dump consistently, restore into a new directory, close it and optionally remove the copied owner lock; partial restore directories are removed on failure. A served database dump must use its owner's exclusive window. Compaction runs VACUUM/CHECKPOINT then nonempty ledger read-back. Remote Postgres refuses copy; compaction uses VACUUM ANALYZE and ledger read-back. It does not run a provider backup or integrity scan.

Restore-point capture shall read the host watermark before online backup and embed it in the filename. It does not lock host writes with that watermark read, deduplicate same-timestamp filenames or expire artifacts. For `:memory:`, capture writes to OS temp; restore returns restartRequired false without validating/reading artifact. File restore checks artifact existence, copies into a same-directory temporary file, renames over live file and best-effort deletes wal/shm. It returns restartRequired true; it does not quiesce writers, close handles, verify artifact integrity or fsync for power-loss durability. Hosts must coordinate the restore and reopen.

## PGlite owner and wire server

Owner acquisition shall resolve dataDir, reject socket paths >103 UTF-8 bytes, acquire a consumer-named pid lock and serve only a Unix socket. Default socket directory uses an eight-hex hash of resolved dataDir under `~/.<runDirName>/run`, falling back to `/tmp/<runDirName>-<uid>` for long paths. Consumer names must be plain names without leading dot/separators. Socket dir shall be owned/non-symlink 0700; fallback parent checked private; socket 0600. Data-dir ancestor isolation remains host-owned.

Lock creation shall publish a prewritten pid file by hard link; a live pid or fresh empty lock shall refuse ownership. A dead pid or empty lock older than 10 seconds permits guarded takeover, at most five attempts. A stuck reaping guard fails closed and needs operator intervention. Release shall be idempotent and bound to acquired inode/pid. No automatic lock renewal or hostile-directory defense is promised.

Socket messages shall preserve per-connection order, run through one queue, and keep a client's transaction exclusive until commit/rollback/disconnect. Defaults: eight connections, 30-second idle-in-transaction timeout; zero disables timeout. Excess clients get FATAL 53300; idle transactions get FATAL 25P03 and rollback. Version-specific ReadyForQuery filtering targets PGlite 0.5.8. SSL/GSS requests are answered no, cancel requests close that connection without cancelling a backend query. There is no TCP listener, per-query deadline, message-size bound or queue-size bound.

Owner runExclusive shall wait for client transactions, run alone and reject/rollback if the callback leaves a transaction open. Startup failure stops server/closes db/removes socket/releases lock. Owner close is memoized. Raw socket-server consumers own db lifetime and private path setup themselves.

## Migrations

Steps shall be strictly lexically increasing unique NNNN_snake_name ids with lowercase 64-hex checksums. sourceChecksum hashes exact UTF-8 input without normalization. Unknown applied ids or checksum mismatch shall fail before pending effects. Each up and ledger insertion runs in one transaction under the ledger lock with a per-step recheck; a failed step rolls back only itself and stops later steps. Previous committed steps remain applied.

The consumer must name the ledger; optional schema is Postgres-only. The runner creates schema/ledger within the first step transaction, storing id/checksum/applied_at ISO text. Optional backup is once before pending work when user tables exist and driver backup is supported. It precedes prepare; prepare runs outside the lock/transaction and can run in concurrent invocations even if another runner applies the step. Therefore prepare effects must be safe to repeat. No pending steps means no backup/prepare. No down migrations, drift adoption or automatic repair exists; hasLedger checks only table presence in current schema.

## Snapshot transfer and store copy

planTransfer shall require every physical source table to be copied or explicitly excluded with a nonblank reason before target work. Policies are consumer-supplied; no fixed application catalog exists. Core table descriptions remain in plan even when absent so countSourceRows names missing tables/columns. Non-core introspection maps SQLite affinities to bigint/text/bytea/double precision, preserves literal defaults and simple indexes/FKs, omits expression/partial indexes, checks and nonliteral defaults. Secret-column matching is name-based host policy, not content inspection. keep/default/sqlType/check SQL are trusted host fragments.

Snapshot source shall open readonly bytes through the host opener; WAL header conversion copies bytes before changing journal flags. Consumer closes source. psql target shall accept postgres/postgresql URLs with host/user/database, derive password into env, remove inherited PG* vars and set connection timeout 5 seconds. It uses one psql process per call, with scripts on stdin and ON_ERROR_STOP; no total query/process timeout or output cap exists. Errors redact double-quoted fragments only, not arbitrary single-quoted row/credential text; host error/log policy must account for this. Bad percent encoding can throw URIError outside the named connection error.

runCopy shall reject public/unsafe/>63-byte schemas, duplicate target table names, marker collisions, malformed counts and invalid SQL tags before script execution. It shall verify schema ownership in the transaction; first copy cannot replace a schema appearing after planning. Replacement drops/recreates only the selected marked schema. Host target must execute the script as one transaction with abort-on-error semantics. Rows stream in roughly 256 KiB string chunks (one large row can exceed this), retain bigint integers and escape COPY text cells; only Buffer-to-bytea accepts binary. Counts are checked before commit, without content checksums. CHECK/FK violations during validation are retained NOT VALID and reported; missing/nonunique omitted parents cause FKs to be skipped. Unique/NOT NULL/data conversion failures still abort. Source closures belong to the caller. Postcommit marker read failure can produce warning; malformed marker JSON can throw after commit.

Store copy shall compare named ledgers, require empty target under locks, copy every nonledger table in host schemas, create absent tables/constraints/indexes, restore validated FKs and advance identities in one target transaction. Source traversal uses ctid and <=500-row batches with 60,000-bind budget; host must keep source unchanged. Existing table compatibility compares column name/type only. Verification checks count plus sorted primary-key checksum, or effectively count only without a key; it does not compare all row values. Ordinary sequence defaults on recreated columns are refused. No source delete, runtime cutover or distributed transaction occurs.

## Database assistant tools

Catalogs shall describe capabilities only; read factory returns five read handlers and one snapshot capture/save handler. Permission port is called before effects. Returned registration policy itself allows, so host must preserve handlers and apply its own independent authorization/risk/error plumbing. Migration execution/planning and restore-guidance handlers are deliberately absent despite catalog entries. Host introspection defines health fields; catalog descriptions alone do not guarantee disk/interrupted-migration data.

Timeline defaults 50 and rejects >200; zero/negative/fractional/NaN are not rejected by this function and are passed to the port. listRestorePoints preserves port order without sorting. createRestorePoint refuses unavailable and expensive without costAck before capture, uses ambient randomUUID, always reports kind file-snapshot and does not save/idempotently reuse an artifact itself. Read tool capture saves trigger manual after backup; capture and save are not atomic and a failed save can orphan an artifact.

Transfer tools require database-transfer.run before destination/snapshot work. Plan checks target then captures main and chat snapshots separately, requires cheap file-snapshot storage, reads/deletes main artifact best-effort, accounts for both sources, and stores bytes/secret address in an in-memory single-use plan. The two captures are not one atomic multi-database snapshot. First copy runs without confirmation; replacement requires host surface confirmation after plan consumption. Missing interactive channel fails closed for replacement/address entry. Abort closes a waiting exchange; copy work has no cancellation propagation once started. No global executor timeout is supplied.

Plans last 10 minutes and at most two survive save (oldest evicted); expired rows are purged on save/take, with no timer or byte-size cap. Wrong principal/workspace returns PLAN_NOT_FOUND without consuming the plan. Valid matching take consumes even if expired, declined, missing channel or subsequent copy fails. Stored objects/Buffers are not cloned/frozen; host must not mutate them. Destination persistence/encryption/last-run lifecycle belong to the injected store. Tool outputs omit secret address, but host descriptions/errors/logging/surface ports must preserve that boundary; catalog descriptions currently carry legacy fixed schema-name wording despite host-controlled naming.

Evidence: current source and tests in `src/__tests__/`, including same-file serialization, lock races, socket framing/timeouts, checksum refusals, completeness, copy rollback and restore round trips. Tests were inspected without execution.

Decision rationale: [Operational history is a bounded read surface](../decisions/DR-001-bounded-operational-timeline.md), [Unavailable restore mechanisms have no attestation override](../decisions/DR-002-restore-point-precondition.md), [Storage copying takes its schemas from the host](../decisions/DR-003-host-owned-schema-copy.md).

## Copy ownership

Generic tool risk/definition vocabulary and registration wiring are owned by core. Neutral defaultDbMessages can be replaced by host descriptions without changing tool IDs, authorizers, confirmation gates, transfer schema names or persisted markers. Transfer catalog descriptions are regenerated with the host naming rather than assuming a product navigation destination.
