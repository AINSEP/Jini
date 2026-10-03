Spec ID: SPEC-JINI-DAEMON-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:46b6fe55f4d1cc69719deb4a89e7826cbd8ba6592eb9bcc20d57440d9da4722a
spec_mode: reverse_spec


# State and persistence contract: @jini-ai/daemon

## Runs and logs

A fresh run enters running after a persisted start. Cancellation adds intent without changing it to terminal. A successfully persisted end moves it to succeeded/failed/cancelled, resolves terminal waiters and initiates retention. Resume can return an eligible resumable terminal record to running, but that transition is only in memory. No durable resume event is written; recovery can observe the preceding terminal end.

The lifecycle owns its maps, subscribers and timers, and borrows EventLog. Hosts own drivers and storage closure. Rehydrate is explicitly awaited once at startup; recovery restores metadata/outcomes and ends orphaned unfinished runs as failed/resumable. Child processes, confirmation promises, transient context, terminal sockets and browser sessions cannot be recovered from this log. Terminal pruning removes both cached record and run log; no archival guarantee is made.

Memory EventLog loses all state on instance loss. SQLite stores jini_event_log_runs and jini_event_log_entries, persists per-run next cursor and applies FIFO entry retention transactionally with append/dedupe. Drop removes cursor/entries; reused run IDs start again. Retention can remove replay/dedupe evidence. Borrowed SQLite factory initializes tables without taking ownership; opened logs apply WAL and close their owned handle idempotently. Serialize/close errors propagate. JSON replay values need not preserve identity or richer JavaScript types.

## Tool, frontend and continuation state

ToolExecutor keeps requested→authorized/denied→confirmed/confirmation-denied→started→completed/failed/timed-out/cancelled audit histories in memory. The confirmation phase is skipped for tools not requiring it. Pending confirmations and audit records have no persistence, expiry or bounded retention. Cancel targets active work; it is a no-op for unknown/completed executions. Host teardown must settle/cancel waits as appropriate.

Frontend registry attach mints a bind token; binding connects run to session; invoke creates pending work; settle/abort/detach removes it. Replacement invalidates the old session generation. Detach rejects pending invocations and removes its token/run bindings. Recreating the registry loses all bindings and promises; there is no reconnect replay of pending frontend work.

RunScopedContextStore is volatile and keyed by run ID. Bind replaces the value and installs one terminal subscription; terminal resolution or rejection evicts the value. Resolve of an absent value throws. It does not authorize a run or persist the bound Principal/context.

RunByteJournal borrows a separate EventLog, writes JournalEntry payloads and projects replayed entries. It has no independent lifetime, validation or persistence engine. Unknown journal run reads return []; record rejects if the supplied log rejects. Host retention settings determine how much continuation history survives.

## Sessions and routines

Memory AgentSessionStore is keyed by the conversation/agent pair and survives only for the instance. Kernel adapters persist that pair atomically in assistant_agent_sessions with session_id/updated_at. Set replaces the pair and clear deletes it. Adapter operations join the supplied kernel transaction; factories do not query/migrate/configure/close the kernel. There is no embedded owner/tenant check or foreign-key enforcement in this port.

Legacy SQLite helpers use the separate agent_sessions table with stable prompt/model/cwd/last-message metadata. Session lookup and completed-assistant message selection are synchronous. Hosts bootstrap schema and decide when to clear sessions. The simple kernel port and rich legacy helpers do not automatically synchronize.

TerminalSessionManager retains session ownership and action locks; platform retains PTY buffers/replay/TTL. Create→active→killed/exited→expiry is volatile process state. Foreign sessions are hidden. shutdownActive stops active sessions with the configured grace period; it does not persist a reconnectable terminal. Hosts detach sinks and invoke shutdown before process exit.

RoutineService owns future timers, while RoutinePersistence owns definitions, run history and scheduled-slot claims. Start schedules enabled definitions; reschedule cancels/replaces relevant timers; stop clears timers without canceling in-flight work. Claim precedes optional prepare/start and completion updates. Atomic slot uniqueness must be supplied by persistence for multi-scheduler safety. A plain in-memory store's recordRun guards duplicate run IDs only; it is not itself a durable shared scheduled-slot lock.

In-memory routine IDs/timestamps use ambient random UUID/time. List sorts IDs, run history sorts startedAt descending. Delete removes the definition without cascading run history. Recreating the store loses all state. On restart the scheduler computes future slots from current definitions rather than replaying every missed historical tick.

## Migration and watchdog lifecycle

Legacy migration stages configured payload under the destination parent, promotes without overwriting existing payload, writes the marker and retains the source. Repeated marked/already-populated/no-proof cases return noop/skipped. Failure attempts to remove promoted/staged files; native filesystem errors can still prevent complete rollback. Hosts select directories and inspect them after a failed migration.

InactivityWatchdog immediately arms a timer through the optional SchedulerPort; the native default timer is unrefed. noteActivity resets it and may rearm after firing. cancel permanently latches cancellation, clears the timer and prevents future scheduling or timeout delivery. Repeated cancellation is safe. No persistence or recovery is supplied.

## Active context and frontend sessions

Each active-context registrar owns one `{current:null}` pointer for all callers of that mounted pair. POST replaces/clears it; GET expires and clears it when age exceeds five minutes. There is no per-principal partition, persistence, timer or disposer. The host resolver supplies display metadata without changing stored resource identity.

Frontend-session registry state belongs to `@jini-ai/daemon`. A stream creates an id, attaches capabilities and delivers its bind token; closure detaches the session. Responses settle a pending invocation once, with false for unknown/repeated answers. `createFrontendControl` constructs and hides one registry, creates capability registrations, binds starting runs using the host token resolver, and releases each binding on terminal resolution or rejection. Bind failures are contained; tool policy defaults to daemon deny-all. The facade adds no durable session store or global shutdown method.


## Disk attachments

Lifecycle: raw private file → registered unclaimed capability → synchronously reserved for a run → verified claim → cleanup. Failed verification rolls back reservations. Batch claim is single-use; `resolveForRun` can claim an unclaimed record and is repeatable only for its owning run. Unknown references return undefined from resolve; a reference owned by another run throws the shared unknown-or-claimed refusal.

The store owns its upload directory and tracked Map. By default construction empties inherited storage; callers must provide an isolated directory. With `retainAcrossRestarts:true`, private sidecars persist id, absolute path, name, kind, size, batch id, device/inode, createdAt and optional owner. Restart validates surviving regular/canonical files against those fields, drops expired or invalid entries, and deletes unadopted uploads. Claimed-run reservations are not persisted; survivors are adopted as unclaimed. The sidecars are local filesystem evidence, not cryptographic signatures or protection against a writer who can replace both metadata and files.

Successful registration records actual filesystem size, not claimed client metadata. Quota checks reserve synchronously within one process. Failed sidecar persistence rolls back registration and removes the refused file. Persisted metadata is written with requested mode 0600; directory is chmod 0700. Multi-process writers are not coordinated.

Pending listing excludes ownerless/claimed entries and sorts createdAt ascending; identity scope is whatever the host uses as ownerId. It does not partition by conversation or batch. Expiry pruning is explicit or performed at upload start; it deletes only unclaimed records at `age >= retentionMs`. No background sweeper exists. `deleteUnclaimed` deduplicates requested capabilities and leaves claimed/other-batch entries alone; `cleanupRun` deletes that run's claims; `dispose()` deletes every tracked upload even with restart retention enabled. Store disposal does not set a closed flag.

Upload concurrency state is per registrar. It increments before async upload work and decrements in finally, then tidies empty batch directories. It supplies no timer/whole-upload deadline. Host shutdown must release run claims and dispose the store deliberately.


## HTTP resources and host state

Run-event routes attach the lifecycle subscription before opening, release it on closure, and release an asynchronously resolved subscription immediately if the client already disappeared. Durable run/event history, retention, replay cursors and idempotency live in the supplied RunLifecycle, not HTTP-kit.

Routine scheduling/store state, terminal sessions, connector records and credentials remain in supplied domain ports. Routine mutation reschedules/unschedules after storage changes; no cross-port transaction is supplied. Media routes persist a queued task, run background work, update progress/status and store base64 result bytes; deleting a task does not cancel the outstanding generation promise.

xAI route registration resolves one pending cache and mutable callback-listener slot shared across its six routes. A listener already running rejects another start. Completion consumes pending state and persists a token through the runtime adapter; cancel closes the listener; disconnect also deletes stored token data. Defaults include a 30-minute pending cache and a file under the supplied data directory. The registrar supplies no public disposer; host-provided pending/listener adapters own shutdown. OAuth credential storage and refresh semantics come from the imported runtime implementation.

## Dedicated entry ownership

Surface exchange stores own per-instance open-exchange maps, FIFO inboxes, waiters and idle/lifetime cancellation handles. Timers are installed before discoverability; shutdown/abandon resolves waiters and removes the exchange. No durable transcript, capacity limit or store-wide disposer is supplied.

Session coordination owns per-conversation run sets, reverse run bindings and promise tails; these disappear on process exit. Audit decorators own no durable ledger; catalog appends are asynchronous and host sinks determine durability. Run credentials own raw tokens per run and digest-to-run maps; revoke removes both. Owner registries require explicit forget. No credential TTL or automatic lifecycle subscription exists in the factory.
