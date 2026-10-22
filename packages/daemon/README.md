# `@jini-ai/daemon`

The stateful agent daemon runtime: run lifecycle, the durable event-log reference implementation,
the tool-execution boundary, the agent executor that drives real coding-agent subprocesses,
interactive terminal sessions, a routine scheduler, and run-orchestration helpers. This is the
largest, most stateful package in the engine — where `@jini-ai/core` defines the composition
kernel and `@jini-ai/protocol` defines the wire types, `@jini-ai/daemon` is where those become a
running process: a `RunLifecycle` you can `start`/`emit`/`cancel`/`resume`/`stream`, a
`ToolExecutor` that is the *only* thing allowed to invoke a registered tool's handler, and an
`AgentExecutor` that spawns and streams a real agent CLI into that lifecycle.

Package `typecheck` and `build` compile source and tests together; runtime test execution remains a separate command.
Packed-consumer fixtures are local to this package. PostgreSQL test declarations come from the development dependency `@types/pg`.

## Install

```sh
npm install @jini-ai/daemon
```

`node-pty` is an **optional peer dependency** — the package boots and every other capability
(run lifecycle, tool executor, agent executor, routines) works without it. Only
`createTerminalSessionManager`'s real (non-test) `PtySpawn` — an actual interactive terminal/PTY
spawn — needs `node-pty` installed; everything else has no native-addon dependency at all.

## What you get

- **Run lifecycle** — `createRunLifecycle`, the `RunLifecycle` interface
  (`start`/`get`/`list`/`cancel`/`onCancelRequested`/`emit`/`finish`/`resume`/`waitForTerminal`/
  `stream`/`rehydrate`), keyed on an opaque `contextRef`, backed by an injected `EventLog`.
- **Event log** — `createInMemoryEventLog`, the reference `EventLog` implementation (the port
  types themselves live in `@jini-ai/protocol` so a storage adapter like `@jini-ai/daemon/store/event-log/sqlite` can
  implement them without depending on this package).
- **Tool-execution boundary** — `createToolExecutor`, the `ToolExecutor` interface
  (`execute`/`resumeConfirmation`/`cancel`/`getAuditRecord`). It is the sole caller of
  `@jini-ai/core/composition`'s `authorizeToolInvocation` — routes and agents only ever see
  `ToolRegistry` descriptors, never a handler, and this is the one path that can run one, gated by
  an injected `ExecutionDelegate` (authorize/confirm) with a resumable confirmation flow.
- **Agent executor** — `createAgentExecutor`, `AgentExecutorError` — wires
  `@jini-ai/agent-runtime`'s registry/launch/stream-parsers into a real `node:child_process` spawn
  that drives `RunLifecycle.emit()`/`finish()`.
- **Delegated & remote tool bridges** — `createDelegatedToolBridge` (an agent's own protocol
  asking Jini to run a registered tool on its behalf, through `ToolExecutor`) and
  `createRemoteToolEventRecorder` (lets a tool that executed in a different process still record
  its `tool_use`/`tool_result` events into a run's log).
- **Frontend capability routing** — `createFrontendSessionRegistry` (addresses a run's attached
  browser surface) and `createFrontendCapabilityRegistrations` (projects a frontend capability
  manifest into `ToolRegistry` registrations — the only door into it).
- **Terminal sessions** — `createTerminalSessionManager`, `createTerminalToolRegistrations` — a
  `node-pty`-backed session manager built on `@jini-ai/platform`'s generic ring-buffer engine, plus
  session-token gating.
- **Routines** — `RoutineService`, `createInMemoryRoutineStore` (`routines/`) — a DST-safe
  wall-clock scheduler plus CRUD + run-history store port.
- **Run-orchestration helpers** (`run/`) — `runResultFromStatus`, `deriveRunErrorCode`,
  `decideSafeRunRetry`, `classifyProcessExitFailure`, `resumableFromProcessExit`, and the
  `SAFE_RUN_RETRY_STRATEGY`/backoff constants — product-neutral retry/failure classification.
- **Continuation** (`continuation/`) — `createRunByteJournal`, `createDefaultRunStartHandler`, and
  the continuation-transport types that support session resume across reconnects.
- **Legacy data migration** — a one-shot, idempotent data-root migrator
  (`legacy-data-migration.ts`) for moving a daemon's data directory at startup.

## Usage

```ts
import { createToolRegistry } from '@jini-ai/core';
import { createInMemoryEventLog, createRunLifecycle, createToolExecutor } from '@jini-ai/daemon';

const eventLog = createInMemoryEventLog({});
const lifecycle = createRunLifecycle({ eventLog });
const registry = createToolRegistry({});
const executor = createToolExecutor({ registry });

const { run } = await lifecycle.start({ contextRef: 'workspace-42' });
await lifecycle.emit({ runId: run.id, input: { event: 'stdout', data: { chunk: 'hello' } } });
await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
```

## What's swappable

`EventLog` and `RunLifecycle` are consumed as ports — this package ships the reference in-memory
implementations, but a host wires `@jini-ai/daemon/store/event-log/sqlite`'s durable `EventLog` for persistence, or its
own `RunLifecycle`, as long as it satisfies the same `@jini-ai/protocol`/interface shapes.
`ExecutionDelegate` (authorize/confirm UI) is a transport-supplied seam on `createToolExecutor` —
omit it for a headless caller. `PtySpawn` (terminal sessions) and `RoutineStore` (routine
persistence) are likewise ports with one reference implementation each. The state-machine logic
itself (run transitions, the tool-execution audit trail, retry classification) is fixed.

## Runtime

Node-only.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See the archived provenance ledger for per-file provenance and scope decisions. Apache-2.0.

## Storage concern subpaths

The root remains driver-free. `./store/event-log/sqlite` exports the unchanged cursor/dedupe/replay
adapter. `createSqliteEventLog({ db }, { maxEntriesPerRun, clock })` borrows the host handle, ensures
its dedicated schema idempotently, never changes pragmas, and has a harmless `close({})`.
`openSqliteEventLog({ file, open }, options)` owns a host-acquired handle, sets WAL, cleans up failed
setup, and closes once. Owned acquisition uses only `openSqliteEventLog`; borrowed creation takes `{ db }`. No ambient driver is loaded.

`./store/agent-sessions` exports `AgentSessionStore`, `AgentSessionStoreError` and
`createInMemoryAgentSessionStore`. `./store/agent-sessions/{sqlite,pglite,postgres}` export the named
`createSqliteAgentSessionStore`, `createPgliteAgentSessionStore` and `createPostgresAgentSessionStore`
factories with `{ kernel }` plus optional `{ clock }` (`Clock.nowMs()` from core, defaulting to system wall time). They borrow an already-migrated kernel, join its
transactions, and use the unchanged `assistant_agent_sessions` mapping. PGlite supports embedded
and owner-socket kernels. Extra host tables are accepted. No schema/bootstrap/pragma/close occurs
at construction. SQL failures retain a cause under `AgentSessionStoreError({ code: 'unavailable' })`.

The SQLite entry also preserves rich legacy `agent_sessions` functions and exports
`LEGACY_AGENT_SESSIONS_DDL`. These records include hashes/model/cwd/message cursors and belong to
the local legacy model; they are separate from the simple session-id port.

Database/Kysely/drivers are optional peers and are needed only by the selected concern. Hosts import
and inject their own drivers. Real Postgres session tests require `JINI_DAEMON_TEST_POSTGRES_URL`
targeting a disposable `jini_daemon_test_*` database; `pnpm run test:postgres` fails when it is unavailable.

## Design decisions

- [Remote tool execution records into the owning run](docs/decisions/DR-001-remote-tool-event-recording.md).

- [Agent subprocess environment is an explicit allowlist](docs/decisions/DR-002-explicit-subprocess-environment.md).

## Optional HTTP surface

`@jini-ai/daemon/http` exports daemon route packs, attachment storage, frontend control,
workspace-root resolution and the live route manifest. Install `@jini-ai/http-kit` and
`express` only when using this entry. `@jini-ai/daemon/read-only-tools` owns the fail-closed
execution gate; compose it around the bare executor, beneath recovery decorators, since an
outer wrapper cannot intercept references those decorators already hold.
See [API.md](https://github.com/AINSEP/Jini/blob/main/packages/daemon/API.md) for route, credential, audit, surface and session contracts.
