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

`node-pty` is no longer a dependency of this package — it boots and every other capability
(run lifecycle, tool executor, agent executor, routines) works without it. Only
the native adapter at `@jini-ai/server/adapters/node-pty` needs `node-pty` installed.
The session manager wraps a host-built `TerminalService`; the host also owns the PTY loader and the
service's tuning (buffer sizes, flush timing, TTL, shutdown grace):

```ts
import { createTerminalSessionManager } from '@jini-ai/daemon';
import { createTerminalService } from '@jini-ai/platform';
import { loadRealSpawnPty } from '@jini-ai/server/adapters/node-pty';

const terminalService = createTerminalService({ loadSpawnPty: () => loadRealSpawnPty({}) });
const manager = createTerminalSessionManager({ terminalService });
```

With `@jini-ai/server`, pass that loader as `featureOptions.terminal.loadSpawnPty` to
`composeJiniKernel`, or as `loadTerminalSpawnPty` to `createLocalNodeDaemon`.

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
  session manager built on `@jini-ai/platform`'s generic ring-buffer engine, plus session-token
  gating. The optional native `loadRealSpawnPty` adapter lives at `@jini-ai/server/adapters/node-pty`.
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

The agent runtime is one port too. `@jini-ai/daemon/ports/agent-runtime` states `AgentRuntimePort` (definitions, launch,
filesystem policy, model resolution, ACP/PI sessions, stream parsers, startup failures) and re-exports `BaseUrlGuardPort`;
`@jini-ai/agent-runtime`'s `createAgentRuntimeBindings` is the one binding, and the host proves it with
`satisfies AgentRuntimePort`. The provider-facing HTTP routes take two more ports:
`@jini-ai/core/contracts/agents` (`ProviderToolTurnPort`, `BaseUrlGuardPort`, the pinned-fetch types; neutral, so a host
types its bindings without importing daemon) and
`@jini-ai/daemon/ports/xai-oauth` (`XaiOAuthPort`). Each has a DI fake under `src/ports/__tests__/` for route and launcher tests.

## Runtime

Node-only.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See the archived provenance ledger for per-file provenance and scope decisions. Apache-2.0.

## Storage concern subpaths

The root remains driver-free. `./store/event-log/sqlite` exports the unchanged cursor/dedupe/replay
adapter. `createSqliteEventLog({ db, clock }, { maxEntriesPerRun })` borrows the host handle, ensures
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
`./store/agent-sessions/kernel` exports `createAgentSessionStoreForKernel({ kernel, clock })`, which
selects one of those three adapters by `kernel.transport` (no I/O at construction).

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
workspace-root resolution and the live route manifest. Hosts supply the route reporter.
The Express credential middleware (`createDaemonAuthMiddleware`, `createRunOwnershipMiddleware`,
and `createOwnedRunListHandler`) lives in `@jini-ai/http-kit/middleware`. Install
`@jini-ai/http-kit` and `express` in the route-mounting host. `@jini-ai/daemon/read-only-tools` owns the fail-closed
execution gate; compose it around the bare executor, beneath recovery decorators, since an
outer wrapper cannot intercept references those decorators already hold.
See [API.md](https://github.com/AINSEP/Jini/blob/main/packages/daemon/API.md) for route, credential, audit, surface and session contracts.

## Wiring

- **Process-memory daemon secrets** (`@jini-ai/daemon/run-credentials`'s
  `adoptAndEnsureDaemonSecret`): the host injects its env record, a module-memory `holder`, the
  env-var name (product-specific) and its credential `crypto`, and may inject `readOperatorSecrets`
  (its secret-file resolver). Jini adopts the operator value once, deletes it from env so spawned
  children never inherit it, and preserves or mints without rotation.
- **Agent session store by kernel** (`@jini-ai/daemon/store/agent-sessions/kernel`'s
  `createAgentSessionStoreForKernel`): a host that opens its chat database on more than one
  dialect passes its already-migrated chat `kernel` (any of `better-sqlite3`, `pglite`,
  `pglite-socket`, `node-postgres`) and its `clock`; the selector picks the matching adapter. The
  host keeps the kernel's lifetime and the `assistant_agent_sessions` migration.
- **Tool families** (`@jini-ai/daemon/http`'s `createPrefixToolFamilyPort`): a host whose tools
  form a `<familyId>.<name>` namespace passes `delegatedToolRoutes` deps
  `families: createPrefixToolFamilyPort({ registry, familyId, selectorKeys })`. The host injects
  the run-scoped `registry` (only `list` is read), its product `familyId`, and the input
  `selectorKeys` agents use to name a card. Omit `families` when the host has no groups.
- **Page-click approval context** (`@jini-ai/daemon`'s `pageApprovalOptions` /
  `createPageApprovalContext`): when registering each frontend capability, the host passes
  `pageApprovalOptions({ toolId, execute, navigationQuery })` as the approval policy's options.
  The host injects the same audited `execute` used for the frontend invocation and its own
  `navigationQuery` string (a `page.find_elements` query that matches no element, so the
  revision read stays cheap). Only `page.click` gets a context port.
- **Per-run active screen** (`@jini-ai/daemon/http`'s `createRunActiveContextStore`): the host
  records each run's validated page context at run start (`record({ runId, pageContext })`),
  forgets it at run end, and serves `store.read()` from its own token-guarded `GET /api/active`
  mount. The host injects its page-context type as the store's type argument (anything with a
  `path` and optional `entry { kind, id, title }`) and the `now` clock seam when testing.
- **Lost frontend bindings** (`@jini-ai/daemon/http`'s `createLostFrontendBindings`): the host
  creates one per frontend control with `createLostFrontendBindings({ messages })`, calls
  `noteBindError(context)` from `createFrontendControl`'s `onBindError`, and registers each
  frontend tool as `wrap({ registration })`. The host injects `messages` — its own wording for
  `lostBinding` (the tab outlived a daemon restart), `unboundDetail` and `detachedDetail` (the
  detail of the recoverable `FrontendDisconnectedError`); `maxRuns` (default 256) is optional.
- **Per-call daemon context** (`@jini-ai/daemon/daemon-call-context`): the host's tool-RPC route
  parses the daemon's opaque wire `context` with `parseDaemonCallContext({ value })` and runs the
  call inside `runWithDaemonCallContext({ context, fn })`; host tool readers call
  `readDaemonCallContext()` (`undefined` means not a daemon call, e.g. a BYOK turn). Nothing is
  injected; the host owns the route path and wire field name.
- **Retained-state RPC parser** (`@jini-ai/daemon/core-rpc-schema`'s
  `createDaemonCoreRequestSchema({ cliConsentKeys, settingsNamespaces })`, `daemonToolConsentSnapshot`;
  wire types in `@jini-ai/core/contracts/site/daemon-core-rpc`): the host injects, as required
  fields, the complete set of consent keys a run may allow and the settings namespaces
  `getEffective` may read, then parses its authenticated RPC body with the returned schema. The host
  owns the route, its bootstrap snapshot and its run-store bindings.
- **BYOK meta-tool results** (`@jini-ai/daemon/byok-meta-tool-result`): a host BYOK tool surface
  maps `ToolExecutor.execute` outcomes with `mapToolExecutionResult({ result, toolId })`, normalizes
  `execute_delegated_tool` input with `resolveDelegatedInput({ raw })`, and returns `ok`/`err`
  results straight to `@jini-ai/agent-runtime/providers/tool-turn`'s `ProviderToolExecutor`.
  The host owns its meta-tool descriptors and registry; nothing is injected.
- **Surface callback decisions** (`@jini-ai/daemon/http`'s `parseSurfaceCallbackRequest`,
  `executeSurfaceRedemption`, `surfaceRedemptionReply`, `isTypedSurfaceAnswer`,
  `surfaceNotPendingBody`): a host's MCP-UI callback route keeps its own server-framework shell
  (principal header, response writing, exchange delivery/streaming) and calls these for body
  validation, allowlist refusal (400/403) and Shape-2 result shaping, writing the returned
  `{ status, body }`. The host injects `admit` (its redeemable-tool allowlist and typed-answer
  policy) and an `idGenerator` for the synthetic redemption run id.
- **A2UI action decisions** (`@jini-ai/daemon/http`'s `readA2uiAction`, `deliverA2uiAction`,
  `a2uiNotPendingBody`): every hop that accepts an A2UI post (daemon route, local-first proxy)
  validates with `readA2uiAction({ rawBody })`, delivers with `deliverA2uiAction({ store, ... })`
  on the `a2ui` channel and answers a miss with the 409 body. The host injects its
  `SurfaceExchangeStore` and owns the route path and principal header.
## Wiring (tool-access-lowering)

- `stopRunsForToolAccessChange` takes the host's `revoke`/`cancel`/`waitForCleanup`/`notice` ports; a host that cannot confirm the affected answers stopped throws `ToolAccessLoweringError` (from `@jini-ai/core/tool-access-change`) so its routes map it to `TOOL_ACCESS_STOP_FAILED`.
