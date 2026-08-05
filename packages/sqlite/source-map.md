# `@jini/sqlite` — provenance

Per extraction-plan.md §8 task 8 ("Store ports + `@jini/sqlite`... a Postgres
*stub* compiles against the async ports; conformance suite has no OD schema
nouns") and §2.6 ("`@jini/sqlite` is the default adapter... an adapter
conformance suite covers transactions/ordering/cursor-durability/
cancellation/migrations"): a `better-sqlite3`-backed implementation of
`@jini/daemon`'s existing `EventLog` port (`packages/daemon/src/event-log.ts`),
proven behaviorally equivalent to that package's own
`createInMemoryEventLog` reference adapter.

This is **not a new interface.** `EventLog`/`EventLogEntry`/
`EventLogAppendInput`/`EventLogReplayResult` are defined once, in
`@jini/daemon`, and `@jini/sqlite` implements that exact contract — same
method signatures, same `dedupeKey` idempotency semantics, same
distinguishable `'replay-gap'` result, same never-reused monotonic per-run
cursor allocation, same FIFO-at-`maxEntriesPerRun` eviction mechanism.
`packages/daemon/src/event-log.ts`'s own module doc literally names this
package as the intended future durable adapter (see that file's header
comment).

**Retention default is a deliberate divergence, not parity.** `maxEntriesPerRun`
defaults to 2000 when omitted (`DEFAULT_MAX_ENTRIES_PER_RUN` in
`src/event-log.ts`) — this does **not** match the in-memory reference
adapter, which defaults to unbounded retention when the option is omitted
(see `createInMemoryEventLog`'s own doc in `packages/daemon/src/event-log.ts`).
An earlier version of this note incorrectly claimed the sqlite default of
2000 "match[ed] the in-memory adapter's default"; that was never true (the
in-memory adapter has never had a 2000 default) and, independently, this
package's own code did not actually apply a 2000 default until the
2026-07-21 SEC-RB-008 fix — before then, an omitted option meant unbounded
here too, contradicting this doc. The two adapters now intentionally differ:
the in-memory adapter stays unbounded-by-default (its own module doc's
rationale: the caller should own that tradeoff explicitly), while this
durable, on-disk adapter defaults to a bounded window because unattended
persistent growth is a real operational risk an in-process structure doesn't
share. `replay`'s `afterCursor` validation is also adapter-specific: this
package throws for a cursor that isn't `null` or a non-negative safe-integer
string, rather than returning the port's `'invalid-cursor'` result kind (see
`assertValidReplayCursor` in `src/event-log.ts`) — the in-memory adapter is
unchanged and still returns `'invalid-cursor'` for a non-numeric cursor.

## File map

| Jini file | Origin / grounding | Transform |
|---|---|---|
| `src/event-log.ts` | *(new — implements `@jini/daemon`'s `EventLog` port; grounded in OD's `apps/daemon/src/db.ts` and `apps/daemon/src/storage/{daemon-db,db-inspect}.ts` on `open-design`'s `main` branch for real-world `better-sqlite3` schema/SQL conventions — `new Database(file)`, `db.pragma('journal_mode = WAL')`, `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`, `db.transaction()` for atomic multi-statement writes — not copied verbatim; OD's actual tables (`projects`, `conversations`, `messages`, etc.) are product schema with no event-log equivalent to lift)* | `createSqliteEventLog(dbPath, options?)` opens (or creates) a `better-sqlite3` database and returns an `EventLog` + `close()`. Two tables: `jini_event_log_runs` (`run_id` PK, `next_cursor` — the durable monotonic cursor counter, so ids are never reused even across eviction or a restart) and `jini_event_log_entries` (`run_id`, `cursor`, `event`, `data` as a JSON-serialized TEXT column, `recorded_at`, `dedupe_key` nullable, PK `(run_id, cursor)`), plus a partial index on `(run_id, dedupe_key)` for O(log n) dedupe lookups. `append` runs inside a `db.transaction()` (dedupe check → insert → cursor-counter bump → eviction, atomically). `replay`/`drop` are plain synchronous reads/deletes (single-statement, no transaction needed). Every public method is still `async`/`Promise`-returning per extraction-plan §2.6, even though `better-sqlite3` itself is fully synchronous under the hood — this is what makes a future non-sqlite adapter (e.g. Postgres) a drop-in swap with no port change. |
| `src/index.ts` | *(new — barrel)* | Re-exports `event-log.ts`. |

## Design decisions

**1. Durable cursor counter, not `MAX(cursor)+1`.** The in-memory reference
adapter keeps a `nextId` field on each run's log that only ever increments,
independent of how many entries are currently retained — so a cursor is
never reassigned even after older entries are evicted. Deriving the next
cursor from `MAX(cursor)` on the entries table would reintroduce reuse the
moment a run's entries are ever fully evicted (e.g. a very small
`maxEntriesPerRun`, or after `drop()` if a new run reused the same id). The
`jini_event_log_runs.next_cursor` column is the durable equivalent of the
in-memory `nextId` field, updated in the same transaction as every insert.

**2. `EntryRow.data` is stored as `JSON.stringify`'d TEXT, not a live
reference.** The in-memory adapter stores whatever value was passed to
`append()` by reference; a durable store obviously cannot do that. This is a
real, documented behavioral difference (not a parity gap in the tested
contract): payloads must be JSON-serializable for the sqlite adapter, and a
round-trip through `JSON.stringify`/`JSON.parse` loses non-JSON values
(`undefined` inside objects, functions, `Map`/`Set`, etc.) exactly as any
durable JSON-backed store would. Every port method signature and every
tested behavior (ordering, dedup, replay-gap, eviction) is unaffected, since
all conformance-test payloads are plain JSON-safe values — matching what
`@jini/protocol`'s wire-event payloads actually are in practice.

**3. `close(): Promise<void>` is an addition beyond the `EventLog`
interface, not a port change.** `@jini/daemon`'s `EventLog` interface has no
lifecycle/disposal method (the in-memory adapter needs none — its state is
garbage-collected with the process). A real file-backed `better-sqlite3`
connection needs an explicit close to release its file handle/WAL files
cleanly, so `SqliteEventLog extends EventLog` adds exactly that one extra
method. Callers that only care about the `EventLog` port itself can ignore
it; the durability-across-restart tests use it directly to prove data
survives a close+reopen cycle.

**4. `db.transaction()` erases the wrapped callback's own generic
parameter.** `better-sqlite3`'s TypeScript types return a non-generic
`Transaction` from `db.transaction(fn)`, so a `<Payload>`-generic callback
passed to it loses that generic at the call site. `appendTxn` is therefore
written against `EventLogAppendInput<unknown>`/`EventLogEntry<unknown>`
internally, and the public `append<Payload>()` method casts across that
boundary — the identical pattern `createInMemoryEventLog` already uses for
its dedupe-hit early return (`existing as EventLogEntry<Payload>`), not a
new relaxation introduced by this adapter.

**5. WAL journal mode**, matching OD's own `db.ts` (`db.pragma('journal_mode
= WAL')`) — better concurrent-reader behavior and durability characteristics
than the default rollback-journal mode, and the convention this codebase's
only other real `better-sqlite3` user already established.

## Conformance test methodology

`src/event-log.test.ts` runs the same test *shape* as
`packages/daemon/src/event-log.test.ts` (ordering, `replay(afterCursor)`,
unknown-run, invalid-cursor, `drop()`, dedupe-hit/dedupe-miss, eviction,
replay-gap, contiguous-cursor-is-not-a-gap, first-replay-after-eviction) —
same inputs, same expected `EventLogEntry`/`EventLogReplayResult` shapes —
against `createSqliteEventLog` instead of `createInMemoryEventLog`, proving
behavioral parity rather than merely "this compiles against the interface."
A separate "durability across a restart" section (no in-memory equivalent is
possible) opens a fresh `createSqliteEventLog` connection to the same file
after `close()` and confirms: appended entries are visible, the cursor
counter is not reset (no id reuse across a reopen), dedupe state survives a
restart (a retried append after reopen still returns the original entry),
and `drop()` is durable (a fresh connection also reports `unknown-run`).

## Not ported (explicitly out of scope)

`apps/daemon/src/storage/project-storage.ts` was **not** read or ported per
this task's explicit instruction — it is OD's own project-model persistence,
product-specific and out of scope for a generic engine adapter.
`apps/daemon/src/storage/aws-sigv4.ts` (S3-compatible signing for a separate
OD feature) and the rest of `apps/daemon/src/db.ts`'s ~2268 lines (project/
conversation/message/deployment/routine schema) were only skimmed for
`better-sqlite3` usage conventions (see the `src/event-log.ts` file-map row
above), not read in full or ported — none of it is event-log-shaped.
`apps/daemon/src/storage/daemon-db.ts`'s Postgres-adapter-selection stub
(`resolveDaemonDbConfig`, `OD_DAEMON_DB`/`OD_PG_*` env vars) was read for
context (it is the closest thing OD has to acknowledging a second backend)
but not ported — extraction-plan §8 task 8's Postgres-stub gate is a
`@jini/sqlite`-adjacent follow-up task, not part of implementing the sqlite
adapter itself, and OD's stub is env-var selection glue with no adapter
logic behind it yet (`throws when used`, per its own header comment).

## Dependencies

`@jini/daemon` (workspace) — the `EventLog` port + `EventLogEntry`/
`EventLogAppendInput`/`EventLogReplayResult` types this package implements.
`better-sqlite3` (`^11.10.0`, new runtime dependency, native module — added
to root `package.json`'s `pnpm.onlyBuiltDependencies` so its install-time
native build runs under pnpm's default script-blocking policy) +
`@types/better-sqlite3` (devDependency).

## 2026-07-18 addition — `backend-config.ts` + `db-inspect.ts`

Task brief: port `apps/daemon/src/storage/{daemon-db,db-inspect}.ts` and
`apps/daemon/src/{metrics,logging}/` from the real `leonaburime-ucla/open-design`
fork (cloned fresh to `/tmp/od-source`; `apps/daemon/src` on `main`), per
`ADS-memory/reports/jini-port/recon/r1-daemon.md`'s TASK 1 classification
(`storage/`: "`aws-sigv4.ts`, `daemon-db.ts`, `db-inspect.ts` generic; only
`project-storage.ts` leans OD"; `metrics/`+`logging/`: "generic observability
primitives").

**This supersedes the note above** ("`daemon-db.ts`'s Postgres-adapter-selection
stub... was read for context... but not ported") — that decision was scoped to
the earlier `EventLog`-focused porting session; this task's brief explicitly
targets `daemon-db.ts`/`db-inspect.ts` as first-class port items, and both
files are, independently verified by reading them in full, generic and
storage/backend-selection-shaped with no OD product coupling beyond `OD_*`
env-var names and comment mentions of `od daemon db status`/`od doctor`
CLI subcommands.

| Jini file | Origin file | Transform |
|---|---|---|
| `src/backend-config.ts` | `apps/daemon/src/storage/daemon-db.ts` | `resolveDaemonDbConfig`→`resolveSqliteBackendConfig`, `DaemonDbConfig`→`SqliteBackendConfig`, `DaemonDbKind`→`SqliteBackendKind`, `DaemonDbConfigError`→`SqliteBackendConfigError`; logic verbatim. **Identity-stripped**: `OD_DAEMON_DB`→`JINI_SQLITE_BACKEND`, `OD_PG_HOST`→`JINI_PG_HOST`, `OD_PG_PORT`→`JINI_PG_PORT`, `OD_PG_DATABASE`→`JINI_PG_DATABASE`, `OD_PG_USER`→`JINI_PG_USER`, `OD_PG_SSL_MODE`→`JINI_PG_SSL_MODE` (same `JINI_*` substitution convention `@jini/http`'s `origin-validation.ts` already established for `OD_ALLOWED_ORIGINS`/etc). Comment referencing "the OD daemon" reworded to "v1 ships local SQLite" (no product name). |
| `src/db-inspect.ts` | `apps/daemon/src/storage/db-inspect.ts` | `inspectSqliteDatabase`/`verifySqliteIntegrity` + their types, logic verbatim (no renames — already product-neutral names). **Identity-stripped**: header comment's `` `od daemon db status` `` / `` `od doctor` `` CLI references reworded to "a host daemon's own ops CLI (a `db status` subcommand)" / "a diagnostics aggregator" — prose only, no behavior change. |

Both files ported with zero logic changes beyond the identity strips above —
verified against the Phase 0 "no behavior changes in the same PR" guardrail
in `ADS-memory/reports/jini-port/skills/fixing-open-design.md` (the file that skill doc
governs is a capability-barrel *refactor* template, not a strict fit for a
first-time *port* like this one, but the same discipline applies).

**Phase 6.6 note:** the task brief that requested this port also referenced
a "Phase 6.6" async/network test-category checklist in
`ADS-memory/reports/jini-port/skills/fixing-open-design.md`, said to have been "added
tonight." That file was read in full before this port began (quoted its
actual Phase 6.5 coverage-bar line as instructed) and **contains no Phase
6.6 section — the document ends at Phase 7.** This is a discrepancy between
the task brief and the actual file contents; no Phase 6.6 was fabricated to
satisfy the brief. The underlying advice the brief describes (malformed
responses, races, missing error handling, stale state on retry) is sound
practice regardless, and was applied in spirit to `db-inspect.ts` anyway:
`src/db-inspect.test.ts` covers a throwing `user_version` pragma, a
non-numeric pragma return, a throwing `sqlite_master` query, a throwing
per-table `count(*)` (simulating a corrupted table), an identifier that
fails `sanitizeTableName`, a missing primary DB file, a throwing
`integrity_check`/`foreign_key_check` pragma, and malformed pragma row
shapes (non-string message, missing named key, missing FK-violation
fields) — via a fake `Database.Database`-shaped object for the
otherwise-unreachable error paths, plus real `better-sqlite3` instances
(including a genuine FK-violation row via `PRAGMA foreign_keys = OFF`) for
the happy paths.

### `metrics/` + `logging/` — NOT ported (recon classification was wrong)

The task brief's premise — "`metrics/` (1) and `logging/` (1)... generic
observability primitives," per `r1-daemon.md`'s TASK 1 table — does not
hold up against the actual file contents. Both files
(`apps/daemon/src/metrics/index.ts`, `apps/daemon/src/logging/critique.ts`)
are **100% Critique Theater domain content**, not generic daemon
observability:

- `metrics/index.ts`: a `prom-client` registry whose nine series are all
  literally namespaced `open_design_critique_*` (`open_design_critique_runs_total`,
  `..._round_duration_ms`, `..._composite_score`, `..._must_fix_total`, etc.),
  with label sets (`panelist`, `dim`, `adapter`, `skill`, `round`) that are
  closed enums specific to the Critique Theater panelist/scoring model.
- `logging/critique.ts`: a `CritiqueLogEvent` discriminated union
  (`run_started`/`round_closed`/`run_shipped`/`degraded`/`parser_recover`/
  `run_failed`) whose every field is Critique-Theater-domain vocabulary
  (`composite`, `mustFix`, `panelist` semantics implied by `round`/`decision`).

This is the *same* OD feature `r1-daemon.md`'s own TASK 1 table separately
and correctly classifies as OD-PRODUCT under `critique/` (21 files,
"Design-critique orchestrator/scoreboard/ratchet/conformance. Product.") —
the recon simply missed that `metrics/`+`logging/` are that feature's
telemetry, not standalone generic infrastructure. There is no generic core
to extract: every constant, label, and event-type name is Critique-Theater-
specific, and porting either file into `packages/@jini/**` under any
renaming would violate root `AGENTS.md`'s hard boundary (no
`Open Design`/`OD_`-branded content in the engine) while also misrepresenting
product-feature telemetry as engine-neutral. **Correct action: dropped,
not ported.** If Jini ever wants a generic Prometheus-registry or
JSON-line-logger *primitive*, that would be new engine-shaped code
designed from scratch against real cross-consumer metrics — not a
rename of this file.

### `project-storage.ts` — split: generic core ported to `@jini/platform`, OD-specific factory dropped

Read in full (`apps/daemon/src/storage/project-storage.ts`, 437 lines).
Verified the recon's "leans OD" flag against the actual content: the
`ProjectStorage` interface + `LocalProjectStorage` + `S3ProjectStorage`
implementations are ~90% generic blob-storage logic with no OD nouns in
their own bodies; the only OD-coupled piece is the bottom-of-file
`resolveProjectStorage()` factory, which reads `OD_PROJECT_STORAGE`/
`OD_S3_BUCKET`/`OD_S3_REGION`/`OD_S3_PREFIX`/`OD_S3_ENDPOINT`/
`OD_S3_ACCESS_KEY_ID`/`OD_S3_SECRET_ACCESS_KEY`/`OD_S3_SESSION_TOKEN` env
vars directly. See `packages/platform/source-map.md`'s corresponding
section for the full file map — landed in `@jini/platform`, not
`@jini/sqlite`, because it is a filesystem/network blob-storage primitive
with no SQL/sqlite involvement (parallel to `fs.ts`'s existing role in that
package), and `aws-sigv4.ts` (its S3-signing dependency) lives there too.
`resolveProjectStorage()` itself was **not ported** — it is OD adapter
wiring (env-var names, and the choice to key storage on "project," a
product noun extraction-plan.md §Task-4-Port-2 already flags as OD's model,
not the engine's) — a Jini host application supplies its own equivalent
composition (`new LocalBlobStorage(root)` / `new S3BlobStorage({...})`
directly, or its own env-var convention) rather than inheriting OD's.

## `db/` module — daemon SQLite persistence (connection + schema + conversations/messages/projects/agent-sessions)

Ported across two sessions from `open-design`'s `refactor/db-barrel` branch
(`be33bd4f9`, "refactor(daemon): split db.ts god-file into capability-barrel
db/ module"), which decomposed OD's monolithic `apps/daemon/src/db.ts` into a
per-concern `apps/daemon/src/db/` barrel. Only the four generic engine tables
(`projects`, `conversations`, `messages`, `agent_sessions`) are ported; five
OD-product tables in the same barrel (`preview_comments`, `tabs`/`tabs_state`,
`deployments`, `routines`/`routine_runs`/`routine_schedule_claims`,
`templates`) are excluded — `deployments` overlaps with the separately-designed
`@jini/deploy` package (different design, not conflated); `routines` is OD's
automation-scheduling feature, explicitly excluded from the kernel per
`extraction-plan.md` §2.1; `preview_comments` is OD's canvas-annotation
feature; `tabs`/`templates` are OD UI-specific. This file-map table was not
updated when the first slice (`core/`, `connection/`, `schema/`,
`conversations/`, commit `2ad9cf6b0`) landed; it is being added retroactively
now, together with the three modules that complete the barrel.

| Jini file | Origin file (`refactor/db-barrel`) | Transform |
|---|---|---|
| `src/db/core/types.ts` | *(new — shared type aliases, no direct OD origin file; the aliases themselves — `SqliteDb`, `DbRow`, `JsonObject`, `ChatSessionMode` — are inferred from how every other `db/*` module in the barrel used `Database.Database`/loosely-typed rows)* | `SqliteDb = Database.Database`, `DbRow = Record<string, any>`, `JsonObject = Record<string, unknown>`, `ChatSessionMode = 'design' \| 'chat' \| 'plan'`. |
| `src/db/core/rows.ts` | `apps/daemon/src/db/core/rows.ts` | Verbatim (`row`/`rows` narrowing helpers). |
| `src/db/core/json.ts` | `apps/daemon/src/db/core/json.ts` | Verbatim (`parseJsonOrUndef`). |
| `src/db/core/index.ts` | `apps/daemon/src/db/core/index.ts` | Verbatim barrel. |
| `src/db/connection/connection.ts` | `apps/daemon/src/db/connection/connection.ts` | Verbatim `openDatabase`/`closeDatabase` singleton lifecycle. **Identity-stripped**: default data directory `.od` → `.jini`. |
| `src/db/connection/index.ts` | `apps/daemon/src/db/connection/index.ts` | Verbatim barrel. |
| `src/db/schema/migrate.ts` | `apps/daemon/src/db/schema/migrate.ts` (405 ln) | Only the 4 generic `CREATE TABLE`s (`projects`, `conversations`, `agent_sessions`, `messages`) + their 2 indexes are kept; the 5 product tables above, their indexes, `migratePreviewCommentsSlideKey`, and the calls to `migrateCritique`/`migrateMediaTasks`/`migrateLibrary`/`migratePlugins` are dropped. OD's forward-compatible `ALTER TABLE … ADD COLUMN` machinery (the whole second half of the original function, plus its `PRAGMA table_info` checks) is dropped — Jini is greenfield, so every column the barrel eventually reaches via `ALTER` (e.g. `messages.run_id`/`run_status`/`telemetry_finalized_at`, `projects.metadata_json`/`custom_instructions`, `agent_sessions.stable_prompt_hash`/`model`/`cwd`/`last_message_id`) is folded directly into the base `CREATE TABLE`. Also pre-drops, per base `CREATE`, the OD-product JSON columns `messages.comment_attachments_json`/`produced_files_json`/`trace_object_files_json`/`feedback_json`/`pre_turn_file_names_json`/`applied_plugin_snapshot_json` and `projects.skill_id`/`design_system_id`/`applied_plugin_snapshot_id` — see the `db/messages` and `db/projects` rows below for why. |
| `src/db/schema/index.ts` | `apps/daemon/src/db/schema/index.ts` | Verbatim barrel. |
| `src/db/conversations/conversations.ts` | `apps/daemon/src/db/conversations/conversations.ts` | Near-verbatim (no OD-specific fields existed on `conversations` to begin with). One behavioral no-op typing change made in this session: `numberProperty`'s `key` parameter was made generic (`<K extends string>`) so its `Partial<Record<K, number>>` return type survives an object-literal spread at the call site — the original's plain `string`-keyed return widened to an index signature under this repo's `strict`/`noUncheckedIndexedAccess` tsconfig, which `tsc --noEmit` (not `vitest run`, which uses esbuild and doesn't full-typecheck) flagged as `totalDurationMs` "not existing" on `getConversation`'s/`listConversations`' return type. |
| `src/db/conversations/index.ts` | `apps/daemon/src/db/conversations/index.ts` | Verbatim barrel. |
| `src/db/messages/messages.ts` | `apps/daemon/src/db/messages/messages.ts` (303 ln) | Drops six OD-product JSON columns/fields with no generic engine equivalent: `comment_attachments_json`/`commentAttachments` (the preview-comments feature, out of scope per this task's explicit instruction), `produced_files_json`/`producedFiles` and `trace_object_files_json`/`traceObjectFiles` (design-canvas file output tracking), `feedback_json`/`feedback` (Critique Theater's scoring feedback), `pre_turn_file_names_json`/`preTurnFileNames` (design-canvas per-turn file context), `applied_plugin_snapshot_json`/`appliedPluginSnapshot` (OD's plugin host). `upsertMessage`'s insert value count drops from 24 to 18 accordingly. Everything else — CRUD, position sequencing, the `telemetry_finalized_at` one-way latch, `appendMessageStatusEvent`/`appendMessageAgentEvent`'s dedupe-consecutive-event logic — is verbatim. |
| `src/db/messages/index.ts` | `apps/daemon/src/db/messages/index.ts` | Verbatim barrel. |
| `src/db/projects/projects.ts` | `apps/daemon/src/db/projects/projects.ts` (358 ln) | Drops three OD-product columns/fields with no generic engine equivalent: `skill_id`/`skillId` (OD's agent-skill marketplace selection), `design_system_id`/`designSystemId` (OD's Design System feature), `applied_plugin_snapshot_id`/`appliedPluginSnapshotId` (OD's plugin host). Everything else — CRUD, the four `listLatest*`/`listFirst*RunStatuses` run-status reducers, the `<question-form>`/`<ask-question>` awaiting-input detection queries, `normalizeProjectRunStatus`'s status-enum collapsing — is verbatim; none of it is OD-specific (see "kernel-noun exclusion" note below). |
| `src/db/projects/index.ts` | `apps/daemon/src/db/projects/index.ts` | Verbatim barrel. |
| `src/db/agent-sessions/agent-sessions.ts` | `apps/daemon/src/db/agent-sessions/agent-sessions.ts` (192 ln) | Verbatim — the upstream CLI resume-identity-guard session cache has no OD-specific fields at all; every column (`session_id`, `stable_prompt_hash`, `model`, `cwd`, `last_message_id`) is generic resume bookkeeping already matched 1:1 by the schema. |
| `src/db/agent-sessions/index.ts` | `apps/daemon/src/db/agent-sessions/index.ts` | Verbatim barrel. |
| `src/db/index.ts` | `apps/daemon/src/db/index.ts` (barrel entrypoint) | Re-exports only the four ported concerns' public surface (not the five excluded product tables' modules, which don't exist in this port). |

### Design decisions

**1. `projects` vs. the kernel-noun exclusion in `extraction-plan.md` §2.1.**
That doc's kernel-noun list excludes "projects... conversations" from the
*kernel* (`@jini/core`/`@jini/daemon`). This does not block porting either
table into `@jini/sqlite`, because `@jini/sqlite` is a generic *optional*
storage adapter any consumer may use — not the kernel itself, which knows
nothing about either table. `conversations` already shipped under this
reasoning in the first slice; `projects` follows the identical precedent
here: the table is de-branded into a generic workspace/container row-store
(id/name/prompt/metadata/instructions/timestamps) with every OD-specific
field (`skill_id`, `design_system_id`, `applied_plugin_snapshot_id`) dropped,
the same way `conversations` (and now `messages`) had their OD-specific
fields dropped.

**2. The `<question-form>`/`<ask-question>` awaiting-input queries were kept,
not dropped.** These pattern-match a markup convention embedded in assistant
message *content* (not a schema column, not a product noun) to detect
whether the latest assistant turn is waiting on a user reply. Nothing about
the mechanism is OD-branded or tied to a design/marketplace/plugin concept —
any chat-agent host that embeds structured forms in message text can reuse
it as-is. Kept verbatim in `db/projects/projects.ts`'s
`listProjectsAwaitingInput`/`listConversationsAwaitingInput`.

**3. `schema/migrate.ts` needed no changes for this task.** The prior
session's foundation-slice port had already pre-trimmed the `messages`,
`projects`, and `agent_sessions` `CREATE TABLE` column lists to exactly the
neutral set these three new CRUD modules need (verified column-by-column
against `messages.ts`'s `MESSAGE_COLS`, `projects.ts`'s `PROJECT_COLS`, and
`agent-sessions.ts`'s literal column list before writing any of the three
modules) — so the task brief's "extend schema/migrate.ts if needed" branch
did not apply.

**4. Two pre-existing `tsc --noEmit` failures in the already-committed
foundation slice were fixed in this session**, both discovered only because
this task's Definition of Done requires a full repo-wide `pnpm typecheck`
pass (the foundation slice had only been verified via `vitest run`, which
transpiles with esbuild and does not full-typecheck): `conversations.ts`'s
`numberProperty` helper (see the `conversations.ts` file-map row above), and
`db/__tests__/db.test.ts`'s `list[0].latestRun` access under
`noUncheckedIndexedAccess` (changed to `list[0]?.latestRun`). Both are
non-behavioral typing-only fixes.

**5. Coverage-only defensive-branch tests use a fake-driver `Proxy`,
matching this package's own established precedent.** A handful of branches
ported verbatim from upstream are provably unreachable through real SQLite
query results given this schema (e.g. `messages.ts`'s
`(max?.m ?? -1) + 1` — the position-max query's `COALESCE(MAX(position), -1)`
guarantees a row; `row.createdAt ?? undefined` — `created_at` is `NOT NULL`;
`projects.ts`'s `listFirstConversationRunStatuses`/`listLatestRunStatuses`
`row.runId ?? undefined` — both queries filter `run_id IS NOT NULL`). Rather
than strip these defensive fallbacks (losing upstream fidelity) or leave
100% coverage unmet, `db/__tests__/db.test.ts` adds a small
`withStubbedStatement` helper that wraps a real `SqliteDb` in a `Proxy`
intercepting only `.prepare()` calls matching a given SQL predicate, letting
every other statement hit the real database — the same technique
`src/__tests__/db-inspect.test.ts` already uses (a hand-built fake
`Database.Database`-shaped object) for its own otherwise-unreachable
`better-sqlite3` error paths, generalized here to a reusable wrapper since
`upsertMessage`/`listMessages`/`listFirstConversationRunStatuses`/
`listLatestRunStatuses` each needed it for a different single statement
while still exercising the surrounding real-database code path (writes still
land in the real underlying file; only the one targeted `.get()`/`.all()` is
stubbed).

### Not ported (explicitly out of scope for this task)

`deployments`/`preview_comments`/`routines`(+`routine_runs`+
`routine_schedule_claims`)/`tabs`(+`tabs_state`)/`templates` and their
per-table CRUD modules — flagged explicitly out of scope in this task's
brief; the barrel branch was not searched for a reason any of them might
actually belong, since none surfaced while reading `messages/`, `projects/`,
or `agent-sessions/` (none of those three modules reference any of the five
excluded tables).
