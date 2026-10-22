Spec ID: SPEC-JINI-DAEMON-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:14e51084b69d20c64dfc724ba4efa040f3b3d69310f572189398512e0a11244f
spec_mode: reverse_spec


# Behavior contract: @jini-ai/daemon

## Durable runs

- The lifecycle shall reserve a run and idempotency key before awaiting its start append. A duplicate key is instance-wide, not context-scoped. Start persistence failure rolls back that reservation.
- The lifecycle shall append protocol events before notifying subscribers. Drivers must serialize their own emits when ordering matters; emit does not provide a global operation queue.
- Finish shall serialize competing finish calls, persist the end event before committing terminal state, and preserve the first successful terminal outcome. Failed end persistence leaves the run live.
- Cancel shall record intent and notify registered cancellation listeners; it shall not itself terminate a child or finish a run. Terminal cancellation is a no-op. A newly registered listener receives previously recorded cancellation intent.
- Stream shall subscribe before replay, buffer concurrent live events, and suppress duplicate event IDs. Replay failure or callback failure during attachment removes that subscription. Terminal catch-up includes an end event; live subscriptions need explicit unsubscribe until terminal delivery.
- Rehydrate shall share one hydration operation, restore usable logged runs and mark unfinished recovered runs failed/resumable. It shall not resurrect subprocesses, cancellation listeners or frontend bindings. The host shall await boot recovery before serving requests.
- Terminal cache retention defaults to 24 hours and 1000 runs; pruning drops the corresponding event log. Resume changes only cached state and emits no durable resume/start event; it is not restart-safe by itself.
- Inactivity watchdog observes emitted activity. Slow notices default to 45 seconds; only agent events reset the slow timer, while raw stdout/stderr do not. Host code can suspend/resume slow notices during human waits.

## Event logs and cursors

Both logs use per-run increasing decimal IDs, sorted listRunIds and run-local drop. The in-memory log is unbounded unless configured. SQLite retention defaults to 2000 entries and requires a nonnegative safe integer; zero retains no entries. Full retained replay can be truncated; replay behind retention returns replay-gap rather than fabricating missing events.

Dedupe differs after eviction: memory retains the old key/index and returns the original entry; SQLite removes the entry and its dedupe key, allowing a new append. Memory cursor validation returns invalid-cursor for nonfinite numeric conversion after checking run existence; SQLite throws for a value that is not numerically a nonnegative safe integer, before run lookup. Consumers shall not assume identical malformed-cursor behavior.

## Tool and frontend guards

- Tool policy must allow before the delegate can approve. The delegate may veto and cannot grant a denied tool. Unknown tool IDs throw before an audit record is created.
- Confirmation shall precede handler execution when required. Missing/bare-undefined onConfirm parks until resumeConfirmation; a promise resolving undefined is treated as denial. Confirmation wait has no default deadline.
- Descriptor timeout starts only after authorization/confirmation. Abort is cooperative; a handler ignoring its signal can remain pending. Output byte limits truncate strings only; object output is unchanged and zero disables truncation.
- Handler ToolInputError becomes failed/validation; other handler errors become failed/internal. Some pre-handler failure results omit errorKind, so consumers shall tolerate its absence.
- Delegated execution emits tool_use before execution and tool_result afterward, subject to persistence succeeding. Human-only result surfaces are emitted separately; model-visible text/image output remains in the result. Remote recording does not enforce policy or prove that execution occurred.
- Frontend binding tokens are opaque session authority. Capability claims accept an exact name or a trailing-dot prefix. Unbound/disconnected/undeclared calls fail closed. Duplicate or foreign settlements return false.
- Session replacement/detachment shall reject pending work and invalidate its tokens/bindings; a stale detach handle cannot detach its replacement. Direct bindRun is trusted host-only wiring. Registry invocation has no intrinsic timeout.

## Process, terminal and scheduling behavior

The driver resolves after dispatch/spawn rather than process completion. It drains ordered driver events before finishing, stages prompt/MCP/config resources as needed, and reports cleanup failures through the host seam. Cancellation attempts process-tree shutdown. ACP native permissions are a separate policy seam. Explicit env bypasses the default environment allowlist; omitted permissionMode selects the vendor bypass mode. The package does not infer a safe workspace, owner, credential grant or application prompt.

Terminal ownership compares principal IDs and hides foreign sessions as not-found. Kill/write/resize are serialized per session; the killed latch prevents further writes/resizes. PTY import is lazy. Terminal service tuning/lifecycle otherwise belongs to platform.

Routine scheduling supports DST repeated times and a post-gap fallback. Scheduled slots are claimed before starting work; persistence false means another scheduler won. A failed slot claim is retried for that slot. Timers are bounded to 1000–2000000000 ms. Stop clears scheduling timers without canceling active work. CRUD does not automatically validate schedules/targets or cascade in-memory run history on routine deletion.

runResultFromStatus recognizes 'succeeded' and 'canceled'; all other strings, including 'cancelled', map to failed. Normalize lifecycle outcome spelling before analytics projection.

Safe retry defaults to one retry, requires explicit retryable transient failure, excludes cancellation/hard quota, and suppresses retries once visible/tool/artifact effects occur. Backoff uses half-to-full jitter, exponential factor 2 and an 8-second cap. Diagnostic tails keep at most 20 nonempty lines/4096 bytes; default redaction is identity, so hosts must provide secret redaction.

Migration shall require configured proof/payload, avoid overwriting existing destination payload and reject symlinks in copied payload. It stages/promotes before marker writing and attempts rollback on failure. It does not delete the legacy source or choose application directories.

## Deliberate limits and source mismatches

The package supplies no HTTP listener, application auth, database driver discovery, schema migration for kernel adapters, durable confirmation/session/audit store, UI, or exactly-once remote execution guarantee. InactivityWatchdog.cancel permanently disables subsequent timer activity, including an already-queued callback. After a timeout fires, activity may start another window until cancellation. RunByteJournal.record propagates its EventLog append failure; it does not convert persistence failures into success.

Decision rationale: [Remote tool execution records into the owning run](../decisions/DR-001-remote-tool-event-recording.md).

Decision rationale: [Agent subprocess environment is an explicit allowlist](../decisions/DR-002-explicit-subprocess-environment.md).

## Stateful route rules

- WHEN a run starts, lifecycle persistence shall precede the optional driver hook. A replay that returns `started:false` shall not rerun that hook. A hook failure shall attempt terminal failed state and return a private correlated error. Idempotency scope/persistence belongs to the supplied lifecycle.
- Run streams shall subscribe before opening SSE, enqueue replay before live writes, honor Last-Event-ID before query cursor, and unsubscribe on closure. Invalid cursor/unknown run/replay gap shall return JSON before headers. Terminal end events close the channel.
- WHEN read-only enforcement is requested as literal true, delegated execution shall check the run, then descriptor, then resolve/attenuate principal, then execute. Missing registry, unknown or unclassified tool metadata shall refuse. Nested/recovery calls require the host's gate directly around the bare executor beneath decorators.
- The generic read-only decorator shall preserve principal roles, gate every execute dispatch, and return denied without calling the handler. Unconstrained principals bypass this extra restriction; confirmation/cancel/audit methods forward to the inner executor.
- Frontend streams shall guard origin before opening/minting a session. Invalid capabilities shall emit one error event and close. The server generates session ids and emits the bind token once. Unknown/duplicate responses shall return `{settled:false}`. Bind failures in the frontend facade shall be reported without failing the run; terminal/rejected terminal waits release bindings.
- Terminal creation and editor opening shall use the injected workspace resolver; missing resolver shall deny, never guess cwd. Terminal tools execute through the supplied executor/principal. DB declarations likewise specify executor dispatch, and DB tool registrations default to deny-all policy; the DB route integration is currently incomplete.
- WHEN starting media generation, the route shall persist a queued task before responding 202 and run generation in the background. Each accepted request creates a new UUID task; no deduplication key is supplied. Task deletion supplies no generation cancellation.
- Attachment upload shall check concurrency and consumed-body ordering before writing, then prune, create a batch directory, stream bounded bytes, sniff content, and register. Filenames shall not choose the stored basename; created files are exclusive and private. Partial writes are removed on failure.
- Attachment registration shall verify canonical regular files and decide quota reservations without an await between quota check and map insertion. Claim shall reserve synchronously, verify filesystem identity, and roll back failed reservations. First claim is capability possession; pending listing is scoped to the host's trusted owner id.


## HTTP defaults and security ordering

- The family manifest shall deduplicate `METHOD PATH` in first-seen order. Unknown family lookup shall return undefined; aggregate lookup shall skip unknown families. The manifest covers five families only.
- Remote event ingestion shall require its dedicated bearer even from loopback, fail 503 when unconfigured and fail 401 for invalid credentials. Its registrar supplies this gate; mounting its route constants directly does not.
- Daemon-auth middleware shall evaluate the host policy before body access unless delegated-body validation is explicitly enabled. Only allowed decisions can replace the principal header. Ownership decisions pass denial status/body through; policy exceptions reach Express `next(error)`.
- WHEN listing owned runs without a principal header, the handler shall fail 401 before the list port. Otherwise it shall apply context filtering before host ownership filtering.
| Active context | TTL 300,000 ms; expires only when age is greater than TTL; one shared pointer per registration; default clock Date.now |
| Catalog search | Declared default 10, cap 25; positive integer query-string limit required; component catalog implements this, tool and component catalogs use object-shaped query ports |
| Routine run-history limit | `Number(firstQueryValue) || 20`, then clamp 1–100; fractions remain fractional; negative values clamp to 1 |
| Attachment upload | 4 concurrent uploads, 20 MiB/file, 10 cleanup references; per-registration upload counter |
| Disk attachment store | 10 files/batch; 50 MiB/batch; 100 tracked files; 200 MiB total; retention 3,600,000 ms; restart retention false |
| Attachment batch id | 8–80 ASCII letters/digits/hyphens; no traversal segments |
| Research | Query trimmed/truncated to 1,000 characters; sources default 5, floor/clamp 1–20; one Tavily request, deadline 30,000 ms covering body |
| xAI | Search deadline 30,000 ms; model `grok-4.20-reasoning`; base `https://api.x.ai/v1`; callback 127.0.0.1:56121 `/callback`; token file `xai-oauth-token.json` under dataDir default process.cwd |

## Exchange, coordination, audit and credential rules

Surface exchanges require unique nonempty IDs and positive finite deadlines. Delivery validates principal plus any provided toolId and the effective channel, resets idle expiry and preserves FIFO. Buffered answers precede terminal status. Close is idempotent and abandons pending receives; typed prose is never confirmation. Outcome emission failure cannot replace an authoritative tool result.

Start locks serialize only initialization for the same conversation and clean settled tails after success or failure; undefined conversation bypasses serialization. Tracker re-registration moves a run out of its previous conversation. Stopping-run waits race terminal completion against the host timer and cancel that timer on exit; timeout does not cancel runs.

Audit sink/reporter/error-ID observer failures cannot change tool results. Summaries contain keys/types/counts and selected IDs, not raw input/query/output/error text. Required clock/ID providers remain host callbacks in this entry and can still throw. Unknown-tool exceptions are audited then rethrown.

Run credentials are minted only for live runs, stable until revoked, and digest-indexed; lookup rechecks liveness/current principal. Route allowlist RegExp g/y flags are stripped to prevent alternating decisions. An absent bearer on an exempt path passes before config validation. Wrong-run requests use 404, denied routes/body.runId mismatch use 403; unknown ownership fails closed if existence lookup throws. The host applies a returned principal header only after an allowed decision.
