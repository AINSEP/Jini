/**
 * @module @injini/daemon
 *
 * `RunLifecycle` + the durable `EventLog` kernel port (extraction-plan §8
 * task 5), plus the `ToolExecutor` tool-execution boundary (extraction-plan
 * §2.5 / §8 task 6), and `AgentExecutor` — the driver that wires
 * `@injini/agent-runtime` into `RunLifecycle` (extraction-plan §2.1 / §3).
 * See `source-map.md` for full provenance and scope-decision notes.
 *
 * The generic `ArtifactStore` kernel port used to live here too — moved to its own
 * `@injini/artifacts` package on 2026-07-19 (see `tokens.ts`'s doc comment).
 *
 * `routines/` (2026-07-21) adds the `RoutineService` scheduler (DST-safe wall-clock schedule
 * math, race-safe scheduled-slot persistence) and the `RoutineStore` CRUD + run-history port,
 * mirroring `EventLog`'s kernel-owned, storage-injected precedent. See its own module doc and
 * `source-map.md`'s dated section for provenance.
 *
 * `terminal-session.ts` (2026-07-21) adds the interactive-terminal session manager: a
 * `node-pty`-backed `PtySpawn` wired into `@injini/platform`'s generic `TerminalService`, plus
 * session-ownership gating and the kill/write/resize lock `@injini/http`'s `terminals.ts` route
 * pack calls into. This is this workspace's first native-compiled-addon dependency — see this
 * package's `package.json` and `source-map.md`'s dated section.
 */
export * from './event-log.js';
export * from './close-status.js';
export * from './run-lifecycle.js';
export * from './tool-executor.js';
export * from './delegated-tool-bridge.js';
export * from './frontend-session-registry.js';
export * from './frontend-capability-tools.js';
export * from './agent-executor.js';
export * from './terminal-session.js';
export * from './tokens.js';
export * from './legacy-data-migration.js';
export * from './run/index.js';
export * from './continuation/index.js';
export * from './routines/index.js';
