# `@jini/daemon` — provenance

Origin: fork `leonaburime-ucla/open-design`, branch `arch/server-startserver-endgame`
(local reference clone `/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic`,
tracked read-only as `refs/remotes/fork/server-endgame`), commit
`f1aabe9e5ac24b48894b135031a65f893a443b2d` (2026-07-03). **This branch closed
PR #5152 without merging** — it is real, complete work (the 4-slice
decomposition of `apps/daemon/src/server.ts` from 8,616 to 3,399 lines), just
not upstream. Every file/line citation below is against this commit, read via
`git show fork/server-endgame:<path>` — the clone itself was never checked out
or modified. All content read: `apps/daemon/src/runtimes/start-chat-run.ts`
(3,715 lines), `apps/daemon/src/runtimes/runs.ts` (473 lines),
`apps/daemon/src/routes/runs.ts` (1,432 lines),
`apps/daemon/src/runtimes/chat-run-lifecycle.ts` (228 lines),
`apps/daemon/src/run-failure-classification.ts` (788 lines),
`apps/daemon/src/run-event-analytics.ts` (204 lines),
`apps/daemon/src/runtimes/run-artifacts.ts` (331 lines),
`apps/daemon/src/run-telemetry.ts` (190 lines),
`apps/daemon/src/runtimes/fire-pipeline-for-run.ts` (94 lines), plus
`git diff main fork/server-endgame --stat -- apps/daemon/src` for the full
touched-file inventory.

Per extraction-plan.md §8 task 5: "RunLifecycle + replayable EventLog
(`@jini/daemon`), runs keyed on `contextRef`." Per §12 C1: the durable
`EventLog` must be a **kernel port**, not assumed in-memory-only.

## File map

| Jini file | Origin file(s) | Transform |
|---|---|---|
| `src/event-log.ts` | `apps/daemon/src/runtimes/runs.ts` lines ~28-96 (ring buffer: `run.events`/`run.nextEventId`, `emit()`'s push-then-evict), lines ~232-258 (`stream()`'s `Last-Event-ID`/`?after=` replay loop) | **Generalized, not lifted verbatim** — OD's ring is a bare array field on a bigger `run` object with no port boundary; this is a from-scratch `EventLog` port + `createInMemoryEventLog` reference implementation reproducing the same FIFO-cap-at-2000 behavior, plus two things OD's version does **not** have: (1) `dedupeKey` idempotency dedup on `append()` — OD's own `clientRequestId` is threaded through but never deduplicated against (confirmed absent by exhaustive grep of the researched source; new work, not a lift), and (2) a distinguishable `'replay-gap'` result when a reconnect cursor references already-evicted events — OD's `stream()` loop (`record.id > lastEventId`) silently resends whatever is still buffered with no gap detection at all (verified: a client reconnecting with a stale cursor gets no error, no signal, just a truncated-looking-contiguous stream with a real hole in it). This is exactly the neutrality risk extraction-plan §12 C1 flags; closing it was treated as in-scope for a "kernel port," not an OD behavior to preserve bug-for-bug. |
| `src/close-status.ts` | `apps/daemon/src/runtimes/chat-run-lifecycle.ts` — `classifyChatRunCloseStatus` (lines 44-72), `resolveChatRunInactivityTimeoutMs`/`resolveChatRunArtifactQuietPeriodMs` (env>agentDefault>default, clamped cascade) | `classifyRunCloseStatus`: kept only the generic skeleton (cancel-requested → cancelled; exit code `0` → succeeded; else failed). **Dropped** the ACP-forced-shutdown-but-actually-clean escape hatch (SIGTERM/exit-130 with a clean ACP completion flag) and the artifact-quiet-shutdown/non-zero-exit-but-artifact-was-produced escape hatches — both are OD-specific nuance (a specific agent protocol's clean-shutdown signature; OD's design-artifact domain concept) layered on top of a generic tree, not the tree itself. `resolveTimeoutMs`: same env>agentDefault>default>clamp cascade, generalized (caller supplies its own env var name and injects the env source for testability, rather than reading `process.env` and an OD-specific var name implicitly). `createInactivityWatchdog` (new, not a direct lift) extracts the reset-on-activity-then-fire-once *pattern* used throughout `start-chat-run.ts`'s inactivity watchdog — the origin's SIGTERM-then-SIGKILL subprocess escalation on fire is deliberately not included (that's subprocess-signaling detail belonging to `@jini/agent-runtime`, task 7; `onTimeout` is where a driver plugs that in). |
| `src/run-lifecycle.ts` | `apps/daemon/src/runtimes/runs.ts` (`createChatRunService`'s `create/get/list/stream/cancel/wait/emit/finish` — the `design.runs` object) + the terminal-decision half of `apps/daemon/src/runtimes/start-chat-run.ts` (`send()` lines ~1082-1115; `finishWithRetryDecision`/resume-on-failure lines ~1220-1406; the `child.on('close', ...)` handler lines ~3228-3677) | See "Design decisions" below for the full accounting — this is the file that needed the most judgment, not a mechanical port. |
| `src/tokens.ts` | *(new)* | `RunLifecycleToken`/`EventLogToken` via `@jini/core`'s `token()`, following the exact naming convention `packages/core/src/index.test.ts` already established (`RunStoreToken`/`EventLogToken`, suffixed `Token` — not the bare names extraction-plan §2.2's illustrative pseudocode used, since that would shadow the interface names in this codebase's actual test precedent). |
| `src/index.ts` | *(new — barrel)* | Re-exports all four modules above. |

## Design decisions (judgment calls the task brief explicitly asked for)

**1. `RunLifecycle` does not spawn or signal subprocesses.** OD's `cancel()`
(`runs.ts:361-401`) does real tiered signal escalation (ACP `.abort()` → RPC
grace → `SIGTERM` on the process group → grace → `SIGKILL`, all
env-var-tunable). That is deeply subprocess/agent-CLI-adapter-specific and is
explicitly `@jini/agent-runtime`'s territory (task 7), not this task's. This
package's `cancel()` only records intent (`cancelRequested` + notifies
`onCancelRequested` listeners, an `AbortSignal`-shaped but framework-neutral
callback registry) and never itself forces a terminal transition — a driver
observes the signal and calls `finish()` once it knows the real outcome,
exactly mirroring OD's actual invariant that `finish()`/`design.runs.finish`
is the only path to a terminal state, called from the child's real `close`
event, never synchronously from `cancel()` itself.

**2. `resume()` is a generalization, not a literal port.** OD has two
unrelated "resume" concepts (see the research notes cited in the handoff
report): (a) resuming the *external agent CLI's own* session via
`--resume <id>`/ACP `session/load`, persisted in OD's SQLite schema — a
real subprocess/vendor-CLI concern out of scope here — and (b) a
`run.resumable` flag surfaced to the client so a *next user turn* can invoke
(a). Neither is "resume an interrupted daemon-side run object" — that
concept doesn't exist in OD. `@jini/daemon`'s `resume()` builds that concept
fresh: a terminal run with `resumable: true` (set by whoever called
`finish()`) can transition back to `'running'` on the **same `runId`**,
continuing the **same `EventLog` cursor sequence** unbroken — no new `'start'`
event, no cursor reset. This was a deliberate choice to make `resume()`
meaningful and testable at the kernel layer without a real subprocess/session
concept to hang it on; see `characterization.test.ts` for the two-segment
proof (start→agent*→end(failed,resumable)→resume→agent*→end(succeeded), ids
monotonically increasing across the whole thing).

**3. No `RunStore` port was extracted.** Extraction-plan §2.2's illustrative
composition example lists `RunStore` and `EventLog` as siblings a pack
depends on. This task's charter (§8 task 5) names only `RunLifecycle` +
`EventLog` as deliverables. `RunLifecycle`'s own run-status registry
(`Map<runId, RunRecord>`) is therefore an internal implementation detail of
this package's `createRunLifecycle`, not a separately swappable port — a
persistent run registry (surviving a daemon restart, not just an event
replay) is not implemented. **Flagged as a real follow-up**: a future task
(likely task 8, alongside the `@jini/sqlite` durable `EventLog` adapter)
should decide whether `RunLifecycle`'s registry needs its own `RunStore`
port for restart-durability parity with §2.2's example, or whether
`RunLifecycle` itself becomes the thing `@jini/sqlite` backs directly.

**4. The `RunState`/`RunEndPayload.status` spelling mismatch is bridged, not
fixed.** `@jini/protocol`'s `RunState` uses `'cancelled'` (2 L) while
`RunEndPayload.status` uses `'canceled'` (1 L) — this is extraction-plan §12
C5's own cited vocabulary-firewall canary, already present in `@jini/protocol`
before this task started. `packages/protocol` is explicitly out of scope for
this task, so `run-lifecycle.ts` bridges the two spellings with an explicit
`TERMINAL_OUTCOME_TO_END_STATUS` lookup table (with a comment citing this)
rather than silently letting them drift or fixing the upstream package.
`run-lifecycle.test.ts`'s finish() test asserts the bridge explicitly.

**5. Driver-emittable events are a closed, explicit union
(`DriverEmittableInput`)**, not `RunProtocolEvent` minus `'start'`/`'end'`
derived mechanically — `'start'` is only ever produced by `start()`, `'end'`
only by `finish()`; a driver calling `emit()` can only ever produce
`'agent'`/`'stdout'`/`'stderr'`/`'error'`. This mirrors OD's actual invariant
(`'start'` emitted once by the engine right before spawn, `'end'` only from
`design.runs.finish`) as a compile-time-enforced contract rather than a
runtime convention.

**6. `emit()` throws (fails fast) on an unknown or already-terminal run**,
rather than silently no-op'ing. OD's own code pattern is the caller checking
`run.cancelRequested || design.runs.isTerminal(run.status)` defensively
*before* emitting (repeated ~10 times in `start-chat-run.ts` per the
research), i.e. OD treats "don't emit after terminal" as the caller's job,
not something `emit()` itself silently absorbs. This package makes that the
same explicit contract, but surfaces a violation as a thrown error (a driver
bug) instead of a silently-observed defensive check, per this codebase's
fail-fast-defaults convention.

**7. A cancel listener that subscribes after `cancel()` already fired still
receives the notification immediately** (`onCancelRequested` replays the
last request if `cancelRequested` is already true at subscribe time). This
was found and fixed during this task's own mandatory score-skepticism pass
(a plain forward-only listener registry has no memory of past firings, so a
driver attaching late — e.g. after being constructed asynchronously — would
otherwise silently never learn a cancellation was already requested). No OD
equivalent exists to compare against; this is new, `AbortSignal`-inspired
behavior.

## Characterization test methodology

`src/characterization.test.ts` is the extraction-plan §8 task 5 gate's
"OD characterization tests emit the same ordered event sequence" deliverable.
**No live OD daemon or captured event-stream fixture was available in this
environment** to diff against byte-for-byte — the test file's own header
comment documents this explicitly and cites the exact researched-source line
ranges each asserted invariant is drawn from (start-always-first,
`'agent'` sub-payload field-name shapes, end-always-last-and-idempotent,
resume-continues-the-cursor-sequence). This proves `@jini/daemon` reproduces
OD's *documented* ordering contract; it is not a claim of byte-for-byte wire
parity. Full byte-for-byte parity would require either a running OD instance
in this environment or a recorded fixture neither of which existed — flagged
as a real gap for whoever next has access to a live/recorded OD run to
upgrade this test with an actual captured transcript diff.

## Not ported / explicitly out of scope

The overwhelming majority of `start-chat-run.ts`'s 3,715 lines were read and
deliberately **not** ported — see the research notes folded into this
report's companion Programmer handoff for the itemized breakdown. In summary,
dropped as OD-product-specific (not a kernel concern): project/cwd/plugin/
design-system resolution, prompt composition and skill/memory injection,
tool-token minting and MCP config injection, the ~20-vendor-CLI
auth/quota/failure-text pattern library in `run-failure-classification.ts`
(kept only its `isResumableFailure` **category** shape, generalized into
`FinishRunInput.resumable`, not its OD-CLI-specific pattern-matching body),
artifact/asset snapshotting (`run-artifacts.ts`), session-resume persistence
to OD's SQLite schema, Langfuse/PostHog analytics (`run-telemetry.ts`), and
the "plugin pipeline" firing (`fire-pipeline-for-run.ts`, which carries its
own `// @ts-nocheck` + explicit "do not copy this" warning in the origin).
`run-event-analytics.ts`'s pure event-scanning mechanics (tool_use/tool_result
pairing, "did anything visible happen" side-effect detection) were noted as
the most reusable part of that file but were not ported in this task —
they're a reasonable candidate for a future analytics/telemetry extension
point layered on top of `EventLog`, not part of the `RunLifecycle`/`EventLog`
charter itself.

## Dependencies

`@jini/core` (workspace) for `token()` — see `src/tokens.ts`. `@jini/protocol`
(workspace) for `RunEvent`/`RunProtocolEvent`/`RunState`/`RunStatus`/
`RunCancelRequest`/`RUN_PROTOCOL_VERSION`/`isTerminalRunState` — this package
produces/consumes exactly those types, not parallel ones, per the task
brief. `node:crypto` (`randomUUID`) — Node built-in, no new external
dependency.

## artifacts/ — MOVED to `@jini/artifacts` (2026-07-19)

Originally ported here 2026-07-18 as a generic artifact-store kernel port (6 files from OD's
`apps/daemon/src/artifacts/`). Moved out into a standalone `@jini/artifacts` package on
2026-07-19 after the swarm-consensus architecture debate found `ArtifactStoreToken` had been
declared alongside this package's genuine kernel tokens — a real violation of the locked
kernel-noun set (extraction-plan.md §2.1: "NO ... artifacts ... in the kernel"). Full original
provenance, file map, and validation record preserved unedited at
`packages/artifacts/source-map.md`.

## Addendum: `legacy-data-migration.ts` (2026-07-18, Part D of the backend
registry/memory/services/migration task)

Origin: `leonaburime-ucla/open-design`'s `refactor/web-memory-slice` branch
(cloned fresh to `/tmp/od-source`), `apps/daemon/src/migration/` (3 files:
`index.ts` barrel, `legacy-data-migrator.ts`, `update-apply-observations.ts`).
Per `foundry/docs/jini-port/recon/r1-daemon.md` TASK 1's `migration/` row: "Legacy-data
migration is generic mechanism but hardcodes OD data layout (inference)." Read
all 3 files in full to confirm/correct that inference:

- **`legacy-data-migrator.ts` — confirmed generic, ported** (as
  `src/legacy-data-migration.ts`). The mechanism (refuse-if-no-proof,
  refuse-if-destination-populated, refuse-if-already-migrated, reject
  symlinks, stage-then-atomically-promote, rollback-on-any-failure) has zero
  OD-specific logic; only the module-level `PAYLOAD_ENTRIES` constant
  (`app.sqlite`, `media-config.json`, `projects`, `artifacts`, ...) and the
  hardcoded `app.sqlite` "proof of real data" check were OD-specific.
  Generalized both into a host-supplied `LegacyDataMigrationConfig`
  (`payloadEntries` + `proofEntry`), threaded through every exported function
  (`dataDirIsEmptyOrFresh`, `legacyDirHasPayload`, `dataDirHasExistingPayload`,
  `migrateLegacyDataDirSync`) instead of a hardcoded module constant. Also
  generalized: the marker file name (`.migrated-from` is now a default, not
  hardcoded), the staging-dir naming prefix (`.od-migrate-` → `.migrate-`),
  and the thrown-error message text (dropped "OD_LEGACY_DATA_DIR"/"Open
  Design"/relaunch-specific wording, kept the operator-actionable structure).
  Simplification: the logger contract's unused `warn` method was dropped —
  the module never calls it (verified: `grep -n 'log.warn'` had zero hits in
  the origin either), so carrying it forward would be untested dead surface,
  not a behavior the port owes callers.
- **`update-apply-observations.ts` — NOT ported, correctly classified
  OD-PRODUCT, not "generic with OD hardcodes."** This is Electron-installer
  apply-across-version-upgrade telemetry: it reads `@open-design/release`'s
  `ReleaseChannel`/`releaseChannelFromVersion`, imports
  `@open-design/contracts/analytics`'s `TrackingUpdateApply*` event-schema
  types, and submits a PostHog `update_apply_observed` analytics event via
  this package's own `analytics.ts`/`app-config.ts` (OD's daemon-local
  telemetry/config modules, not ported). The recon's "generic mechanism but
  hardcodes OD data layout" inference was written for the whole `migration/`
  directory as one row; on a full read this file is not a data-layout
  migration at all — it observes and reports on the *desktop updater's*
  apply-outcome, a product-specific concern (release channels, installer
  artifact types, a fixed analytics event name/property schema) with no
  generic-mechanism core to extract. Skipped, not forced.

## New home decision

Ranked alongside `RunLifecycle`/`EventLog` in `@jini/daemon` because, like
those, it is a daemon-startup-lifecycle concern — the origin's own doc
comment states it runs "at module import time in server.ts, before
`openDatabase` opens SQLite," i.e. before any daemon service starts, which is
exactly this package's charter ("stateful" lifecycle, not a pure-interfaces
package like `@jini/core`).
## `ToolExecutor` — the tool-execution boundary (2026-07-18, port continuation task — Part 3)

**No upstream source. This is original design work, not a port.** Per
extraction-plan.md §2.5/§8 task 6 and confirmed by direct research the same
evening this was built: OD's `apps/daemon/src/runtimes/tool-loop-guard.ts`
only *observes* `tool_use` events to detect runaway repetition — it never
gates a call before it runs, and no admission-control/confirmation/audit
layer exists anywhere in the researched OD source for tool invocation. This
file builds that invariant fresh, against the shape extraction-plan.md §2.5
specifies almost verbatim: `{descriptor, handler, policy}` registration,
`ToolExecutor.execute(principal, run, tool, input, signal)` as the sole
invocation path, an audit trail covering
`requested→authorized→confirmed→started→completed→timed-out→cancelled`,
resumable confirmation, and a transport-injected `ExecutionDelegate`.

### Package split: `ToolRegistry` in `@jini/core`, `ToolExecutor` in `@jini/daemon`

extraction-plan.md §3's locked package table already answers "which
package" precisely, and this port follows it rather than picking a new
answer: `@jini/core` owns `ProviderRegistry, ToolRegistry, DI tokens +
resolver, Principal/Authorizer, pure interfaces`; `@jini/daemon` owns
`RunLifecycle, EventLog/EventSink, AgentExecutor, ToolExecutor, createDaemon
(stateful)`. Concretely: `ToolRegistry` (registration/enumeration, no
timers, no per-call state — a `Map` plus a couple of methods) is exactly
the "pure interface" shape `@jini/core`'s existing `token.ts`/`pack.ts`/
`bindings.ts` already establish. `ToolExecutor` (the audit-record map, the
pending-confirmation map, the per-call `AbortController`/timeout — genuine
runtime state that outlives a single function call) matches
`RunLifecycle`/`EventLog`'s existing shape in this package far better than
it matches anything in `@jini/core`. New files:

| File | Package | Contents |
|---|---|---|
| `packages/core/src/principal.ts` | `@jini/core` | `Principal { id, roles? }` — deliberately minimal per §3 ("Principal/Authorizer, pure interfaces"); anything richer is a consumer concern. |
| `packages/core/src/tool-registry.ts` | `@jini/core` | `RunRef` (a structural `{ id: string }` — no import needed to satisfy it; `@jini/protocol`'s `RunStatus` already has `id: string` and structurally satisfies it, so `@jini/core` gains no new dependency), `ToolDescriptor`, `ToolExecutionContext`, `ToolHandler`, `ToolPolicy`/`AuthorizationDecision`, `ToolRegistration`, the public `ToolRegistry` interface (`register`/`has`/`list` — descriptors only), `createToolRegistry()`, and the package-internal `authorizeToolInvocation(registry, toolId, principal, run, input, delegate?)` (renamed 2026-07-29, see below — formerly `getToolRegistration(registry, toolId)`). |
| `packages/core/src/internal.ts` | `@jini/core` | Re-exports **only** `authorizeToolInvocation` (plus its `ToolAuthorizationDelegate`/`ToolInvocationAuthorization` types) — see "Handlers never publicly retrievable" below. |
| `packages/core/src/tool-tokens.ts` | `@jini/core` | `ToolRegistryToken`, alongside the service per this package's own token-placement convention. |
| `packages/daemon/src/tool-executor.ts` | `@jini/daemon` | `ExecutionDelegate`, the audit-trail types, `ToolExecutionResult`, the `ToolExecutor` interface, `createToolExecutor()`. |
| `packages/daemon/src/tokens.ts` (edited) | `@jini/daemon` | Added `ToolExecutorToken` alongside the pre-existing `RunLifecycleToken`/`EventLogToken`. |

### "Handlers never publicly retrievable" — how it's actually enforced

The task brief's own words. A `ToolRegistry`'s public methods
(`register`/`has`/`list`) never return a `handler` or `policy` — `list()`
returns `ToolDescriptor`s only. But `ToolExecutor` (a different package)
genuinely needs the full `{descriptor, handler, policy}` triple to do its
job. The registrations themselves live in a module-private `WeakMap<ToolRegistry,
Map<string, ToolRegistration>>` in `tool-registry.ts` — unreachable from the
returned `ToolRegistry` object's own methods — and `authorizeToolInvocation`
is the one function that can read it back out. That function is exported
from `./internal.ts`, **not** from `./index.ts`'s public barrel (verified
by a test: `'authorizeToolInvocation' in publicBarrel === false`), and
`internal.ts` is wired as a separate `./internal` entry in this package's
`package.json` `exports` map rather than a subpath TypeScript/Node would
resolve by accident. This is the realistic boundary a JS/TS package can
actually enforce (there is no language-level "friend package" access
modifier) — a consumer of `@jini/core`'s default entry point cannot reach
a handler; `@jini/daemon`'s `ToolExecutor` is the one caller that imports
`@jini/core/internal` on purpose, and that import is visible in its own
source (`tool-executor.ts`'s own import line), not hidden.

**2026-07-29 hardening:** a package.json `exports` subpath is not a
language-level access modifier — nothing actually stops a *different*
package from importing `@jini/core/internal` too, so the paragraph above
describes intent, not enforcement (`scripts/check-engine-boundaries.ts`
rule R6 is the actual enforcement layer, and it only shipped later). The
original `getToolRegistration(registry, toolId)` returned the full
`{descriptor, handler, policy}` triple unconditionally — any package able
to reach the import could retrieve a live handler closure and invoke it
directly, skipping `ToolExecutor`'s authorization gate entirely. It was
replaced by `authorizeToolInvocation(registry, toolId, principal, run,
input, delegate?)`, which runs the tool's own `ToolPolicy` (and an optional
transport-level `delegate.onAuthorize` veto) *inside* the function, and
only includes `handler` in its returned object when the decision is
`'allow'`. A denied or unauthorized call gets a descriptor and a decision,
never a handler — so the gate can no longer be bypassed by calling this
export directly instead of going through `ToolExecutor`, closing the leak
structurally rather than by convention.

### Design decisions

**1. Authorization vs. confirmation are two distinct gates, not one.**
`ToolPolicy.authorize` (owned by the tool's registration) answers "is this
principal permitted to use this tool at all" — a rule-based decision.
`ExecutionDelegate.onConfirm` (owned by the transport, only consulted when
`ToolDescriptor.requiresConfirmation` is set) answers "does the user want
to proceed with *this specific* invocation right now" — an interactive,
per-call gate. `ExecutionDelegate.onAuthorize` exists too, but only as an
additional veto *after* the policy already allows (e.g. "does this session
actually hold an active grant") — it can turn an `'allow'` into a `'deny'`,
never the reverse, and is never consulted when the policy itself denies
(tested explicitly).

**2. Confirmation resumability is a real parked Promise, not a polling
flag.** When `ExecutionDelegate.onConfirm` doesn't supply a decision
synchronously (returns/resolves `undefined`), `execute()`'s returned
Promise is parked on an internal `Map<executionId, resolve>` and simply
does not settle — `resumeConfirmation(executionId, decision)` is the only
thing that can settle it, and it can be called from a completely separate
tick/request, arbitrarily far in the future, no polling required. This is
the concrete answer to "the headless kernel can't prompt, so the transport
injects an `ExecutionDelegate`": the kernel (`ToolExecutor`) never renders
anything; it hands the transport a notification (the `onConfirm` call) and
waits indefinitely for `resumeConfirmation`, exactly the shape a real UI
approval flow needs. One documented sharp edge: an `async` `onConfirm`
that itself resolves to `undefined` is treated as "the decision is
`undefined`" (i.e. denied) rather than "pending," since the code can only
tell "no decision yet" apart from "the Promise's inner value happens to be
undefined" by checking whether `onConfirm`'s *own return value* is
`undefined` before awaiting it — documented on the interface, not
silently surprising.

**3. Output truncation is a text-output concern, not a general
serialization limit.** `ToolDescriptor.maxOutputBytes` only truncates a
`string` handler result exceeding that length; non-string (structured)
output passes through untouched even when the limit is set. A real
byte-accurate UTF-8 truncation or a generic-JSON-payload cap was judged
out of scope for this task's gate ("output truncation" — proven, not
maximally engineered) — a reasonable follow-up if a real tool handler
starts returning large structured payloads.

**4. `execute()` throws (doesn't return a status) for an unknown tool
id.** Denial/confirmation-denial/timeout/cancellation/failure are all
legitimate business-domain outcomes modeled as `ToolExecutionResult`
variants; calling `execute()` with a `toolId` nothing registered is a
routing/programming bug, not a business outcome, so it's a thrown `Error`
instead — the same distinction OD's own `RunLifecycle`-equivalent code in
this package (`requireRun`) already draws between "unknown id" (throw) and
"legitimate terminal state" (return value).

**5. No persistence.** Like `EventLog`'s in-memory reference
implementation, `createToolExecutor`'s audit records and pending-
confirmation state live only in the process; a real host that needs audit
records to survive a restart, or confirmation to resume across a daemon
restart, layers a durable store behind `getAuditRecord`/`resumeConfirmation`
later. Out of this task's scope (the gate is "one allowed + one denied
tool call, resumable confirmation, timeout, cancellation, output
truncation, and an audit record — no HTTP involved," which this satisfies
in-process).

**6. A `finally` block was deliberately avoided around the handler's
try/catch.** An early draft cleaned up the timeout handle and the active-
`AbortController` map entry in a `finally` clause; istanbul/v8 instruments
try/finally with a synthetic "abrupt completion through finally" branch
that is unreachable here (nothing in the catch block can itself throw a
second exception past the catch), which the coverage-driven pass (Phase
6.5) couldn't close without a contrived test. Repeating the two-line
cleanup at each of the try/catch's own return points instead avoided
introducing that uncoverable branch — a "dead branch, refactor away"
call, same discipline as the agent-protocol port's (Part 1) precedent.

### Validation

`pnpm --filter @jini/core typecheck` / `pnpm --filter @jini/daemon
typecheck`: clean (src + tests). Coverage (`vitest run --coverage`, scoped
per each package's `vitest.config.ts` to this task's new files): `@jini/core`'s
`tool-registry.ts`/`internal.ts` and `@jini/daemon`'s `tool-executor.ts`
all 100% statements/branches/functions/lines. A dedicated test proves each
gate item: one allowed call (full audit trail), one denied call (policy
deny, and separately a delegate-vetoed allow), resumable confirmation
(parked `execute()` settled later by a separate `resumeConfirmation()`
call, proven via a captured `executionId` — both through a real
`ExecutionDelegate.onConfirm` and through `randomUUID` mocked to prove the
no-delegate-at-all path), a timeout (`descriptor.timeoutMs` outliving an
abort-aware handler), a cancellation (`cancel(executionId)` on an in-flight
call, plus an already-aborted and a mid-flight external `AbortSignal`),
output truncation (both the truncated and untruncated string cases, plus
non-string pass-through), and audit-record retrieval (including the
`null` case for an unknown id).

## run/ — generic run-orchestration primitives (2026-07-18)

Origin: `apps/daemon/src/run/` — OD's run capability-barrel
(`analytics/ artifacts/ core/ diagnostics/ tools/`). Only the product-neutral
run-*orchestration* primitives were ported; the execution engine
(`apps/daemon/src/runtimes/`) was already ported to `@jini/agent-runtime` and
is NOT re-ported here.

### File map (`src/run/`)

- `core/result.ts` — `RunResult`, `RunStatusForAnalytics`,
  `runResultFromStatus`, `deriveRunErrorCode`. Faithful lift; the
  "`failed` always carries a non-empty `error_code`" invariant and its
  `AGENT_SIGNAL_*` / `AGENT_EXIT_*` / `AGENT_TERMINATED_UNKNOWN` fallback chain
  are the load-bearing bit. Zero external deps.
- `core/failure-taxonomy.ts` — neutral string-literal unions
  (`RunFailureCategory` / `RunFailureDetail` / `RunFailureStage` /
  `RunFailureResult` / `RunRetryStrategy` / `RunRetrySuppressedReason`)
  replacing the `@open-design/contracts/analytics` `Tracking*` import. The
  single vendor-account-balance detail (`amr_insufficient_balance`) was dropped
  as product-specific; everything else is a generic failure vocabulary. This is
  a declaration-only module (emits no JS under `isolatedModules` /
  `verbatimModuleSyntax`), so it has nothing to cover.
- `core/retry.ts` — the safe-run retry policy: backoff constants,
  `computeRetryBackoffMs` (exponential + equal jitter, injectable `random`),
  and `decideSafeRunRetry` (transient-vs-non-retryable classification + the
  side-effect guards that suppress a retry once a run produced user-visible
  output / a tool call / an artifact). This is the run-orchestration keystone.
  Two redundant `?.` optional-chains on the already-null-checked `failure`
  were dropped (they compiled to an unreachable branch v8 could never cover —
  same dead-branch discipline as `tool-executor.ts`'s `finally` note above).
- `diagnostics/diagnostics.ts` — post-run stderr/stdout tail collection
  (line-count bucketing, last-20-lines + 4 KB byte cap, truncation flags) and
  `summarizeRunDiagnosticsForAnalytics` (scans the event stream for the
  diagnostic source, rpc-close reason, and observed-flag signals). **Genericized
  one dependency:** OD hard-imported `redactSecrets` from a daemon-local
  `redact.ts`; here the tail redactor is an injected `TailRedactor` (identity
  default) so the engine owns the tail *mechanism* while a consumer supplies the
  scrubbing *policy* (e.g. `@jini/core`'s `redactSecrets`). This also keeps the
  module dependency-free.
- `core/index.ts`, `diagnostics/index.ts`, `run/index.ts` — barrels; the root
  `run/index.ts` re-exports only the ported surface (explicit named exports).
  Wired into `src/index.ts`.

### Not ported / explicitly out of scope

- **`runtimes/`** — already ported to `@jini/agent-runtime`; not re-ported.
- **`run/diagnostics/failure.ts`** (the ~800-line `classifyRunFailure`) —
  SKIPPED as product-saturated. It depends on `integrations/vela-errors.ts`
  (a vendor account/auth product module) and `runtimes/auth.ts`, and its body is
  a wall of vendor-specific regex (a specific model-router service, named
  third-party agent CLIs, provider-specific non-English error strings). A
  faithful lift would drag product classification in. The retry keystone stands
  without it: `decideSafeRunRetry` consumes a `RunRetryFailureSignal` that a
  consumer's own classifier supplies. The neutral taxonomy those signals use is
  kept (`failure-taxonomy.ts`).
- **`run/analytics/`** (`analytics.ts`, `lifecycle-tracer.ts`) — SKIPPED as OD
  telemetry. `runtimeTypeForRunAnalytics` / `amrUserIdForRunAnalytics` bind to a
  vendor sign-in status and model-router runtime types; the timing/usage
  summarizers target that product's `run_finished` v2 analytics event and its
  provider-specific token-usage alias matrix. Product, not engine.
- **`run/artifacts/`** (`artifact-fs.ts`, `html-version-snapshots.ts`) —
  SKIPPED (overlap + product). `artifact-fs` depends on
  `runtimes/run-artifacts.ts`'s design-system/preview-module path taxonomy
  (`DESIGN.md`, `preview/*.html` — OD design-output concepts) and overlaps the
  already-ported `src/artifacts/`; `html-version-snapshots` depends on
  `@open-design/contracts` + a product project-file-versioning service.
- **`run/tools/tool-bundle.ts`** — SKIPPED (belongs to the MCP barrel). It is
  squarely MCP-config territory: it depends on `mcp-config.ts`'s
  `sanitizeMcpServer` / `McpServerConfig` (not present anywhere in `@jini/*`;
  a separate `port/mcp-barrel` branch owns that surface) and
  `runtimes/types.ts`'s `RuntimeAgentDef`. Porting it here would either
  duplicate the MCP-config port or create a cross-barrel dependency.

### Environment note

The worktree's `packages/daemon/node_modules` symlinks into the main checkout,
whose `@jini/core` **dist** is stale (missing `redact` / `tool-registry` /
`internal`), which is why the pre-existing `tool-executor.{ts,test.ts}` fail to
typecheck/run here. The ported `run/` modules are deliberately dependency-free
(only relative imports), so all three test files run and typecheck without
touching that stale cross-package dist.

### Validation

`pnpm --filter @jini/daemon typecheck`: no errors in `src/run/**` (the only
remaining errors are the pre-existing `tool-executor` ones from the stale main
dist described above). Coverage (`vitest run` over the three new test files,
`--coverage.include` scoped to the executable modules): `result.ts`,
`retry.ts`, and `diagnostics.ts` all 100% statements / branches / functions /
lines (66 tests). `failure-taxonomy.ts` is declaration-only (no executable
statements). `grep -rInE 'Open Design|OD_|open-design|/tmp/open-design'` over
the changed files: empty.

## `AgentExecutor` — wiring `@jini/agent-runtime` into `RunLifecycle` (2026-07-18)

`RunLifecycle`'s own module doc (this file's earlier "Design decisions" §1
and the file itself) has always named the gap: it owns the run *state
machine* and event log, but "does not spawn or signal a subprocess... A
driver... calls `emit()` for agent/stdout/stderr/error events, observes
cancellation via `onCancelRequested`, and calls `finish()` once it knows the
real outcome." Until this task, nothing in the repo was that driver —
`@jini/agent-runtime`'s registry/launch-resolution/stream-parsers had zero
callers anywhere outside its own package. `src/agent-executor.ts` is that
driver.

### Provenance — control-flow shape reference only, not a lift

OD's real equivalent is not one file: it is the inline `startChatRun`
closure inside `apps/daemon/src/server.ts` (main branch,
`leonaburime-ucla/open-design`, roughly lines 4197–7990 — a ~3,800-line fused
monolith), or the same logic mid-extraction on the
`arch/chat-run-extraction` branch's `apps/daemon/src/runtimes/start-chat-run.ts`.
Both were read (via `git show <ref>:<path>` against the read-only reference
clone at `/Users/la/Desktop/Programming/OSS-Repos/open-design`) for exactly
one purpose: confirming the generic control-flow shape — spawn → per-
`streamFormat` dispatch → `parser.feed`/`flush` → terminal classification →
cancellation escalation — and the exact stdin wire format for
`promptInputFormat: 'stream-json'` (`{"type":"user","message":{"role":"user",
"content":[{"type":"text","text":composed}]}}\n`, confirmed against
`server.ts`'s own `child.stdin.write` call site, ~line 7975). No OD-specific
code was copied; every line in `agent-executor.ts` is new, product-neutral
kernel code informed by that shape.

### File map

| Jini file | Contents |
|---|---|
| `src/agent-executor.ts` | `AgentExecutor` interface, `createAgentExecutor(...)` factory, `translateAgentRuntimeEvent` (the pure event-translation function), the stream-parser dispatch table, spawn/stdin/cancellation wiring. |
| `src/delegated-tool-bridge.ts` | **New, generic composition code** — adapts a Jini-owned delegated tool request to the existing `ToolExecutor`, with canonical run `tool_use`/`tool_result` events and run-cancellation propagation. It intentionally supplies no wire server. |
| `src/tokens.ts` (edited) | Added `AgentExecutorToken` alongside `RunLifecycleToken`/`EventLogToken`/`ArtifactStoreToken`/`ToolExecutorToken`, same convention. |
| `src/index.ts` (edited) | Re-exports `./agent-executor.js`; module doc updated to mention `AgentExecutor`. |
| `package.json` (edited) | Added `@jini/agent-runtime` and `@jini/platform` as direct dependencies (both previously zero-cross-referenced with `@jini/daemon`; `@jini/platform` added directly rather than relied on transitively through `@jini/agent-runtime`, per the task brief — no cycle: neither package imports `@jini/daemon`). |
| `packages/node-host/src/create-local-node-daemon.ts` (edited, different package) | `KernelBoundIds` extended to `'jini.eventLog' \| 'jini.runLifecycle' \| 'jini.agentExecutor'`; `AgentExecutorToken` bound automatically alongside `EventLogToken`/`RunLifecycleToken` via `createAgentExecutor({ lifecycle: runLifecycle })` — a genuine zero-config default (unlike `ToolExecutorToken`, deliberately NOT auto-bound, since it needs a caller-supplied `ToolRegistry` with no sensible default). |

### v1 scope: 18 of 24 registered agent defs

`@jini/agent-runtime`'s registry ships 24 built-in defs. Only the 9 using one
of the four `createXStreamHandler`-family JSON-stream parsers are wired:
`claude-stream-json` (amp, codebuddy, claude), `json-event-stream` (codex,
cursor-agent, opencode, mimo — `mimo` shares `opencode`'s `eventParser`
`kind`), `copilot-stream-json` (copilot), `qoder-stream-json` (qoder).
Confirmed by reading every one of the 9 defs' `buildArgs`/`promptViaStdin`/
`promptInputFormat` fields in full: **all 9 use `promptViaStdin: true`** —
`claude` and `codebuddy` use `promptInputFormat: 'stream-json'`, the
remaining 7 use the default `'text'`. Alongside those JSON-stream adapters,
all 9 `acp-json-rpc` defs (hermes, devin, amr, vibe, kimi, reasonix, kiro,
trae-cli, kilo) now use a separate branch: the real `attachAcpSession`
handshake owns prompt delivery and parsed events; the driver preserves raw
stdio, uses the controller's clean-prompt result rather than its expected
cleanup SIGTERM, and sends cancellation through both ACP and process-tree
termination. Its subprocess integration fixture proves launch → handshake →
audited permission choice → stream → lifecycle completion.

A non-ACP supported def still requires `promptViaStdin: true`; ACP does not,
because its prompt is the `session/prompt` JSON-RPC call.

**Deferred, not built this task** (all still callable/tested inside
`@jini/agent-runtime` itself — only the *driver* wiring is deferred):

- **The one pi-rpc def** (`pi`). It uses the separately-shaped
  `attachPiRpcSession` controller; no driver has been added for it yet.
- **`plain` (5 defs: antigravity, grok-build, aider, deepseek, qwen)** has
  zero existing consuming code anywhere in this codebase — no parser, no
  dispatch branch. The design space (a single final chunk on `flush()`? raw
  passthrough only?) is not decided. `AgentExecutor.run()` rejects these
  cleanly with `AgentExecutorError('AGENT_RUNTIME_UNSUPPORTED', ...)` rather
  than mishandling them silently.

### Design decisions

**1. `resumable` is always `false` in v1.** `RunRetryFailureSignal` (the
richer classification `decideSafeRunRetry`, in `run/core/retry.ts`,
consumes) has no producer anywhere in this codebase — OD's real
~20-vendor-CLI text-matching failure classifier
(`run-failure-classification.ts`, researched but never ported; see this
file's earlier "Not ported" section) was deliberately excluded as its own
substantial, unscoped task. Every `lifecycle.finish()` call
`AgentExecutor` makes — pre-spawn guard failures, spawn errors, and the
real `child.on('close', ...)` terminal transition alike — passes
`resumable: false`. A blanket "not retryable" default is the only honest
answer without a classifier; building one is a separate, unscoped
follow-up, not attempted here.

**2. `turn_end` is not forwarded as an `'agent'` event, and v1 has no
multi-turn stdin-injection loop.** `turn_end` is Claude-stream-specific
(synthesized from an assistant message's `stop_reason`) and has no
`RunAgentPayload` variant — `translateAgentRuntimeEvent` routes it to a
`'turn-end'` translation kind that `run()` reacts to directly (closing
stdin) rather than durably recording. **v1 unconditionally closes stdin on
the first `turn_end` regardless of `stopReason`** — including
`stop_reason: 'tool_use'`, which in a real multi-turn caller would instead
inject the tool's result back into the same open stdin and keep the turn
going. Without that injection loop, a `tool_use`-ending turn's stdin still
closes (rather than hanging forever waiting for a continuation that will
never come); the agent CLI is responsible for deciding how to behave when
its stdin closes mid-tool-use, which each of the 9 defs already handles
via its own inactivity/EOF behavior. Building the real tool-continuation
loop needs `ToolExecutorToken` wiring (deciding what to send back) and is
explicitly out of this task's scope — see the plan's "Explicitly out of
scope" section.

**3. Session-resume ids are an intentional, documented drop.** Some
parsers attach a resumable session handle to their `status` event
(OpenCode's `sessionID`, Codex's `thread_id`/`sess-*`, Qoder's
`session_id`+`qodercliVersion`) — `translateAgentRuntimeEvent`'s `status`
case only carries `label`/`model`/`ttftMs`/`detail` (the fields
`RunAgentPayload`'s `status` variant actually declares), so these ids are
silently dropped at translation time. This is unrelated to
`RunLifecycle.resume()`, which is run-level (does the daemon-side run
object transition back to `'running'`), not CLI-conversation-level (does
the underlying agent CLI continue its own multi-turn session) — persisting
and replaying these ids into a real `--resume`/`session/load` call on a
later turn is a downstream chat-composition concern with no current owner
in this codebase, matching the same "not this package's charter" boundary
this file's earlier §2's "resume" design decision draws.

**4. `translateAgentRuntimeEvent`'s `usage` payload drops every sub-field
`RunAgentPayload`'s narrow `usage` variant has no room for.** The 4 parsers
attach `thought_tokens`, `cached_read_tokens`/`cached_write_tokens`
(opencode/gemini/codex), `modelUsage`/`stopReason`/`isError` (qoder), and a
top-level `stopReason` (claude/copilot) that `RunAgentPayload['usage']`
(only `usage?: {input_tokens?, output_tokens?}`, `costUsd?`, `durationMs?`)
has no field for — dropped, not silently miscoerced. Widening
`RunAgentPayload`'s `usage` shape to carry these is a `@jini/protocol`
change, out of this task's scope (protocol is a separate package with its
own owner).

**5. `error` events carry a minimal `RunErrorPayload`** — `{message}`,
plus `error: {code, message}` only when the parser attached a string
`code` (currently only claude's error event does). The `raw` field some
parsers attach (opencode/gemini/qoder — a stringified copy of the whole
original event, for debugging) is not folded into the error payload; kept
minimal rather than speculatively enriched.

**6. Every `lifecycle.emit()` call is funneled through a per-run FIFO
queue (`enqueueEmit`, private to `wireChildLifecycle`), not fired
independently.** A single stdout `data` chunk can synchronously produce
several parsed events (one JSON line's `feed()` call may invoke a stream
parser's `onEvent` more than once — e.g. Codex's `item.completed` firing
both a `tool_use` guard-check and a `tool_result`), and successive `data`
events must not have their derived `emit()` calls race each other out of
order. Each queued task is individually try/caught (a single failing
`emit()` — e.g. a race against an already-terminal run — does not block
delivery of subsequently queued events), and the `close` handler awaits
the queue fully drained before computing the terminal outcome, so
`finish()`'s `'end'` event is always durably last.

**7. Cancellation escalates the child's full descendant process tree, not
just the direct child.** `@jini/platform`'s `collectProcessTreePids`
(cross-platform: POSIX `ps` / Windows `Get-CimInstance`) plus
`stopProcesses` (SIGTERM → poll-wait → SIGKILL escalation) were both
previously completely unused — zero callers anywhere in this codebase —
despite being an exact fit; `AgentExecutor` is their first real caller.
This catches MCP-server/tool-subprocess descendants an OD-style
POSIX-process-group-only kill would miss.

**8. Native-agent authorization and Jini tool execution are two explicit
paths.** ACP's `onPermissionRequest` seam receives the tool-call metadata and
offered option ids before the ACP agent executes its own tool; without an
injected policy it fails closed, while a runnable host records and chooses an
offered allow/reject/cancel outcome. The
autonomous JSON-stream CLIs still report `tool_use` only after their internal
execution, so their telemetry remains observational. Separately,
`createDelegatedToolBridge` is the actual Jini-tool path: it emits a matching
run event pair around `ToolExecutor.execute`, so registry policy,
confirmation, timeout, cancellation, and the executor audit all apply. It is
transport-neutral by design; an MCP or other server must decode a concrete
delegated request before calling it.

### Explicitly out of scope (same deferral discipline as the node-host keystone)

- `ExecutionDelegate`/`ToolExecutorToken`/HTTP wiring (`mountPackHttp`) —
  separate, already-deferred task per `packages/http/source-map.md`.
- The one pi-rpc def and the 5 `plain` defs — see "v1 scope" above.
- Retry-loop *orchestration* (deciding to start a second run) and
  retry-*signal production* (the failure classifier `decideSafeRunRetry`
  consumes) — both separate, unscoped tasks; `resumable` stays `false`
  throughout (see Design decision 1).
- A concrete HTTP/SSE-exposed "chat pack" wiring `AgentExecutorToken` +
  `RunLifecycleToken` into routes — the natural next layer beyond "create
  `AgentExecutor` and wire agent-runtime into it."
- A generic MCP stdio server shell, persistence, MCP-server injection, prompt composition (skill/memory
  injection, transcript recomposition), and telemetry — all OD-product or
  transport-layer concerns with no kernel-port home; `AgentExecutor`
  receives an already-composed `prompt` string and does nothing to it
  beyond the stdin wire-format wrapping described in Design decision 2's
  neighbor, the stream-json JSONL wrap.

### A pre-existing, unrelated type-emission gap surfaced (not fixed) by this task

`packages/node-host/src/__tests__/create-local-node-daemon.test.ts`'s new
"auto-binds `AgentExecutorToken`... with zero caller config" test could not
call `createLocalNodeDaemon` through its own overloaded compile-time
signature the way the pre-existing `GreeterToken` test does: `@jini/core`'s
`token<T, const Id extends string = string>(id, opts)` is meant to infer
each token's literal id type via the `const` type-parameter modifier, but
every kernel token this package exports — `EventLogToken`/`RunLifecycleToken`
included, not just the new `AgentExecutorToken` — round-trips through
`@jini/daemon`'s *compiled* `dist/tokens.d.ts` as `Token<T, string>`
(widened, confirmed by inspecting the emitted declaration file directly),
defeating `MissingTokenIds`'s literal-id-based exclusion for any pack
depending solely on a dist-imported kernel token. This has apparently never
been hit before because the existing `create-local-node-daemon.typecheck.ts`
proof only exercises a token declared *inline in the same compilation unit*
(`GreeterToken`), which infers its literal id correctly. The new node-host
test calls `createLocalNodeDaemon` through a narrowed function-type cast
(the same "bypass the compile-time generic gate to reach the runtime path"
pattern `packages/core/src/__tests__/index.test.ts`'s `createDaemonUnsafe`
already established) to prove the *runtime* wiring, which is what that test
is actually for. Fixing the underlying `@jini/core`/`@jini/daemon` type-
emission gap is out of this task's scope — flagged here as a real,
independently-actionable follow-up.

### Validation

- `pnpm --filter @jini/daemon exec tsc -p tsconfig.json --noEmit`: clean.
- `pnpm --filter @jini/daemon exec vitest run src/__tests__/agent-executor.test.ts --coverage --coverage.include='src/agent-executor.ts'`:
  46 tests, **100% statements/branches/functions/lines**.
  `pnpm --filter @jini/daemon exec vitest run --coverage --coverage.include='src/**'`
  (whole package, regression check): 350/350 tests pass, no regressions;
  `agent-executor.ts` itself still 100/100/100/100 (the run's aggregate
  threshold failure is entirely pre-existing gaps in files this task did
  not touch — `run-lifecycle.ts`/`close-status.ts`/`event-log.ts`,
  confirmed via `git diff --stat main` showing zero changes to those three
  — plus the top-level `index.ts`/`tokens.ts` barrel files' structural 0%,
  which predates this task and matches the same pattern the untouched
  `src/artifacts/index.ts` vs. non-barrel-file split already shows).
- `pnpm --filter @jini/node-host exec tsc -p tsconfig.json --noEmit` and
  `create-local-node-daemon.typecheck.ts`'s `@ts-expect-error` proofs:
  clean, unmodified.
- `pnpm --filter @jini/node-host exec vitest run --coverage --coverage.include='src/**'`:
  50/50 tests, 100% on all 4 metrics for every file including
  `create-local-node-daemon.ts`.
- `pnpm typecheck` (repo-wide): clean, every package "Done", exit 0.
- `pnpm guard`: `[guard] ok`.
- `grep -rInE 'Open Design|OD_|open-design' packages/daemon/src packages/node-host/src`: empty.

## 2026-07-21 addition — driving the `pi-rpc` def (19 of 24 registered agent defs)

Closes one of the two "deferred, not built" driver gaps this file's own "v1 scope" section named:
the one `pi-rpc` def (`pi`) now has a real `wirePiRpcLifecycle` branch in `agent-executor.ts`,
mirroring `wireAcpLifecycle`'s existing shape (spawn → attach → cancel → finish). The `plain` × 5
defs remain deliberately unsupported — their design space is still undecided (see the module doc).

**No new event-translation code was needed.** `@jini/agent-runtime`'s `mapPiRpcEvent` (the pure
RPC-to-daemon event mapper behind `attachPiRpcSession`) already sends every event through the exact
`{type, ...}` vocabulary `translateAgentRuntimeEvent` handles for ACP/JSON-stream — confirmed by
reading every `send(...)` call site in `agent-protocol/pi-rpc/events.ts` (status/text_delta/
thinking_start/thinking_delta/tool_use/tool_result/usage/error, all on the `'agent'` channel; pi-rpc
never calls `send('error', ...)` the way ACP's `send(event, payload)` distinguishes — error-ness is
signaled via the payload's own `type: 'error'` field instead). One gap: `thinking_end` has no
`translateAgentRuntimeEvent` case and is silently `'ignored'` — a real, documented drop (same
category as `usage`'s already-documented sub-field drops), not a bug.

**`PiRpcSession`/`PiRpcSessionOptions` types added to `@jini/agent-runtime`'s barrel** (`agent-
protocol/pi-rpc/index.ts` → `agent-protocol/index.ts` → root `index.ts`) — previously only the
`attachPiRpcSession` function itself was exported, matching that barrel's own "three public
symbols" doc comment; `AcpSessionController`/`AttachAcpSessionOptions` were already exported for
ACP, so this closes an asymmetry rather than introducing a new pattern.

**`wirePiRpcLifecycle` vs. `wireAcpLifecycle` — differences, not just a rename:**
- Success/failure comes from `PiRpcSession.hasFatalError()` (boolean, true = failed), not ACP's
  `completedSuccessfully()` (true = succeeded) — inverted polarity, so `status = cancelRequested ?
  'cancelled' : session?.hasFatalError() ? 'failed' : 'succeeded'`, not a direct swap of the ACP
  ternary's arms.
- No `envFormat`/`onPermissionRequest` — pi-rpc has no MCP-env-format or native-tool-permission
  concept; `attachPiRpcSession`'s options instead include `model`/`imagePaths`/`uploadRoot`/
  `parentSession`, none of which `AgentExecutorRunInput` carries yet in v1 (same "explicitly out of
  scope" discipline this file already applies to ACP's multi-turn tool continuation and session-
  resume ids — see the module's Design decisions 2–3).
- `AgentCleanupFailurePhase` gained a `'pi-rpc-attach-failure'` tag alongside the existing
  `'cancel'`/`'acp-attach-failure'`, and `AgentCleanupFailureContext.pid` was tightened from
  `number | null` to `number` (with a documented non-null assertion at its one construction site)
  — `terminateChildTree`'s own `child.pid == null` early-return guard means the cleanup-failure
  catch path is only ever reached once a pid was already assigned, so the `| null` was dead, not
  defensive; proved rather than assumed before simplifying (same discipline `packages/http`'s
  `host-tools.ts` port already established for `resolveEntry`'s discriminated union).

Tests: `src/__tests__/agent-executor.test.ts`'s new "pi-rpc dispatch (fake attachPiRpcSession)"
describe block (11 tests, mirroring the ACP dispatch block's coverage: happy path, failed-not-
cancelled, cancel+process-tree escalation, SEC-007 stopProcesses-rejects fallback, SEC-007 direct
child.kill()-also-throws fallback, error-channel routing, an ignored/unmapped event, an
already-terminal emit race, and both attach-failure paths including the default (uninjected)
`onCleanupFailure` sink) plus two fixed pre-existing tests that asserted the old "pi-rpc
unsupported" behavior. 100% coverage on all 4 metrics for `agent-executor.ts` (up from a
pre-existing, previously-undetected gap in `terminateChildTreeBestEffort`'s own cleanup-failure
path, closed as part of this pass since it's shared infrastructure this task's new code also calls
into). Full package: 285/285 tests. `pnpm guard`: clean.

## 2026-07-21 addition — driving 4 of the 5 `streamFormat: 'plain'` defs (23 of 24 registered agent defs)

Closes the other "deferred, not built" driver gap this file's own "v1 scope" section named, per
`ADS-memory/reports/proposals/PROP-plain-format-agent-driving-2026-07-21.md` (written earlier the same
day, approved for implementation, read in full before this task started). grok-build, aider, deepseek,
and qwen now drive through `run()`; **antigravity stays deliberately unsupported** — see below. This
closes the module doc's `plain` gap entirely except for that one named, scoped-out exception.

### Output-side dispatch — Option B, exactly as the proposal recommended

`wireChildLifecycle`'s existing raw `child.stdout.on('data', ...)` handler (already emitting a raw
`'stdout'` event for every format, `plain` included) now also emits, per chunk, when
`streamFormat === 'plain'`: `lifecycle.emit(runId, {event:'agent', data:{type:'text_delta', delta:
text}})`. No new stream-parser state machine and no `wireXLifecycle` function of ACP/pi-rpc's
complexity — `createStreamHandlerForDef` is simply never called for `'plain'` (`streamHandler` is
`null` for that branch; `flush()` becomes `streamHandler?.flush()`, a no-op). Every emit still goes
through the same per-run FIFO `enqueueEmit` queue every other format already uses (design decision 6),
so multi-chunk ordering is preserved — proved by a dedicated 25-chunk synchronous-back-to-back test,
not just single-chunk coverage. Emits on `'agent'`/`text_delta`, not OD's literal `'stdout'` channel —
the proposal's one deliberate, flagged deviation from the researched OD ground truth (§3/§4 open
question 1), for consistency with how the other 19 already-wired defs all use `'agent'`/`text_delta` as
the one chat-content channel and treat `'stdout'` as a separate always-on raw/diagnostic echo.

**Text hygiene (open question 3): raw passthrough, no stripping — an explicit v1 decision, not a
silent gap.** There is no Jini equivalent of OD's `TerminalControlSequenceStripper` yet. Rather than
build one speculatively (arguably a broader `AgentExecutor`-level concern affecting every format's raw
`'stdout'` echo too, not just `plain`'s new `'agent'` emit — scope explicitly deferred, matching the
discipline of naming a boundary rather than silently expanding one), v1 forwards every chunk verbatim.
Proved intentional, not accidental, by a dedicated test asserting exact passthrough of a fixture
containing `\r`, ANSI SGR color codes (`\x1b[32m...\x1b[0m`), unmodified.

### Prompt-delivery generalization — the prerequisite the proposal called out (§1, §2d, §3 opening)

`AgentExecutor` previously called none of `@jini/agent-runtime`'s already-built, already-tested
prompt-delivery machinery (`preparePromptFileForAgent`, `checkPromptArgvBudget`,
`checkWindowsCmdShimCommandLineBudget`, `checkWindowsDirectExeCommandLineBudget`) and its one guard
(`streamFormat !== 'acp-json-rpc' && def.promptViaStdin !== true`) rejected grok-build/aider/deepseek on
prompt-delivery shape alone. Now, in `run()`:

- The guard is widened to `def.promptViaStdin !== true && def.promptViaFile !== true && typeof
  def.maxPromptArgBytes !== 'number'` (still short-circuited past for `acp-json-rpc`) — a def clears it
  by declaring any one of the three shapes, matching how OD's own call sites key **only** off the def's
  declared fields, with zero per-agent-id branches (§2d).
- `checkPromptArgvBudget(def, input.prompt)` runs pre-launch-resolution, pre-filesystem-touch, for
  every run (a no-op for the 22 defs without `maxPromptArgBytes` — only aider/deepseek declare it) — an
  over-budget prompt fails via the existing `failBeforeSpawn`/`AgentExecutorError` path with a new
  `AGENT_PROMPT_TOO_LARGE` code, never a raw `spawn()` `ENAMETOOLONG`/`E2BIG`.
- `preparePromptFileForAgentFn(def, input.prompt, input.runId)` runs unconditionally after launch
  resolution succeeds (a no-op — returns `null` — for the 23 defs without `promptViaFile: true`; only
  grok-build declares it), staging
  grok-build's prompt to a real `0o600` temp file. Wrapped in try/catch: a staging failure (e.g.
  `ENOSPC`) now rejects cleanly via `failBeforeSpawn('AGENT_SPAWN_FAILED', ...)` instead of bare-throwing
  out of `run()` — a new guard this task added to keep the module's own "never a bare throw" Invariant
  intact once `run()` gained its first `await`ed filesystem call.
- The resulting `{promptFilePath}` becomes a `RuntimeContext` argument, now actually threaded into
  `def.buildArgs(input.prompt, [], undefined, undefined, runtimeContext)` — previously always called as
  `def.buildArgs(input.prompt, [])`, no third/fourth/fifth argument at all (proposal open question 4).
  **Resolved minimally, not broadly**: `AgentExecutorRunInput` itself gained no new public field (no
  `options`/`model`/`reasoning`) — only the internally-derived `promptFilePath` is threaded through.
  Widening the input shape for `options.model`/`reasoningOptions` (antigravity, grok-build's own
  `reasoningOptions` field) remains exactly the pre-existing, unscoped gap the proposal flagged it as.
- Post-`buildArgs`, `checkWindowsCmdShimCommandLineBudget`/`checkWindowsDirectExeCommandLineBudget` run
  against the resolved launch path + built args (both no-ops off-Windows or for non-argv-bound defs) —
  included per the proposal's test-evidence bar (§4 point 4, "if in scope"); judged in-scope here since
  the underlying math is already fully built and tested in `@jini/agent-runtime`, and skipping it would
  leave a real gap (a prompt under the POSIX budget that still blows the Windows CreateProcess cap after
  quote-expansion). Tested on this macOS host via fake `C:\...\aider.cmd`/`C:\...\aider.exe` resolved
  paths, mirroring `prompt-budget.test.ts`'s own cross-platform-on-one-host technique.
- **Cleanup discipline**: a `cleanupPromptFile: () => Promise<void>` closure (the real
  `preparedPromptFile.cleanup`, or an `async () => {}` no-op when nothing was staged) is threaded through
  every path from the point a file might exist onward — the Windows-budget-reject path, the
  synchronous-`spawn()`-throw path, the `waitForSpawnOrError` reject path (child `'error'` before
  `'spawn'`), and — via a new `cleanupPromptFile` field on `WireChildLifecycleContext` /
  `WireAcpLifecycleContext` / `WirePiRpcLifecycleContext` — every format's `close` handler and ACP/pi-rpc
  attach-failure catch. Threaded into all three lifecycle-wiring functions uniformly (not just the plain
  branch) since no current ACP/pi-rpc def declares `promptViaFile` — always the no-op default there today,
  kept for consistency/future-proofing rather than special-cased away, at zero extra branch-coverage cost
  (an unconditional call, not a new conditional). A leaked temp file with full prompt content on a
  failure path is a confidentiality gap, not just a disk leak — proved by real-filesystem assertions
  (`fs.readFile`/`fs.stat`/`fs.access`) in the happy-path test, and by injected-fake `cleanup` spies on
  every failure-path test.

### Antigravity — deliberately still rejected, guarded independently of the generic plain logic

A new `streamFormat === 'plain' && def.id === 'antigravity'` check in `run()`, evaluated immediately
after `isSupportedStreamFormat` and *ahead of* the widened prompt-delivery guard — antigravity's own def
declares `promptViaStdin: true` and would otherwise clear every guard below it. Matches OD's own choice
to hardcode `def.id === 'antigravity'` in `server.ts` rather than generalize a field (proposal §2c/§3,
open question 2/6): it needs auth-URL-leak buffering (agy can print an OAuth URL to stdout and still
exit 0) and a cross-run model-selection lock serializing writes to its shared `settings.json`, both
concerns unrelated to `streamFormat: 'plain'` itself and explicitly scoped to their own follow-up by the
proposal. Still rejects with `AgentExecutorError('AGENT_RUNTIME_UNSUPPORTED', ...)`, pointing at the
proposal doc. Regression-tested: a fake def shaped exactly like antigravity (`id: 'antigravity',
streamFormat: 'plain', promptViaStdin: true`) — i.e. one that would pass every other guard — still
rejects specifically because of its id.

### `isSupportedStreamFormat` / `SUPPORTED_STREAM_FORMATS`

`'plain'` added, exactly matching the pi-rpc addition's shape: appended to the tuple,
`JsonStreamFormat`'s `Exclude` widened to also drop `'plain'` (so `createStreamHandlerForDef`'s 4-way
switch stays exhaustive and is never asked to handle a format it can't parse), and a new
`ChildDrivenStreamFormat = JsonStreamFormat | 'plain'` type documents which formats
`wireChildLifecycle` — as opposed to `wireAcpLifecycle`/`wirePiRpcLifecycle` — actually drives.

### Deviations from the proposal

None material — the proposal made every hard call (Option B over A/C, `'agent'`/`text_delta` over
`'stdout'`, defer antigravity, raw passthrough as the hygiene default) and this task implemented them
as written. Two things the proposal left open and this task decided: (1) the Windows command-line-budget
guards are in scope (see above); (2) `preparePromptFileForAgent` itself failing gets a defensive
try/catch → `AGENT_SPAWN_FAILED` rather than bare-throwing, to preserve the module's pre-existing
Invariant once `run()` gained its first pre-spawn `await`ed filesystem call (proposal open question 5
asked *where* the cleanup hook lives, not whether staging failure needed its own guard — this task
answered both).

Tests: three new `describe` blocks in `src/__tests__/agent-executor.test.ts` — "plain-format dispatch
(Option B...)" (4 tests: verbatim multi-chunk passthrough incl. ANSI/`\r` fixture + ordering assertion,
a dedicated 25-chunk synchronous-ordering test, cancellation/process-tree escalation through the new
branch, non-zero-exit → failed), "plain-format prompt-file delivery (grok-build)" (4 tests: real
`0o600`-mode temp file end-to-end incl. post-close removal, cleanup-on-spawn-throw, cleanup-on-spawn-
`'error'`-before-`'spawn'`, clean `AGENT_SPAWN_FAILED` rejection when staging itself throws), and
"plain-format argv prompt-budget guard (aider/deepseek)" (4 tests: under-budget happy path, over-budget
POSIX rejection pre-spawn, Windows `.cmd`-shim rejection, Windows direct-`.exe` rejection) — plus one
new antigravity-regression test and one existing test's fixture format string swapped from `'plain'`
(now supported) to `'made-up-format'` to keep testing a genuinely-unsupported format. 86/86 tests in
this file, 100% coverage on all 4 metrics for `agent-executor.ts`. Full package: 298/298 tests, no
regressions in `run-lifecycle.ts`/`delegated-tool-bridge.ts`'s own pre-existing, unrelated gaps.
`pnpm --dir packages/node-host exec vitest run --coverage` (a real downstream consumer of
`createAgentExecutor`'s default binding): 52/52, 100% on all 4 metrics, unaffected. `pnpm guard`: clean.
`grep -rInE 'Open Design|OD_|open-design' packages/daemon/src`: empty.

## 2026-07-22 addition — run/chat orchestration gap 1: default wiring + byte-journal

Implements gap 1 of the run/chat orchestration swarm-consensus Final Recommendation
(`ADS-memory/reports/swarm-consensus/runs/20260722T023000Z-consensus-report.md`) — "the observability
floor every later increment depends on." Locked by that debate: no new package; land as increments in
`@jini/daemon`, a small `@jini/protocol` addition, and `@jini/node-host` preset wiring.

**`@jini/protocol`**: new `journal.ts` — `JournalEntry{content, provenance, trust}` exactly as the
debate specified. `provenance` is a discriminated union (`{source:'host',channel:'stdin'}` /
`{source:'agent',channel:'stdout'|'stderr'}`) rather than a bare string, so a future consumer can
narrow on it without parsing. `trust` exists for gap 3 (not yet built): a byte the host composed is
`'trusted'`, a byte a child agent produced is `'untrusted'` by definition — the debate's Final
Recommendation requires structured/JSON-escaped framing (never raw string concatenation) when a later
increment injects a tool result back into a child's input, given the prompt-injection stakes on that
exact path.

**`@jini/daemon/src/continuation/`** (new module, the exact path the debate proposed):
- `journal.ts` — `RunByteJournal`/`createRunByteJournal(eventLog)`, a thin projection over the existing
  `EventLog` port. Deliberately takes its own `EventLog` *instance*, not the one `RunLifecycle` already
  uses: that log's `stream()` replays every entry it holds to SSE subscribers as a `RunProtocolEvent`,
  and a `'journal'` entry has no corresponding protocol-event kind — sharing the instance would either
  leak raw (possibly untrusted) agent bytes into the public run-event stream or force widening
  `RunProtocolEvent` itself. A dedicated instance reuses the exact same port/durability guarantees (for
  `@jini/node-host`, the same `@jini/sqlite` adapter) without touching run-protocol vocabulary.
- `run-start-handler.ts` — `ResolveRunInput`/`createDefaultRunStartHandler({agentExecutor,
  resolveRunInput})`. Fills a real gap: `@jini/http`'s `POST /api/runs` durably starts a run and, absent
  a host-supplied `onStarted`, nothing ever drives an actual `AgentExecutor.run()` — the run sits
  `'running'` forever with no attached driver. `resolveRunInput` has no generic default (unlike
  `resolveDaemonUrl`'s optional `discover`): prompt/skill/memory composition is gap 2, and gap 2 stays
  host-owned *permanently* per the debate's Final Recommendation item 5, so there is no sensible
  kernel-supplied fallback. The returned handler's parameter type (`RunStartDriverContext`) is a
  structural subset of `@jini/http`'s `RunStartContext` — `@jini/daemon` cannot import `@jini/http`
  (wrong-direction edge; `@jini/http` already imports `@jini/daemon`), so a real `RunStartContext` value
  satisfies the narrower type structurally instead.

**`agent-executor.ts`**: new optional `journal?: RunByteJournal` on `CreateAgentExecutorOptions` — opt-in
only (unlike every other seam on that interface, which defaults to a real implementation), since there
is no generic "real" journal storage this package can default to without a caller-supplied `EventLog`.
Threaded into all three lifecycle-wiring functions (`wireChildLifecycle`/`wireAcpLifecycle`/
`wirePiRpcLifecycle`) and `writePromptToStdin`. Records every byte at the same choke points the module
already had in hand pre-translation: the 6 `child.stdout`/`child.stderr` `'data'` handlers (received,
`trust:'untrusted'`) and `writePromptToStdin`'s two write branches (sent, `trust:'trusted'`) via a new
`StdinCloseHandle.recordSentBytes` method. Journal writes are queued through each function's own
existing per-run FIFO `enqueueEmit` — the same ordering/error-isolation discipline already used for
`lifecycle.emit()` calls, not a new mechanism. **Honest scope boundary**: ACP and pi-rpc's own prompt
delivery happens inside `attachAcpSession`/`attachPiRpcSession`'s own transport, out of this module's
direct view — their sent bytes are not journaled in v1 (their received stdout/stderr, which this module
does own, is). Documented on `WireAcpLifecycleContext.journal`/`WirePiRpcLifecycleContext.journal`, not
silently dropped.

**`@jini/node-host`**: `createLocalNodeDaemon` always constructs a dedicated durable byte-journal
(`createSqliteEventLog(join(dataDir, 'journal.db'))` — a second sqlite file, separate from
`events.db`) and wires it into the zero-config `AgentExecutor` unconditionally — gap 1 is "the
observability floor," not opt-in, for this preset. New `resolveRunInput?: ResolveRunInput` config field:
when supplied and `onRunStarted` is not, a default `RunStartHandler` is built via
`createDefaultRunStartHandler` and wired as `RunHttpDeps.onStarted`. `onRunStarted` always wins when
both are supplied (a host that wants full control shouldn't have to fight the default). Neither supplied
preserves prior behavior exactly (no driver attached). `journalEventLog` is closed alongside `eventLog`
on every existing cleanup path (rehydrate failure, bind failure, `stop()`) — **correction, 2026-07-22:**
this claim was wrong when originally written; `stop()` and the bind-failure path only closed
`eventLog`, leaking `journalEventLog`'s sqlite handle on every normal daemon shutdown. Fixed for
real in `packages/node-host/src/create-local-node-daemon.ts` (both paths now `Promise.all([eventLog.close(),
journalEventLog.close()])`) — the claim above is accurate again as of that fix. This exact gap was
independently found and fixed twice (once directly on `main`, once on a since-merged branch); the
branch's version additionally added regression assertions (`create-local-node-daemon.test.ts`'s three
`createdJournal.close` checks) that this merge keeps — see this package's own test suite.

Tests: `packages/daemon/src/continuation/__tests__/journal.test.ts` (4 tests, pure unit),
`run-start-handler.test.ts` (4 tests, pure unit, fake `AgentExecutor`), a new "gap 1 byte-journal"
`describe` block in `agent-executor.test.ts` (6 tests, covering sent/received journaling across all
three lifecycle paths — child/ACP/pi-rpc — plus the no-journal-configured default and the raw-prompt-
not-wire-frame assertion for `stream-json` defs), and two new tests in
`packages/node-host/src/__tests__/create-local-node-daemon.test.ts` (real HTTP integration: the default
handler reaching a real `AGENT_NOT_FOUND` rejection proves the wiring without spawning a subprocess;
`onRunStarted` precedence over `resolveRunInput`). `packages/daemon`: 313/313 tests, 100% on all 4
coverage metrics for every new/touched file. `packages/node-host`: 62/62 tests, 100% on all 4 metrics.
`packages/protocol`: clean typecheck (types-only addition, no dedicated test file — matches
`events.ts`/`errors.ts`'s precedent). `pnpm guard`: clean.

Not yet built (gaps 5/3/4, per the debate's locked MVP sequencing — this addition is gap 1 only):
session-resume capture, capability-routed continuation transport, retry-classifier port. The
human-in-the-loop pause question (debate's one Unresolved Delta) is also not addressed here — it's
scoped for gap 3's design, not gap 1's.

## 2026-07-22 addition — run/chat orchestration gap 5: session resume

Implements gap 5 of the debate's locked MVP sequencing (gap 1 → 5 → 3 → 4 — gap 5 is second in
sequence order but keeps its own item number from the Final Recommendation; there is no "gap 2" work
item at all, that number is permanently out of scope — prompt/skill/memory composition, staying
host-owned). Final Recommendation: "stop dropping `sessionID`/`thread_id`/`session_id` fields
already present in existing per-format parsers; persist as an optional `sessionRef` on
`RunEndPayload`/`FinishRunInput`, riding the existing `EventLog` terminal-entry retention — no new
storage."

**Where the id was already being dropped (confirmed by direct research, not assumed)**: four of
`@jini/agent-runtime`'s stream parsers already extract a session/thread id and surface it on a
`'status'` event's `sessionId` field — OpenCode (`json-event-stream.ts:161-172`, `sessionID`), Codex
(`json-event-stream.ts:699-716`, `thread_id`), Qoder (`qoder-stream.ts:74-85`, `session_id`), Claude
(`claude-stream.ts:419-427`, `session_id`). `translateAgentRuntimeEvent`'s `'status'` case
(`agent-executor.ts`) read every other field off that raw event but never `sessionId` — confirmed the
exact drop point, since `RunAgentPayload`'s `'status'` variant (`@jini/protocol`) has no field for it
either.

**Design: `sessionId` stays off the wire protocol.** `AgentRuntimeEventTranslation`'s `'agent'` variant
gained an optional `sessionId?: string` field, separate from `payload` — a daemon-internal side
channel a lifecycle-wiring function reads into a local variable, not a new field on the public
`RunAgentPayload` wire shape. `RunEndPayload`/`FinishRunInput` each gained an optional `sessionRef?:
string` (widened in `@jini/protocol`/`@jini/daemon` respectively) — all three lifecycle-wiring
functions (`wireChildLifecycle`/`wireAcpLifecycle`/`wirePiRpcLifecycle`) now track a local
`capturedSessionId` (last-write-wins across however many `'status'` events a run emits) and thread it
into their own terminal `finish()` call. Zero new storage: `finish()` already durably appends the
`'end'` entry to `EventLog`; widening `RunEndPayload` costs nothing beyond one more optional field on
an existing append.

**`RunLifecycle.resume()` is untouched, on purpose** — confirmed by direct reading (`run-lifecycle.ts`
lines 452-471) that it is a pure attempt-recovery state-machine flip (terminal → `'running'`) gated
only on `FinishRunInput.resumable`, keyed only on `runId`. `sessionRef` is read-only metadata for a
*host's own* next `start()` call (new `runId`, same `contextRef`, host decides whether/how to pass a
resume flag to the underlying agent CLI) — matching the debate's DP5 framing that a `Run` is one
attempt, not a multi-turn session, and continuity across turns is `contextRef` + an optional captured
`sessionRef`, never automatic.

**Deliberately NOT widened this pass**: `RunStatus`/`toPublicStatus` (`run-lifecycle.ts`) — a host
polling the plain `GET /api/runs/:runId` JSON endpoint still cannot see `sessionRef` (or `code`/
`signal`/`resumable`, which were already excluded before this task). `sessionRef` is visible today only
via the SSE event stream's terminal `'end'` event (`GET /api/runs/:runId/events`), which already
replays the full `RunEndPayload`. Staying this minimal matches the Final Recommendation's precise
wording ("no new storage") rather than also taking on a `RunStatus` shape change the debate never
asked for — a host that needs `sessionRef` without SSE is a real, identifiable follow-up, not silently
solved here.

**Honest scope limit**: `streamFormat: 'plain'` defs (grok-build/aider/deepseek/qwen) never populate
`capturedSessionId` — they have no structured parser, hence no `'status'` events to read a session id
from in the first place. ACP/pi-rpc's own prompt-delivery bytes were already out of the byte-journal's
view (gap 1's documented boundary); this gap only concerns bytes *received*, which both transports do
route through `translateAgentRuntimeEvent`.

Tests: 3 new cases in `translateAgentRuntimeEvent`'s existing describe block (`sessionId` present /
absent / non-string-defensive-coerced), plus a new "gap 5 session resume" describe block in
`agent-executor.test.ts` (4 tests: ACP session id reaches the terminal `'end'` event's `sessionRef`,
same for pi-rpc, `sessionRef` omitted entirely when no session id was ever reported, and
last-write-wins when the child-driven/Codex path reports two different thread ids across two `status`
events). One pre-existing test's title/assertion updated (`translates status carrying only sessionId
(dropped...)` → now asserts it's captured, not dropped — the old title described exactly the behavior
this task intentionally changed). 319/319 tests in the package, 100% on all 4 coverage metrics for
every file this task touched (`agent-executor.ts`, `run-lifecycle.ts`). `pnpm guard`: clean.

## 2026-07-22 addition — run/chat orchestration gap 3, part 1: transport resolution + stdin-tool-result injection

Implements the stdin-injection half of gap 3's Final Recommendation ("per-definition
`continuationTransport: 'mcp-callback' | 'stdin-injection' | 'none'`... Add `stdin-tool-result` only
for the confirmed stream-json defs (Claude, CodeBuddy), using structured/JSON-escaped framing
exclusively — never raw string concatenation... every injected byte routes through the existing
`ToolExecutor` deny-by-default gate"). **The MCP-callback half (the single-definition spike) is a
separate, not-yet-built follow-up** — see the "Not yet built" note at the end of this section for why
it's genuinely a different-sized task, not deferred out of laziness.

**`continuation/continuation-transport.ts`** (new) — `resolveContinuationTransport(def):
'mcp-callback' | 'stdin-injection' | 'none'`, a pure function over `RuntimeAgentDef`'s own declared
capability fields. Resolution order (derived from reading all 24 registered defs directly, not
assumed): `externalMcpInjection` set → `'mcp-callback'` (12 defs); else `promptInputFormat ===
'stream-json' && promptViaStdin` → `'stdin-injection'` (claude/codebuddy only, but both also declare
`externalMcpInjection`, so they resolve to `'mcp-callback'` as primary under this ordering — v1's
actual stdin-injection driver, described next, doesn't consult this function directly and is
independently gated); else `'none'`. Deliberately keyed off `promptInputFormat`/`externalMcpInjection`,
never `streamFormat` — `amp.ts` reuses `streamFormat: 'claude-stream-json'` (the output parser only)
but declares neither input-continuation field; a `streamFormat`-keyed resolver would misroute it.

**`agent-executor.ts`**: three changes.
1. `AgentRuntimeEventTranslation`'s `'turn-end'` kind now carries an optional `stopReason`, threaded
   from the raw parser event. Previously discarded entirely — confirmed by direct reading that
   `claude-stream.ts`'s own parser deliberately emits `stop_reason` *after* every `tool_use` block in
   the same assistant message has already been translated (its own comment: so a caller "sees the
   final `stop_reason` before deciding whether to close... stdin"), i.e. the parser always anticipated
   a caller that would eventually branch on it. v1 (pre-this-task) closed stdin unconditionally on any
   `turn_end` regardless of `stopReason` — a documented scope limit, not an oversight (see this file's
   own "Design decision 2" note, now partially closed).
2. New `ContinuationOptions` (`{toolExecutor, principal, autonomousToolNames}`) on
   `CreateAgentExecutorOptions`, opt-in only like `journal` — absent means every `turn_end` closes
   stdin exactly as before, byte-identical to pre-gap-3 behavior.
3. `wireChildLifecycle` tracks the most recently seen `tool_use` (`pendingToolUse`) and, on
   `turn_end`, only injects instead of closing stdin when *all* of: `stopReason === 'tool_use'`, a
   `continuation` was configured, `resolveContinuationTransport(def) === 'stdin-injection'`, and the
   pending tool's *name* is in `continuation.autonomousToolNames`. On injection: calls
   `continuation.toolExecutor.execute(principal, {id: runId}, toolUse.name, toolUse.input)` — the same
   deny-by-default gate every other tool-execution path in this codebase already uses, no parallel
   authorization path — emits a `tool_result` agent event (reusing `delegated-tool-bridge.ts`'s newly-
   exported `resultContent()` status→string mapping, not a duplicated one), then writes a structured
   (`JSON.stringify`, never string-concatenated) tool_result JSONL line mirroring the exact shape
   `claude-stream.ts`'s own inbound parser already expects on the opposite direction of this wire
   format (`{type:'user', message:{role:'user', content:[{type:'tool_result', tool_use_id, content,
   is_error?}]}}`) — inferred from that parser's own inbound-parsing symmetry, since Anthropic's
   outbound stream-json injection format isn't independently documented anywhere in this repo. The
   injected content is journaled via the same `sentJournalEntry`/`trust:'trusted'` path gap 1 already
   established for `writePromptToStdin`, so gap 1's observability floor covers this new write path too.

**The human-in-the-loop pause question (debate's Unresolved Delta), resolved for this transport**: an
explicit host-supplied `autonomousToolNames` allowlist, not stream-inferred intent. A `tool_use` whose
name isn't allowlisted is left exactly as v1 always treated it — stdin closes, the run proceeds to its
normal terminal state — even though `stopReason: 'tool_use'` was observed. Nothing auto-continues
unless a host has explicitly pre-vetted that specific tool name as autonomous-safe; this sidesteps
building unproven stream-based intent-detection entirely. A human-facing "ask the user a question"
tool is simply never added to the set — `packages/chat-core/src/question-form.ts`'s existing inline
`<question-form>` text-tag mechanism (which starts a fresh `Run` per turn with the answer baked into
the next prompt, matching DP5's "`Run` = one operation" semantics) already covers that case without
needing mid-turn injection at all.

Tests: `continuation/__tests__/continuation-transport.test.ts` (6 tests, including an exhaustive
assertion against all 24 real registered `AGENT_DEFS` — not a hand-picked subset — confirming the
resolution table matches direct research, plus the `amp.ts` misrouting-guard case). A new "gap 3
capability-routed continuation" describe block in `agent-executor.test.ts` (9 tests): default-unchanged
behavior with no `continuation` configured, not-allowlisted tool still closes stdin, non-`tool_use`
`stopReason` still closes stdin even when the tool would have been allowlisted, successful injection
(ToolExecutor called with the right args, stdin stays open, correct JSONL line, correct `tool_result`
event), `denied`-status injection produces `is_error: true`, a thrown `ToolExecutor.execute()` produces
`is_error: true`, the injected write is journaled as trusted, and the `child.stdin` unexpectedly-absent
defensive guard. Two pre-existing tests updated to assert `stopReason` is now carried through rather
than dropped (matching the same "test described exactly the old, intentionally-changed behavior"
pattern as gap 5's fix above). 467/467 tests in the package, 100% coverage on all 4 metrics for every
file this task touched. `pnpm guard`: clean.

**Not yet built**: the MCP-callback transport itself (primary for the 12 `externalMcpInjection` defs,
including claude/codebuddy under this resolver's own ordering). Confirmed by direct research that this
is a genuinely different-sized task, not a smaller "just wire it up": `@jini/mcp`'s `createMcpToolServer`
has no executable entry point anywhere in this repo (`packages/mcp/package.json` has no `bin` field);
none of the three `externalMcpInjection` config builders in `packages/mcp/src/core/config.ts`
(`buildClaudeMcpJson`/`buildAcpMcpServers`/`buildOpenCodeMcpConfigContent`) have any real caller —
`agent-executor.ts` never reads `def.externalMcpInjection` at all; and `delegated-tool-bridge.ts` (which
*does* already fully satisfy the "routes through `ToolExecutor`'s deny-by-default gate" requirement, no
changes needed there) has zero real callers anywhere outside its own test file. The spike the Final
Recommendation calls for needs, at minimum: a real `@jini/mcp` bin entry point, a new daemon HTTP route
bridging an MCP tool call to `delegated-tool-bridge.execute()`, and wiring that writes `.mcp.json` into
the spawn cwd before the child launches. Scoped as its own follow-up task rather than rushed alongside
the stdin-injection half above.

**Update, 2026-07-22 — closed.** All four pieces named above now exist: the `@jini/mcp` bin entry
(`packages/mcp/src/bin/serve.ts`), the HTTP bridge route (`packages/http/src/delegated-tools.ts`),
and — the specific piece this note flagged as the real remaining gap — the spawn-time `.mcp.json`
write itself, in this package's own "gap 3, part 2" dated section further below. This paragraph is
left in place rather than deleted so the record shows the note was accurate when written and that
the gap it named was later closed, not silently forgotten.

## 2026-07-21 addition — `routines/`: the routine scheduler engine + `RoutineStore` CRUD/history port

Implements the two decisions made in response to `ADS-memory/reports/proposals/
PROP-http-route-packs-automation-routines-2026-07-21.md` (Finding 2) for automation/routines' non-HTTP
half — the `@jini/http` route pack itself lives in `packages/http/src/routines.ts` (see that package's
own `source-map.md` dated section).

**New module `src/routines/`** (not mixed into `agent-executor.ts`/`run-lifecycle.ts` — a different
session was concurrently editing those files for the run/chat orchestration gaps above; this task
stayed out of them per its own brief):

- **`types.ts`** — `Routine`/`RoutineRun`/`RoutineSchedule`/`RoutineProjectTarget`/
  `RoutineContextSelection`/`RoutineRunHandler`/`RoutinePersistence`/etc., ported field-for-field from
  OD's `apps/daemon/src/routines.ts` (726 lines, `refactor/web-memory-slice` branch) local type mirror —
  that file's own header comment already documented these as "a local mirror... kept here so this
  service typechecks under NodeNext," not a product coupling, confirmed directly rather than re-cited
  from the proposal blind.
- **`schedule.ts`** — the DST-safe wall-clock schedule math (`nextRunAtForSchedule`,
  `nextHourlyRunAt`, `nextWallTimeMatching`, the `Intl.DateTimeFormat`-based `partsInTimezone`/
  `tzWallToUtcCandidates`/`tzWallToUtcGapFallback` gap/fall-back-transition handling) plus
  `validateSchedule`/`validateTarget`/`isValidWallTime`/`isValidTimezone`. Logic unchanged from the OD
  source — a faithful port, not a redesign, per the proposal's own warning against "casually
  reinventing" this. `nextWallTimeMatching`/`tzWallToUtcCandidates`/`tzWallToUtcGapFallback`/
  `partsInTimezone` are exported (OD kept them module-private) specifically so their defensive/
  edge-case branches — the 14-day walk-exhaustion fallback, the invalid-timezone catch blocks, two ICU
  quirks (`hour: "24"` at local midnight, an unrecognized weekday abbreviation) — are directly
  unit-testable instead of structurally unreachable through the public schedule-kind API alone (every
  real `RoutineSchedule` a caller can construct guarantees a predicate match within 7 days, and reaches
  `validateSchedule` before ever reaching these functions).
- **`scheduler.ts`** — `RoutineService` (start/stop/rescheduleAll/rescheduleOne/unschedule/nextRunAt/
  runNow), `ScheduledRunPersistenceError`. A faithful port of OD's `routines.ts` scheduler class:
  same `setTimeout`-chained re-schedule (capped at the ~24.8-day `setTimeout` ceiling), same
  race-safe scheduled-slot claim (a sibling daemon's losing `insertRun()` distinguished from a real
  persistence failure via `ScheduledRunPersistenceError`, with retry-same-slot vs. advance-to-next-
  cadence branching on that distinction), same routine-placeholder-id scrubbing
  (`clearRoutinePlaceholderId`) on a failed prepare. Only cosmetic change: the `[od]` console-log
  prefix became `[@jini/daemon]`. `RoutinePersistence` (the port `RoutineService` is injected with)
  is **deliberately kept synchronous**, not converted to this package's usual "ports are async-only
  from day one" convention (`event-log.ts`'s own doc note, extraction-plan §2.6) — see `types.ts`'s
  `RoutinePersistence` doc comment for why: the `setTimeout`-driven fire path and the scheduled-slot
  race logic are exactly the "genuinely hard to get right" logic the proposal flagged as not to
  casually reinvent, and a mechanical async conversion of every internal call site risks introducing
  new races for no behavioral gain, since a real backing store can still satisfy this port
  synchronously (an in-process cache a host keeps warm) even when the durable writes underneath it are
  async.
- **`routine-store.ts`** — **new**, no OD source (no such port existed anywhere in this repo before
  this file; OD's own `routine.ts` route file called eight raw `db.js` SQL functions directly against
  `routines`/`routine_runs` tables `packages/sqlite/source-map.md` already flags as explicitly out of
  scope for the db-barrel port). `RoutineStore` — `list`/`get`/`create`/`update`/`delete`/`listRuns`/
  `getLatestRun` — designed the same way `EventLog` is designed per this task's explicit brief: a
  storage-agnostic async interface plus `createInMemoryRoutineStore()`, the in-memory reference
  implementation, so a durable `@jini/sqlite` adapter is a drop-in swap later without an API break.
  **Deliberately does not write run records** (no `insertRun`/`updateRun` on the public interface) —
  mirrors OD's own architectural split, where the scheduler's `RoutinePersistence.insertRun`/
  `updateRun` (the write path for a routine actually firing) and the HTTP layer's run-history reads
  were always two different narrow ports over the same conceptual table, not one shared interface. A
  host bridging both against one real durable table is host-level integration wiring (the same way
  `runs.ts`'s `onStarted` driver is host-supplied rather than built into `RunLifecycle`), not attempted
  here. The concrete `createInMemoryRoutineStore()` factory does expose two extra methods beyond the
  `RoutineStore` contract itself — `recordRun`/`patchRun` — documented as existing only so (a) this
  module's own tests can seed `listRuns`/`getLatestRun` fixtures without a second store, and (b) a host
  building that bridge adapter has a shape-matched target to forward the scheduler's writes to.
  `summarizeLastRun` (the `Routine.lastRun` display-shaped projection embedded by `list`/`get`/`create`/
  `update` — OD's own `routineDbRowToContract` mapping) is its own exported pure function, directly
  unit-tested rather than inlined.
- **`index.ts`** — barrel; re-exported from the package's top-level `index.ts` (`export * from
  './routines/index.js';`, alongside a new module-doc paragraph there).

**Confirmed no name collisions** against the rest of the package's public surface before adding this
(`Routine`/`Schedule`/`Weekday`/`validate*`/`nextRunAt*` greppped clean across every other exported
module).

Tests: `src/routines/__tests__/schedule.test.ts` (30 tests — the DST spring-forward-gap/fall-back-
ambiguous-hour cases adapted from OD's own `apps/daemon/tests/routines.test.ts`, since that suite tests
exactly this generic scheduling math with zero OD product coupling, plus new tests this port added for
branches OD's own suite didn't cover: the 14-day walk exhaustion, the two ICU-quirk fallbacks via a
mocked `Intl.DateTimeFormat.prototype.formatToParts`, and both arms of the gap-fallback candidate-
ordering ternary using two different real timezones' spring-forward transitions), `scheduler.test.ts`
(25 tests — same OD-suite-adapted idempotency/race/discard-cleanup coverage, plus new tests for
`rescheduleAll`/`rescheduleOne` re-invocation branches, `retryScheduledSlot`'s two guard branches via
a synchronous `stop()`/routine-removal race simulated inside a mocked `insertRun`, the async closure's
defensive run-handler re-check via `Object.defineProperty` on the instance — TS `private` is
compile-time-only, so this is a legitimate runtime override, not a hack — and the raw-non-Error-value
branches of every `error instanceof Error ? error.message : error` ternary), `routine-store.test.ts`
(23 tests — full CRUD, run-history recording/patching/limiting, defensive-clone-on-read verified by
mutating a returned `Routine`'s array/object fields and re-fetching). One inherited, faithfully-ported
behavior documented rather than "fixed": `nextWallTimeMatching`'s per-day loop calls the unguarded
`partsInTimezone` without a try/catch (unlike `isValidTimezone`, which does wrap it) — an invalid
timezone reaching `nextRunAtForSchedule` throws rather than returning `null`; in practice a schedule
only reaches this function after `validateSchedule` has already rejected a bad timezone, so this
mirrors the OD original's own reachability assumption rather than a new gap.

`pnpm --dir packages/daemon typecheck`: clean. `pnpm --dir packages/daemon test:coverage`: this
package's coverage gate was intermittently red during this task purely from a concurrent session's
in-progress, uncommitted work on `agent-executor.ts`/`terminal-session.ts` (unrelated to routines,
confirmed via `git diff`/`git status` showing those files mid-edit) — resolved by the time of this
task's own final push; see this task's own final numbers in the `feat/http-routes-and-cli-commands`
branch history / PR for the as-pushed measurement. This task's own new files
(`src/routines/**`) measured in isolation at effectively 100% across statements/functions/lines with
branches in the high 90s before the final full-package run.

Not built this pass (explicitly out of scope, per the task brief): any built-in automation-template
content (`automation-templates.ts`'s `BUILT_IN_AUTOMATION_TEMPLATES`, ~145 lines of authored product
prompts — the host-supplies-its-own-templates decision was already made before this task started, so
none of that file's content or its template-lookup shape was ported, matching this repo's existing
`@jini/memory` prompt-composition / `@jini/deploy` config-path-resolution precedent for product-authored
content staying host-owned); `automation-proposals.ts`/`automation-ingestions.ts` (per the proposal's
Finding 1, scoped as "a dedicated follow-up task the same size and shape as `@jini/memory`'s own
original port," not attempted here); wiring a `RoutineStore`↔`RoutinePersistence` bridge adapter (host-
level integration, see `routine-store.ts`'s module doc).

## 2026-07-22 addition — run/chat orchestration gap 4: retry classifier port

Implements gap 4 of the run/chat orchestration Final Recommendation, the last of the 5 gaps in the
debate's locked MVP sequencing (1 → 5 → 3 → 4): "an injectable `classifyFailure?` port on
`CreateAgentExecutorOptions`, with no default classifier — absent, behavior stays byte-identical to
today's hardcoded `resumable: false`."

**`ClassifyFailure`** (new type in `agent-executor.ts`): `(context: FailureClassificationContext) =>
boolean | Promise<boolean>`, where `FailureClassificationContext = {runId, agentId, code, signal}`.
Deliberately minimal — those four fields are the only signals cheaply available at each of the three
lifecycle-wiring close handlers without new buffering machinery. No stderr/stdout tail is accumulated
for this purpose; a host wanting output-pattern-based classification (the way OD's own ~20-vendor-CLI
text-matching classifier worked, per this module's own doc — "deliberately never ported") would need
its own listener for that. An honest scope limit, not an oversight.

New optional `classifyFailure?: ClassifyFailure` on `CreateAgentExecutorOptions`, opt-in only like
`journal`/`continuation` — there is no generic "real" classification logic this package could supply on
a caller's behalf. Threaded into all three lifecycle-wiring functions
(`wireChildLifecycle`/`wireAcpLifecycle`/`wirePiRpcLifecycle`), each of which now computes `resumable`
as: `status === 'failed' && classifyFailure !== undefined ? await classifyFailure({...}) : false` — the
exact fallback (`false`) matches every prior hardcoded value byte-for-byte. **Never consulted** for
`'succeeded'`/`'cancelled'` outcomes (nothing to reclassify), and **never consulted** for a pre-spawn
failure (`failBeforeSpawn`'s call sites, unknown-agentId/unsupported-format/binary-not-resolved/spawn-
error) — those represent failures where no child process ever ran, so there is nothing a classifier
could meaningfully examine; those paths keep their original hardcoded `resumable: false` untouched.

ACP and pi-rpc's wiring contexts (`WireAcpLifecycleContext`/`WirePiRpcLifecycleContext`) previously
carried no agent identity at all (only `WireChildLifecycleContext` had `def`) — both gained a new
`agentId: string` field, populated from `def.id` at each construction call site in `run()`, purely so
`classifyFailure`'s context can report which agent failed.

Tests: a new "gap 4 failure classifier" describe block in `agent-executor.test.ts` (8 tests): default-
unchanged `resumable:false` with no classifier configured, the classifier is never consulted for a
succeeded run, never consulted for a cancelled run, a synchronous `true` result is honored (child-driven
path, also asserting the exact `{runId, agentId, code, signal}` context shape passed in), an asynchronous
(`Promise`-returning) classifier and a `false` result are both honored, the classifier is consulted on a
failed ACP-driven run, on a failed pi-rpc-driven run, and never consulted for a pre-spawn failure. Initial
draft of three of these tests raced `runPromise` (which resolves at spawn confirmation, not at run
termination) against the close handler's own async chain — fixed by awaiting
`lifecycle.waitForTerminal(run.id)` before asserting on `classifyFailure`'s call count, matching this
package's own established pattern elsewhere in the same test file. 475/475 tests in the package
(package-wide, including sibling gap-3-part-2/terminal-pty/automation-routines work landing
concurrently), 100% coverage on all 4 metrics for every file this task touched. `pnpm guard`: clean.

**This closes all 5 gaps the swarm-consensus debate's Final Recommendation named for its MVP sequencing**
(1: default wiring + byte-journal; 5: session resume; 3: transport resolution + stdin-tool-result
injection, with the MCP-callback spike split out as its own follow-up per the Final Recommendation's own
"validate... before committing" framing; 4: this addition). Gap 2 (prompt/skill/memory composition)
remains permanently out of scope per the debate's own decision — not a gap left open, a deliberate
boundary.

## 2026-07-21 addition — `terminal-session.ts`: interactive-terminal session manager (session-token gating + the kill/write/resize lock)

Implements the specific decision made in
`ADS-memory/reports/proposals/PROP-http-route-packs-terminal-pty-2026-07-21.md` — that document's own
"What would need to happen before this ports" §1/§2 candidate (a): `ToolExecutor.execute('terminal.create',
...)` returns a session id a lighter, still-explicit per-call ownership check validates on every
subsequent `write`/`resize`/`kill`/`attach`, rather than either (1) gating only `create` and leaving
`stdin` reachable through an ordinary same-origin-gated route with no further capability check, or (2)
wrapping every keystroke in `ToolExecutor`'s full authorize/confirm/audit round-trip.

**Not a port of OD's `apps/daemon/src/terminals.ts`** — that file's ring-buffer/coalescing/SSE-agnostic
session engine was already ported to `@jini/platform`'s `terminal.ts` on 2026-07-18 (see that package's
own `source-map.md`), before this task, as part of the "flat daemon primitives" batch — with its own
`PtySpawn`/`PtyProcess`/`TerminalSseSink` ports specifically because `@jini/platform` does not and
should not depend on `node-pty` (a native compiled addon). This module is new work layered on top of
that existing port, not a re-port of the origin.

**What this module adds, concretely:**

1. **`loadRealSpawnPty`** — the real `node-pty`-backed `PtySpawn` `@jini/platform`'s `TerminalService`
   is constructed with by default. Dynamically imports `node-pty` (mirroring OD's origin `await
   import('node-pty')`) so a host whose platform lacks a usable addon still boots; only an actual
   `terminal.create` call fails. Before the first spawn, repairs `node-pty`'s bundled `spawn-helper`
   executable bit via `@jini/platform`'s own `spawnHelperCandidatePaths`/`ensureSpawnHelperExecutable`
   — reused, not reimplemented — but with the resolver anchored at **this** module
   (`createRequire(import.meta.url)` here), since `@jini/platform`'s own default resolver would not
   find `node-pty` (that package deliberately does not depend on it).

2. **Session-ownership gating** — `TerminalSessionManager` records which `Principal` created each
   session (at `create()` time, inside the `ToolExecutor`-gated tool handler) and every subsequent
   `write`/`resize`/`kill`/`attach`/`get` call verifies the calling principal matches, denying
   otherwise. A mismatch is reported identically to "no such session" (`'not-found'`), never a
   distinguishable "forbidden" — matching OD's own `resolveSession` precedent (a foreign `projectId`
   was already a 404 in the origin, not a 403) and avoiding session-id enumeration.

3. **The kill/write/resize race fix** (the proposal's own named secondary blocker, and the routes-
   classification table's original note against `terminal.ts`: "No lock between a `kill` and a
   concurrent `stdin`/`resize` on the same session id"). The underlying engine's `kill()` only
   *requests* the real OS process die (`SIGTERM`) — `status` does not flip to `'exited'` until the
   pty's own `onExit` fires asynchronously once the process actually dies, so a `write`/`resize`
   processed in that window still reaches the real pty. `runExclusive` (a per-session-id promise chain,
   the same `withLock` idiom `agent-runtime/src/providers/oauth-tokens.ts` already established in this
   codebase) serializes `write`/`resize`/`kill` calls for the same session id; `kill()` sets its own
   immediate `killed` flag inside that same locked critical section, before delegating to the
   underlying engine — so any `write`/`resize` queued behind it observes `killed: true` and is
   rejected, regardless of whether the real OS process has actually exited yet. Verified directly: a
   test drives a fake pty that never fires `onExit`, issues `kill()` then `write()` concurrently, and
   asserts the write never reaches the fake pty's `write()` — proving the fix does not depend on the
   underlying async status transition.

**A fourth, self-imposed constraint drove one design choice**: `@jini/platform`'s `TerminalSession`/
`CreateTerminalOptions` carry a per-session grouping field this package's own identifier-neutrality
lint (`__tests__/identifier-lint.test.ts`) forbids naming anywhere in `packages/daemon/src/**`. Rather
than working around the lint, this module's public `TerminalSessionInfo` type is its own shape — every
field explicitly enumerated in `toSessionInfo` (no object spread, which would have silently carried the
forbidden field through) — and the caller-supplied `resourceRef` this module tracks in its own metadata
map is never forwarded to `@jini/platform`'s `create`/`list` calls at all (that field is simply omitted
on every call into the underlying engine).

**`node-pty` as a new workspace dependency** — this is the first native compiled addon dependency
anywhere in this monorepo. Investigated and resolved empirically, not assumed:

- Confirmed absent from `pnpm-lock.yaml` before this task (checked directly).
- Added to `@jini/daemon`'s `package.json` only (`"node-pty": "^1.1.0"`), not the workspace root and
  not `@jini/http` (a pure HTTP/SSE transport package has no business taking on a process-spawning
  native dependency) — matching the task brief's explicit placement decision.
- This workspace's root `package.json` already gates native postinstall/build scripts behind a
  `pnpm.onlyBuiltDependencies` allow-list (previously `["better-sqlite3"]`, for `@jini/sqlite`) —
  `pnpm install` otherwise silently skips a new native dependency's install/postinstall lifecycle
  scripts by design (a deliberate supply-chain-safety default, not a bug). `"node-pty"` was added to
  that same allow-list; without it, `node-pty`'s bundled prebuilt binary is never linked and every
  spawn fails.
- Verified end to end, for real, in this sandbox (darwin, this environment's Node binary reports
  `x64` — Rosetta or an actual Intel runtime, not the host's `arm64`): `pnpm install` fetches
  `node-pty@1.1.0`, which ships **bundled prebuilt binaries for `darwin-arm64`, `darwin-x64`,
  `win32-arm64`, `win32-x64` inside the npm tarball itself** (no network fetch at install time) — but
  **no `linux-*` prebuild is bundled**. A real spawn was confirmed working after `pnpm install`
  (`ensureSpawnHelperExecutable` repairing the bundled `spawn-helper`'s permission bit, exactly the
  same fix `@jini/platform`'s `terminal.ts` module doc already documents needing) by actually forking
  `/bin/echo` through the addon and reading its output back. **This is a real, confirmed gap for any
  Linux CI runner or Linux-hosted daemon deployment**: `node-pty`'s own `install` script falls back to
  `node-gyp rebuild` when no bundled prebuild matches, which needs a full native toolchain
  (python/make/a C++ compiler) present at install time — this workspace's `onlyBuiltDependencies` gate
  means that fallback only even runs where explicitly allowed, and this repo currently has no CI
  configuration at all (confirmed: no `.github/workflows`), so this gap is undiscovered rather than
  mitigated. Flagged here rather than silently absorbed, per the task brief's explicit instruction.

Tests: `src/__tests__/terminal-session.test.ts` — `loadRealSpawnPty` driven end to end against a fully
mocked `node-pty`/`@jini/platform` (spawn-helper repair, the resolver-anchoring proof, the `IPty`→
`PtyProcess` adapter's every member) with zero real filesystem or subprocess touched; the session
manager built on the **real** `@jini/platform` `TerminalService` (that package's own ring-buffer/
coalescing/TTL logic is not re-tested here) with an injected fake `PtySpawn`, covering ownership
denial (cross-principal `get`/`write`/`resize`/`kill`/`attach`/`list`, always `'not-found'`, never a
distinguishable forbidden), the kill/write/resize lock's actual race-closing behavior (including the
"write queued before kill still lands" non-starvation case), TTL-driven metadata pruning (via fake
timers), a narrow-but-real defensive branch (a session reaped by TTL cleanup between a call's ownership
check and its own turn in the lock reports a null snapshot rather than throwing — deterministically
forced by advancing fake timers inside the synchronous window before the queued lock body runs), and
`createTerminalToolRegistrations`'s deny-by-default/policy-override/confirmation/malformed-input
handling end to end through a real `ToolExecutor`/`ToolRegistry` (matching `db-ops.test.ts`'s own
"prove the real production default, not a test fixture's" discipline). `pnpm --dir packages/daemon
typecheck`: clean. This file's own coverage measured in isolation at 100% statements/branches/
functions/lines; see this task's final push for the as-measured full-package numbers (the package's
existing coverage gate was intermittently red during this task purely from a different, concurrent
session's in-progress, uncommitted edits to `agent-executor.ts` — unrelated to this module, resolved by
that session before this task's own final push).

## 2026-07-22 addition — run/chat orchestration gap 3, part 2: MCP-callback spawn-time `.mcp.json` injection (finishing item 4 of the spike commit `2a081c5`)

Closes the one deliverable the MCP-callback continuation-transport spike's own commit message
named as undone: *"Item 4 (agent-executor.ts mcp.json spawn-time injection for the claude def)
... [is] NOT done yet."* Items 1–3 (`packages/mcp/src/bin/serve.ts`, `packages/mcp/src/server/
tools/delegated-tool.ts`, `packages/http/src/delegated-tools.ts`) already existed but had no
spawn-time caller — `resolveContinuationTransport` already resolved `'mcp-callback'` for every def
with `externalMcpInjection !== undefined`, but nothing in this package ever *acted* on that
resolution by actually launching `jini-mcp` as the spawned CLI's own MCP server subprocess.

**What shipped, concretely** (`agent-executor.ts`): a new opt-in `mcpJsonInjection?:
McpJsonInjectionOptions` field on `CreateAgentExecutorOptions` — `{command, args?, daemonUrl,
readFile?, writeFile?}`, host-resolved (no default `command`/`daemonUrl`, matching every other
seam on this interface that defaults to *nothing* rather than a real implementation, since there
is no install layout or loopback URL this package could assume on a caller's behalf). `run()`
calls a new `writeMcpJsonForRun` right after `buildArgs`, before spawn — a no-op whenever
`mcpJsonInjection` is unconfigured (byte-identical to pre-this-task behavior) or `def
.externalMcpInjection !== 'claude-mcp-json'`. That gate is deliberately keyed off the injection
*strategy*, not a hardcoded `def.id === 'claude'` check — matching `resolveContinuationTransport`'s
own established capability-based-dispatch convention in this same file — which means it also
covers `codebuddy` (the only other def declaring `'claude-mcp-json'`) as an honest consequence,
not scope creep: `'acp-merge'` defs deliver `mcpServers` through the ACP `session/new` params
`wireAcpLifecycle` already carries, and `'opencode-env-content'`/`'mimo-env-content'` defs deliver
through spawn-env content — neither wants or needs a written file, so `writeMcpJsonForRun` is
correctly a no-op for both.

**Merge, never clobber.** `mergeMcpJsonContent` (pure, exported for direct unit testing) reads any
existing `.mcp.json` at `<cwd>/.mcp.json` first and merges only the `mcpServers.jini` key,
preserving every other top-level key and every other registered server untouched — a missing file
(the common case; `ENOENT` from the injected `readFile`), an unreadable file, or one that doesn't
parse as a JSON object all degrade to "start from an empty document" (an unparseable project
`.mcp.json` is a pre-existing problem this driver did not create and cannot safely repair, so it is
overwritten with a fresh, valid file rather than left broken or blocking the run — documented, not
silent). A write failure is treated exactly like every other pre-spawn filesystem guard in this
file (`preparePromptFileForAgentFn`'s own try/catch): `cleanupPromptFile()` then
`failBeforeSpawn('AGENT_SPAWN_FAILED', ...)` — never a bare throw, the run is already transitioned
to `'failed'` before rejecting, matching this module's own Invariant.

**Tests**: `src/__tests__/agent-executor.test.ts` gained 17 new tests — `buildMcpJsonServerEntry`
(2, pure), `mergeMcpJsonContent` (7, pure — fresh document, preserves unrelated keys/other
servers, overwrites a stale `jini` entry, and three "start fresh" degradation cases: unparseable
JSON, a JSON array instead of an object, a non-object `mcpServers` field), and a `gap 3 part 2`
integration describe block (7 — no-op when unconfigured even for a `claude-mcp-json` def, no-op
for a configured `'acp-merge'` def, no-op for a claude-mcp-json def with `externalMcpInjection`
simply absent, a full read-merge-write round trip through a real `ToolExecutor`-free harness
proving the write happens strictly before spawn, `ENOENT`-as-start-fresh, and the write-failure
pre-spawn-failure path). One further test in `createAgentExecutor — real default collaborators`
touches a real temp directory (`fs.mkdtemp` under `os.tmpdir()`) with no `readFile`/`writeFile`
override at all, so `defaultReadMcpJsonFile`/`defaultWriteMcpJsonFile` (the real
`fs.promises` defaults) are exercised for real, not just their injected-fake seams — this repo's
own "extract, don't cut" coverage convention: rather than leaving the real default branch
undercovered, it is driven directly.

**Verification, personally re-run this session** (not propagated from the spike commit's own
"NOT LOCALLY VERIFIED" note): `pnpm --dir packages/daemon exec vitest run --coverage` — **491/491
tests pass**, `agent-executor.ts` **100/100/100/100** (statements/branches/functions/lines),
package-wide aggregate **100/99.92/100/100** (the two pre-existing sub-100% files —
`routines/schedule.ts` line 219 and the zero-executable-statement `run/core/failure-taxonomy.ts` —
are untouched by this task and already documented as such). `pnpm --dir packages/daemon exec tsc
--noEmit`: clean. Root `pnpm typecheck` (all 28 workspace projects) and root `pnpm guard`: both
clean — see this task's final integration-verification section for the full command transcript.

## 2026-07-22 addition — terminal/PTY route pack: `pnpm guard` re-run, and `node-pty`'s missing Linux prebuild — a real deployment decision, not a bare flag

The 2026-07-21 `terminal-session.ts` addition above flagged the `node-pty` Linux-prebuild gap but
left it as "undiscovered rather than mitigated" pending a real decision. This pass makes that
decision, backed by evidence gathered in this session, not assumption:

**`pnpm guard`, actually run this session** (it had not been, per this task's own open-items
list): root `pnpm guard` (scans all of `packages/@jini/**`, including `terminal-session.ts`) — zero
violations. No R1–R7 boundary/neutrality/sprawl issues in this file.

**The decision.** This repo's own `foundry/docs/jini-port/START-HERE.md` states the architecture plainly:
*"Jini is a headless daemon"* — a long-running Node server process, the deployment shape that
overwhelmingly means a Linux host (container or bare server) in practice, not a developer's own
macOS/Windows machine. `node-pty@1.1.0`'s npm tarball bundles prebuilt native addons for
`darwin-arm64`/`darwin-x64`/`win32-arm64`/`win32-x64` but ships **no `linux-*` prebuild** — on a
Linux install, `node-pty`'s own `install` script falls back to `node-gyp rebuild`, which needs a
C/C++ toolchain (python3/make/a C compiler) present at `pnpm install` time.

**Empirically verified in this exact session**, not inferred from reading `node-pty`'s source: this
task's own `pnpm install` ran on a real Linux (x64) sandbox with a standard build toolchain present
and the fallback **worked correctly and automatically** — `node-gyp rebuild` compiled
`pty.node` from source (`CXX(target) Release/obj.target/pty/src/unix/pty.o` →
`SOLINK_MODULE(target) Release/obj.target/pty.node`, `gyp info ok`) with zero manual intervention
beyond the `pnpm.onlyBuiltDependencies` allow-list entry the 2026-07-21 addition already added
(without that entry, pnpm's supply-chain-safety default silently skips native postinstall scripts
entirely and this fallback would never run at all — confirmed by that entry already being present
in this checkout's root `package.json` before this pass touched anything).

**Decision: accept the gap, with a documented, actionable requirement — not a code fallback.**
Build-from-source *is* the fallback (already the default, already proven working end-to-end this
session); nothing further needs to be built. What was missing was making the requirement this
implies for a deployer explicit rather than silent: **a Linux host deploying this daemon must
have a C/C++ build toolchain (`python3`, `make`, a C compiler — e.g. Debian/Ubuntu's
`build-essential` package) available at `pnpm install` time.** This is *not* satisfied by a
minimal/`slim`/`alpine`-family base image out of the box (those deliberately omit build tooling to
stay small) — a deploying host must either use a base image that already includes one (e.g. the
non-slim `node:*-bookworm` family) or install the toolchain as an explicit build-stage step before
`pnpm install`. No CI configuration exists anywhere in this repo to encode this in (confirmed: no
`.github/workflows` directory) — this paragraph, plus the 2026-07-21 addition's own flag above, is
this decision's durable record until a real deployment/CI configuration task exists to encode it
as an executable check instead of documentation. Rejected alternatives: vendoring a prebuilt
`linux-x64`/`linux-arm64` `.node` binary into this repo (adds binary artifacts + a maintenance
burden for a native addon this package doesn't own) and pinning an older `node-pty` version that
might ship a Linux prebuild (checked — no version in this package's supported range ships one;
Linux users of `node-pty` upstream are documented to be expected to build from source).

## 2026-07-22 addition — gap 4's retry classifier gets a real zero-config default (`resumableFromProcessExit`)

Confirmed by tonight's audit: `ClassifyFailure`/gap 4 was fully built and unit-tested, but
`@jini/node-host`'s `createLocalNodeDaemon` — the one real host-assembly entry point in this repo —
never supplied one to `createAgentExecutor`, so every real run still got hardcoded
`resumable: false`. Fixed for real, not just wired-through-to-a-stub: `packages/daemon/src/run/core/retry.ts`
gains `classifyProcessExitFailure(code, signal)` (maps the raw exit info this package's own
`FailureClassificationContext` deliberately limits itself to — see that interface's own doc for why
richer signal isn't available without new stderr/stdout buffering — into a `process_exit`
`RunRetryFailureSignal`) and `resumableFromProcessExit(code, signal)` (composes that classification
with `decideSafeRunRetry`, called with `attemptCount: 0` since gap 4's `resumable` flag is
informational metadata for a host's own later follow-up run, not the same thing as
`decideSafeRunRetry`'s full same-run-automatic-retry scheduling — see that function's own doc for
the distinction).

**A real policy decision, not just plumbing:** `decideSafeRunRetry`'s existing `process_exit`
retryable-detail allowlist (`agent_protocol_error`/`qoder_stop_sequence`/`session_resume_expired`/
`stream_error`/`fatal_rpc_error`) had zero real callers before this fix (confirmed by tonight's
audit) and none of those details are derivable from bare exit code/signal — routing
`classifyFailure` through it unmodified would have been wiring that *looks* real but always
evaluates to `false`, the exact kind of "relocated the same shortcut" outcome the standing rule
warns against. Extended the allowlist with one new, real, defensible case instead:
`signal_killed` — a process terminated by an OS signal (SIGKILL from an OOM-kill, an infra-level
eviction, etc.) was never the agent's own choice to fail, unlike a plain non-zero exit code (the
agent's own process deciding to fail — a config problem, a deterministic bug — where blind retry is
unlikely to help). Safe to extend since nothing else in the repo called `decideSafeRunRetry` before
this pass (confirmed), so this couldn't regress any other consumer's behavior.

`createLocalNodeDaemon`'s `createAgentExecutor(...)` call now passes
`classifyFailure: ({ code, signal }) => resumableFromProcessExit(code, signal)` — every real run
gets a genuine classification instead of the previous hardcoded `false`.

**Verification, and its one honest boundary.** `classifyProcessExitFailure`/`resumableFromProcessExit`
are 100% unit-tested (`packages/daemon/src/run/core/__tests__/retry.test.ts`), as is
`agent-executor.ts`'s own `classifyFailure` invocation contract (already covered by
`agent-executor.test.ts`'s existing 131 tests, unchanged by this pass). The one-line wiring call
itself in `create-local-node-daemon.ts` is type-checked (a real type error would fire if
`ClassifyFailure`'s signature and `resumableFromProcessExit`'s didn't match) but **not** independently
re-proven via a live spawned-process integration test end to end through `createLocalNodeDaemon`'s
public API — doing so would require either a real, predictably-failing agent CLI installed in every
dev/CI environment (fragile, non-deterministic) or new test-only spawn-injection hooks added solely
for this test, which felt like a worse trade than being honest about the boundary: two independently
100%-tested pure functions, composed via one type-checked line, is the real verification state —
not "fully proven end to end," and this paragraph exists so that distinction isn't lost.

Personally run this session: `pnpm --dir packages/daemon exec vitest run --coverage
--coverage.include='src/run/core/**'` → **500 tests pass**, `retry.ts` **100/100/100/100**.
`pnpm --dir packages/node-host exec vitest run` → **78/78 tests pass** (unchanged count — this
fix has no new node-host-level test, per the boundary above). `pnpm --dir packages/daemon exec tsc
--noEmit` and `pnpm --dir packages/node-host exec tsc --noEmit`: both clean.
## 2026-07-22 addition — two independent retry classifiers reconciled at merge time (audit fix, AUD-002)

A second cloud session, working in parallel on a branch (`fix/audit-6-fixes-20260722`) that forked
before the paragraph above landed, independently built its **own** answer to the identical gap-4
problem: `classifyProcessExitFailure` + `defaultClassifyFailure`, both new exports added directly to
`agent-executor.ts`, with a **materially different policy** — only `signal === 'SIGPIPE'` was
classified retryable (`upstream_unavailable`/`network_error`); every other signal, including
`SIGKILL`/`SIGTERM`, was `process_exit`/`signal_killed` and explicitly **not** retryable. Because
this branch touched a file `main` had not (a different file than the `run/core/retry.ts` location
above), a raw `git merge` would have combined both silently with no conflict marker at all — two
same-shaped, contradictorily-behaving classifiers coexisting in the tree, one of them dead code by
accident of which line happened to get wired last. A deep-dive audit
(`ADS-memory/reports/audit-fastify-merge-and-six-gap-fixes-2026-07-22.md`, AUD-002) caught this
before it landed.

**Decision made at merge time: keep this file's `run/core/retry.ts` version; delete the branch's
`agent-executor.ts` duplicate.** Reasoning: the branch's SIGPIPE-only policy is more conservative
but misses the single most common real-world signal-kill scenario this classifier exists for — an
OS/container OOM killer or infra-level eviction sending `SIGKILL` to a healthy process, which is
presumptively transient and exactly the case worth retrying. The broader "any signal is
presumptively transient" policy this file already documents does risk retrying a genuine crash
signal (e.g. `SIGSEGV`) that a retry won't fix, but the blast radius of that miss is small and
bounded: `DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS = 1`, so the cost of being too permissive here is at
most one wasted extra attempt, while the cost of the branch's more conservative policy is silently
never retrying the dominant legitimate case. `agent-executor.ts`'s own `classifyProcessExitFailure`/
`defaultClassifyFailure` exports and their dedicated tests were removed as part of this merge;
`FailureClassificationContext`'s `code`/`signal`-only scope note is unaffected (both
implementations agreed on that boundary — see this file's now-single classifier for the reasoning).

Also merged in from the same branch, independent of the classifier question: real `sideEffects`
wiring (`userVisibleOutputSeen`/`toolCallSeen`, derived live from the translated agent-event stream
in all three `wire*Lifecycle` drivers) so two of `decideSafeRunRetry`'s four side-effect-suppression
guards are now genuinely exercised, not permanently dead code — see `resumableFromProcessExit`'s own
doc in `retry.ts` for exactly which two, and why `artifactWriteSeen`/`liveArtifactSeen` still
cannot be (no `'artifact'`/`'live_artifact'` event kind exists anywhere in `@jini/protocol`'s
`RunAgentEventPayload` union today — a real protocol gap, not an oversight; see this repo's own
"A2UI full protocol deferred" scope note). `attemptCount` stays a documented, correct `0`: no
automatic same-run retry loop exists anywhere in this codebase yet (gap 4's `resumable` flag is
read-only metadata for a host's own later follow-up run, not an auto-retry trigger — see
`resumableFromProcessExit`'s doc), so every real call to this classifier genuinely is evaluating a
first and only attempt; a future auto-retry loop would need to supply its own real count.

**Verified, personally, this session**: `pnpm --dir packages/daemon exec tsc --noEmit` clean;
`pnpm --dir packages/daemon run test:coverage` — all tests pass, `retry.ts` and `agent-executor.ts`
both 100/100/100/100 after the branch's duplicate export and its 8 dedicated unit tests were
removed and the 3 `wire*Lifecycle` drivers' new side-effect tracking got its own coverage.

## 2026-07-22 addition — coverage pass: `routines/schedule.ts:219` re-verified genuinely unreachable, not accepted at face value

Per this task's own "no scope cuts for coverage — real refactor first, only document as
unreachable with the actual proof" standing rule, `nextWallTimeMatching`'s `if (!fallback) return
null;` at line 219 (the `tzWallToUtcGapFallback` null-safety guard) was re-derived from scratch
rather than trusted from the inline comment already there:

`tzWallToUtcGapFallback(timezone, ...)` returns `null` only when its own internal
`tzOffsetMinutes(timezone, ...)` call throws — which happens only when `new
Intl.DateTimeFormat(..., {timeZone: timezone, ...})` rejects `timezone` as invalid (read
`tzOffsetMinutes`'s own implementation to confirm this — same construction pattern, wrapped in the
same try/catch-to-null shape `partsInTimezone` uses). But by the time line 219 is ever reached,
`partsInTimezone(timezone, probe)` (line 203, this exact same loop iteration) has *already*
constructed an `Intl.DateTimeFormat` for the identical `timezone` string and succeeded — and
`Intl`'s timezone validity is a static property of the string, not something that can change
between two calls microseconds apart in the same synchronous loop body. So `tzWallToUtcGapFallback`
cannot fail here without `partsInTimezone` having already failed first, which would have
short-circuited this code path entirely before line 219 is ever reached. Confirmed unreachable
through this call site, not merely asserted.

**Kept, not deleted**: this is real, correct defensive programming against
`tzWallToUtcGapFallback`'s actual `Date | null` signature (a general-purpose exported function used
elsewhere too — deleting the guard here would make this call site silently wrong the moment
`tzWallToUtcGapFallback`'s own contract or this function's call order ever changes). Its `null`
path is independently, directly covered by `schedule.test.ts`'s own dedicated test against a
real invalid timezone string — genuine behavior of that function is tested; only this one
call site's redundant re-check of an already-proven invariant is unreachable.

No code change; this entry exists because the standing rule requires the *proof*, not just the
prior claim, to be on record in this file, matching the inline code comment already at that line.

## 2026-07-23 addition — replay subscription failure cleanup

`RunLifecycle.stream()` deliberately installs its subscriber before awaiting durable replay so it
cannot lose events in the replay-to-live handoff. That provisional subscriber is now removed when
either replay I/O or the replay consumer callback throws; previously both exceptions could leave a
dead callback retained for the process lifetime. Dedicated tests prove a failed replay/callback is
not invoked by a later live event.

Fable's follow-up review found the deeper terminal-during-replay race: a stale replay snapshot could
deliver `end`, buffered agent output, and a duplicate `end`; an SSE consumer closes on the first
`end` and would silently lose the buffered output. Buffered live events now flush and contribute
their ids before the terminal fallback, preserving order and exactly one `end`. Terminal state is
also committed in memory only after the durable end append succeeds; a `finishPromise` reservation
blocks emits and serializes concurrent finishes without advertising an undurable terminal state.
Failed start appends unwind both the run and idempotency reservation, and idempotent duplicates wait
for the pending durable start. Inactivity-timeout append failures are contained and reported through
an optional host sink instead of becoming unhandled rejections.

Verified: `pnpm --filter @jini/daemon typecheck`; full daemon suite **517/517**, including gated
terminal-during-replay, start/end append failure, concurrent finish, and watchdog containment tests.

## 2026-07-29 addition — driving antigravity: the 24th def, via declarative `RuntimeAgentDef` fields

Closes the one gap the 2026-07-21 plain-format entry above explicitly scoped out ("**antigravity
stays deliberately unsupported**"), and with it the last `AgentExecutor` driver gap: **all 24
registered `@jini-ai/agent-runtime` defs now run.** The `streamFormat === 'plain' && def.id ===
'antigravity'` guard in `assessAgentExecutorCompatibility` is deleted.

### The decision: def-declared fields, not an id branch

`PROP-plain-format-agent-driving-2026-07-21.md`'s open question 6 asked whether antigravity's
divergence stays "an id-keyed special case inside `@jini-ai/daemon` (mirroring OD's own choice to
hardcode `def.id === 'antigravity'` in `server.ts`)" or gets a `RuntimeAgentDef`-level field (its
"Option C"). **Option C, deliberately** — and the evidence is not a style preference:

- `RuntimeAgentDef` already carries **14** optional behavior flags/hooks the executor reads
  generically (`promptViaFile`, `promptViaStdin`, `resumesSessionViaCli`,
  `capturesSessionIdFromStream`, `resumesSessionViaAcpLoad`, `externalMcpInjection`, `authProbe`,
  `acpMcpEnvFormat`, `defaultModelEnvVar`, `inactivityTimeoutMs`, `maxPromptArgBytes`,
  `supportsCustomModel`, `promptInputFormat`, `promptViaStdin`'s `permissionMode`-aware `buildArgs`).
- There was **zero** precedent anywhere in this package for the executor branching on a literal
  agent id to decide *behavior* — the antigravity rejection was the only id branch at all, and it
  decided *support*, not behavior.
- OD's `server.ts` hardcodes `def.id === 'antigravity'` twice; §2d of the same proposal already
  records that OD's *prompt-delivery* call sites, by contrast, key only off declared fields with
  zero id branches. The field-driven half is the half that generalized cleanly.

Consequence worth stating plainly: a second CLI with either property (prints a secret on stdout and
exits 0; or mutates process-global state its own startup reads back) needs **no new executor code**.

### Three new fields on `RuntimeAgentDef` (`@jini-ai/agent-runtime`)

| field | shape | why |
|---|---|---|
| `needsAgentLogFile` | `boolean` | Asks the caller to stage a temp path and pass it as `RuntimeContext.agentLogFilePath` before `buildArgs`. Exactly `promptViaFile`'s opt-in shape, for the same reason: `buildArgs` cannot invent a path the caller must also read and delete. `agy` needs it twice over — the lock's handoff detector polls it, and print mode never echoes auth/quota failures on stdout, so post-exit log inspection is the only way to tell those apart. |
| `stdoutPolicy` | `{buffering:'live'} \| {buffering:'until-close'; sanitize?}` | When a `plain` def's stdout reaches the client. `undefined` ⇒ live, i.e. every def's pre-existing behavior. |
| `runtimeLock` | `{acquire(ctx) => Promise<RuntimeLockHold>}` | A mutex around a process-global side effect `buildArgs` performs. |

**`stdoutPolicy` is a discriminated union, not two flat fields** (`stdoutBuffering` +
`sanitizeStdout`), and that is the load-bearing design call in this entry. A sanitizer is only
*meaningful* on the buffered path, because the pattern to redact can straddle two `'data'` chunks —
which is the entire reason buffering exists here. Two independent flags would let a def declare
`sanitize` alongside live streaming, where the caller cannot honor it: the confidentiality gap would
then **look closed in the def while leaking at runtime**. The union makes that unrepresentable. Same
"make illegal states unrepresentable" instinct as `AgentExecutorCompatibility` in this module.

**`runtimeLock` does not accept a `ChildProcess`.** The release contract needs three things — the
staged log path, the model, and "has the process exited" — so `RuntimeLockHandoffContext` carries
exactly those, with process exit as an `AbortSignal`. Handing a def a whole `ChildProcess` would
couple `RuntimeAgentDef` to `node:child_process`'s process model for a concern that is really just
"did the child read the file yet", and would let a def kill or write to the child. The release rule:
**whichever of `waitForHandoff` settling or process exit comes first**, `release()` being idempotent
by contract so no path coordinates with any other. Releasing on exit is not a fallback — a watcher
returning "gave up polling" means *"I stopped watching"*, never *"the child didn't read the file"*;
only exit proves the child can no longer read it (`waitForAgyToReadModel`'s own doc says exactly
this, and the executor now honors it).

**All three are stripped from `DetectedAgent`.** Found while checking the whole surface, and a real
latent leak rather than tidiness: `detection.ts#stripFns` builds its result by spreading `...rest`,
so *any* new `RuntimeAgentDef` field is published into the public registry payload by default.
`stdoutPolicy` and `runtimeLock` carry closures — `JSON.stringify` drops the functions but keeps
their wrappers, so the response would have advertised a misleading `{"buffering":"until-close"}` and
`{}`. Both the `Omit` list and `stripFns`' destructuring now exclude all three, pinned by a
detection test that asserts on the serialized projection.

### `@jini-ai/agent-runtime` side

- **`src/log-file.ts`** (new, no OD provenance — OD derived the path inline in `server.ts`):
  `prepareAgentLogFile(def, label)`, the deliberate sibling of `prompt-file.ts` — same
  `{path, cleanup}` shape, same `mkdtemp`-per-run isolation, same label sanitization (so a run id
  containing `../` cannot escape `os.tmpdir()`). One substantive difference: **it does not write the
  file.** Direction of travel is inverted — the prompt file is input we author for the CLI, the log
  file is output the CLI authors for us. Only the `0o700` containing directory is created, which is
  the actual confidentiality control since the CLI picks the log file's own mode.
- **`defs/antigravity.ts`**: `needsAgentLogFile: true`; `stdoutPolicy: {buffering: 'until-close',
  sanitize: redactAntigravityAuthUrls}`; `runtimeLock: antigravityModelLock`. The lock is a **thin
  adapter** over the already-existing, already-tested `acquireAntigravityModelLock` /
  `waitForAgyToReadModel` pair — no new serialization logic. Its one policy decision: skip the chain
  entirely when no concrete model was selected, mirroring `buildArgs`' own `options.model &&
  options.model !== DEFAULT_MODEL_OPTION.id` guard, since the lock guards that write and holding the
  chain anyway would queue a `'default'`-model run behind an unrelated one for nothing. OD does the
  same ("serialises **non-default** antigravity spawns").
- `waitUntilAborted(signal)` replaces what would otherwise be a never-settling
  `new Promise(() => {})` on the "hold until exit" paths — a long-lived daemon would otherwise
  accumulate one permanently-pending promise, plus its captured closure, per run.

**The sanitizer's pattern is grounded, not guessed.** The exact leaked shape is documented in this
same package: `auth.ts#isAntigravityAuthFailureText` matches agy v1.0.3's `Authentication required.
Please visit the URL to log in: https://accounts.google.com/o/oauth2/auth?client_id=…&redirect_uri=
antigravity-redirect`, and OD's own `chat-route.test.ts` used that literal string as its fixture
(asserting `not.toContain('accounts.google.com')`). `redactAntigravityAuthUrls` matches two
alternatives: any URL on `accounts.google.com` (host-anchored, so an upstream path change still
redacts), and any absolute URL carrying an OAuth/bearer query parameter (`client_id`,
`code_challenge`, `code_verifier`, `access_token`, `id_token`, `refresh_token`) so a change of
identity provider degrades to "redacted" rather than "leaked". Deliberately **not** keyed on the word
"oauth" appearing in a URL, which would also eat ordinary documentation links in a legitimate reply.

**Scoped to redaction, not classification.** It does not decide "this run failed auth" or substitute
sign-in guidance for the output. That already has an owner — `auth.ts`'s
`classifyAgentAuthFailure`/`antigravityAuthGuidance`. See "Open, not decided here" below.

### `@jini-ai/daemon` side (`agent-executor.ts`)

- **Compatibility**: the id guard is gone; `assessAgentExecutorCompatibility` now reads only
  `streamFormat` and prompt-delivery shape. The stale `(see packages/daemon/source-map.md for the
  deferred antigravity guard)` pointer is dropped from the unsupported-format message.
- **Log-file staging** mirrors the prompt file exactly: staged after it, before `buildArgs`,
  try/catch → `AGENT_SPAWN_FAILED` (preserving the module's "never a bare throw" Invariant), and its
  path merged into the same `RuntimeContext`.
- **Cleanup**: `cleanupPromptFile` on all three wiring contexts becomes **`cleanupStagedFiles`**, one
  composed closure covering both staged files. Deliberately not two parallel fields: they are staged
  at the same point and must be released on the same set of paths, and a second parallel field is
  exactly how one of them ends up forgotten on a path the other covers. Composed once in `run()`,
  threaded unchanged.
- **Lock**: `def.runtimeLock?.acquire({model})` before `buildArgs`. `child.once('exit',
  releaseRuntimeLock)` — `'exit'`, not `'close'`, because the lock guards state the *process* reads,
  so the process being gone is the release condition, not its stdio pipes draining (which a
  grandchild inheriting them can delay arbitrarily). Registered before the spawn-confirmation await,
  same discipline as `wireChildLifecycle`, so an instantly-exiting child cannot slip past.
  `waitForHandoff` starts only *after* spawn confirmation — before that there is no process that
  could have consumed the write. Pre-spawn/spawn-failure paths release explicitly via
  `releaseStagedResources` (there is no `'exit'` to wait for), and `releaseRuntimeLock` also aborts
  the exit signal so no watcher outlives its run.
- **Buffered stdout**: `wireChildLifecycle` reads `def.stdoutPolicy` once up front; the per-chunk
  handler is then a single boolean test. `flushBufferedStdout()` is queued from the `close` handler
  **through the same `enqueueEmit` FIFO queue** (design decision 6) and *before* `await emitQueue`,
  so the flush is ordered after every prior emit and before `finish()`'s `'end'` — bypassing that
  queue would have reintroduced the exact ordering race decision 6 closed. Empty output, and output
  the sanitizer reduces to empty, emit nothing (an empty `text_delta` is noise).

**The buffered path holds back the raw `'stdout'` echo too, and sanitizes it.** A deliberate call
worth flagging: `'stdout'` is documented in this module as an always-on raw/diagnostic channel
distinct from `'agent'`. But emitting it unsanitized while withholding the chat copy would leak the
exact string the sanitizer exists to remove to any client subscribed to the run's events — the raw
channel is a different *purpose*, not a different *audience*. OD reaches the same outcome (its own
test asserts the OAuth URL never appears in the SSE body at all). The opt-in byte `journal` is the
one place raw bytes are still recorded per chunk: "every byte received" is its documented contract,
and it deliberately lives in a **separate `EventLog` instance never replayed to run-event
subscribers** (see `continuation/journal.ts`'s module doc) — verified before deciding, not assumed.

### Open, not decided here

OD does strictly more than redact: when the buffered output matches its antigravity auth matcher it
**suppresses the buffer entirely** and emits a structured `AGENT_AUTH_REQUIRED` error instead, so the
user gets actionable sign-in guidance rather than `Please visit the URL to log in: [redacted sign-in
URL]`. Reproducing that needs an auth-classification seam `AgentExecutor` does not have for *any* def
(`classifyAgentAuthFailure` exists in `@jini-ai/agent-runtime` and is unwired here), and it is a
product-facing choice about rewriting assistant text into instructions. Flagged rather than decided
silently. What is closed here is the leak; what is open is the upgrade from "redacted" to "actionable".

Also still open, unchanged: `RuntimeContext.agentLogFilePath`'s other documented purpose — post-exit
log inspection to tell missing-auth from quota-exhausted apart — has no consumer in this module. The
file is now staged and passed, so a future classifier has something to read; nothing reads it yet.

Tests: **`@jini-ai/daemon` 620 → 648** (`agent-executor.test.ts` 159 → 187), three new `describe`
blocks — buffered/sanitized stdout (8 tests, incl. the URL deliberately split across two chunks so a
per-chunk sanitizer provably could not have caught it, mid-run "client has seen nothing on either
channel", 25-chunk FIFO ordering with live stderr interleaved, and the explicit **live-streaming
regression pin for the other 4 plain defs** using the same fixture and differing only in the absence
of `stdoutPolicy`), log-file staging (8 tests, incl. real-filesystem `0o700`-dir/no-pre-created-file
end-to-end and cleanup on all 5 pre-spawn/spawn-failure paths), and `runtimeLock` (9 tests, incl.
acquire-strictly-before-`buildArgs`, release on handoff, release on exit when handoff never settles,
release on handoff rejection, double release, and **two overlapping runs through the real
`antigravityModelLock` proving run B's `buildArgs` cannot execute until run A releases**). Two
existing tests inverted, both intentionally: the "rejects antigravity by id" pair now pins that *no
guard reads an agent id at all*, plus a new "accepts every one of the 24 registered defs" assertion.
`agent-executor.ts`: **100% statements/branches/functions/lines**. Package: 648/648,
99.74/99.66/100/99.74 (the residual `run-lifecycle.ts`/`schedule.ts` gaps are pre-existing and
untouched). **`@jini-ai/agent-runtime` 1822 → 1845**; `log-file.ts`, `defs/antigravity.ts` and
`detection.ts` all 100% on all 4 metrics; package 99.96/99.95/100/99.96 — identical to its documented
pre-change figure. `src/types.ts` stays in that package's coverage `exclude` list, re-verified as
still legitimate: `grep -nE '^(export )?(const|function|class|let|var) '` finds no runtime
declarations after these additions. `pnpm guard`: clean. `pnpm typecheck`: clean.

## 2026-07-30 addition — post-merge audit fixes (Codex gpt-5.6-sol findings on `9cb4ffc50…085c4799a`)

Full verification write-up, per finding, with the observed red/green output:
`ADS-memory/reports/post-merge-audit-2026-07-29/daemon-fix-report.md`. Findings list:
`daemon-findings.md` in that same directory. All 5 blocking and 2 of 3 non-blocking findings were real
— no false positives. Every fix landed behind a test confirmed failing first.

**`.mcp.json` is now one file per run.** `mcpServers.jini.env` carries this run's `JINI_RUN_ID` and its
bearer `JINI_DAEMON_TOKEN`, and a shared `cwd/.mcp.json` cannot hold two runs' identities at once — a
CLI loads its MCP config when it starts its client, not at spawn, so a second run in the same directory
overwrote the entry the first run's child had not read yet and that child then called back with the
*other* run's id and token. `mcpJsonPathForRun` writes `<cwd>/.mcp.jini-<runId>.json`; `cwd/.mcp.json`
is now read-only (still the merge source, so a project's own servers survive, and nothing needs
restoring); the run's file is removed through `cleanupStagedFiles` via a new
`McpJsonInjectionOptions.removeFile` seam, so a live token no longer outlives the run. Refusing the
second run instead was rejected: concurrent runs in one cwd are a documented design point (that is why
`credential` is a per-run resolver at all).

**One follow-up this leaves open, in `@jini-ai/agent-runtime` rather than here.** The run-scoped path
only reaches the child because the def passes it on — `claude.ts` emits
`--strict-mcp-config --mcp-config <runtimeContext.mcpJsonPath>`. **`codebuddy.ts`, the other
`externalMcpInjection: 'claude-mcp-json'` def, ignores `mcpJsonPath`** and relies on its CLI
auto-discovering `cwd/.mcp.json`, so a codebuddy run with `mcpJsonInjection` configured now writes a
file nothing reads. That def wants the same two flags under the same guard — deliberately not done
blind, because codebuddy's acceptance of those flags is unverified and an unsupported flag fails the
run outright, which is worse than losing tools on a path `claude.ts`'s own live 2026-07-30 note says
never worked headlessly anyway (auto-discovery needs an interactive trust prompt; the connection sat at
`"pending"` forever). Verify with one live codebuddy run, then add the flags.

**Resolved the same day, below** — the "the other 3 MCP injection mechanisms" entry closes this
exact follow-up (Gap A) plus the two mechanisms nothing implemented at all (Gaps B/C), all through
one dispatch point rather than one-off patches.

**The `'until-close'` stdout accumulator is bounded.** `DEFAULT_BUFFERED_STDOUT_MAX_BYTES` (8 MiB,
overridable via `CreateAgentExecutorOptions.bufferedStdoutMaxBytes`) — an `until-close` child can emit
indefinitely or never close, and this driver treats agent CLIs as potentially adversarial elsewhere
(SEC-001), so one run could exhaust the daemon heap and take every unrelated run with it. Whole chunks
only (no sliced multi-byte characters), everything after the first refusal dropped, and truncation is
reported in a host-authored note appended *after* the def's `sanitize` runs — a consumer redactor must
not be able to delete the line saying output is missing, and a truncated run emits even when the
sanitized text is empty.

**Nothing fallible now sits in front of `finish()`.** `buildArgs` is guarded like every other
staging→spawn step (it performs real filesystem writes — that is what `runtimeLock` exists for — so
EACCES/ENOSPC used to escape `run()` as a bare `Error`, stranding the run *and* holding the
process-global mutex forever). In all three close handlers, staged-file cleanup and the host's
`classifyFailure` are guarded by `cleanupStagedFilesSafely`/`classifyFailureSafely`: previously either
rejection took the terminal transition with it, leaving a `'running'` run whose child was already gone
and surfacing only as an unhandled rejection. The finding cited only the child-driven handler; the ACP
and pi-rpc handlers had the identical shape and the identical bug. `reportPostCloseFailure` also
absorbs a throwing `onCleanupFailure` sink. `AgentCleanupFailurePhase` gains `'staged-file-cleanup'`
and `'failure-classification'`; `AgentCleanupFailureContext.pid` widens to `number | undefined`.

**`RunLifecycle` no longer exposes uncommitted starts.** `get`/`list` await a pending `startPromise` (a
failed durable start reads as "no such run" rather than as a running one no restart could rehydrate),
and `waitForTerminal` awaits *and propagates* it before parking a waiter — which is what closes the
hang: nothing ever calls `finish()` for an unwound record, so such a waiter was previously never
resolved or rejected.

**Two smaller ones.** `FrontendSessionRegistry` keys run bindings on the attachment object, not the
session id: a session id is reusable by design (a reconnecting tab re-attaches under the same id), so a
stale handle's `detach()` used to remove the *replacement* session, its bindings, and the usability of
its still-current bind token. `createDefaultRunStartHandler` now forwards `imagePaths`,
`extraAllowedDirs` and `uploadRoot` — the same silent-drop failure mode `permissionMode` was already
documented for.

**Left as a note, not patched:** `remote-tool-bridge.ts` does not dedup on `toolUseId`, so a retried
cross-process POST appends duplicate tool events. Real, but every in-reach fix is worse than the bug:
the recorder holds only a `RunLifecycle` (no read API, so dedup could only be non-durable in-memory
state that a restart defeats), it would need per-run lifetime machinery this module has no hook for,
and `delegated-tool-bridge.ts`'s `execute()` does not dedup either — deduping one half would split two
paths this module exists to keep byte-identical. The honest fix is idempotency at the
`RunLifecycle.emit` (or transport) boundary.

Tests: **`@jini-ai/daemon` 654 → 682**, 26 files, zero failures — `agent-executor.test.ts` 189 → 210,
`frontend-session-registry.test.ts` 41 → 44, `run-lifecycle.test.ts` 53 → 56,
`run-start-handler.test.ts` 7 → 8. No test deleted or weakened; three existing `.mcp.json` tests were
updated for the genuinely-changed write path (two of them strengthened — see the report). Coverage:
package 99.85/99.93/99.64/99.85, with `agent-executor.ts`, `frontend-session-registry.ts` and
`run-start-handler.ts` all fully covered; the only residual gap is the pre-existing, deliberately
uncovered `handleInactivityTimeout` guard in `run-lifecycle.ts` that function's own doc already explains.
`pnpm typecheck` (package and `-r` workspace-wide, since two exported types changed): clean.
`pnpm guard`: clean.

## 2026-07-30 addition — the other 3 MCP injection mechanisms get wired: `acp-merge`, the two `*-env-content` strategies, and codebuddy's missing argv

The 2026-07-22 gap-3-part-2 entry above wired exactly one of the four declared
`externalMcpInjection` strategies. Its own text named the other three as future work ("a future
task wiring those two would extend `wireAcpLifecycle`'s existing `envFormat`/`mcpServers`
passthrough or `applyAgentLaunchEnv`'s env composition respectively"). A peer review then confirmed
the practical consequence: of 24 defs, only `claude` actually delivered MCP tools end to end. This
entry closes all three remaining gaps. **Adding a strategy for a currently-undeclared agent (e.g.
`codex`) was explicitly out of scope and was not done.**

**The boundary this is organised around** is per-CLI vs per-mechanism. Identity, binary, and
model/session/permission argv are genuinely bespoke and stay in each def's own `buildArgs`. MCP
staging, ACP server merging, and env-content serialisation are *mechanisms*, and each now has
exactly one implementation that every def declaring it flows through.

**Gap A — `codebuddy` (`'claude-mcp-json'`).** The executor already computed and staged the same
`.mcp.json` for it, but `defs/codebuddy.ts`'s `buildArgs` never read `runtimeContext.mcpJsonPath`,
so it was still left on the headless auto-discovery path the claude fix exists to avoid. Rather
than copy claude's branch, the flag-building moved into a shared
`@jini-ai/agent-runtime` helper — **`buildClaudeMcpConfigArgs` in `src/defs/shared.ts`** — that both
defs now call. `--strict-mcp-config` was verified as genuinely supported by CodeBuddy before being
added (its own CLI reference documents `--mcp-config <fileOrString>` and `--strict-mcp-config`,
"Only use MCP servers in --mcp-config, ignore other MCP configuration"), so codebuddy gets the same
strict-isolation guarantee as claude rather than a silently weaker one. `shared.test.ts` pins that
both defs emit byte-identical MCP argv for identical input, so a future copy-paste divergence fails
there rather than in production.

**Gap B — the 8 `'acp-merge'` defs** (devin, hermes, kilo, kimi, kiro, reasonix, trae-cli, vibe),
which were getting *zero* MCP tools, not merely a missing flag. `attachAcpSession` has always
accepted `mcpServers`; `wireAcpLifecycle` simply never passed any. Fixed once, in that shared
function (`WireAcpLifecycleContext.mcpServers` → spread into the attach call when non-empty) —
**no per-def file was touched**, because the gap was never in the defs. A 9th def declaring
`'acp-merge'` is covered automatically. Each entry's `env` is emitted as a plain object so
`buildAcpSessionNewParams` keeps owning the array-vs-map wire-shape fork (reasonix declares
`acpMcpEnvFormat: 'map'`).

**Gap C — `'opencode-env-content'` / `'mimo-env-content'`.** Two labels, one serialiser: MiMo's own
def doc already stated it consumes the same JSON schema as OpenCode's, differing only in env-var
namespace, and the tests pin that the emitted content is byte-identical modulo the run id. The
difference is one row in `ENV_CONTENT_VAR_BY_STRATEGY` (`OPENCODE_CONFIG_CONTENT` /
`MIMOCODE_CONFIG_CONTENT`), not a second code path. `mergeEnvContentMcpConfig` applies the same
"merge, never clobber" discipline `mergeMcpJsonContent` does, and for a sharper reason: a host may
already be handing the CLI the *user's* configured MCP servers through that very variable.

**One dispatch point, one credential.** `buildMcpBridgeDelivery` (pure, exported) is the single
place a declared strategy maps to a mechanism, returning a discriminated `McpBridgeDelivery` so a
consumer cannot read another mechanism's payload. `run()` resolves the per-run bearer credential
exactly once, before `buildArgs`, and hands it to whichever serialiser applies; a rejecting resolver
still fails the run before spawn. Keyed off the *strategy*, never off `def.id` — a registry-level
test asserts every real def declaring a strategy gets a non-null delivery, so a 25th def with an
unhandled strategy fails there.

**Security.** The credential reaches every mechanism through an *environment*, never through
process arguments (`ps` is readable by other local users): `.mcp.json`'s `env`, the ACP server
descriptor's `env` (which the ACP agent applies to the MCP child it spawns), and the env-content
config's `environment` key — itself carried in the spawned CLI's own env var, deliberately not a
`-c key=value`-style CLI argument. Three dedicated tests assert the secret is absent from argv while
still present where it must be, including one driving a real subprocess.

**Files changed.** `@jini-ai/agent-runtime`: `src/defs/shared.ts` (new
`buildClaudeMcpConfigArgs`), `src/defs/claude.ts` and `src/defs/codebuddy.ts` (both call it).
`@jini-ai/daemon`: `src/agent-executor.ts` (new `buildAcpMcpBridgeServers`,
`ENV_CONTENT_VAR_BY_STRATEGY`, `mergeEnvContentMcpConfig`, `McpBridgeDelivery`,
`buildMcpBridgeDelivery`; `writeMcpJsonForRun` narrowed to consume an already-built delivery;
`wireAcpLifecycle` gained `mcpServers`; `run()` composes `childEnv`). `McpJsonInjectionOptions`
keeps its name for API compatibility with `@jini-ai/server`'s `agentExecutor` passthrough even
though it is no longer `.mcp.json`-specific — a naming-debt item, deliberately not renamed here.
Reconciled the same session with the run-scoped-path fix above: `buildMcpBridgeDelivery`'s
`'claude-mcp-json'` case calls `mcpJsonPathForRun`, not a shared `cwd/.mcp.json`, so the
cross-run credential leak that fix closed stays closed under the generalized dispatch too;
`writeMcpJsonForRun` takes `cwd` as an explicit param so it still reads the project's own
`.mcp.json` as its merge base while writing the run-scoped path.

**Tests / verification, run this session.** `@jini-ai/agent-runtime` **1848 → 1858**
(`defs/__tests__/shared.test.ts` +5, `defs/__tests__/codebuddy.test.ts` +5). `@jini-ai/daemon`
**654 → 687** (`__tests__/agent-executor.test.ts` +30 across `buildAcpMcpBridgeServers`,
`mergeEnvContentMcpConfig`, `buildMcpBridgeDelivery`, the ACP passthrough block and the env-content
block; `__tests__/agent-executor-acp.integration.test.ts` +3). Nothing existing regressed. The three
integration additions are the closest available analogue to the live smoke check that verified the
claude fix: the existing ACP fixture — a **real spawned Node subprocess** speaking real ACP JSON-RPC
over real stdio, through the real `attachAcpSession` — now echoes back the `mcpServers` its own
`session/new` received, so delivery is asserted from the agent's point of view rather than from a
stubbed attach call, in both `array` and `map` env formats. No vendor CLI or credentials were
needed, and none of the 24 real agent CLIs were spawned. `tsc --noEmit` and `tsc -p tsconfig.json`
(build): clean for both packages; root `pnpm -r typecheck`: clean.
