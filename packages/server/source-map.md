# `@jini/node-host` — provenance

Origin: the generic bootstrap skeleton inside OD's `startServer()`
(`apps/daemon/src/server.ts`) plus `apps/daemon/src/daemon-startup.ts`, on the user's
`arch/server-startserver-endgame` branch (`leonaburime-ucla/open-design`), reference-only clone at
`/Users/la/Desktop/Programming/OSS-Repos/open-design` (branch not checked out there — read via
`git show arch/server-startserver-endgame:<path>`).

Per `foundry/docs/jini-port/extraction-plan.md` §2.4, `createLocalNodeDaemon` is the "host preset" that
lets a brand-new product boot a daemon by implementing zero interfaces — the single missing piece
that makes the whole engine runnable instead of a set of tested-in-isolation fragments (per the
root `AGENTS.md`'s ⚠️ PORT STATUS callout). Everything product-specific `startServer` also wires
(design-systems, plugins, marketplace, connectors, routines, media, live-artifacts, skills, orbit,
chat proxy routes, telemetry, project/artifact/upload routes, static SPA fallback) stays in OD;
only the generic Express-assembly-and-listen skeleton is ported here.

## File map

| Jini file | Origin file(s) | Transform |
|---|---|---|
| `src/host-bootstrap.ts` | `apps/daemon/src/daemon-startup.ts` | `normalizeDaemonBindHost`/`closeHttpServer`, logic verbatim (no OD env-var reads inside either function body). **Not ported**: `parseDaemonCliStartupArgs`/`DaemonCliStartupConfig`/`runDaemonCliStartup`/`startDaemonRuntime` — CLI-flag/env-var parsing for an `od <cmd>`-shaped CLI belongs to a future `@jini/cli` task, not this one. |
| `src/create-local-node-daemon.ts` | `apps/daemon/src/server.ts`'s `startServer()` — the bound-API-token boot guard (~line 1569-1590), the app-assembly block (~line 1592-1656), and the `.listen()` tail (~line 3295-3387) | New composition, not a lift: assembles `@jini/sqlite`'s `createSqliteEventLog` + `@jini/daemon`'s `createRunLifecycle`, binds them via `@jini/core`'s `bindings()`, extends via a caller-supplied customizer callback, assembles an Express app behind `@jini/http`'s `installRouteRegistrationGuard`/`registerApiBearerAuthMiddleware`/`registerApiOriginGuardMiddleware`, composes the caller's own packs via `@jini/core`'s `createDaemon`, mounts them via `@jini/http`'s `mountPackHttp`, registers `@jini/http`'s generic `registerDaemonStatusRoutes`, then listens and resolves `{url, server, stop}`. See "Design decisions" below for the compile-time-gate overload split and the two extracted pure helpers (`resolveBoundPort`, `resolveReportHost`). |
| `src/create-local-node-daemon.typecheck.ts` | *(new)* | Compile-time-only proof (mirrors `packages/core/src/compose.typecheck.ts`) that `createLocalNodeDaemon` preserves `createDaemon`'s "missing binding" gate through the wrapper, in both the "no `bindings` customizer" and "`bindings` customizer provided" directions. `tsc --noEmit` is its test runner; never exercised by vitest (excluded via `vitest.config.ts`). |
| `src/index.ts` | *(new)* | Root barrel. |

## Explicitly out of scope (per the porting task's own boundary)

- Every other route `startServer` wires — see the table above and
  `packages/http/source-map.md`'s `routes/` classification table (32 files, 2 GENERIC / 14 MIXED /
  16 OD-PRODUCT) for the full accounting of what those routes are and why none of them belong here.
- **`ToolExecutorToken` binding.** No sensible zero-config default exists — an empty
  `ToolRegistry` would silently fail every tool call. `ExecutionDelegate` injection into
  `mountPackHttp` is independently deferred per `packages/http/source-map.md`.
- **Agent discovery (fixed 2026-07-23).** The old forward-compatible, unused `agents` placeholder
  has been replaced by real lazy daemon-owned discovery. The zero-config host calls
  `@jini/agent-runtime`'s `detectAgents`, caches the in-flight/result promise for browser/desktop
  clients, projects only client-safe availability/model metadata, and invalidates the cache through
  `POST /api/agents/rescan`. `agentDetector` is an optional host/test override for PATH/env policy.
- **Additional streaming projections.** The generic lifecycle SSE run transport is mounted here;
  AGUI, terminal sessions, and product-specific stream families remain out of scope.

## Design decisions

**1. Two function overloads instead of one generic signature with a defaulted `BoundIds`.** The
task brief's literal shown signature was
`createLocalNodeDaemon<const Packs, BoundIds extends string = KernelBoundIds>(config: ...)`.
Empirically verified against this repo's TypeScript (5.9.3, `strict`) that this shape does not
actually preserve `createDaemon`'s compile-time "missing binding" gate: when a type parameter both
has a default *and* is referenced inside a conditional type in the same position where it also
needs inference from a nested callback's return type, TypeScript resolves it to the default
instead of inferring from the callback — silently defeating the gate on exactly the call shape
(`bindings` customizer provided) where it matters most. Fixed by splitting into two overloads — one
where `bindings` is absent and `BoundIds` is the concrete `KernelBoundIds`, one where `bindings` is
required and `BoundIds` is inferred fresh with no default — which sidesteps the inference conflict
entirely. Both directions (and an under-binding customizer, and a satisfied customizer) are proven
in `create-local-node-daemon.typecheck.ts`. Documented in full inline on the exported function.

**2. `resolveBoundPort`/`resolveReportHost` extracted as small pure, exported helpers.** The
origin's `.listen()` tail inlined both the "is `server.address()` actually usable" check and the
"substitute 127.0.0.1 for an all-interfaces bind host" substitution directly in the `'listening'`
callback. Pulling them out makes two genuinely-defensive branches (a `server.address()` that is
`null`/a Unix-socket-path string/a non-positive port — provably unreachable via any real TCP
listener once `'listening'` has fired, per the origin's own "belt-and-braces" framing) directly
unit-testable without mocking Express or the underlying socket at all.

**3. `@jini/core/internal`'s `AnyPack`/`RequiredTokenIds`/`MissingTokenIds` re-export.** Needed so
this package could re-derive `createDaemon`'s exact compile-time gate rather than duplicate the
type-level logic. See `packages/core/src/internal.ts`'s own module doc and
`packages/core/src/daemon.ts` — these three types are now `export`ed there (previously
module-private) but deliberately *not* re-exported from `@jini/core`'s public `index.ts` (which
switched from a `daemon.js` wildcard re-export to an explicit named list for exactly this reason).

**4. `createDaemon`'s own compile-time gate is bypassed (via a cast) inside
`createLocalNodeDaemon`'s implementation body**, the same way
`packages/core/src/__tests__/index.test.ts`'s `createDaemonUnsafe` reaches `createDaemon`'s runtime
path directly: `Packs`/`BoundIds` are still abstract, unresolved type parameters inside a generic
function body, so `createDaemon`'s own conditional gate can never collapse to a definite branch
there regardless of which overload the real call site matched. Safety was already established by
this function's own equivalent gate (present on both exported overloads) at the real call site.

**5. `stop()` always closes the durable `EventLog`, even when the caller's `onShutdown` hook
rejects** — `try { await config.onShutdown?.() } finally { await eventLog.close() }` — so a
caller-supplied hook failing can never leak an open sqlite file handle; the original rejection
still propagates to whoever awaited `stop()`.

**6. `env[JINI_BIND_HOST]` is set before serving any request — a documented, only-partially-fixable
wrinkle.** `@jini/http`'s own `guardSameOrigin` (used by `registerDaemonStatusRoutes`' shutdown
route) resolves `bindHost` purely from real `process.env.JINI_BIND_HOST`, with **no parameter path**
of its own — unlike most of that module's other functions, it never accepts an injected `env`.
`createLocalNodeDaemon` sets `env[JINI_BIND_HOST] = host` (where `env` is `config.env ??
process.env`) before returning, which correctly fixes the common case (no `env` override — the
default, real `process.env` gets the right value). When a caller *does* inject a distinct `env`
object for full test isolation, this line cannot make `guardSameOrigin`'s hardwired real-`process.env`
read reflect it — a pre-existing `@jini/http` limitation this call cannot reach around without
editing `origin.ts` itself (out of scope here, same reasoning as the origin-validation duplication
flagged in `packages/http/source-map.md`).

## Tests

`src/__tests__/host-bootstrap.test.ts` (unit, no server needed) and
`src/__tests__/create-local-node-daemon.test.ts` (real bound server on `port: 0` + `fetch()`,
mirroring `packages/platform/src/__tests__/index.test.ts`'s established real-socket pattern — no
`supertest` dependency). `createSqliteEventLog` is the one thing spied on (not replaced) in a
handful of tests, specifically to observe that `stop()` really calls the returned `EventLog`'s
`close()` — reopening the same sqlite file afterward succeeds regardless of whether the original
handle was closed (`better-sqlite3` in WAL mode permits two concurrently open handles on one file
within a single process, verified empirically before relying on it), so that assertion alone would
not have proven anything. The bearer-auth 401 case is gated behind
`it.skipIf(lanAddress == null)` — the middleware unconditionally exempts loopback peers by design,
so observing a real 401 requires a genuine non-loopback TCP connection; the underlying branch logic
already has full unit coverage in `packages/http/src/express/__tests__/api-security-middleware.test.ts`
regardless of whether this particular integration test can run in a given sandbox. 100% coverage
on all 4 metrics (statements/branches/functions/lines). Test-count/file-count is stated fresh in
the "2026-07-19" section below, since the Fastify transport split added a second integration suite
after this section was first written.

## Dependencies

`@jini/core` (workspace) — `bindings`/`createDaemon`/`Bindings`/`Daemon` plus
`AnyPack`/`MissingTokenIds` via the `./internal` subpath. `@jini/daemon` (workspace) —
`createRunLifecycle`/`EventLogToken`/`RunLifecycleToken`. `@jini/sqlite` (workspace) —
`createSqliteEventLog`. `@jini/http` (workspace) — the route-pack registrar, the two security
middlewares, the route-registration guard, `configuredAllowedOrigins`, and the generic daemon-status
routes. `express` (`^4.21.0`) + `@types/express` (devDependency) — this package's own composition
root creates the real Express app.

## 2026-07-19 addition — lifecycle HTTP vertical slice and restart recovery

`createLocalNodeDaemon` now awaits `RunLifecycle.rehydrate()` immediately after
opening its SQLite event log and before it accepts HTTP traffic. That rebuilds
the lifecycle's process-local status/idempotency indexes from durable records;
an interrupted non-terminal run is conclusively recorded as a resumable
failure because its child process cannot survive a host restart. If rehydration
itself fails, the SQLite handle is closed before boot rejects.

The composition root registers `@jini/http`'s generic run transport:
`POST /api/runs`, `GET /api/runs/:runId`,
`POST /api/runs/:runId/cancel`, and `GET /api/runs/:runId/events` (SSE with
`Last-Event-ID` replay). `CreateLocalNodeDaemonConfig.onRunStarted` is an
optional host-owned driver hook invoked only after the lifecycle has durably
started a run. This keeps agent selection, prompt construction, working-root
resolution, and capability policy in the consuming host rather than making
the Node preset a product runtime. The integration test exercises create,
live SSE, reconnect, idempotency, cancel, stop/restart, and durable replay
over real sockets.

## 2026-07-21 addition — local daemon-registry discovery record (`discoveryFile`)

Closes the gap `packages/cli/source-map.md`'s own 2026-07-21 investigation named: "nothing
persists that URL anywhere a *separate* CLI process could find it (no IPC status server, no port
file, no pidfile)." `createLocalNodeDaemon` now writes a small, atomically-written JSON record
(`{url, host, port, pid, startedAt}`) once it is actually listening, via `@jini/sidecar`'s new
`daemon-registry.ts` primitives (`writeDaemonRegistryRecord`/`removeDaemonRegistryRecordIfCurrent`/
`resolveDaemonRegistryPath`) — see that package's own matching source-map.md entry for the
low-level design (atomic write, guarded removal, pid-liveness verification).

**Why `dataDir`-scoped, not a single machine-wide well-known path.** The task's own open question
was whether multiple daemons on one machine is a real scenario here. It is not a *new* scenario
this feature had to invent support for — it already exists structurally: two `createLocalNodeDaemon`
calls already require two different `dataDir`s (each opens its own `<dataDir>/events.db`; sharing
one would already corrupt sqlite state). Scoping the registry record to
`resolveDaemonRegistryPath(dataDir)` (`<dataDir>/daemon.json`, a sibling of `events.db`) inherits
that same isolation for free — two daemons on one machine get two non-colliding records with zero
new configuration, and there is no single global path to argue over or collide on. This mirrors
`resolveDaemonUrl`'s own "conservative default, fully host-overridable" pattern: `discoveryFile`
defaults to the `dataDir`-derived path, accepts an explicit override string, or `false` to disable
writing a record at all.

**New `CreateLocalNodeDaemonConfig.discoveryFile?: string | false`.** The write happens inside the
`'listening'` event handler, *before* `createLocalNodeDaemon`'s own returned promise resolves — a
caller that immediately shells out to a CLI command right after `await createLocalNodeDaemon(...)`
must not lose a race against this module's own write. `stop()` removes the record via
`removeDaemonRegistryRecordIfCurrent(registryPath, process.pid)` — the pid guard (matching
`json-file.ts`'s pre-existing `removePointerIfCurrent` pattern) means a slow-shutting-down old
daemon can never delete a newer daemon's already-written record on a reused `dataDir`.

**Both the write and the removal are best-effort by explicit design, not an oversight.** Wrapped in
try/catch and silently swallowed on failure: the discovery record is a convenience for automatic
CLI discovery, not a correctness requirement for the daemon itself (a caller can always fall back
to an explicit `--daemon-url`/env var), so an unwritable `dataDir` must not fail daemon boot, and a
failed cleanup must not fail an otherwise-successful graceful shutdown. Proven with a real,
deterministic failure (an `ENOTDIR`-forcing blocker file in the registry path's ancestor directory
— privilege-independent, unlike a chmod-based test, which does not actually deny access when tests
run as root, per `packages/sidecar/source-map.md`'s own note on the same issue) rather than an
environment-dependent permission trick.

**Not built.** No change to `resolveDaemonUrl` itself (that lives in `@jini/cli` and already had its
injection point); no attempt to also expose the record over `@jini/sidecar`'s NDJSON-IPC surface
(`json-ipc.ts`) — a flat JSON pointer file is sufficient for "read this once to get a URL" and
avoids standing up a long-lived IPC server just for discovery. See `@jini/cli`'s own source-map.md
for the reader side (`local-daemon-discovery.ts`).

**Tests**: 8 new cases appended to `src/__tests__/create-local-node-daemon.test.ts`'s existing
real-socket suite (default path + content shape, resolves before the daemon's own promise does,
custom `discoveryFile`, `discoveryFile: false`, `stop()` removes the record, two dataDirs on one
"machine" get two non-colliding records, write-failure-is-best-effort via the ENOTDIR trick,
removal-failure-is-best-effort via mocking `@jini/sidecar`'s export). 100/100/100/100 coverage
maintained across the whole package (60 tests, 3 files) — `pnpm --dir packages/node-host exec
vitest run --coverage`.

## Dependencies (updated)

Adds `@jini/sidecar` (workspace) — `writeDaemonRegistryRecord`/`removeDaemonRegistryRecordIfCurrent`/
`resolveDaemonRegistryPath`.

## 2026-07-22 addition — wiring audit: is everything this session's parallel-agent batch built actually reachable through `createLocalNodeDaemon`?

The batch of work that landed on `feat/http-routes-and-cli-commands` this session added roughly a
dozen new `@jini/http` route packs (`terminals.ts`, `memory.ts`, `routines.ts`, `model-proxy.ts`,
`db-ops.ts`, `delegated-tools.ts`, `active-context.ts`, `agents.ts`, `host-tools.ts`,
`cancel-owned-runs.ts`) and `@jini/daemon`'s gap-1 byte-journal / gap-3 continuation / gap-4
failure-classifier / gap-3-part-2 `.mcp.json` injection. This package is the one real entry point a
host actually calls to boot a working daemon, so "is it built" and "is it reachable" are different
questions — this section answers the second one honestly, checked by grepping every
`register*Routes` call site in the whole repo (not just this package), not by re-reading each
route pack's own claims.

**Confirmed reachable, unconditionally, before this addition:** `registerRunRoutes` and
`registerDaemonStatusRoutes` — both already hardwired directly in `createLocalNodeDaemon`, not
behind any pack. Gap 1's byte-journal is unconditionally wired into the zero-config
`AgentExecutor` this preset already constructs (`createAgentExecutor({ lifecycle, journal })`) —
every run this preset drives gets byte-journaled, no caller action needed.

**Confirmed NOT reachable, before this addition, from any real entry point in this repo:** every
one of the dozen route packs named above. A repo-wide grep for each `register*Routes` function
name found call sites only inside its own defining file, its own tests, and the `@jini/http`
barrel re-export — zero callers anywhere in `packages/node-host`, `apps/`, `examples/`, or
`integrations/`. No `Pack` object anywhere wraps any of them either, so even a consumer who wanted
to opt in via `config.packs` had no example to follow. Built, tested to 100% in isolation, and
completely orphaned from the one real boot path — exactly the failure mode this task's item 4(c)
asked to check for.

**Fixed this pass — wired in for real, not just documented:** `registerAgentRoutes` and
`registerHostToolsRoutes` are now unconditionally mounted in `createLocalNodeDaemon`, alongside
`registerRunRoutes`/`registerDaemonStatusRoutes`. Both are the only two of the dozen that are
genuinely safe with a zero-config, harmless default:

- **`GET /api/agents` + `POST /api/agents/rescan`** — the initial read lazily executes
  `@jini/agent-runtime`'s real concurrent PATH/version/auth/model detection and caches the result;
  rescan explicitly invalidates it. The HTTP projection includes availability and model choices
  but strips spawn-only paths, argv builders, executable names, and env. This adds no dependency
  beyond this package's existing §3-locked `@jini/agent-runtime` edge.
- **`POST /api/resources/:resourceRef/open-in`** (+ `GET /api/editors`) — `HostToolsOpenInDeps`'s
  `resolveRoot` already defaults to `denyAllWorkspaceRoots` inside `host-tools.ts` itself; mounting
  it with no resolver configured means the route exists and is reachable but denies every call with
  `404`, never fabricating a path — safe by construction. A new optional
  `resolveWorkspaceRoot?: WorkspaceRootResolver` config field lets a real host wire a working
  resolver in without needing its own `Pack`.

**2026-07-22 update — six of the remaining eight route packs re-investigated and wired in for
real; this paragraph's own prior claims about them were not taken at face value (per this repo's
"no scope cuts for coverage / no accepting a prior claim without re-deriving it" standing rule) —
see this file's own dated entry below for the full reachability analysis, one bullet per route
pack. `memory.ts`, `terminals.ts`, `model-proxy.ts`, `active-context.ts`, `db-ops.ts`
(`daemon.db.*`), and `media.ts` (added 2026-07-22, see `packages/http/source-map.md`'s own dated
entry) are now unconditionally mounted, each with a genuinely safe, harmless zero-config default —
the same "provably harmless" bar `agents`/`host-tools` already had to clear, not a lowered one.

**Left genuinely NOT wired, with the specific reason each one needs — not a bare "future work"
note:** `routines.ts` (see this file's own dated entry below for the concrete structural blocker —
`RoutinePersistence`'s deliberately-synchronous contract cannot be satisfied by `RoutineStore`'s
async CRUD interface without new bridging code), `delegated-tools.ts` (needs a `resolvePrincipal`
callback — deliberately mandatory, no default identity, matching gap 3's own
human-in-the-loop-authority decision), `cancel-owned-runs.ts` (a helper function, not a route pack,
invoked by a caller's own shutdown/context-teardown logic — never meant to be auto-wired). This
matches the *established* pattern already on this interface — `continuation`/`mcpJsonInjection` in
`@jini/daemon`'s `agent-executor.ts` are opt-in for the identical reason (see that package's own
source-map.md).

**Verified, personally, this session:** `pnpm --dir packages/node-host exec tsc --noEmit`: clean.
`pnpm --dir packages/node-host exec vitest run --coverage`: **65/65 tests pass** (62 pre-existing +
3 new tests exercising `GET /api/agents` and both the default-deny and configured-resolver paths of
`POST /api/resources/:resourceRef/open-in` end-to-end against a real booted daemon on a real
socket, matching this file's own established "real integration test, not a mock" convention), all
3 touched/added files **100/100/100/100**. Root `pnpm typecheck` and root `pnpm guard`: both clean.

## 2026-07-19 — `transport: 'express' | 'fastify'` switch

`CreateLocalNodeDaemonConfig.transport` (default `'express'`, for drop-in compatibility with every
existing caller) picks which of `@jini/http`'s two transport namespaces (`express`/`fastify`, see
that package's own source-map.md "Fastify transport split" section) assembles the HTTP app. Both
branches wire the matching namespace's route-registration guard, `/api` bearer-auth and
origin-guard middleware, and daemon-status routes; `mountPackHttp` is already transport-agnostic
(see `@jini/http`'s `pack-http.ts`) and is therefore called once, outside the branch, not
duplicated per transport.

**Where the two transports converge vs. diverge, concretely:** everything from bound-port
resolution (`resolveBoundPort`) through `stop()`'s graceful shutdown is one shared, transport-
agnostic implementation — both branches produce the same raw `node:http` `Server` (Fastify exposes
its own internal one via `app.server`) before that shared tail runs. The one place the two
transports' own APIs genuinely do not converge is `listen()`: Express's `http.Server#listen` throws
synchronously for some errors (e.g. an out-of-range port) and emits an async `'error'` event for
others (e.g. `EADDRINUSE`, on this Node/OS combination) — both paths are wired into one `Promise`
inside the Express branch's `listen` closure. Fastify's own `app.listen({port, host})` is
promise-based end to end and always settles its returned promise for either failure shape, needing
no such dual wiring. `stop()` closes the shared raw `Server` directly rather than calling Fastify's
own `app.close()`, so a Fastify-transport daemon skips Fastify's own `onClose` plugin-lifecycle
hook run on shutdown — a known, accepted gap since no caller in this codebase registers one today.

**`mountPackHttp` being transport-agnostic does not make a pack's own `http(app, services)`
registrar portable across transports** — this is documented in full in `@jini/http`'s own
`pack-http.ts` module doc and its source-map.md, and is why this package's two integration test
files (`create-local-node-daemon.test.ts` for Express, `create-local-node-daemon.fastify-transport.test.ts`
for Fastify) deliberately use two different `makePingPack()` fixtures rather than sharing one — an
Express-shaped handler calling `res.json(...)` throws (surfaced as a 500) when mounted on a raw
Fastify instance, since Fastify's `reply` has no `.json()` method.

### Coverage gaps closed in this pass (Part A completion, 2026-07-19)

The Fastify integration suite originally shipped as a smaller "smoke coverage" pass (see that
file's own prior module doc) that explicitly named three gaps left for a follow-up. All three are
now closed:

1. **The loopback-vs-non-loopback bearer-401 branch, at the assembled-pipeline level.** The
   Express suite's `it.skipIf(lanAddress == null)`-gated test (a real non-loopback TCP connection is
   needed to observe the 401, since the middleware unconditionally exempts loopback peers) now has
   a Fastify equivalent in `create-local-node-daemon.fastify-transport.test.ts`, gated the same way.
   The underlying unit-level branch itself already had 100% coverage in
   `packages/http/src/fastify/__tests__/api-security-middleware.test.ts` before this pass — this
   closes the *integration*-level gap specifically, mirroring the Express suite's own stated
   rationale for why that level of proof matters independently.
2. **Fastify's own `.listen()` rejection paths.** Two new tests
   (`rejects rather than handing when a second Fastify instance boots on a port already in use
   (EADDRINUSE)`, `propagates an out-of-range port from Fastify app.listen() as a rejection`) prove
   the Fastify branch's `listen` closure actually propagates a real Fastify listen failure into the
   shared `failToBind` tail — previously only the Express branch's dual sync-throw/`'error'`-event
   path had been independently exercised for this.
3. **No saved dual-boot smoke-test artifact existed.** Added
   `packages/node-host/scripts/dual-boot-smoke.ts` — a standalone (non-vitest, not coverage-counted)
   script that boots `createLocalNodeDaemon` twice, once per transport, and for each: fetches a
   caller-defined pack route, fetches `GET /api/daemon/status`, confirms the bearer-401 branch via a
   real non-loopback connection (gracefully skipped with a printed note on a fully loopback-only
   sandbox), and confirms `stop()` closes the listener. Run via
   `pnpm --filter @jini/node-host exec tsx scripts/dual-boot-smoke.ts`. Its last captured output is
   in the Part A completion report (this task's handoff), reproduced in full for posterity — both
   transports passed every check on the machine this port was verified on.

Test suite is now 60 tests across 4 files (was 57/4 before this pass — the Fastify suite gained the
3 tests above), still 100% coverage on all 4 metrics.

## 2026-07-22 — merging the Fastify transport switch into `main`: real dual-transport parity, not the reduced scope the section above describes

The "`transport: 'express' | 'fastify'` switch" section above was written against `main` as of
2026-07-19, when this package's HTTP composition consisted of only daemon-status + the caller's own
packs. By the time this branch was merged (2026-07-22), `main` had also gained the full
run/chat-orchestration work and the wiring-audit fixes documented earlier in this file — `runs`/
`agents`/`host-tools` routes are now part of `createLocalNodeDaemon`'s zero-config default for
**both** transports, not left Express-only. See `@jini/http`'s own source-map.md, "2026-07-22 —
Merging the Fastify transport split into main" section, for the full mechanism (dual-mounting the
same `JsonRouteSpec` objects via each transport's own `mountJsonRoute`, and generalizing the SSE
run-events primitive off Express's `Response` onto raw `node:http`'s `ServerResponse`).

**Dependencies, current and accurate:** `@jini/core`, `@jini/daemon`, `@jini/sqlite`, `@jini/http`
(the route-pack registrar, both security middlewares, the route-registration guard,
`configuredAllowedOrigins`, the generic daemon-status routes, and the runs/agents/host-tools route
packs — from either its `express` or `fastify` namespace), `@jini/sidecar` (the local
daemon-registry record). `express` (`^4.21.0`) + `@types/express`, and `fastify` (`^5.10.0`) — this
package's own composition root creates the real Express or Fastify app depending on `transport`,
and both branches now mount an identical route set.

**Registry-record writing (`@jini/sidecar`) is transport-independent** — it runs identically for
both branches, since both converge on the same raw `server` before that logic runs; this was
already true of the 2026-07-21 discovery-record work above, just confirmed explicitly here since
that section predates the transport switch's own merge.

**Verified, personally, this session:** `pnpm --dir packages/node-host exec tsc --noEmit`: clean.
`pnpm --dir packages/node-host run test:coverage`: **78/78 tests pass** (3 new tests added to
`create-local-node-daemon.fastify-transport.test.ts` proving `GET /api/agents`,
`POST /api/resources/:resourceRef/open-in`, and the run-create/status/SSE-stream vertical slice all
work end-to-end against a real booted Fastify-transport daemon — the direct Fastify-transport
equivalents of this package's own pre-existing Express-transport reachability tests). Coverage:
**100% on all 4 metrics**, every file. Root `pnpm typecheck` and `pnpm guard`: clean.

## 2026-07-22 addition — real zero-config retry-classifier default wired (`resumableFromProcessExit`)

`createLocalNodeDaemon`'s `createAgentExecutor({lifecycle, journal})` call never supplied a
`classifyFailure` — `@jini/daemon`'s gap 4 port and `decideSafeRunRetry` (`run/core/retry.ts`) were
both fully built and tested, but nothing connected them, so every real daemon booted by this preset
hardcoded `resumable: false` regardless of cause. Fixed by wiring
`classifyFailure: ({ code, signal, sideEffects }) => resumableFromProcessExit(code, signal,
sideEffects)` — a third zero-config-safe default alongside `agents`/`host-tools`. See
`packages/daemon/source-map.md`'s own dated entry for the full classification policy, the real
`userVisibleOutputSeen`/`toolCallSeen` side-effect wiring, and — importantly — the record of a
*second*, independently-built classifier (`defaultClassifyFailure`/`classifyProcessExitFailure` in
`agent-executor.ts`, from a parallel cloud session's branch) that was found and deliberately
**rejected** at merge time in favor of keeping this one, with the reasoning for that choice.

**Verified, personally, this session**: `pnpm --dir packages/node-host exec tsc --noEmit`: clean.
`pnpm --dir packages/node-host run test:coverage`: all tests pass, `create-local-node-daemon.ts`
**100/100/100/100**.

## 2026-07-22 addition — six more route packs wired zero-config-safe, one re-verified genuinely blocked (audit fix)

**Merge note**: this section was written on a branch that forked before the `transport: 'express' |
'fastify'` switch existed, so its wiring (below) is Express-only by construction — it calls each
route pack's flat `register*Routes` function directly, not through either of `@jini/http`'s
`express`/`fastify` namespaces. At merge time, this wiring was placed in `createLocalNodeDaemon`'s
Express-transport branch specifically, **by explicit instruction to table Fastify parity for these
six packs for now** rather than build it as part of this merge. A `transport: 'fastify'` daemon
today therefore does not serve `memory`/`terminals`/`model-proxy`/`active-context`/`db-ops`/`media`
— only `runs`/`agents`/`host-tools`/`daemon-status` have real Fastify mounting siblings (see
`@jini/http`'s own source-map.md). This is a known, deliberate, tracked scope gap (matching the
Fable audit's AUD-004 finding), not silently dropped — a follow-up task should build
`fastify/{memory,terminals,model-proxy,active-context,db-ops,media}.ts` mounting siblings the same
way `fastify/runs.ts`/`fastify/agents.ts`/`fastify/host-tools.ts` were built, then move this
wiring's Express-only placement to run identically in both transport branches.

**Gap found by independent audit**: the six route packs this file's own prior text left
"genuinely NOT wired" (memory, routines, terminals, model-proxy, db-ops, active-context) were
accepted at face value by an earlier pass without re-deriving whether each one *actually* lacked a
safe zero-config default, the same way `agents`/`host-tools` turned out to have one despite
initially looking like they needed host input. Per this task's own standing instruction not to
accept that reasoning without checking it, all six (plus `media.ts`, added the same day) were
re-investigated from the real `HttpDeps` interfaces and factory functions, not from the prior
doc's summary of them.

**Wired in, each with a real, harmless, provably-safe default:**

- **`memory.ts`** — `@jini/memory`'s `NoteStore` methods take `dataDir` *per call*, not bound to
  one directory at construction (`createNoteStore(config)`'s `config` only carries the
  `validTypes`/`defaultType` taxonomy, itself deliberately host-defined-not-derived per that
  package's own doc). `config.dataDir` — already trusted, already where `events.db`/`journal.db`
  live — is therefore a real, non-fabricated root, not a guess. `createExtractionLog()`/
  `createVerifyLog()` take no arguments at all. Wired with `validTypes: ['note']`,
  `defaultType: 'note'` — the minimal generic single-bucket taxonomy.
- **`terminals.ts`** — re-investigated after the prior doc claimed "no safe no-op form." That
  claim didn't hold up: `terminalCreateRoute.handle` calls `resolveWorkspaceRoot` (defaulting to
  `denyAllWorkspaceRoots`, exactly `host-tools.ts`'s own already-proven-safe default) **before**
  `ToolExecutor.execute` is ever reached — a real PTY is never spawned unless a host supplies its
  own `resolveWorkspaceRoot`. Independently, `@jini/daemon`'s `createTerminalToolRegistrations`
  itself defaults `terminal.create`'s policy to the already-exported `denyAllTerminalCreatePolicy`
  (deny-by-default, the exact same shape as `db-ops.ts`'s `denyAllDaemonDbPolicy`) — two
  independent deny-by-default gates, not one. `createTerminalSessionManager()` needs zero
  arguments (dynamically imports `node-pty` only on an actual spawn attempt, per its own doc).
  `principal` is the one genuinely mandatory field with no default of its own — filled with a new
  `LOCAL_DAEMON_PRINCIPAL` constant (`{id: 'local-daemon'}`), justified in its own doc comment:
  this preset has no multi-tenant identity system anywhere else either (the bearer-token gate is
  is-authenticated-or-not, not per-caller), so one fixed identity removes no real distinction.
- **`model-proxy.ts`** — every field of `ModelProxyHttpDeps` is already optional; the routes are
  BYOK (`apiKey`/`model` supplied per-request in the POST body). `{}` is a fully real, working
  zero-config default — the prior doc's own claim that "the route already handles [BYOK] per-call"
  was correct but stopped short of noticing that made the *whole pack* wireable, not just the
  request path.
- **`active-context.ts`** — `resolveResource` is mandatory but has an honest, harmless answer this
  preset can always give: "unknown" (`() => undefined`), the same "no fabricated data" shape
  `denyAllWorkspaceRoots` already uses. Verified via `resolveResource`'s own doc ("may return
  `null`/`undefined` if the ref is unknown") and `handleGetActive`'s real handling of that case
  (`resource?.name ?? null`) — an explicitly designed-for path, not an edge case being abused.
- **`db-ops.ts`** (`daemon.db.*`) — `DaemonDbHttpDeps.policy` defaults to the already-exported
  `denyAllDaemonDbPolicy` the exact same way `terminals.ts` does. `DaemonDbOperations`'s own doc
  names its intended real backing directly: "`@jini/sqlite`'s `inspectSqliteDatabase`/
  `verifySqliteIntegrity` plus a small `vacuum` wrapper around `db.exec('VACUUM')`" — both already
  exist and are already exported from `@jini/sqlite`; only the `vacuum` wrapper needed writing
  (`buildDaemonDbOperations`, new in this file, exported for direct unit testing since the
  deny-by-default policy means no real HTTP-level test can reach its body — matching this repo's
  established "extract into a directly-testable pure function" convention for exactly this
  reachability shape). Built against a **second** `better-sqlite3` connection to the same
  `events.db` file this preset already owns — safe because both run in WAL mode, which the
  existing `stop() releases the sqlite file handle` test already proves empirically permits two
  concurrently open handles on one file in-process. `VACUUM` rewriting a file another connection
  may be concurrently writing to is a real operational consideration, flagged in
  `buildDaemonDbOperations`'s own doc — but it's a consideration a host takes on only by
  consciously supplying a permissive policy in the first place; it is not this zero-config
  default's own doing.

**Left genuinely NOT wired — re-verified with a real, concrete blocker, not inherited from the
prior pass's summary:**

- **`routines.ts`** — `RoutineHttpDeps.scheduler: RoutineScheduler` is backed by `@jini/daemon`'s
  `RoutineService`, whose constructor requires a `RoutinePersistence` — and `RoutinePersistence`'s
  `list()`/`insertRun()`/`updateRun()`/`getLatestRun()` are **deliberately synchronous** (no
  `Promise` anywhere in that interface — confirmed by reading `types.ts`'s own doc: "why
  `RoutinePersistence` deliberately stays synchronous rather than converted to this package's
  usual async-port convention"). `RoutineStore` (the CRUD side `routines.ts`'s own `store` field
  needs) is fully `async` (`list(): Promise<...>`, etc. — the package's *usual* convention
  `RoutinePersistence` explicitly opted out of). `createInMemoryRoutineStore()` structurally
  cannot satisfy `RoutinePersistence` — its methods return Promises, not the plain synchronous
  values that interface's own type signature requires — so there is no single zero-config object
  that is simultaneously a valid `RoutineStore` and a valid `RoutinePersistence`. A real bridge (a
  second, purpose-built synchronous in-memory `RoutinePersistence` whose writes are also mirrored
  into the async `RoutineStore` so `lastRun`/history stay visible through the CRUD API) is genuine,
  scoped, new logic — not a two-line default — and was not attempted in this pass. This is the one
  route pack in the original six where the prior doc's "needs a `RoutineStore` plus the scheduler
  engine's own persistence" claim held up under re-investigation.

**Verified, personally, this session**: `pnpm --dir packages/node-host exec tsc --noEmit`: clean.
`pnpm --dir packages/node-host run test:coverage` — **76/76 tests pass** (11 new: one per newly-
wired route pack proving its safe-by-default behavior end-to-end against a real booted daemon, plus
3 direct `buildDaemonDbOperations` unit tests against a real temp sqlite file, plus a media-task-
store-survives-restart durability test), `create-local-node-daemon.ts` **100/100/100/100**. New
dependencies added to `package.json`: `@jini/media`, `@jini/memory`, `better-sqlite3` (+
`@types/better-sqlite3` dev) — `@jini/sqlite` already depended on the latter two transitively; this
file now imports `Database` directly for the `daemon.db.*` second connection.

## 2026-07-22 addition — Fastify transport removed, `transport` config option gone

`CreateLocalNodeDaemonConfig.transport?: 'express' | 'fastify'` and the `if (config.transport ===
'fastify') { ... } else { ... }` branch this file's own 2026-07-19/2026-07-22 sections above
documented are both gone — this preset now unconditionally assembles a single Express app. See
`@jini/http`'s own source-map.md "Fastify transport removed" entry for the full reasoning (no real
consumer ever used `transport: 'fastify'`, and it cost a recurring parity-tracking tax on every new
route pack). The removed implementation is preserved unchanged on the `future/fastify-transport`
branch (`FASTIFY-TRANSPORT-PARKED.md` at that branch's root has the revival notes).

`packages/node-host/src/__tests__/create-local-node-daemon.fastify-transport.test.ts` and
`packages/node-host/scripts/dual-boot-smoke.ts` were deleted (both existed solely to exercise/
demonstrate the two-transport switch). `fastify` was removed from `package.json`'s dependencies.

**Verified, personally, this session**: `pnpm --dir packages/node-host run build`/`exec tsc
--noEmit`: clean. `pnpm --dir packages/node-host run test:coverage`: **78/78 tests pass**, genuine
**100/100/100/100** across every file. Root `pnpm guard`: clean.

## 2026-07-23 — optional capabilities moved to the composition root

Fixing R7 exposed that this locked host preset directly instantiated incubating `@jini/memory` and
`@jini/media`. Those imports and package dependencies are removed. `httpExtensions` is now the
neutral composition seam: an extension receives the guarded Express app plus adapter,
`RunLifecycle`, and `dataDir` context after the locked security/base routes are mounted. Its
composition root owns any capability resources and closes them through `onShutdown`.

`examples/reference-web` now demonstrates the intended direction by registering memory, media, and
AG-UI stream routes and owning the media-task-store lifetime. The node-host test suite replaces
capability-specific zero-config assertions with an extension-mount test and an assertion that
incubating routes are absent unless explicitly composed.

Verified: `pnpm --filter @jini/node-host build`; `pnpm --filter @jini/node-host typecheck`;
`pnpm --filter @jini/node-host exec vitest run --testTimeout=15000` (**78/78**).

## 2026-07-29 addition — `sidecar-strict` security mode; `agents` filtered by executor compatibility

**Nothing was ported.** Two additions to existing assemblies.

### `composeJiniKernel`'s third security mode

`security` gained a `sidecar-strict` arm alongside `host` and `jini-local`, for a daemon whose threat
model is another process running as the same OS user. It installs `@jini-ai/http-kit`'s
`requireStrictBearerToken` (no loopback exemption, no disable flag, fail-closed 503) plus the usual
origin guard.

**Additive by construction, not by promise.** The modes are arms of a discriminated union, so the two
existing arms cannot be altered by adding a third — and a test asserts each still installs exactly what
it did. `tokenEnvVar` is required with no default: this package does not name a host's secret.

**One mounting-order change, and it is load-bearing.** The strict bearer gate mounts *ahead of*
`express.json()`, unlike `jini-local`'s gate which mounts after. A caller this gate will reject with 401
should never have had its body parsed, and the gate needs nothing the parser provides — only `req.path`
and the `Authorization` header. The module's mounting-order doc was renumbered accordingly.

Asserting that ordering took some thought. It is invisible to the route-registration inventory, because
the gate mounts with a bare `app.use(handler)` and the inventory records only string-path registrations.
It is instead proven behaviorally with a malformed JSON body: the parser answers 400, the gate answers
401, and whichever runs first wins — so an unauthenticated request yields 401 while an authenticated one
yields 400. The pair matters; the first assertion alone would also pass if the body were simply never
parsed by anyone.

`probe`-phase routes mount before the gate, so health/readiness/version stay reachable without a
credential. That falls out of the existing phase order rather than needing an exemption.

### `agents` now filters on executor compatibility

The feature scanned every runtime definition, so a composition could advertise `antigravity` — which
`AgentExecutor` explicitly rejects — and hand a user a choice that failed the instant it was selected.
`isExecutableDetectedAgent` applies `@jini-ai/daemon`'s `isAgentExecutorSupported` by default.

Two decisions worth recording:

- **Assessed against the full `RuntimeAgentDef` resolved by id, not the `DetectedAgent` in hand.** The
  projected type omits `maxPromptArgBytes`, and the argv-bound defs (`aider`, `deepseek`) qualify *solely*
  through it. Filtering on the projection would have removed two working agents while fixing one broken
  one — a strictly worse bug. There are tests for exactly this.
- **An id with no registered def is kept, not dropped.** A host supplying its own `detector` may
  legitimately surface agents driven by something other than this executor. There is nothing to assess,
  and refusing to advertise them would break that host on no evidence.

Filtering by default is a behavior change for an existing consumer — `antigravity` disappears from
`GET /api/agents`. Taken deliberately: the previous behavior was a bug rather than a contract, and
`options.agents.detector` remains an escape hatch for any host that disagrees.

**Verified, personally, this session**: `pnpm --filter @jini-ai/server run typecheck` clean; the package's
full suite **195/195 passing** (7 files), including 8 new `sidecar-strict` tests and 4 new filtering tests.
`pnpm guard` clean.

## 2026-07-29 — post-merge audit fixes (six teardown/config/URL defects)

Independent review of the `feat/agentic-capability-layer` merge (OpenAI Codex `gpt-5.6-sol` as peer
reviewer, then re-verified against source here) surfaced six real defects in this package. Each was
reproduced with a failing test before any fix landed.

**1. Caller packs were never disposed.** `composeJiniKernel` calls `createDaemon` on `config.packs`,
so it — not the caller — builds their services; but neither the failure-cleanup path nor `close()`
ever ran their `dispose`. A caller pack whose `services()` opened a socket, timer or database handle
leaked it past `createLocalNodeDaemon().stop()`, and the wrapper exposes no caller daemon for the
host to tear down itself. Added `JiniKernel.disposeCallerPacks()` — memoized, best-effort, symmetric
with `disposeFeatures()` — called by `close()`, by the composition-failure `catch`, and by the
daemon's `stop()`. Disposal order is reverse of construction: features first (they were composed
against an already-built caller daemon), caller packs second.

**2. `journal.db` opened outside the cleanup block.** `createJiniKernelBase` opened `events.db`, then
`journal.db`, and only *then* entered the `try` whose `catch` closed them. `journal.db` failing (a
corrupt file, or a directory sitting where a database was expected) left the `events.db` handle open
in a process that has no kernel. Every acquisition now happens inside the one block, tracked in an
`opened` array the cleanup drains — the shape the module's own comment already claimed.

**3. Capability keys were not runtime-validated.** Feature ids in `config.features` threw on a typo;
capability ids in `config.capabilities` did not. `{'host:exce': false}` deleted a grant nobody held,
so `host:exec` survived and `terminal`/`hostTools` stayed mounted — a security switch that fails
*open* on a typo, in the direction that reads as applied. `feature.ts` now carries the runtime half
of `CapabilityId` as a `Record<CapabilityId, true>` (drift is a compile error in both directions, so
the list cannot silently fall behind the union it validates) plus `CAPABILITY_IDS`/`isCapabilityId`;
`resolveFeatureActivation` validates the keys next to where it validates feature ids.

**4. An injected `config.env` never reached the per-route same-origin guard.** `env[JINI_BIND_HOST] =
host` writes into the caller's object when one is supplied, and `@jini-ai/http-kit`'s `guardSameOrigin`
read real `process.env`. The origin-guard *middleware* was already handed the injected `env`, so the
two halves of one decision read two different environments: the middleware admitted an origin the
host configured through `config.env` and the route then rejected it. Fixed at the seam —
`OriginContext` (and so `AdapterContext`) grew an optional `env`, defaulting to `process.env`, and
this preset sets it. That covers `JINI_BIND_HOST`, `JINI_ALLOWED_ORIGINS` and `JINI_WEB_PORT` alike.

**5. Shutdown could skip its own teardown, or crash the process.** `closeHttpServer` rejecting (which
its own contract documents) skipped feature disposal, discovery-record removal, `onShutdown` and the
sqlite close — leaving a half-torn-down daemon, strictly worse than the failure that caused it. It is
a `try`/`finally` now; the original rejection still propagates once teardown finishes. Separately,
`requestShutdown` dropped `stop()`'s promise with a bare `void`, so a failing shutdown became an
unhandled rejection — which on Node's default policy terminates the process this was gracefully
shutting down. It is reported through `console.error` now; the rejection stays on `stopPromise` so an
explicit `stop()` caller still observes it.

**6. `resolveReportHost` produced an unparseable URL for an IPv6 bind host.** `'::1'` passed through
unchanged, so the reported base URL was `http://::1:54321` — which `new URL()` and `fetch` both
reject, and which was written verbatim into the discovery record. It now returns the bracketed
authority form (RFC 3986 §3.2.2), idempotently.

Two lower-severity items from the same review, also fixed:

- **`agents`' scan cache was not keyed by promise identity.** A slow scan that failed *after* `POST
  /api/agents/rescan` had already replaced it with a successful one cleared the newer entry, forcing
  a duplicate probe of every agent CLI on the machine. The `catch` now clears only its own entry.
- **`createFrontendControl`'s bind boundary did not cover `resolveBindToken` or its own error sink.**
  A `RunStartHandler` throwing is not a no-op — `@jini-ai/http-kit`'s run-start route marks the run
  `failed` and answers 500 — so a host-supplied `resolveBindToken` throwing (it parses an opaque host
  blob) produced exactly the killed run the `onBindError` doc promises never to cause. Both are inside
  the boundary now; a throwing sink is swallowed, because the reporting channel is what failed.

**One pre-existing gap closed while here.** The package's committed 100% function-coverage gate was
already failing on `main` (99.09%): `sidecar-strict`'s origin-guard `getResolvedPort` closure had no
end-to-end coverage, because both of that mode's gates are request-time middleware. Added six real
`security: sidecar-strict` tests (unauthenticated 401, authenticated 201, cross-origin 403 with a
valid token, unset-token 503, probe routes reachable tokenless, `exemptPaths`) — the one block in
`compose-jini-kernel.test.ts` that opens a socket, and only because it has to.

**Verified, personally, this session**: `packages/server` **231/231 passing** across 8 files (was
215 before the sidecar-strict block), **100/100/100/100 coverage**; `packages/http-kit` 1245/1245 and
100% ; `packages/chat-core` 261/261; `packages/chat-react` 610/610 and 100%;
`examples/reference-web` 41/41. Repo-wide `pnpm typecheck` and `pnpm guard` clean.
