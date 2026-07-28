/**
 * @module create-local-node-daemon
 *
 * The "host preset" (extraction-plan.md §2.4) that lets a brand-new product boot a running daemon
 * process by implementing zero interfaces: assembles `@injini/sqlite`'s durable `EventLog`,
 * `@injini/daemon`'s `RunLifecycle` and `AgentExecutor` (the driver that actually spawns an agent
 * CLI subprocess for 23 of the 24 registered defs — see `@injini/daemon`'s own source-map.md), an HTTP
 * app wrapped in `@injini/http`'s route-registration guard and security middleware, a caller's own
 * `@injini/core` packs, and the generic daemon-status routes, then listens and returns `{url, server,
 * stop}`. Generalized from OD's `startServer()` — see `source-map.md` for the exact line-by-line
 * provenance and drop-list (every plugin/design-system/connector/routine/media/marketplace/
 * telemetry/project route `startServer` also wires is explicitly out of scope; this is the generic
 * assembly skeleton only).
 *
 * Also writes (2026-07-21) a `@injini/sidecar`-backed local daemon-registry record — see
 * `resolveDaemonRegistryPath`'s own doc and this file's `CreateLocalNodeDaemonConfig.discoveryFile`
 * — once the real bound port is known, and removes it during `stop()`. This is the missing daemon
 * side of `@injini/cli`'s `resolveDaemonUrl({ discover })` injection point (see that package's
 * `local-daemon-discovery.ts` and its own `source-map.md`'s 2026-07-21 investigation, which found
 * no such record existed anywhere a separate CLI process could read).
 *
 * This preset supported a switchable `transport: 'express' | 'fastify'` HTTP transport from
 * 2026-07-19 through 2026-07-22; it was removed since nothing ever consumed `transport: 'fastify'`
 * in practice — see `source-map.md`'s dated entry and the `future/fastify-transport` branch (which
 * preserves the removed implementation unchanged, with a note on why and how to revive it).
 */
import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';

import express, { type Express } from 'express';
import { detectAgents, type DetectedAgent, type OAuthCallbackListener } from '@injini/agent-runtime';
import { bindings, createDaemon, createToolRegistry, type Bindings, type Daemon, type Principal, type ToolRegistration } from '@injini/core';
import type { AnyPack, MissingTokenIds } from '@injini/core/internal';
import {
  AgentExecutorToken,
  createAgentExecutor,
  createDefaultRunStartHandler,
  createRunByteJournal,
  createRunLifecycle,
  createTerminalSessionManager,
  createTerminalToolRegistrations,
  createToolExecutor,
  EventLogToken,
  resumableFromProcessExit,
  RunLifecycleToken,
  type ResolveRunInput,
  type RunLifecycle,
  type RunRetrySideEffectState,
} from '@injini/daemon';
import {
  createSqliteEventLog,
  ensureToolCatalogTables,
  getToolCatalogEntry,
  inspectSqliteDatabase,
  reseedToolCatalog,
  searchToolCatalog,
  verifySqliteIntegrity,
} from '@injini/sqlite';
import {
  configuredAllowedOrigins,
  createDaemonDbToolRegistrations,
  denyAllWorkspaceRoots,
  installRouteRegistrationGuard,
  mountPackHttp,
  registerActiveContextRoutes,
  registerAgentRoutes,
  registerApiBearerAuthMiddleware,
  registerApiOriginGuardMiddleware,
  registerConnectorsRoutes,
  registerDaemonDbRoutes,
  registerDaemonStatusRoutes,
  registerDelegatedToolRoutes,
  registerHealthRoutes,
  registerHostToolsRoutes,
  registerModelProxyRoutes,
  registerResearchRoutes,
  registerRunRoutes,
  registerTerminalRoutes,
  registerToolCatalogRoutes,
  registerXaiRoutes,
  type AdapterContext,
  type AgentSummary,
  type DaemonDbOperations,
  type DaemonDbVacuumResult,
  type DelegatedToolExecuteRequest,
  type RunStartHandler,
  type WorkspaceRootResolver,
} from '@injini/http';
import { removeDaemonRegistryRecordIfCurrent, resolveDaemonRegistryPath, writeDaemonRegistryRecord } from '@injini/sidecar';

import { closeHttpServer, normalizeDaemonBindHost } from './host-bootstrap.js';

const require = createRequire(import.meta.url);
/** This package's own `package.json` version, echoed back by `GET /api/daemon/status`. Read once at module load — never changes for the life of the process. */
const packageVersion = (require('../package.json') as { readonly version: string }).version;

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_TOKEN_ENV_VAR = 'JINI_API_TOKEN';
const DEFAULT_DISABLE_ENV_VAR = 'JINI_DISABLE_API_AUTH';
const DEFAULT_BIND_HOST_ENV_VAR = 'JINI_BIND_HOST';

/**
 * The identity every zero-config, `ToolExecutor`-gated route this preset wires (`terminal.create`,
 * `daemon.db.*`) executes as. This preset has no multi-tenant identity subsystem of its own — the
 * bearer-token gate (`registerApiBearerAuthMiddleware`) is a single is-authenticated-or-not check,
 * not a per-caller identity — so every authenticated caller of a given daemon process already
 * shares one trust boundary; a single fixed `Principal` here doesn't remove any distinction that
 * existed before it. A host that needs real per-caller identity supplies its own `toolExecutor`/
 * `principal` via a custom pack instead of this preset's zero-config default (matching
 * `delegated-tools.ts`'s mandatory, no-default `resolvePrincipal` for the one route in this
 * package that genuinely does need per-request identity).
 */
const LOCAL_DAEMON_PRINCIPAL: Principal = { id: 'local-daemon' };

/**
 * The identity a delegated tool call runs as when the host has not supplied
 * {@link CreateLocalNodeDaemonConfig.resolveDelegatedPrincipal}.
 *
 * Carries **no roles**, deliberately. `@injini/http`'s `delegated-tools.ts` documents
 * `resolvePrincipal` as mandatory because "there is no safe default identity this package could
 * assume on a host's behalf" — and that stays true. What makes a default acceptable *here* is that
 * this preset's inertness never depended on identity in the first place: every tool it registers
 * is guarded by a deny-by-default `ToolPolicy` (`denyAllTerminalCreatePolicy`,
 * `denyAllDaemonDbPolicy`, `@injini/daemon`'s `denyAllFrontendCapabilityPolicy`), so an anonymous
 * caller is refused by the policy rather than by the absence of a route. A host that grants access
 * does so by supplying a permissive policy through `toolRegistrations` — an explicit act — and a
 * host that wants real identities to branch on supplies `resolveDelegatedPrincipal`.
 *
 * Mounting-but-inert matches this preset's established shape for every other capability it cannot
 * configure on a host's behalf (`registerConnectorsRoutes`' 503 slots, `registerXaiRoutes`,
 * `denyAllWorkspaceRoots`): the route is reachable and diagnosable instead of a 404 that looks
 * like a missing build.
 */
const ANONYMOUS_DELEGATED_PRINCIPAL: Principal = { id: 'anonymous-delegated' };

/**
 * Builds a `DaemonDbOperations` (see `@injini/http`'s `db-ops.ts`) against `db` — a *second*
 * `better-sqlite3` connection to the same `events.db` this preset already owns (safe: both
 * connections run in WAL mode, which permits multiple concurrently open handles on one file
 * within a single process — the same fact `create-local-node-daemon.test.ts`'s own
 * `stop() releases the sqlite file handle` test already relies on empirically). `inspect`/`verify`
 * are thin wrappers over `@injini/sqlite`'s own `inspectSqliteDatabase`/`verifySqliteIntegrity`;
 * `vacuum` is the "small wrapper around `db.exec('VACUUM')`" `db-ops.ts`'s own `DaemonDbOperations`
 * doc names as the missing piece — measuring the primary file's on-disk size before/after (not the
 * `-wal`/`-shm` sum `inspectSqliteDatabase` reports, since a fresh `VACUUM` checkpoints and shrinks
 * the primary file itself, which is what "reclaimed" means here).
 *
 * Reachable at all only when a host supplies a permissive `ToolPolicy` in place of this preset's
 * own zero-config `denyAllDaemonDbPolicy` default (see this file's `daemon.db.*` wiring below) —
 * `vacuum` rewrites the database file in place, so running it against a file another connection
 * (this same process's own `eventLog`) may be concurrently writing to is a real operational
 * consideration a host opts into consciously, not something this zero-config default does on its
 * own initiative.
 */
export function buildDaemonDbOperations(db: Database.Database, file: string): DaemonDbOperations {
  return {
    inspect: () => inspectSqliteDatabase({ db, file }),
    verify: (quick: boolean) => verifySqliteIntegrity({ db, quick }),
    vacuum: (): DaemonDbVacuumResult => {
      const startedAt = Date.now();
      const beforeBytes = statSync(file).size;
      db.exec('VACUUM');
      const afterBytes = statSync(file).size;
      return {
        ok: true,
        beforeBytes,
        afterBytes,
        reclaimedBytes: Math.max(0, beforeBytes - afterBytes),
        elapsedMs: Date.now() - startedAt,
      };
    },
  };
}

/**
 * Gap 4's zero-config retry-classifier default (`classifyFailure`), wired into `createAgentExecutor`
 * below. Extracted as its own named, exported function rather than an inline arrow — the same
 * reason `buildDaemonDbOperations` above is: `daemon/source-map.md`'s 2026-07-22 wiring entry
 * already documents this call site as *not* independently re-provable via a live spawned-process
 * integration test (that would need either a real, predictably-failing agent CLI installed in
 * every dev/CI environment, or new test-only spawn-injection hooks — both a worse trade than making
 * the wiring itself directly unit-testable, matching this file's own established convention for
 * exactly this reachability shape). Delegates entirely to `@injini/daemon`'s
 * `resumableFromProcessExit` — see that function's own doc for the classification policy and the
 * real `sideEffects` this now threads through (forwarded verbatim from `@injini/daemon`'s own
 * `FailureClassificationContext`, which every real close handler populates).
 */
export function classifyRunFailureForRetry(context: {
  code: number | null;
  signal: string | null;
  sideEffects?: Pick<RunRetrySideEffectState, 'userVisibleOutputSeen' | 'toolCallSeen'>;
}): boolean {
  return resumableFromProcessExit(context.code, context.signal, context.sideEffects);
}

/**
 * Extracts the real bound TCP port from `server.address()`'s result once a `'listening'` event
 * has fired. Pulled out as its own pure function (rather than inlined) so the belt-and-braces
 * "somehow still not a port" branch — `server.address()` is typed `AddressInfo | string | null`
 * for the general `net.Server` case, but is always a real `AddressInfo` with a positive `.port`
 * for the TCP listener this module creates — is directly unit-testable without needing a real
 * socket or any mocking.
 *
 * @param address - The raw return value of `server.address()`.
 * @returns The bound port, or `null` if `address` is `null` (not yet listening), a string (a Unix
 * domain socket path — this module never listens on one), or an `AddressInfo` with a non-positive port.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function resolveBoundPort(address: { port: number } | string | null): number | null {
  if (address == null || typeof address === 'string') return null;
  return address.port > 0 ? address.port : null;
}

/**
 * The host a daemon's reported base URL should use: binding to every interface (`0.0.0.0` /
 * `::`) is not itself a connectable address, so callers are told to use the IPv4 loopback address
 * instead. Any other bind host is echoed back verbatim.
 *
 * @param bindHost - The literal host `createLocalNodeDaemon` bound to (already normalized).
 * @returns `'127.0.0.1'` for an all-interfaces bind host, otherwise `bindHost` unchanged.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function resolveReportHost(bindHost: string): string {
  return bindHost === '0.0.0.0' || bindHost === '::' ? '127.0.0.1' : bindHost;
}

/** The token ids `createLocalNodeDaemon` always binds itself, before any caller customization runs. */
export type KernelBoundIds = 'jini.eventLog' | 'jini.runLifecycle' | 'jini.agentExecutor';

/**
 * Product-level HTTP composition seam. Incubating capabilities register their routes here instead
 * of becoming downward dependencies of this locked host preset.
 */
export interface LocalNodeHttpExtensionContext {
  readonly adapter: AdapterContext;
  readonly lifecycle: RunLifecycle;
  readonly dataDir: string;
}

export type LocalNodeHttpExtension = (app: Express, context: LocalNodeHttpExtensionContext) => void;

export interface CreateLocalNodeDaemonConfig<
  Packs extends readonly AnyPack[],
  BoundIds extends string = KernelBoundIds,
> {
  /** Directory the daemon's durable state lives in. Created implicitly by `better-sqlite3` opening `<dataDir>/events.db` — the directory itself must already exist. */
  dataDir: string;
  packs: Packs;
  /**
   * Extends the kernel's own pre-bound `EventLog`/`RunLifecycle` bindings with whatever a pack's
   * own deps require. A callback rather than a pre-built `Bindings` instance because
   * `Bindings.bind()` mutates and returns `this` — two independently constructed instances can't
   * be merged, so the caller must chain directly onto the instance this function already seeded.
   */
  bindings?: (b: Bindings<KernelBoundIds>) => Bindings<BoundIds>;
  /** TCP port to listen on. Defaults to `0` (ask the OS for an ephemeral free port). */
  port?: number;
  /** Host/address to bind to. Defaults to `'127.0.0.1'` (loopback-only). */
  host?: string;
  /** Env var names for the optional bearer-token gate. Defaults to `JINI_API_TOKEN` / `JINI_DISABLE_API_AUTH`. */
  apiToken?: { tokenEnvVar?: string; disableEnvVar?: string };
  /** Invoked once the HTTP listener has fully closed, before the durable `EventLog` is closed. Any rejection still lets shutdown finish (see `stop()`'s doc), but propagates to the `stop()` caller. */
  onShutdown?: () => Promise<void> | void;
  /** Defaults to `process.env`. Threaded through for testability — see this module's own doc on the one place (`JINI_BIND_HOST`) this still touches the real process env regardless. */
  env?: NodeJS.ProcessEnv;
  /**
   * Optional detector override for a host with custom PATH/env policy or a
   * deterministic test fixture. Defaults to `@injini/agent-runtime`'s real
   * concurrent CLI/version/auth/model probe.
   */
  agentDetector?: () => Promise<readonly DetectedAgent[]>;
  /**
   * Optional host-owned driver attached immediately after `POST /api/runs` durably starts a run.
   * Takes full precedence over {@link resolveRunInput} when both are supplied — a host that
   * wants complete control over run-start behavior should use this, not compose alongside the
   * default handler.
   */
  onRunStarted?: RunStartHandler;
  /**
   * Host-owned prompt/cwd/env composition seam (gap 1 of the run/chat orchestration
   * swarm-consensus Final Recommendation — see
   * `ADS-memory/reports/swarm-consensus/runs/20260722T023000Z-consensus-report.md`). When
   * supplied and `onRunStarted` is not, this daemon builds a default `RunStartHandler` via
   * `@injini/daemon`'s `createDefaultRunStartHandler` that resolves each run's input through this
   * seam and drives it straight to the zero-config `AgentExecutor` this preset already
   * constructs. Ignored when `onRunStarted` is supplied — see that option's own doc. Omit both to
   * durably start runs with no driver attached at all (unchanged prior behavior).
   */
  resolveRunInput?: ResolveRunInput;
  /**
   * Resolves a `resourceRef` (an opaque, host-defined identifier — this preset has no `Project`/
   * `Workspace` noun of its own) to a filesystem working directory for `@injini/http`'s
   * `POST /api/resources/:resourceRef/open-in` route (always mounted — see below). Defaults to
   * `denyAllWorkspaceRoots`: with no resolver supplied, the route exists and is reachable but
   * denies every call with `404`, never fabricating or guessing a path. A host that wants the
   * route to actually do anything supplies this.
   */
  resolveWorkspaceRoot?: WorkspaceRootResolver;
  /**
   * Optional product/capability route registrars. They run after the host's security middleware
   * and locked route packs, before caller packs and daemon-status routes. Resource cleanup remains
   * owned by the composition root via `onShutdown`.
   */
  httpExtensions?: readonly LocalNodeHttpExtension[];
  /**
   * Host-contributed `{descriptor, handler, policy}` triples, registered into the same internal
   * registry this preset's own gated tools (`jini.terminal.create`, `daemon.db.*`) use — and so
   * executed through the same `ToolExecutor`, inheriting its authorization, confirmation, timeout,
   * cancellation, output truncation, and audit trail.
   *
   * This exists because that registry is otherwise private: a host had no way to contribute to it,
   * which is precisely the pressure that produces a second, weaker execution path alongside the
   * gated one. The motivating case is a capability the daemon cannot implement itself because it
   * has to run somewhere else — an attached browser surface reached through `@injini/daemon`'s
   * `FrontendSessionRegistry`, where the handler's job is to route the call and await an answer
   * rather than to do the work.
   *
   * Registration order is preserved, and these are registered after the preset's own tools so a
   * collision names the host's id rather than silently shadowing a built-in.
   *
   * @throws At startup if a `descriptor.id` is already registered — by another entry here, or by
   * one of the preset's own tools. The registry is append-only by design; re-registration must be
   * explicit, never implicit.
   */
  toolRegistrations?: readonly ToolRegistration[];
  /**
   * Resolves the `Principal` one `POST /api/delegated-tool-calls` request executes as — the
   * identity every `ToolPolicy` on that path branches on.
   *
   * This route is what makes `toolRegistrations` reachable *by an agent*: a spawned CLI calls the
   * injected MCP server's `execute_delegated_tool`, which posts here, which runs the call through
   * `DelegatedToolBridge` → `ToolExecutor`. Without it the registry above is complete and
   * correct and nothing can call it.
   *
   * @default {@link ANONYMOUS_DELEGATED_PRINCIPAL} — see its doc for why a default is safe here
   * when `@injini/http` refuses to define one: inertness comes from deny-by-default policies, not
   * from the identity.
   */
  resolveDelegatedPrincipal?: (
    request: DelegatedToolExecuteRequest,
  ) => Principal | Promise<Principal>;
  /**
   * Where this daemon's local discovery record (URL/host/port/pid) is written once it starts
   * listening, so a separate CLI process on the same machine can find it via
   * `@injini/cli`'s `createLocalDaemonDiscovery`. Defaults to `resolveDaemonRegistryPath(dataDir)`
   * (`<dataDir>/daemon.json`) — the same conservative, host-overridable-default pattern
   * `resolveDaemonUrl` itself already uses, and scoped to `dataDir` so two daemons on one machine
   * (already required to use two different `dataDir`s for two independent sqlite files) never
   * collide on a single registry path. Pass `false` to disable writing a discovery record
   * entirely. Writing (and removing, on `stop()`) this record is always best-effort: a failure
   * here (e.g. an unwritable `dataDir`) never fails daemon startup or shutdown — the record is a
   * convenience for automatic discovery, not a correctness requirement, and a caller can always
   * fall back to an explicit `--daemon-url`/env var.
   */
  discoveryFile?: string | false;
}

export interface LocalNodeDaemon {
  /** The daemon's real, resolved base URL (reflects the actual bound port even when `port: 0` was requested). */
  readonly url: string;
  readonly server: Server;
  /**
   * Gracefully shuts the daemon down: closes the HTTP listener, runs the caller's `onShutdown`
   * hook, then closes the durable `EventLog` (releasing the sqlite file handle). Idempotent and
   * safe to call more than once, or concurrently — every call after the first observes the same
   * in-flight/settled shutdown rather than repeating the work.
   */
  stop(): Promise<void>;
}

/**
 * Boots a complete, runnable `@injini/core` daemon process: an `EventLog` + `RunLifecycle` are
 * created and bound automatically, an Express app is assembled behind `@injini/http`'s route guard
 * and security middleware, the caller's own `packs` are composed and mounted, and the generic
 * daemon-status routes are registered — then the app starts listening and this resolves once the
 * real port is known.
 *
 * Preserves `createDaemon`'s compile-time "missing binding" error through this wrapper: the same
 * `MissingTokenIds<Packs, BoundIds>` conditional gate `createDaemon` itself uses (re-derived here
 * via `@injini/core/internal`, not duplicated) forces a call site with an unbound pack dependency to
 * fail to typecheck with the missing token id(s) visible in the error, exactly as it would calling
 * `createDaemon` directly. See `packages/node-host/src/create-local-node-daemon.typecheck.ts` for
 * the compile-time proof.
 *
 * **Why two overloads instead of one generic signature with `BoundIds extends string =
 * KernelBoundIds`:** that single-signature shape is what `foundry/docs/jini-port/extraction-plan.md`'s
 * task brief for this file literally shows, but it does not actually work — empirically verified
 * against this repo's own TypeScript (5.9.3, `strict`): when a type parameter both (a) has a
 * default and (b) is referenced inside a conditional type in the same parameter position where it
 * also needs to be inferred from a nested callback's return type, TypeScript resolves it to the
 * default *instead of* inferring from the callback, silently defeating the gate on exactly the
 * call shape (`bindings` provided) where it matters most. Splitting into two overloads — one
 * where `bindings` is absent and `BoundIds` is the concrete `KernelBoundIds`, one where `bindings`
 * is required and `BoundIds` is inferred fresh with no default — sidesteps the inference conflict
 * entirely; each overload only asks TypeScript to solve one problem instead of two contradictory
 * ones. Both directions are covered by `@ts-expect-error` proofs in `create-local-node-daemon.typecheck.ts`.
 *
 * @param config - See {@link CreateLocalNodeDaemonConfig}. Omit `bindings` when every pack's deps
 * are satisfied by the two kernel tokens alone; supply it (chaining onto the seeded `Bindings`
 * instance) to bind anything else a pack requires.
 * @returns A promise resolving to `{url, server, stop}` once the daemon is actually listening and
 * ready to serve requests.
 * @throws Rejects if the port is already in use (`EADDRINUSE`), the host can't be bound
 * (`EACCES`/`EADDRNOTAVAIL`), or the OS somehow reports a listening socket with no resolvable
 * port. On any of these the durable `EventLog` this call already opened is closed before
 * rejecting, so a failed boot never leaks an open sqlite file handle.
 * @complexity O(1) beyond the packs' own `services()`/`http()` costs — `createDaemon` composition
 * is O(p) in pack count (see `@injini/core`'s own complexity note).
 * @overallScore 100/100
 */
export async function createLocalNodeDaemon<const Packs extends readonly AnyPack[]>(
  config: CreateLocalNodeDaemonConfig<Packs, KernelBoundIds> &
    { bindings?: undefined } &
    (MissingTokenIds<Packs, KernelBoundIds> extends never
      ? unknown
      : { readonly __missingBindings: MissingTokenIds<Packs, KernelBoundIds> }),
): Promise<LocalNodeDaemon>;
export async function createLocalNodeDaemon<const Packs extends readonly AnyPack[], BoundIds extends string>(
  config: CreateLocalNodeDaemonConfig<Packs, BoundIds> &
    { bindings: (b: Bindings<KernelBoundIds>) => Bindings<BoundIds> } &
    (MissingTokenIds<Packs, BoundIds> extends never
      ? unknown
      : { readonly __missingBindings: MissingTokenIds<Packs, BoundIds> }),
): Promise<LocalNodeDaemon>;
export async function createLocalNodeDaemon(
  config: CreateLocalNodeDaemonConfig<readonly AnyPack[], string>,
): Promise<LocalNodeDaemon> {
  const env = config.env ?? process.env;
  const host = normalizeDaemonBindHost(config.host ?? DEFAULT_HOST);
  const requestedPort = config.port ?? 0;
  const registryPath = config.discoveryFile === false ? null : (config.discoveryFile ?? resolveDaemonRegistryPath(config.dataDir));

  // @injini/http's own `guardSameOrigin` (used by the daemon-status shutdown route below) resolves
  // `bindHost` purely from real `process.env.JINI_BIND_HOST` — it has no parameter path for an
  // injected env, unlike most of that module's other functions. Setting it here, before any
  // request can possibly be served, keeps that route's same-origin decision in sync with the host
  // this daemon actually bound to instead of silently comparing against whatever
  // `JINI_BIND_HOST` happened to already be set to. (When `config.env` is a caller-injected object
  // distinct from `process.env`, this line cannot fix `guardSameOrigin`'s behavior — that gap is a
  // pre-existing `@injini/http` limitation, not something this call can reach around; see this
  // package's source-map.md.)
  env[DEFAULT_BIND_HOST_ENV_VAR] = host;

  const eventLog = createSqliteEventLog(join(config.dataDir, 'events.db'));
  // Gap 1's byte-journal (see `@injini/daemon`'s `continuation/journal.ts`) gets its own durable
  // sqlite file, deliberately separate from `eventLog` above — that log's `stream()` replays
  // every entry it holds to SSE subscribers as a `RunProtocolEvent`, and a journal entry has no
  // corresponding protocol-event kind. Always constructed, unconditionally wired into
  // `agentExecutor` below: gap 1 is "the observability floor every later increment depends on",
  // not an opt-in extra.
  const journalEventLog = createSqliteEventLog(join(config.dataDir, 'journal.db'));
  const journal = createRunByteJournal(journalEventLog);
  const runLifecycle = createRunLifecycle({ eventLog });
  try {
    await runLifecycle.rehydrate();
  } catch (error) {
    // Rehydration happens before the HTTP server exists, so it cannot use the
    // later bind-failure cleanup path. Never leak the sqlite handle on corrupt
    // or otherwise unreadable durable history.
    await Promise.all([eventLog.close(), journalEventLog.close()]);
    throw error;
  }
  // Zero-config default, unlike ToolExecutorToken (which needs a caller-supplied
  // ToolRegistry and is therefore NOT auto-bound here — see this file's own
  // KernelBoundIds doc and packages/daemon/source-map.md's AgentExecutor
  // section): createAgentExecutor's own defaults already resolve the real
  // @injini/agent-runtime registry, launch resolution, and node:child_process
  // spawn, so every caller gets a working AgentExecutor with no additional
  // wiring. ACP agents intentionally still require a host-injected permission
  // policy before any native tool request can proceed; that fail-closed
  // authority decision has no safe zero-config default. `classifyFailure` DOES
  // get a real zero-config default (`resumableFromProcessExit`, 2026-07-22) —
  // unlike ToolExecutorToken/ACP permissions, marking a failed run's
  // `resumable` flag from its raw exit code/signal has a safe, real answer
  // with no caller input needed (an OS-signal-terminated process is treated as
  // resumable, a plain non-zero exit is not — see that function's own doc for
  // the full reasoning); every real run now gets a genuine resumable
  // classification instead of the previous hardcoded `resumable: false`.
  //
  // A second, independently-built classifier (`defaultClassifyFailure` in
  // `agent-executor.ts`, from a parallel cloud session) was found at merge
  // time with a materially different, contradictory policy and deliberately
  // removed in favor of this one — see `daemon/source-map.md`'s 2026-07-22
  // "two independent retry classifiers reconciled at merge time" entry for
  // the full reasoning.
  const agentExecutor = createAgentExecutor({
    lifecycle: runLifecycle,
    journal,
    classifyFailure: classifyRunFailureForRetry,
  });

  const kernelBindings = bindings()
    .bind(EventLogToken, eventLog)
    .bind(RunLifecycleToken, runLifecycle)
    .bind(AgentExecutorToken, agentExecutor);
  const boundBindings = config.bindings ? config.bindings(kernelBindings) : kernelBindings;

  // `createDaemon`'s own compile-time gate can't be satisfied by this function's own
  // (deliberately widened, non-generic — see the two exported overloads above) implementation
  // signature: `config.packs`/`boundBindings` are typed `readonly AnyPack[]`/`Bindings<string>`
  // here, not the concrete `Packs`/`BoundIds` a real call site's overload already resolved. This
  // call's safety was already established by whichever overload the real call site matched
  // (both apply the identical `MissingTokenIds` gate) — bypassing `createDaemon`'s own redundant
  // copy of that same check here is the same pattern
  // `packages/core/src/__tests__/index.test.ts`'s `createDaemonUnsafe` uses to reach the runtime
  // path directly.
  const daemon = (
    createDaemon as (config: { packs: readonly AnyPack[]; bindings: Bindings<string> }) => Daemon<readonly AnyPack[]>
  )({
    packs: config.packs,
    bindings: boundBindings,
  });

  // Shared by the origin guard middleware and the daemon-status routes' same-origin gate below —
  // both must observe the exact same "has the real port resolved yet" state.
  const resolvedPortRef = { current: requestedPort };

  // `onRunStarted` always wins when supplied — see that config option's own doc. Otherwise, a
  // supplied `resolveRunInput` gets the default RunStartHandler built for it; with neither, runs
  // durably start with no driver attached (unchanged prior behavior). Composed once, outside the
  // transport branch below, since it depends only on `config`/`agentExecutor`, not on which HTTP
  // transport ends up mounting `registerRunRoutes` with it.
  const onStarted =
    config.onRunStarted ??
    (config.resolveRunInput === undefined
      ? undefined
      : createDefaultRunStartHandler({ agentExecutor, resolveRunInput: config.resolveRunInput }));
  const runRoutesDeps = { lifecycle: runLifecycle, ...(onStarted === undefined ? {} : { onStarted }) };
  // Agent discovery is daemon-owned. The first GET populates a shared
  // promise-backed cache; POST /api/agents/rescan invalidates it and runs
  // the real PATH/version/auth/model probes again. Promise caching prevents
  // concurrent browser/desktop clients from spawning duplicate probe sets.
  const agentDetector = config.agentDetector ?? detectAgents;
  let agentScanPromise: Promise<readonly AgentSummary[]> | null = null;
  const projectDetectedAgent = (agent: DetectedAgent): AgentSummary => ({
    id: agent.id,
    name: agent.name,
    available: agent.available,
    ...(agent.version !== undefined ? { version: agent.version } : {}),
    ...(agent.authStatus !== undefined ? { authStatus: agent.authStatus } : {}),
    models: agent.models.map(({ id, label }) => ({ id, label })),
    ...(agent.reasoningOptions !== undefined
      ? { reasoningOptions: agent.reasoningOptions.map(({ id, label }) => ({ id, label })) }
      : {}),
    modelsSource: agent.modelsSource,
    ...(agent.supportsCustomModel !== undefined
      ? { supportsCustomModel: agent.supportsCustomModel }
      : {}),
    ...(agent.diagnostics?.[0]?.message
      ? { diagnostic: agent.diagnostics[0].message }
      : {}),
  });
  const scanAgents = (force: boolean): Promise<readonly AgentSummary[]> => {
    if (force) agentScanPromise = null;
    if (!agentScanPromise) {
      agentScanPromise = agentDetector()
        .then((agents) => agents.map(projectDetectedAgent))
        .catch((error: unknown) => {
          agentScanPromise = null;
          throw error;
        });
    }
    return agentScanPromise;
  };
  const agentRoutesDeps = {
    listAgents: () => scanAgents(false),
    rescanAgents: () => scanAgents(true),
  };
  const hostToolsRoutesDeps = { resolveRoot: config.resolveWorkspaceRoot ?? denyAllWorkspaceRoots };

  // `active-context.ts`: `resolveResource` is mandatory but has an honest, harmless answer this
  // preset can always give — "unknown" (`undefined`) — since it has no `Project`/`Workspace` noun
  // of its own to resolve a display name from, the same "no fabricated data" shape
  // `denyAllWorkspaceRoots` already uses for `host-tools.ts`.
  const activeContextRoutesDeps = { resolveResource: (): undefined => undefined };

  // `terminals.ts` + `daemon-db.ts` share one internal, zero-config `ToolRegistry`/`ToolExecutor`
  // pair — both are gated tools this preset registers with a **deny-by-default** `ToolPolicy`
  // (`denyAllTerminalCreatePolicy`/`denyAllDaemonDbPolicy`, both `@injini/daemon`/`@injini/http`'s own
  // established precedent, mirroring `host-tools.ts`'s `denyAllWorkspaceRoots`): the route exists
  // and is reachable, but every real call is denied with no fabricated access, until a host
  // supplies its own permissive policy. This is what makes spawning a real, `node-pty`-backed
  // shell (`terminals.ts`) and rewriting the database file in place (`daemon.db.vacuum`) safe to
  // wire in unconditionally — the capability exists but is inert by construction.
  const zeroConfigToolRegistry = createToolRegistry();
  const zeroConfigToolExecutor = createToolExecutor({ registry: zeroConfigToolRegistry });

  const terminalManager = createTerminalSessionManager();
  zeroConfigToolRegistry.register(createTerminalToolRegistrations({ manager: terminalManager }).create);
  const terminalRoutesDeps = {
    manager: terminalManager,
    toolExecutor: zeroConfigToolExecutor,
    principal: LOCAL_DAEMON_PRINCIPAL,
    resolveRoot: config.resolveWorkspaceRoot ?? denyAllWorkspaceRoots,
  };

  const eventsDbPath = join(config.dataDir, 'events.db');
  const dbOpsConnection = new Database(eventsDbPath);
  const dbOpsRegistrations = createDaemonDbToolRegistrations({ operations: buildDaemonDbOperations(dbOpsConnection, eventsDbPath) });
  zeroConfigToolRegistry.register(dbOpsRegistrations.inspect);
  zeroConfigToolRegistry.register(dbOpsRegistrations.verify);
  zeroConfigToolRegistry.register(dbOpsRegistrations.vacuum);
  const daemonDbRoutesDeps = { toolExecutor: zeroConfigToolExecutor, principal: LOCAL_DAEMON_PRINCIPAL };

  // Registered last so a colliding id reports the host's tool rather than silently shadowing one
  // of the preset's own. See `toolRegistrations`' own doc for why this seam exists at all.
  //
  // Guarded because this is the first startup step that can throw on *caller-supplied* input (a
  // duplicate descriptor id), and by this point the sqlite handles are already open. Same cleanup
  // shape as the bind-failure path below — a failed boot never leaks an open file handle.
  try {
    for (const registration of config.toolRegistrations ?? []) {
      zeroConfigToolRegistry.register(registration);
    }
  } catch (error) {
    dbOpsConnection.close();
    await Promise.all([eventLog.close(), journalEventLog.close()]);
    throw error;
  }

  // A durable, searchable snapshot of every descriptor `zeroConfigToolRegistry` now holds — the
  // preset's own tools plus everything `config.toolRegistrations` just added — v0 of
  // `ai-control-plane.md` §29 / `PROP-tool-catalog-discovery-2026-07-26.md`. Seeded here, after
  // both registration passes above, so the snapshot is never partial. Reuses `dbOpsConnection`
  // (already open against `eventsDbPath`) rather than a second file handle. Descriptors only —
  // the same public, non-secret surface `ToolRegistry.list()` always exposed; no handler or
  // policy ever reaches this table (`@injini/sqlite/db/tool-catalog`'s own module doc, §2 of the
  // proposal: "no executable ever comes out of the database").
  ensureToolCatalogTables(dbOpsConnection);
  reseedToolCatalog(
    dbOpsConnection,
    zeroConfigToolRegistry.list().map((descriptor) => ({
      id: descriptor.id,
      description: descriptor.description ?? descriptor.id,
      source: 'first-party',
      ...(descriptor.inputSchema === undefined ? {} : { inputSchema: descriptor.inputSchema }),
    })),
  );
  const toolCatalogRoutesDeps = {
    catalog: {
      search: (query: string, limit?: number) => searchToolCatalog(dbOpsConnection, query, limit),
      describe: (id: string) => getToolCatalogEntry(dbOpsConnection, id),
    },
  };

  // Owned here (rather than left to xai.ts's internal default) so stop() can close an in-flight
  // OAuth loopback listener — otherwise the 127.0.0.1:56121 socket outlives the daemon by up to
  // its 30-minute self-close timeout, keeping the process alive and the fixed port occupied.
  const xaiListenerRef: { current: OAuthCallbackListener | null } = { current: null };

  let shuttingDown = false;
  let stopPromise: Promise<void> | null = null;
  let server: Server;

  async function stop(): Promise<void> {
    shuttingDown = true;
    if (!stopPromise) {
      stopPromise = (async () => {
        await closeHttpServer(server);
        const xaiListener = xaiListenerRef.current;
        xaiListenerRef.current = null;
        if (xaiListener) {
          try {
            await xaiListener.stop();
          } catch {
            // Best-effort — the listener self-closes on its own timeout anyway.
          }
        }
        if (registryPath !== null) {
          // Best-effort (see this file's own `discoveryFile` doc): a daemon that already served
          // every request successfully must not fail its own shutdown just because its discovery
          // record couldn't be removed (e.g. `dataDir` became unwritable mid-run).
          try {
            await removeDaemonRegistryRecordIfCurrent(registryPath, process.pid);
          } catch {
            // Intentionally swallowed — see the try's own comment.
          }
        }
        // A caller-supplied `onShutdown` failing must never leak any of the sqlite file handles
        // this call opened — `eventLog`, gap 1's separate `journalEventLog`, and the raw
        // `better-sqlite3` connection `daemon.db.*` operates through —
        // `finally` guarantees every close still runs, then the original rejection (if any)
        // propagates to whoever is awaiting `stop()`.
        try {
          await config.onShutdown?.();
        } finally {
          dbOpsConnection.close();
          await Promise.all([eventLog.close(), journalEventLog.close()]);
        }
      })();
    }
    return stopPromise;
  }

  const daemonStatusDeps = {
    getVersion: () => packageVersion,
    host,
    getPort: () => resolvedPortRef.current,
    dataDir: config.dataDir,
    isShuttingDown: () => shuttingDown,
    requestShutdown: () => {
      void stop();
    },
  };
  const apiTokenConfig = {
    tokenEnvVar: config.apiToken?.tokenEnvVar ?? DEFAULT_TOKEN_ENV_VAR,
    disableEnvVar: config.apiToken?.disableEnvVar ?? DEFAULT_DISABLE_ENV_VAR,
  };
  const originGuardDeps = {
    host,
    extraAllowedOrigins: configuredAllowedOrigins(env),
    getResolvedPort: () => resolvedPortRef.current,
    env,
  };

  // `health.ts`: reuses `dbOpsConnection` — the same raw `better-sqlite3` handle
  // `daemonDbRoutesDeps` above already operates through (see that block's own comment on why a
  // *second* connection to `events.db` is safe under WAL mode) — rather than opening a third
  // connection just to run a readiness probe. `verifySqliteIntegrity({quick: true})` runs SQLite's
  // fast `quick_check` pragma (skips the index-content check `integrity_check` does, appropriate
  // for a readiness probe that should be cheap enough to poll frequently). Wrapped in try/catch:
  // a readiness *check* must never itself throw and crash the route — a thrown pragma read is
  // itself a legitimate "not ready" signal, not a 500.
  const healthDeps = {
    getVersion: () => packageVersion,
    checkReadiness: async () => {
      let dbOk: boolean;
      try {
        dbOk = verifySqliteIntegrity({ db: dbOpsConnection, quick: true }).ok;
      } catch {
        dbOk = false;
      }
      const notShuttingDown = !shuttingDown;
      return { ok: dbOk && notShuttingDown, checks: { db: dbOk, notShuttingDown } };
    },
  };

  // Assembles the concrete Express app and wires @injini/http's route-registration guard, `/api`
  // security middleware, and daemon-status routes — `mountPackHttp` above is already
  // framework-agnostic (it only ever forwards `app` straight through to a pack's own
  // `http(app, services)`).
  const app: Express = express();
  installRouteRegistrationGuard(app);
  // Registered before `express.json()`/the bearer-auth/origin-guard middleware — see
  // `health.ts`'s own module doc: a liveness/readiness probe must never need a JSON body parser,
  // a bearer token, or a same-origin `Origin` header just to confirm the process is up.
  registerHealthRoutes(app, healthDeps, { resolvedPortRef });
  app.use(express.json());
  registerApiBearerAuthMiddleware(app, { tokenConfig: apiTokenConfig, env });
  registerApiOriginGuardMiddleware(app, originGuardDeps);
  registerRunRoutes(app, runRoutesDeps, { resolvedPortRef });
  registerAgentRoutes(app, agentRoutesDeps, { resolvedPortRef });
  registerHostToolsRoutes(app, { resolvedPortRef }, hostToolsRoutesDeps);
  registerModelProxyRoutes(app, {}, { resolvedPortRef });
  registerActiveContextRoutes(app, activeContextRoutesDeps, { resolvedPortRef });
  registerTerminalRoutes(app, terminalRoutesDeps, { resolvedPortRef });
  registerDaemonDbRoutes(app, daemonDbRoutesDeps, { resolvedPortRef });
  registerToolCatalogRoutes(app, toolCatalogRoutesDeps, { resolvedPortRef });
  // The agent-facing door onto `zeroConfigToolRegistry` — same registry, same `ToolExecutor`, and
  // therefore the same authorization/confirmation/timeout/truncation/audit as every route above.
  // Mounted unconditionally so a host that supplied `toolRegistrations` does not also have to
  // discover that nothing can reach them; every call is still refused by the tools' own
  // deny-by-default policies until the host opts in.
  registerDelegatedToolRoutes(
    app,
    {
      lifecycle: runLifecycle,
      toolExecutor: zeroConfigToolExecutor,
      resolvePrincipal: config.resolveDelegatedPrincipal ?? (() => ANONYMOUS_DELEGATED_PRINCIPAL),
    },
    { resolvedPortRef },
  );
  // Zero-config defaults, deliberately: `registerConnectorsRoutes`' five capability slots
  // (auth/storage/payments/db/realtime) are all independently optional and left unconfigured here
  // — every connectors route is reachable but answers 503 NOT_CONFIGURED until a caller-supplied
  // preset binds real providers (see `connectors.ts`'s own module doc).
  registerConnectorsRoutes(app, {}, { resolvedPortRef });
  registerResearchRoutes(app, {}, { resolvedPortRef });
  // `xai.ts`: zero-config-safe the same way — `dataDir` is the one default worth overriding here
  // (this preset already has a real, trusted `dataDir` for `events.db`/`journal.db`/etc.), every
  // other field (provider config, loopback port, pending-auth cache, search defaults) keeps that
  // route pack's own built-in default. No OAuth account is connected until a caller completes the
  // `/api/xai/oauth/*` dance — `/api/xai/search` answers a clean 503 `NOT_CONFIGURED` until then.
  registerXaiRoutes(app, { dataDir: config.dataDir, listenerRef: xaiListenerRef }, { resolvedPortRef });

  for (const registerExtension of config.httpExtensions ?? []) {
    registerExtension(app, {
      adapter: { resolvedPortRef },
      lifecycle: runLifecycle,
      dataDir: config.dataDir,
    });
  }
  mountPackHttp(app, config.packs, daemon);
  registerDaemonStatusRoutes(app, daemonStatusDeps, { resolvedPortRef });

  const listen = (): Promise<Server> =>
    new Promise<Server>((resolve, reject) => {
      let listeningServer: Server;
      try {
        listeningServer = app.listen(requestedPort, host);
      } catch (error) {
        reject(error);
        return;
      }
      listeningServer.once('listening', () => resolve(listeningServer));
      // `app.listen` throws synchronously when the port is already in use on some Node
      // versions, but emits an `error` event on others (and for EACCES/EADDRNOTAVAIL even on
      // the same Node) — wiring both paths means this promise always settles instead of
      // hanging forever.
      listeningServer.on('error', (error) => reject(error));
    });

  return await new Promise<LocalNodeDaemon>((resolve, reject) => {
    const failToBind = (error: unknown) => {
      // Best-effort: a failed boot must not leave any sqlite file handle this call already opened
      // (`eventLog`, `journalEventLog`, or the raw `daemon.db.*` connection) dangling open.
      dbOpsConnection.close();
      void Promise.all([eventLog.close(), journalEventLog.close()]).finally(() => reject(error));
    };

    listen()
      .then((listeningServer) => {
        server = listeningServer;
        // Widen the between-request idle window so kept-alive sockets survive gaps between bursts
        // (e.g. an SSE stream's idle periods); `headersTimeout` must exceed `keepAliveTimeout` per
        // the Node docs, or a slow-loris client could stall request parsing.
        server.keepAliveTimeout = 120_000;
        server.headersTimeout = 125_000;

        const boundPort = resolveBoundPort(server.address());
        if (!boundPort) {
          failToBind(
            new Error(`@injini/node-host: daemon failed to resolve listening port (address=${JSON.stringify(server.address())})`),
          );
          return;
        }
        resolvedPortRef.current = boundPort;
        const reportedUrl = `http://${resolveReportHost(host)}:${boundPort}`;

        // Writing the discovery record is async; the promise this executor returns must not
        // resolve — handing the URL back to the caller — until the record a same-machine CLI
        // would read is actually in place, or a caller that immediately shells out to a CLI
        // command right after `await createLocalNodeDaemon(...)` could lose the race against its
        // own write.
        void (async () => {
          if (registryPath !== null) {
            try {
              await writeDaemonRegistryRecord(registryPath, {
                url: reportedUrl,
                host: resolveReportHost(host),
                port: boundPort,
                pid: process.pid,
                startedAt: new Date().toISOString(),
              });
            } catch {
              // Best-effort (see this file's own `discoveryFile` doc): a daemon that is otherwise
              // fully up and serving must not fail to boot just because its discovery record
              // couldn't be written (e.g. an unwritable dataDir).
            }
          }
          resolve({ url: reportedUrl, server, stop });
        })();
      })
      .catch((error) => failToBind(error));
  });
}
