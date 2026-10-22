Spec ID: SPEC-JINI-SERVER-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:6c3ad191439dc0f97a34aff25bf94d740229333e4c63afdc573f071887451e73
spec_mode: reverse_spec


# API contract: @jini-ai/server

## Entry points and calling convention

| Import suffix | Public surface |
|---|---|
| package root | Node listener preset, embedded kernel composition, base resources, features/profiles/activation, shutdown helpers, frontend-control compatibility export |
| `/storage` | Backend selection types, resolver and error class; no database acquisition |
| `/storage/legacy/sqlite` | `openDatabase`, `closeDatabase`, `migrate`; owned local singleton |
| `/store/projects/sqlite` | Synchronous project CRUD/status/awaiting-input projections and `LEGACY_PROJECTS_DDL` |

The desired consumer-adapter convention is `(required, optional = {})`. Current one-object/positional source signatures below remain callable; this specification does not invent overloads. Node/Express are required for the root. SQL drivers are supplied explicitly by the host, never autoloaded by this package.

## Listener and embedded composition

```ts
createLocalNodeDaemon(config: CreateLocalNodeDaemonConfig<Packs, BoundIds>): Promise<LocalNodeDaemon>;
composeJiniKernel(config: ComposeJiniKernelConfig): Promise<JiniKernel>;
createJiniKernelBase(options: CreateJiniKernelBaseOptions): Promise<JiniKernelBase>;
```

`createLocalNodeDaemon` requires `{dataDir, open: SqliteSyncOpener, packs}`. dataDir must already exist. Its overloads preserve the core pack missing-binding gate: supply a bindings callback if packs require tokens beyond `jini.eventLog`, `jini.runLifecycle`, `jini.agentExecutor`. Return is `{url, server: http.Server, activeFeatures: readonly string[], stop(): Promise<void>}`.

| Optional preset configuration | Consumer responsibility/default |
|---|---|
| port / host | 0 / 127.0.0.1 |
| env | process.env; preset mutates supplied map's `JINI_BIND_HOST` |
| profile / capabilities / features | local-daemon-v1; optional capability grant overrides and feature selection |
| apiToken | tokenEnvVar `JINI_API_TOKEN`, disableEnvVar `JINI_DISABLE_API_AUTH` |
| security | Default local gate; optional `{mode:'sidecar-strict', tokenEnvVar, exemptPaths?}`; host is inferred from listener config |
| bindings | Extend kernel token bindings to satisfy packs |
| onRunStarted / resolveRunInput | Explicit start callback takes precedence; otherwise input resolver drives AgentExecutor; absent both creates runs without a driver |
| agentDetector | Host detector or built-in runtime discovery |
| resolveWorkspaceRoot | Omitted resolver denies all resource-root lookup rather than guessing a path |
| httpExtensions | `(app: Express, {adapter, lifecycle, dataDir}) => void`, after API features and before caller packs/status |
| toolRegistrations | Host descriptor/handler/policy triples sharing kernel registry and executor |
| resolveDelegatedPrincipal | Host request-to-Principal resolver; absent uses role-less anonymous identity with a wiring warning |
| discoveryFile | `<dataDir>/daemon.json`; false disables discovery |
| onShutdown | Host teardown callback before base handles close |

`composeJiniKernel` requires `{app: Express, adapter: AdapterContext, storage: JiniKernelStorage}`. storage is `{kind:'memory'}` or `{kind:'sqlite', dataDir, open}`. Optional profile defaults to agent-core-v1; security defaults to `{mode:'host'}`; installJsonBodyParser defaults true. It also accepts capabilities, features, featureOptions, extraFeatures, toolRegistrations, packs, bindings, agentExecutor overrides, env and `onAfterApiRoutes(app, callerDaemon, base)`.

It returns `{base, daemon, activation, disposeFeatures(), disposeCallerPacks(), closeBase(), close()}`. Every close/dispose method returns Promise<void>. It mounts an app but opens no listener; host owns its HTTP server. Caller pack HTTP routes require explicit mounting in onAfterApiRoutes; kernel composition creates their services and registers their tools, but does not automatically mount their HTTP routes.

`createJiniKernelBase` requires storage and accepts agentExecutor overrides in the same object. Return has eventLog, journalEventLog, lifecycle, agentExecutor, registry, toolExecutor, sqlite (handle/path/dataDir or null), close. The base owns acquired resources; features only borrow them.

```ts
import express from 'express';
import { composeJiniKernel, createLocalNodeDaemon } from '@jini-ai/server';
const app = express();
const kernel = await composeJiniKernel({
  app, adapter: hostAdapter, storage: { kind: 'memory' },
  security: { mode: 'host' },
});
await kernel.close();
const daemon = await createLocalNodeDaemon({ dataDir, open: hostSqliteOpen, packs: [] });
await daemon.stop();
```

## Features, profiles and helpers

`JiniFeature = {id, provides: readonly CapabilityId[], requires?, phase?, compose(context): FeatureComposition}`. Context supplies kernel/adapter/env; composition returns `{pack, afterTools?}`. Phase defaults api and is probe/api/status. `AnyPack`, `FeatureBuildContext`, `FeatureComposition`, profile/phase/activation types and configuration/result types are exported by the root barrel.

| Current signature / constant | Return and ports |
|---|---|
| `defineJiniFeature(feature: JiniFeature)` | same feature |
| `isCapabilityId(required: { value: string })` | type guard for CapabilityId |
| `resolveFeatureActivation(input: FeatureActivationInput)` | FeatureActivationPlan; required features/profile, optional capabilities/featureOverrides; pure |
| `createBuiltInFeatures(options: BuiltInFeatureOptions = {})` | readonly JiniFeature[]; no resources acquired until feature composition |
| `buildDaemonDbOperations(db: SqliteDb, file: string)` | DaemonDbOperations inspect/verify/vacuum; borrowed handle and real file |
| `projectDetectedAgent(agent: DetectedAgent)` | AgentSummary; maps models/reasoning/auth/diagnostic fields |
| `classifyRunFailureForRetry({code, signal, sideEffects?})` | boolean; daemon's process-exit retry classifier |
| `resolveBoundPort(address: {port:number} \| string \| null)` | positive number or null |
| `resolveReportHost(bindHost: string)` | loopback for wildcard binds; brackets IPv6 literals |
| `normalizeDaemonBindHost(input: unknown)` | trimmed String(input ?? '') or loopback fallback |
| `closeHttpServer(server: http.Server, options: CloseHttpServerOptions = {})` | Promise<void>; idleCloseMs 1000, closeTimeoutMs 5000 |
| `installGracefulShutdown(stop: () => Promise<void>, options: GracefulShutdownOptions = {})` | `{uninstall():void}`; SIGTERM/SIGINT, timeoutMs 10000, onExit defaults process.exit |
| `CAPABILITY_IDS`, `CORE_CAPABILITIES`, `JINI_PROFILES` | Frozen capability/profile vocabulary |
| `LOCAL_DAEMON_PRINCIPAL`, `ANONYMOUS_DELEGATED_PRINCIPAL` | Principal identities `local-daemon`, `anonymous-delegated`; no implicit permission grants |
| `DEFAULT_DAEMON_BIND_HOST` | `'127.0.0.1'` |

BuiltInFeatureOptions groups host seams for health, runs, agents, hostTools, terminal, daemonDb, delegatedToolCalls, remoteRunEvents, xai, daemonStatus, memory, routines, media and frontendSessions. Required options for a selected feature are checked while composing it. The full current group shapes are in [builtin-features.ts](../../src/builtin-features.ts); no default host memory/routine/media engine is invented.

`createFrontendControl` is re-exported from `@jini-ai/http-kit`:

```ts
createFrontendControl(
  { capabilities, resolveBindToken },
  { policy?, timeoutMs?, maxOutputBytes?, onBindError? } = {},
): FrontendControl;
```

The resolver takes `{request: RunCreateRequest}` and returns a bind token or undefined. Return is `{httpExtension, toolRegistrations, bindOnStarted}`; wire all three to the host's routes, registry and start driver. Default policy denies; default capability timeout is 30000 ms. Bind failure is reported without failing the run. Re-exported `CreateFrontendControlOptions`, `FrontendControl`, `FrontendBindErrorContext`, `FrontendHttpExtension` remain owned by http-kit.

## Backend selection and local storage

```ts
resolveSqliteBackendConfig(required: Record<string, never>, optional: { env?: Record<string, string | undefined> } = {}): SqliteBackendConfig;
openDatabase({ projectRoot, open }: { projectRoot: string; open: SqliteSyncOpener }, options: { dataDir?: string; filesystem?: Pick<typeof fs, 'mkdirSync'> } = {}): SqliteDb;
closeDatabase(): void;
migrate({ db }: { db: SqliteDb }): void;
```

`/storage` exports `SqliteBackendKind = 'sqlite' | 'postgres'`, `SqliteBackendConfig`, `SqliteBackendConfigError(message)`. Selection uses `JINI_SQLITE_BACKEND` (sqlite default), and for postgres requires `JINI_PG_HOST`, `JINI_PG_DATABASE`, `JINI_PG_USER`; port defaults 5432 and SSL mode require. It does not open PostgreSQL or implement a selectable PostgreSQL host preset.

Legacy open requires options.open even if a singleton already exists. Default file is `<projectRoot>/.jini/app.sqlite`; explicit dataDir is resolved absolutely. It creates the directory, applies WAL and foreign_keys ON, runs migrate, and caches by path. migrate executes legacy project/chat/agent-session DDL; no migration ledger is maintained.

```ts
import { openDatabase, closeDatabase } from '@jini-ai/server/storage/legacy/sqlite';
const db = openDatabase(workspaceRoot, { open: hostSqliteOpen });
// Borrow db for authorized legacy concern calls.
closeDatabase();
```

## Project SQLite adapter

All methods below are synchronous, borrow db: SqliteDb, require host authorization, and use host-created projects/conversations/messages tables. They do not enforce user/tenant scope.

| Current signature | Result |
|---|---|
| `listProjects({ db }: { db: SqliteDb })` / `getProject({ db, id }: { db: SqliteDb; id: string })` | normalized ProjectRow[] / ProjectRow or null |
| `insertProject({ db, project: p }: { db: SqliteDb; project: DbRow })` / `updateProject({ db, id, patch }: { db: SqliteDb; id: string; patch: DbRow }, optional: { clock?: { now(): number } } = {})` | normalized ProjectRow or null |
| `deleteProject({ db, id }: { db: SqliteDb; id: string })` | void; cascades are schema-dependent |
| `listLatestProjectRunStatuses({ db }: { db: SqliteDb })` | Map keyed by project ID |
| `listLatestConversationRunStatuses({ db }: { db: SqliteDb })` / `listFirstConversationRunStatuses({ db }: { db: SqliteDb })` | Map keyed by conversation ID |
| `listLatestRunStatuses({ db }: { db: SqliteDb })` | Map keyed by run ID |
| `listProjectsAwaitingInput({ db }: { db: SqliteDb })` / `listConversationsAwaitingInput({ db }: { db: SqliteDb })` | Set of matching IDs |
| `LEGACY_PROJECTS_DDL` | Explicit idempotent table bootstrap SQL |

ProjectRow contains id/name/pendingPrompt?/metadata?/customInstructions?/createdAt/updatedAt; timestamps are numbers. Status map values contain `{value, updatedAt, runId?}` in an open DbRow. Normalization maps starting→running, cancelled→canceled, unknown→not_started. Example: `db.exec(LEGACY_PROJECTS_DDL); const projects = listProjects(db);` after host authentication and remaining schema bootstrap.

## Evidence and unavailable path

The package manifest exposes no `/lifecycle` path yet, despite source for staged boot/readiness. This specification covers all four existing paths; that proposed import remains unavailable. Evidence: current exported source, composition/kernel/activation/bootstrap tests and storage ownership/config tests; none were executed.

defaultServerMessages is a root export containing invalidSecurityMode copy used when the supplied compose security mode is not supported. It changes display text only; capability IDs, storage keys and security-mode wire values remain unchanged.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `ActivationReason`, `ActiveFeatureRecord`, `DeactivationReason`, `InactiveFeatureRecord` | type; [feature-activation.ts](../../src/feature-activation.ts) |
| `FeaturePhase`, `JiniProfile`, `JiniProfileId`, `ProfileActivation` | type; [feature.ts](../../src/feature.ts) |
| `GracefulShutdownHandle` | type; [host-bootstrap.ts](../../src/host-bootstrap.ts) |
| `JiniKernelSecurity` | type; [compose-jini-kernel.ts](../../src/compose-jini-kernel.ts) |
| `KernelBoundIds`, `LocalNodeHttpExtension`, `LocalNodeHttpExtensionContext` | type; [create-local-node-daemon.ts](../../src/create-local-node-daemon.ts) |
| `KernelSqliteAccess` | type; [kernel-base.ts](../../src/kernel-base.ts) |

## Current manifest boundary

The current `package.json` exposes `.`, `./storage`, `./storage/legacy/sqlite`, `./store/projects/sqlite`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
