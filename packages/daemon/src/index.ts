/**
 * @module @jini-ai/daemon
 *
 * Stateful kernel orchestration: RunLifecycle, the durable EventLog port,
 * ToolExecutor and the AgentExecutor runtime driver. Feature storage is injected;
 * ArtifactStore belongs to @jini-ai/artifacts. Routines own scheduling and their
 * CRUD/run-history port. Terminal sessions own PTY lifecycle, session access and
 * kill/write/resize locking. Startup data migration belongs here because it must
 * precede service startup, rather than run inside the pure core interfaces.
 *
 * Run contracts:
 * - cancel records intent; drivers finish after the real outcome is known.
 *   RunLifecycle does not spawn or signal processes because those mechanics
 *   belong to the runtime driver. Late cancellation listeners receive the last
 *   request immediately so asynchronous driver setup cannot miss cancellation.
 * - resume reuses the same runId and EventLog cursor sequence without a new start
 *   event. This is distinct from resuming a vendor CLI session. The lifecycle's
 *   run registry is internal, not a separate RunStore token; durable event replay
 *   must not be confused with persistence of arbitrary live process state.
 * - start/finish own start/end events; DriverEmittableInput is an explicit union
 *   so drivers cannot originate those transitions. Unknown or terminal emits
 *   throw because they indicate driver bugs. The cancelled/canceled spelling
 *   bridge preserves the protocol's existing state and payload vocabularies.
 * - Pending durable starts are awaited before exposing run records or parking
 *   terminal waiters: a failed append must not expose an uncommitted run.
 *
 * Tool security and confirmation:
 * - Tool policy authorization and user confirmation are separate gates.
 *   A transport delegate may veto an allowed policy decision, never override a
 *   denial. ToolExecutor is the invocation boundary; handlers are not exposed.
 * - A synchronous undefined confirmation parks the promise for
 *   resumeConfirmation; an async promise resolving to undefined is a denial.
 *   Audit records and pending confirmations are process-local, so cross-restart
 *   durability needs a host-owned store. Unknown tool IDs throw as routing bugs;
 *   denial, timeout, cancellation and handler failure are result variants.
 * - maxOutputBytes bounds UTF-8 string output; structured output is not a general
 *   serialization limit. Handler timeout/controller cleanup occurs at settlement
 *   points; it must not leave an active execution behind.
 *
 * Runtime driver invariants:
 * - Parsed event delivery uses a per-run FIFO and drains before finish so end is
 *   durably last. A failed emit does not block later queued events. Cancellation
 *   stops the full descendant process tree because tools may spawn grandchildren.
 * - Native ACP permission requests fail closed without an injected policy.
 *   Autonomous CLI tool-use telemetry is observational; delegated Jini calls go
 *   through ToolExecutor with authorization, confirmation and audit intact.
 * - Vendor usage is narrowed to protocol fields, rather than inventing wire
 *   fields; error payloads stay minimal. Session handles and turn-end control
 *   are runtime/continuation concerns, distinct from RunLifecycle.resume.
 * - Failure classification belongs to run/core/retry. Signal kills may be
 *   transient (including OOM/eviction); the conservative side-effect guards and
 *   one-retry limit bound duplicate work and wasted attempts. Resumability
 *   metadata does not itself start an automatic retry loop.
 * - Runtime behavior follows def-declared fields, not agent-ID branches, so a
 *   second CLI with the same prompt/output/lock behavior needs no driver fork.
 * - MCP mechanisms have one strategy dispatcher. Per-CLI identity and argv stay
 *   in runtime defs; mechanism staging, server merging and env serialization
 *   stay shared. Existing user servers are merged rather than clobbered.
 * - MCP config files are run-scoped because concurrent runs cannot share bearer
 *   identity. The project's .mcp.json is only a merge source; staged files are
 *   removed at cleanup so live credentials do not outlast the run. Credentials
 *   travel in environments, never argv, which other local users can inspect.
 * - until-close stdout is bounded because an adversarial child can exhaust the
 *   daemon heap. Whole chunks preserve multibyte characters; a host truncation
 *   note follows vendor sanitization so redaction cannot hide missing output.
 * - Fallible buildArgs, staged-file cleanup, classification and reporting must
 *   not strand runs or runtime locks; post-close failures cannot prevent finish.
 * - Frontend session bindings use attachment identity because reconnects reuse
 *   session IDs; stale detach handles must not remove replacement sessions.
 *   Run-start adapters forward imagePaths, extraAllowedDirs and uploadRoot.
 * - Remote/delegated tool events do not establish retry idempotency. A durable
 *   solution belongs at the lifecycle or transport boundary, rather than a
 *   restart-unsafe recorder cache that makes the two paths disagree.
 *
 * node-pty uses native addons. Linux deployment requires python3, make and a
 * C/C++ compiler during installation; source compilation is the fallback.
 * Vendoring foreign prebuilt binaries would create an unowned maintenance burden.
 * See the owning modules and packages/daemon/README.md for detailed contracts.
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

export * from './attachment-content.js';
