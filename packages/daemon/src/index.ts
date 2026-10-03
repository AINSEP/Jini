/**
 * @module @jini-ai/daemon
 *
 * `RunLifecycle` + the durable `EventLog` kernel port (extraction-plan §8
 * task 5), plus the `ToolExecutor` tool-execution boundary (extraction-plan
 * §2.5 / §8 task 6), and `AgentExecutor` — the driver that wires
 * `@jini-ai/agent-runtime` into `RunLifecycle` (extraction-plan §2.1 / §3).
 * See `archived provenance ledger` for full provenance and scope-decision notes.
 *
 * The generic `ArtifactStore` kernel port used to live here too — moved to its own
 * `@jini-ai/artifacts` package on 2026-07-19 (see `tokens.ts`'s doc comment).
 *
 * `routines/` (2026-07-21) adds the `RoutineService` scheduler (DST-safe wall-clock schedule
 * math, race-safe scheduled-slot persistence) and the `RoutineStore` CRUD + run-history port,
 * mirroring `EventLog`'s kernel-owned, storage-injected precedent. See its own module doc and
 * `archived provenance ledger`'s dated section for provenance.
 *
 * `terminal-session.ts` (2026-07-21) adds the interactive-terminal session manager: a
 * `node-pty`-backed `PtySpawn` wired into `@jini-ai/platform`'s generic `TerminalService`, plus
 * session-ownership gating and the kill/write/resize lock `@jini-ai/daemon/http`'s `terminals.ts` route
 * pack calls into. This is this workspace's first native-compiled-addon dependency — see this
 * package's `package.json` and `archived provenance ledger`'s dated section.

 * Archived provenance rationale:
 * ## Design decisions (judgment calls the task brief explicitly asked for)
 *
 * **1. `RunLifecycle` does not spawn or signal subprocesses.** OD's `cancel()`
 * (`runs.ts:361-401`) does real tiered signal escalation (ACP `.abort()` → RPC
 * grace → `SIGTERM` on the process group → grace → `SIGKILL`, all
 * env-var-tunable). That is deeply subprocess/agent-CLI-adapter-specific and is
 * explicitly `@jini/agent-runtime`'s territory (task 7), not this task's. This
 * package's `cancel()` only records intent (`cancelRequested` + notifies
 * `onCancelRequested` listeners, an `AbortSignal`-shaped but framework-neutral
 * callback registry) and never itself forces a terminal transition — a driver
 * observes the signal and calls `finish()` once it knows the real outcome,
 * exactly mirroring OD's actual invariant that `finish()`/`design.runs.finish`
 * is the only path to a terminal state, called from the child's real `close`
 * event, never synchronously from `cancel()` itself.
 *
 * **2. `resume()` is a generalization, not a literal port.** OD has two
 * unrelated "resume" concepts (see the research notes cited in the handoff
 * report): (a) resuming the *external agent CLI's own* session via
 * `--resume <id>`/ACP `session/load`, persisted in OD's SQLite schema — a
 * real subprocess/vendor-CLI concern out of scope here — and (b) a
 * `run.resumable` flag surfaced to the client so a *next user turn* can invoke
 * (a). Neither is "resume an interrupted daemon-side run object" — that
 * concept doesn't exist in OD. `@jini/daemon`'s `resume()` builds that concept
 * fresh: a terminal run with `resumable: true` (set by whoever called
 * `finish()`) can transition back to `'running'` on the **same `runId`**,
 * continuing the **same `EventLog` cursor sequence** unbroken — no new `'start'`
 * event, no cursor reset. This was a deliberate choice to make `resume()`
 * meaningful and testable at the kernel layer without a real subprocess/session
 * concept to hang it on; see `characterization.test.ts` for the two-segment
 * proof (start→agent*→end(failed,resumable)→resume→agent*→end(succeeded), ids
 * monotonically increasing across the whole thing).
 *
 * **3. No `RunStore` port was extracted.** Extraction-plan §2.2's illustrative
 * composition example lists `RunStore` and `EventLog` as siblings a pack
 * depends on. This task's charter (§8 task 5) names only `RunLifecycle` +
 * `EventLog` as deliverables. `RunLifecycle`'s own run-status registry
 * (`Map<runId, RunRecord>`) is therefore an internal implementation detail of
 * this package's `createRunLifecycle`, not a separately swappable port — a
 * persistent run registry (surviving a daemon restart, not just an event
 * replay) is not implemented. **Flagged as a real follow-up**: a future task
 * (likely task 8, alongside the `@jini/sqlite` durable `EventLog` adapter)
 * should decide whether `RunLifecycle`'s registry needs its own `RunStore`
 * port for restart-durability parity with §2.2's example, or whether
 * `RunLifecycle` itself becomes the thing `@jini/sqlite` backs directly.
 *
 * **4. The `RunState`/`RunEndPayload.status` spelling mismatch is bridged, not
 * fixed.** `@jini/protocol`'s `RunState` uses `'cancelled'` (2 L) while
 * `RunEndPayload.status` uses `'canceled'` (1 L) — this is extraction-plan §12
 * C5's own cited vocabulary-firewall canary, already present in `@jini/protocol`
 * before this task started. `packages/protocol` is explicitly out of scope for
 * this task, so `run-lifecycle.ts` bridges the two spellings with an explicit
 * `TERMINAL_OUTCOME_TO_END_STATUS` lookup table (with a comment citing this)
 * rather than silently letting them drift or fixing the upstream package.
 * `run-lifecycle.test.ts`'s finish() test asserts the bridge explicitly.
 *
 * **5. Driver-emittable events are a closed, explicit union
 * (`DriverEmittableInput`)**, not `RunProtocolEvent` minus `'start'`/`'end'`
 * derived mechanically — `'start'` is only ever produced by `start()`, `'end'`
 * only by `finish()`; a driver calling `emit()` can only ever produce
 * `'agent'`/`'stdout'`/`'stderr'`/`'error'`. This mirrors OD's actual invariant
 * (`'start'` emitted once by the engine right before spawn, `'end'` only from
 * `design.runs.finish`) as a compile-time-enforced contract rather than a
 * runtime convention.
 *
 * **6. `emit()` throws (fails fast) on an unknown or already-terminal run**,
 * rather than silently no-op'ing. OD's own code pattern is the caller checking
 * `run.cancelRequested || design.runs.isTerminal(run.status)` defensively
 * *before* emitting (repeated ~10 times in `start-chat-run.ts` per the
 * research), i.e. OD treats "don't emit after terminal" as the caller's job,
 * not something `emit()` itself silently absorbs. This package makes that the
 * same explicit contract, but surfaces a violation as a thrown error (a driver
 * bug) instead of a silently-observed defensive check, per this codebase's
 * fail-fast-defaults convention.
 *
 * **7. A cancel listener that subscribes after `cancel()` already fired still
 * receives the notification immediately** (`onCancelRequested` replays the
 * last request if `cancelRequested` is already true at subscribe time). This
 * was found and fixed during this task's own mandatory score-skepticism pass
 * (a plain forward-only listener registry has no memory of past firings, so a
 * driver attaching late — e.g. after being constructed asynchronously — would
 * otherwise silently never learn a cancellation was already requested). No OD
 * equivalent exists to compare against; this is new, `AbortSignal`-inspired
 * behavior.
 *
 * ## New home decision
 *
 * Ranked alongside `RunLifecycle`/`EventLog` in `@jini/daemon` because, like
 * those, it is a daemon-startup-lifecycle concern — the origin's own doc
 * comment states it runs "at module import time in server.ts, before
 * `openDatabase` opens SQLite," i.e. before any daemon service starts, which is
 * exactly this package's charter ("stateful" lifecycle, not a pure-interfaces
 * package like `@jini/core`).
 *
 * ### Design decisions
 *
 * **1. Authorization vs. confirmation are two distinct gates, not one.**
 * `ToolPolicy.authorize` (owned by the tool's registration) answers "is this
 * principal permitted to use this tool at all" — a rule-based decision.
 * `ExecutionDelegate.onConfirm` (owned by the transport, only consulted when
 * `ToolDescriptor.requiresConfirmation` is set) answers "does the user want
 * to proceed with *this specific* invocation right now" — an interactive,
 * per-call gate. `ExecutionDelegate.onAuthorize` exists too, but only as an
 * additional veto *after* the policy already allows (e.g. "does this session
 * actually hold an active grant") — it can turn an `'allow'` into a `'deny'`,
 * never the reverse, and is never consulted when the policy itself denies
 * (tested explicitly).
 *
 * **2. Confirmation resumability is a real parked Promise, not a polling
 * flag.** When `ExecutionDelegate.onConfirm` doesn't supply a decision
 * synchronously (returns/resolves `undefined`), `execute()`'s returned
 * Promise is parked on an internal `Map<executionId, resolve>` and simply
 * does not settle — `resumeConfirmation(executionId, decision)` is the only
 * thing that can settle it, and it can be called from a completely separate
 * tick/request, arbitrarily far in the future, no polling required. This is
 * the concrete answer to "the headless kernel can't prompt, so the transport
 * injects an `ExecutionDelegate`": the kernel (`ToolExecutor`) never renders
 * anything; it hands the transport a notification (the `onConfirm` call) and
 * waits indefinitely for `resumeConfirmation`, exactly the shape a real UI
 * approval flow needs. One documented sharp edge: an `async` `onConfirm`
 * that itself resolves to `undefined` is treated as "the decision is
 * `undefined`" (i.e. denied) rather than "pending," since the code can only
 * tell "no decision yet" apart from "the Promise's inner value happens to be
 * undefined" by checking whether `onConfirm`'s *own return value* is
 * `undefined` before awaiting it — documented on the interface, not
 * silently surprising.
 *
 * **3. Output truncation is a text-output concern, not a general
 * serialization limit.** `ToolDescriptor.maxOutputBytes` only truncates a
 * `string` handler result exceeding that length; non-string (structured)
 * output passes through untouched even when the limit is set. A real
 * byte-accurate UTF-8 truncation or a generic-JSON-payload cap was judged
 * out of scope for this task's gate ("output truncation" — proven, not
 * maximally engineered) — a reasonable follow-up if a real tool handler
 * starts returning large structured payloads.
 *
 * **4. `execute()` throws (doesn't return a status) for an unknown tool
 * id.** Denial/confirmation-denial/timeout/cancellation/failure are all
 * legitimate business-domain outcomes modeled as `ToolExecutionResult`
 * variants; calling `execute()` with a `toolId` nothing registered is a
 * routing/programming bug, not a business outcome, so it's a thrown `Error`
 * instead — the same distinction OD's own `RunLifecycle`-equivalent code in
 * this package (`requireRun`) already draws between "unknown id" (throw) and
 * "legitimate terminal state" (return value).
 *
 * **5. No persistence.** Like `EventLog`'s in-memory reference
 * implementation, `createToolExecutor`'s audit records and pending-
 * confirmation state live only in the process; a real host that needs audit
 * records to survive a restart, or confirmation to resume across a daemon
 * restart, layers a durable store behind `getAuditRecord`/`resumeConfirmation`
 * later. Out of this task's scope (the gate is "one allowed + one denied
 * tool call, resumable confirmation, timeout, cancellation, output
 * truncation, and an audit record — no HTTP involved," which this satisfies
 * in-process).
 *
 * **6. A `finally` block was deliberately avoided around the handler's
 * try/catch.** An early draft cleaned up the timeout handle and the active-
 * `AbortController` map entry in a `finally` clause; istanbul/v8 instruments
 * try/finally with a synthetic "abrupt completion through finally" branch
 * that is unreachable here (nothing in the catch block can itself throw a
 * second exception past the catch), which the coverage-driven pass (Phase
 * 6.5) couldn't close without a contrived test. Repeating the two-line
 * cleanup at each of the try/catch's own return points instead avoided
 * introducing that uncoverable branch — a "dead branch, refactor away"
 * call, same discipline as the agent-protocol port's (Part 1) precedent.
 *
 * ### Design decisions
 *
 * **1. `resumable` is always `false` in v1.** `RunRetryFailureSignal` (the
 * richer classification `decideSafeRunRetry`, in `run/core/retry.ts`,
 * consumes) has no producer anywhere in this codebase — OD's real
 * ~20-vendor-CLI text-matching failure classifier
 * (`run-failure-classification.ts`, researched but never ported; see this
 * file's earlier "Not ported" section) was deliberately excluded as its own
 * substantial, unscoped task. Every `lifecycle.finish()` call
 * `AgentExecutor` makes — pre-spawn guard failures, spawn errors, and the
 * real `child.on('close', ...)` terminal transition alike — passes
 * `resumable: false`. A blanket "not retryable" default is the only honest
 * answer without a classifier; building one is a separate, unscoped
 * follow-up, not attempted here.
 *
 * **2. `turn_end` is not forwarded as an `'agent'` event, and v1 has no
 * multi-turn stdin-injection loop.** `turn_end` is Claude-stream-specific
 * (synthesized from an assistant message's `stop_reason`) and has no
 * `RunAgentPayload` variant — `translateAgentRuntimeEvent` routes it to a
 * `'turn-end'` translation kind that `run()` reacts to directly (closing
 * stdin) rather than durably recording. **v1 unconditionally closes stdin on
 * the first `turn_end` regardless of `stopReason`** — including
 * `stop_reason: 'tool_use'`, which in a real multi-turn caller would instead
 * inject the tool's result back into the same open stdin and keep the turn
 * going. Without that injection loop, a `tool_use`-ending turn's stdin still
 * closes (rather than hanging forever waiting for a continuation that will
 * never come); the agent CLI is responsible for deciding how to behave when
 * its stdin closes mid-tool-use, which each of the 9 defs already handles
 * via its own inactivity/EOF behavior. Building the real tool-continuation
 * loop needs `ToolExecutorToken` wiring (deciding what to send back) and is
 * explicitly out of this task's scope — see the plan's "Explicitly out of
 * scope" section.
 *
 * **3. Session-resume ids are an intentional, documented drop.** Some
 * parsers attach a resumable session handle to their `status` event
 * (OpenCode's `sessionID`, Codex's `thread_id`/`sess-*`, Qoder's
 * `session_id`+`qodercliVersion`) — `translateAgentRuntimeEvent`'s `status`
 * case only carries `label`/`model`/`ttftMs`/`detail` (the fields
 * `RunAgentPayload`'s `status` variant actually declares), so these ids are
 * silently dropped at translation time. This is unrelated to
 * `RunLifecycle.resume()`, which is run-level (does the daemon-side run
 * object transition back to `'running'`), not CLI-conversation-level (does
 * the underlying agent CLI continue its own multi-turn session) — persisting
 * and replaying these ids into a real `--resume`/`session/load` call on a
 * later turn is a downstream chat-composition concern with no current owner
 * in this codebase, matching the same "not this package's charter" boundary
 * this file's earlier §2's "resume" design decision draws.
 *
 * **4. `translateAgentRuntimeEvent`'s `usage` payload drops every sub-field
 * `RunAgentPayload`'s narrow `usage` variant has no room for.** The 4 parsers
 * attach `thought_tokens`, `cached_read_tokens`/`cached_write_tokens`
 * (opencode/gemini/codex), `modelUsage`/`stopReason`/`isError` (qoder), and a
 * top-level `stopReason` (claude/copilot) that `RunAgentPayload['usage']`
 * (only `usage?: {input_tokens?, output_tokens?}`, `costUsd?`, `durationMs?`)
 * has no field for — dropped, not silently miscoerced. Widening
 * `RunAgentPayload`'s `usage` shape to carry these is a `@jini/protocol`
 * change, out of this task's scope (protocol is a separate package with its
 * own owner).
 *
 * **5. `error` events carry a minimal `RunErrorPayload`** — `{message}`,
 * plus `error: {code, message}` only when the parser attached a string
 * `code` (currently only claude's error event does). The `raw` field some
 * parsers attach (opencode/gemini/qoder — a stringified copy of the whole
 * original event, for debugging) is not folded into the error payload; kept
 * minimal rather than speculatively enriched.
 *
 * **6. Every `lifecycle.emit()` call is funneled through a per-run FIFO
 * queue (`enqueueEmit`, private to `wireChildLifecycle`), not fired
 * independently.** A single stdout `data` chunk can synchronously produce
 * several parsed events (one JSON line's `feed()` call may invoke a stream
 * parser's `onEvent` more than once — e.g. Codex's `item.completed` firing
 * both a `tool_use` guard-check and a `tool_result`), and successive `data`
 * events must not have their derived `emit()` calls race each other out of
 * order. Each queued task is individually try/caught (a single failing
 * `emit()` — e.g. a race against an already-terminal run — does not block
 * delivery of subsequently queued events), and the `close` handler awaits
 * the queue fully drained before computing the terminal outcome, so
 * `finish()`'s `'end'` event is always durably last.
 *
 * **7. Cancellation escalates the child's full descendant process tree, not
 * just the direct child.** `@jini/platform`'s `collectProcessTreePids`
 * (cross-platform: POSIX `ps` / Windows `Get-CimInstance`) plus
 * `stopProcesses` (SIGTERM → poll-wait → SIGKILL escalation) were both
 * previously completely unused — zero callers anywhere in this codebase —
 * despite being an exact fit; `AgentExecutor` is their first real caller.
 * This catches MCP-server/tool-subprocess descendants an OD-style
 * POSIX-process-group-only kill would miss.
 *
 * **8. Native-agent authorization and Jini tool execution are two explicit
 * paths.** ACP's `onPermissionRequest` seam receives the tool-call metadata and
 * offered option ids before the ACP agent executes its own tool; without an
 * injected policy it fails closed, while a runnable host records and chooses an
 * offered allow/reject/cancel outcome. The
 * autonomous JSON-stream CLIs still report `tool_use` only after their internal
 * execution, so their telemetry remains observational. Separately,
 * `createDelegatedToolBridge` is the actual Jini-tool path: it emits a matching
 * run event pair around `ToolExecutor.execute`, so registry policy,
 * confirmation, timeout, cancellation, and the executor audit all apply. It is
 * transport-neutral by design; an MCP or other server must decode a concrete
 * delegated request before calling it.
 *
 * ## 2026-07-22 addition — terminal/PTY route pack: `pnpm guard` re-run, and `node-pty`'s missing Linux prebuild — a real deployment decision, not a bare flag
 *
 * The 2026-07-21 `terminal-session.ts` addition above flagged the `node-pty` Linux-prebuild gap but
 * left it as "undiscovered rather than mitigated" pending a real decision. This pass makes that
 * decision, backed by evidence gathered in this session, not assumption:
 *
 * **`pnpm guard`, actually run this session** (it had not been, per this task's own open-items
 * list): root `pnpm guard` (scans all of `packages/@jini/**`, including `terminal-session.ts`) — zero
 * violations. No R1–R7 boundary/neutrality/sprawl issues in this file.
 *
 * **The decision.** This repo's own `ADS-memory/reports/jini-port/START-HERE.md` states the architecture plainly:
 * *"Jini is a headless daemon"* — a long-running Node server process, the deployment shape that
 * overwhelmingly means a Linux host (container or bare server) in practice, not a developer's own
 * macOS/Windows machine. `node-pty@1.1.0`'s npm tarball bundles prebuilt native addons for
 * `darwin-arm64`/`darwin-x64`/`win32-arm64`/`win32-x64` but ships **no `linux-*` prebuild** — on a
 * Linux install, `node-pty`'s own `install` script falls back to `node-gyp rebuild`, which needs a
 * C/C++ toolchain (python3/make/a C compiler) present at `pnpm install` time.
 *
 * **Empirically verified in this exact session**, not inferred from reading `node-pty`'s source: this
 * task's own `pnpm install` ran on a real Linux (x64) sandbox with a standard build toolchain present
 * and the fallback **worked correctly and automatically** — `node-gyp rebuild` compiled
 * `pty.node` from source (`CXX(target) Release/obj.target/pty/src/unix/pty.o` →
 * `SOLINK_MODULE(target) Release/obj.target/pty.node`, `gyp info ok`) with zero manual intervention
 * beyond the `pnpm.onlyBuiltDependencies` allow-list entry the 2026-07-21 addition already added
 * (without that entry, pnpm's supply-chain-safety default silently skips native postinstall scripts
 * entirely and this fallback would never run at all — confirmed by that entry already being present
 * in this checkout's root `package.json` before this pass touched anything).
 *
 * **Decision: accept the gap, with a documented, actionable requirement — not a code fallback.**
 * Build-from-source *is* the fallback (already the default, already proven working end-to-end this
 * session); nothing further needs to be built. What was missing was making the requirement this
 * implies for a deployer explicit rather than silent: **a Linux host deploying this daemon must
 * have a C/C++ build toolchain (`python3`, `make`, a C compiler — e.g. Debian/Ubuntu's
 * `build-essential` package) available at `pnpm install` time.** This is *not* satisfied by a
 * minimal/`slim`/`alpine`-family base image out of the box (those deliberately omit build tooling to
 * stay small) — a deploying host must either use a base image that already includes one (e.g. the
 * non-slim `node:*-bookworm` family) or install the toolchain as an explicit build-stage step before
 * `pnpm install`. No CI configuration exists anywhere in this repo to encode this in (confirmed: no
 * `.github/workflows` directory) — this paragraph, plus the 2026-07-21 addition's own flag above, is
 * this decision's durable record until a real deployment/CI configuration task exists to encode it
 * as an executable check instead of documentation. Rejected alternatives: vendoring a prebuilt
 * `linux-x64`/`linux-arm64` `.node` binary into this repo (adds binary artifacts + a maintenance
 * burden for a native addon this package doesn't own) and pinning an older `node-pty` version that
 * might ship a Linux prebuild (checked — no version in this package's supported range ships one;
 * Linux users of `node-pty` upstream are documented to be expected to build from source).
 *
 * ## 2026-07-22 addition — two independent retry classifiers reconciled at merge time (audit fix, AUD-002)
 *
 * A second cloud session, working in parallel on a branch (`fix/audit-6-fixes-20260722`) that forked
 * before the paragraph above landed, independently built its **own** answer to the identical gap-4
 * problem: `classifyProcessExitFailure` + `defaultClassifyFailure`, both new exports added directly to
 * `agent-executor.ts`, with a **materially different policy** — only `signal === 'SIGPIPE'` was
 * classified retryable (`upstream_unavailable`/`network_error`); every other signal, including
 * `SIGKILL`/`SIGTERM`, was `process_exit`/`signal_killed` and explicitly **not** retryable. Because
 * this branch touched a file `main` had not (a different file than the `run/core/retry.ts` location
 * above), a raw `git merge` would have combined both silently with no conflict marker at all — two
 * same-shaped, contradictorily-behaving classifiers coexisting in the tree, one of them dead code by
 * accident of which line happened to get wired last. A deep-dive audit
 * (`ADS-memory/reports/audit-fastify-merge-and-six-gap-fixes-2026-07-22.md`, AUD-002) caught this
 * before it landed.
 *
 * **Decision made at merge time: keep this file's `run/core/retry.ts` version; delete the branch's
 * `agent-executor.ts` duplicate.** Reasoning: the branch's SIGPIPE-only policy is more conservative
 * but misses the single most common real-world signal-kill scenario this classifier exists for — an
 * OS/container OOM killer or infra-level eviction sending `SIGKILL` to a healthy process, which is
 * presumptively transient and exactly the case worth retrying. The broader "any signal is
 * presumptively transient" policy this file already documents does risk retrying a genuine crash
 * signal (e.g. `SIGSEGV`) that a retry won't fix, but the blast radius of that miss is small and
 * bounded: `DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS = 1`, so the cost of being too permissive here is at
 * most one wasted extra attempt, while the cost of the branch's more conservative policy is silently
 * never retrying the dominant legitimate case. `agent-executor.ts`'s own `classifyProcessExitFailure`/
 * `defaultClassifyFailure` exports and their dedicated tests were removed as part of this merge;
 * `FailureClassificationContext`'s `code`/`signal`-only scope note is unaffected (both
 * implementations agreed on that boundary — see this file's now-single classifier for the reasoning).
 *
 * Also merged in from the same branch, independent of the classifier question: real `sideEffects`
 * wiring (`userVisibleOutputSeen`/`toolCallSeen`, derived live from the translated agent-event stream
 * in all three `wire*Lifecycle` drivers) so two of `decideSafeRunRetry`'s four side-effect-suppression
 * guards are now genuinely exercised, not permanently dead code — see `resumableFromProcessExit`'s own
 * doc in `retry.ts` for exactly which two, and why `artifactWriteSeen`/`liveArtifactSeen` still
 * cannot be (no `'artifact'`/`'live_artifact'` event kind exists anywhere in `@jini/protocol`'s
 * `RunAgentEventPayload` union today — a real protocol gap, not an oversight; see this repo's own
 * "A2UI full protocol deferred" scope note). `attemptCount` stays a documented, correct `0`: no
 * automatic same-run retry loop exists anywhere in this codebase yet (gap 4's `resumable` flag is
 * read-only metadata for a host's own later follow-up run, not an auto-retry trigger — see
 * `resumableFromProcessExit`'s doc), so every real call to this classifier genuinely is evaluating a
 * first and only attempt; a future auto-retry loop would need to supply its own real count.
 *
 * **Verified, personally, this session**: `pnpm --dir packages/daemon exec tsc --noEmit` clean;
 * `pnpm --dir packages/daemon run test:coverage` — all tests pass, `retry.ts` and `agent-executor.ts`
 * both 100/100/100/100 after the branch's duplicate export and its 8 dedicated unit tests were
 * removed and the 3 `wire*Lifecycle` drivers' new side-effect tracking got its own coverage.
 *
 * ### The decision: def-declared fields, not an id branch
 *
 * `PROP-plain-format-agent-driving-2026-07-21.md`'s open question 6 asked whether antigravity's
 * divergence stays "an id-keyed special case inside `@jini-ai/daemon` (mirroring OD's own choice to
 * hardcode `def.id === 'antigravity'` in `server.ts`)" or gets a `RuntimeAgentDef`-level field (its
 * "Option C"). **Option C, deliberately** — and the evidence is not a style preference:
 *
 * - `RuntimeAgentDef` already carries **14** optional behavior flags/hooks the executor reads
 *   generically (`promptViaFile`, `promptViaStdin`, `resumesSessionViaCli`,
 *   `capturesSessionIdFromStream`, `resumesSessionViaAcpLoad`, `externalMcpInjection`, `authProbe`,
 *   `acpMcpEnvFormat`, `defaultModelEnvVar`, `inactivityTimeoutMs`, `maxPromptArgBytes`,
 *   `supportsCustomModel`, `promptInputFormat`, `promptViaStdin`'s `permissionMode`-aware `buildArgs`).
 * - There was **zero** precedent anywhere in this package for the executor branching on a literal
 *   agent id to decide *behavior* — the antigravity rejection was the only id branch at all, and it
 *   decided *support*, not behavior.
 * - OD's `server.ts` hardcodes `def.id === 'antigravity'` twice; §2d of the same proposal already
 *   records that OD's *prompt-delivery* call sites, by contrast, key only off declared fields with
 *   zero id branches. The field-driven half is the half that generalized cleanly.
 *
 * Consequence worth stating plainly: a second CLI with either property (prints a secret on stdout and
 * exits 0; or mutates process-global state its own startup reads back) needs **no new executor code**.
 *
 * ## 2026-07-30 addition — post-merge audit fixes (Codex gpt-5.6-sol findings on `9cb4ffc50…085c4799a`)
 *
 * Full verification write-up, per finding, with the observed red/green output:
 * `ADS-memory/reports/post-merge-audit-2026-07-29/daemon-fix-report.md`. Findings list:
 * `daemon-findings.md` in that same directory. All 5 blocking and 2 of 3 non-blocking findings were real
 * — no false positives. Every fix landed behind a test confirmed failing first.
 *
 * **`.mcp.json` is now one file per run.** `mcpServers.jini.env` carries this run's `JINI_RUN_ID` and its
 * bearer `JINI_DAEMON_TOKEN`, and a shared `cwd/.mcp.json` cannot hold two runs' identities at once — a
 * CLI loads its MCP config when it starts its client, not at spawn, so a second run in the same directory
 * overwrote the entry the first run's child had not read yet and that child then called back with the
 * *other* run's id and token. `mcpJsonPathForRun` writes `<cwd>/.mcp.jini-<runId>.json`; `cwd/.mcp.json`
 * is now read-only (still the merge source, so a project's own servers survive, and nothing needs
 * restoring); the run's file is removed through `cleanupStagedFiles` via a new
 * `McpJsonInjectionOptions.removeFile` seam, so a live token no longer outlives the run. Refusing the
 * second run instead was rejected: concurrent runs in one cwd are a documented design point (that is why
 * `credential` is a per-run resolver at all).
 *
 * **One follow-up this leaves open, in `@jini-ai/agent-runtime` rather than here.** The run-scoped path
 * only reaches the child because the def passes it on — `claude.ts` emits
 * `--strict-mcp-config --mcp-config <runtimeContext.mcpJsonPath>`. **`codebuddy.ts`, the other
 * `externalMcpInjection: 'claude-mcp-json'` def, ignores `mcpJsonPath`** and relies on its CLI
 * auto-discovering `cwd/.mcp.json`, so a codebuddy run with `mcpJsonInjection` configured now writes a
 * file nothing reads. That def wants the same two flags under the same guard — deliberately not done
 * blind, because codebuddy's acceptance of those flags is unverified and an unsupported flag fails the
 * run outright, which is worse than losing tools on a path `claude.ts`'s own live 2026-07-30 note says
 * never worked headlessly anyway (auto-discovery needs an interactive trust prompt; the connection sat at
 * `"pending"` forever). Verify with one live codebuddy run, then add the flags.
 *
 * **Resolved the same day, below** — the "the other 3 MCP injection mechanisms" entry closes this
 * exact follow-up (Gap A) plus the two mechanisms nothing implemented at all (Gaps B/C), all through
 * one dispatch point rather than one-off patches.
 *
 * **The `'until-close'` stdout accumulator is bounded.** `DEFAULT_BUFFERED_STDOUT_MAX_BYTES` (8 MiB,
 * overridable via `CreateAgentExecutorOptions.bufferedStdoutMaxBytes`) — an `until-close` child can emit
 * indefinitely or never close, and this driver treats agent CLIs as potentially adversarial elsewhere
 * (SEC-001), so one run could exhaust the daemon heap and take every unrelated run with it. Whole chunks
 * only (no sliced multi-byte characters), everything after the first refusal dropped, and truncation is
 * reported in a host-authored note appended *after* the def's `sanitize` runs — a consumer redactor must
 * not be able to delete the line saying output is missing, and a truncated run emits even when the
 * sanitized text is empty.
 *
 * **Nothing fallible now sits in front of `finish()`.** `buildArgs` is guarded like every other
 * staging→spawn step (it performs real filesystem writes — that is what `runtimeLock` exists for — so
 * EACCES/ENOSPC used to escape `run()` as a bare `Error`, stranding the run *and* holding the
 * process-global mutex forever). In all three close handlers, staged-file cleanup and the host's
 * `classifyFailure` are guarded by `cleanupStagedFilesSafely`/`classifyFailureSafely`: previously either
 * rejection took the terminal transition with it, leaving a `'running'` run whose child was already gone
 * and surfacing only as an unhandled rejection. The finding cited only the child-driven handler; the ACP
 * and pi-rpc handlers had the identical shape and the identical bug. `reportPostCloseFailure` also
 * absorbs a throwing `onCleanupFailure` sink. `AgentCleanupFailurePhase` gains `'staged-file-cleanup'`
 * and `'failure-classification'`; `AgentCleanupFailureContext.pid` widens to `number | undefined`.
 *
 * **`RunLifecycle` no longer exposes uncommitted starts.** `get`/`list` await a pending `startPromise` (a
 * failed durable start reads as "no such run" rather than as a running one no restart could rehydrate),
 * and `waitForTerminal` awaits *and propagates* it before parking a waiter — which is what closes the
 * hang: nothing ever calls `finish()` for an unwound record, so such a waiter was previously never
 * resolved or rejected.
 *
 * **Two smaller ones.** `FrontendSessionRegistry` keys run bindings on the attachment object, not the
 * session id: a session id is reusable by design (a reconnecting tab re-attaches under the same id), so a
 * stale handle's `detach()` used to remove the *replacement* session, its bindings, and the usability of
 * its still-current bind token. `createDefaultRunStartHandler` now forwards `imagePaths`,
 * `extraAllowedDirs` and `uploadRoot` — the same silent-drop failure mode `permissionMode` was already
 * documented for.
 *
 * **Left as a note, not patched:** `remote-tool-bridge.ts` does not dedup on `toolUseId`, so a retried
 * cross-process POST appends duplicate tool events. Real, but every in-reach fix is worse than the bug:
 * the recorder holds only a `RunLifecycle` (no read API, so dedup could only be non-durable in-memory
 * state that a restart defeats), it would need per-run lifetime machinery this module has no hook for,
 * and `delegated-tool-bridge.ts`'s `execute()` does not dedup either — deduping one half would split two
 * paths this module exists to keep byte-identical. The honest fix is idempotency at the
 * `RunLifecycle.emit` (or transport) boundary.
 *
 * Tests: **`@jini-ai/daemon` 654 → 682**, 26 files, zero failures — `agent-executor.test.ts` 189 → 210,
 * `frontend-session-registry.test.ts` 41 → 44, `run-lifecycle.test.ts` 53 → 56,
 * `run-start-handler.test.ts` 7 → 8. No test deleted or weakened; three existing `.mcp.json` tests were
 * updated for the genuinely-changed write path (two of them strengthened — see the report). Coverage:
 * package 99.85/99.93/99.64/99.85, with `agent-executor.ts`, `frontend-session-registry.ts` and
 * `run-start-handler.ts` all fully covered; the only residual gap is the pre-existing, deliberately
 * uncovered `handleInactivityTimeout` guard in `run-lifecycle.ts` that function's own doc already explains.
 * `pnpm typecheck` (package and `-r` workspace-wide, since two exported types changed): clean.
 * `pnpm guard`: clean.
 *
 * ## 2026-07-30 addition — the other 3 MCP injection mechanisms get wired: `acp-merge`, the two `*-env-content` strategies, and codebuddy's missing argv
 *
 * The 2026-07-22 gap-3-part-2 entry above wired exactly one of the four declared
 * `externalMcpInjection` strategies. Its own text named the other three as future work ("a future
 * task wiring those two would extend `wireAcpLifecycle`'s existing `envFormat`/`mcpServers`
 * passthrough or `applyAgentLaunchEnv`'s env composition respectively"). A peer review then confirmed
 * the practical consequence: of 24 defs, only `claude` actually delivered MCP tools end to end. This
 * entry closes all three remaining gaps. **Adding a strategy for a currently-undeclared agent (e.g.
 * `codex`) was explicitly out of scope and was not done.**
 *
 * **The boundary this is organised around** is per-CLI vs per-mechanism. Identity, binary, and
 * model/session/permission argv are genuinely bespoke and stay in each def's own `buildArgs`. MCP
 * staging, ACP server merging, and env-content serialisation are *mechanisms*, and each now has
 * exactly one implementation that every def declaring it flows through.
 *
 * **Gap A — `codebuddy` (`'claude-mcp-json'`).** The executor already computed and staged the same
 * `.mcp.json` for it, but `defs/codebuddy.ts`'s `buildArgs` never read `runtimeContext.mcpJsonPath`,
 * so it was still left on the headless auto-discovery path the claude fix exists to avoid. Rather
 * than copy claude's branch, the flag-building moved into a shared
 * `@jini-ai/agent-runtime` helper — **`buildClaudeMcpConfigArgs` in `src/defs/shared.ts`** — that both
 * defs now call. `--strict-mcp-config` was verified as genuinely supported by CodeBuddy before being
 * added (its own CLI reference documents `--mcp-config <fileOrString>` and `--strict-mcp-config`,
 * "Only use MCP servers in --mcp-config, ignore other MCP configuration"), so codebuddy gets the same
 * strict-isolation guarantee as claude rather than a silently weaker one. `shared.test.ts` pins that
 * both defs emit byte-identical MCP argv for identical input, so a future copy-paste divergence fails
 * there rather than in production.
 *
 * **Gap B — the 8 `'acp-merge'` defs** (devin, hermes, kilo, kimi, kiro, reasonix, trae-cli, vibe),
 * which were getting *zero* MCP tools, not merely a missing flag. `attachAcpSession` has always
 * accepted `mcpServers`; `wireAcpLifecycle` simply never passed any. Fixed once, in that shared
 * function (`WireAcpLifecycleContext.mcpServers` → spread into the attach call when non-empty) —
 * **no per-def file was touched**, because the gap was never in the defs. A 9th def declaring
 * `'acp-merge'` is covered automatically. Each entry's `env` is emitted as a plain object so
 * `buildAcpSessionNewParams` keeps owning the array-vs-map wire-shape fork (reasonix declares
 * `acpMcpEnvFormat: 'map'`).
 *
 * **Gap C — `'opencode-env-content'` / `'mimo-env-content'`.** Two labels, one serialiser: MiMo's own
 * def doc already stated it consumes the same JSON schema as OpenCode's, differing only in env-var
 * namespace, and the tests pin that the emitted content is byte-identical modulo the run id. The
 * difference is one row in `ENV_CONTENT_VAR_BY_STRATEGY` (`OPENCODE_CONFIG_CONTENT` /
 * `MIMOCODE_CONFIG_CONTENT`), not a second code path. `mergeEnvContentMcpConfig` applies the same
 * "merge, never clobber" discipline `mergeMcpJsonContent` does, and for a sharper reason: a host may
 * already be handing the CLI the *user's* configured MCP servers through that very variable.
 *
 * **One dispatch point, one credential.** `buildMcpBridgeDelivery` (pure, exported) is the single
 * place a declared strategy maps to a mechanism, returning a discriminated `McpBridgeDelivery` so a
 * consumer cannot read another mechanism's payload. `run()` resolves the per-run bearer credential
 * exactly once, before `buildArgs`, and hands it to whichever serialiser applies; a rejecting resolver
 * still fails the run before spawn. Keyed off the *strategy*, never off `def.id` — a registry-level
 * test asserts every real def declaring a strategy gets a non-null delivery, so a 25th def with an
 * unhandled strategy fails there.
 *
 * **Security.** The credential reaches every mechanism through an *environment*, never through
 * process arguments (`ps` is readable by other local users): `.mcp.json`'s `env`, the ACP server
 * descriptor's `env` (which the ACP agent applies to the MCP child it spawns), and the env-content
 * config's `environment` key — itself carried in the spawned CLI's own env var, deliberately not a
 * `-c key=value`-style CLI argument. Three dedicated tests assert the secret is absent from argv while
 * still present where it must be, including one driving a real subprocess.
 *
 * **Files changed.** `@jini-ai/agent-runtime`: `src/defs/shared.ts` (new
 * `buildClaudeMcpConfigArgs`), `src/defs/claude.ts` and `src/defs/codebuddy.ts` (both call it).
 * `@jini-ai/daemon`: `src/agent-executor.ts` (new `buildAcpMcpBridgeServers`,
 * `ENV_CONTENT_VAR_BY_STRATEGY`, `mergeEnvContentMcpConfig`, `McpBridgeDelivery`,
 * `buildMcpBridgeDelivery`; `writeMcpJsonForRun` narrowed to consume an already-built delivery;
 * `wireAcpLifecycle` gained `mcpServers`; `run()` composes `childEnv`). `McpJsonInjectionOptions`
 * keeps its name for API compatibility with `@jini-ai/server`'s `agentExecutor` passthrough even
 * though it is no longer `.mcp.json`-specific — a naming-debt item, deliberately not renamed here.
 * Reconciled the same session with the run-scoped-path fix above: `buildMcpBridgeDelivery`'s
 * `'claude-mcp-json'` case calls `mcpJsonPathForRun`, not a shared `cwd/.mcp.json`, so the
 * cross-run credential leak that fix closed stays closed under the generalized dispatch too;
 * `writeMcpJsonForRun` takes `cwd` as an explicit param so it still reads the project's own
 * `.mcp.json` as its merge base while writing the run-scoped path.
 *
 * **Tests / verification, run this session.** `@jini-ai/agent-runtime` **1848 → 1858**
 * (`defs/__tests__/shared.test.ts` +5, `defs/__tests__/codebuddy.test.ts` +5). `@jini-ai/daemon`
 * **654 → 687** (`__tests__/agent-executor.test.ts` +30 across `buildAcpMcpBridgeServers`,
 * `mergeEnvContentMcpConfig`, `buildMcpBridgeDelivery`, the ACP passthrough block and the env-content
 * block; `__tests__/agent-executor-acp.integration.test.ts` +3). Nothing existing regressed. The three
 * integration additions are the closest available analogue to the live smoke check that verified the
 * claude fix: the existing ACP fixture — a **real spawned Node subprocess** speaking real ACP JSON-RPC
 * over real stdio, through the real `attachAcpSession` — now echoes back the `mcpServers` its own
 * `session/new` received, so delivery is asserted from the agent's point of view rather than from a
 * stubbed attach call, in both `array` and `map` env formats. No vendor CLI or credentials were
 * needed, and none of the 24 real agent CLIs were spawned. `tsc --noEmit` and `tsc -p tsconfig.json`
 * (build): clean for both packages; root `pnpm -r typecheck`: clean.
 */
export * from './event-log.js';
export * from './close-status.js';
export * from './run-lifecycle.js';
export * from './tool-executor.js';
export * from './delegated-tool-bridge.js';
export * from './remote-tool-bridge.js';
export * from './frontend-session-registry.js';
export * from './frontend-capability-tools.js';
export * from './agent-executor.js';
export * from './terminal-session.js';
export * from './tokens.js';
export * from './legacy-data-migration.js';
export * from './run/index.js';
export * from './continuation/index.js';
export * from './routines/index.js';
