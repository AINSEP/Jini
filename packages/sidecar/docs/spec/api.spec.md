Spec ID: SPEC-JINI-SIDECAR-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:8a7b50e9253039689705302135fb32a05a59089506aec35e2d4bcf76198729ca
spec_mode: reverse_spec


# API Contract: sidecar

## Purpose and entry points

ESM. Root and supervisor/node use Node; generic supervisor and respawn policy are universal. The export map exposes `@jini-ai/sidecar`, `@jini-ai/sidecar/respawn-policy`, and `@jini-ai/sidecar/supervisor`. The root re-exports policy and the generic supervisor; Node defaults are isolated at `@jini-ai/sidecar/supervisor/node`. Importing creates no server, timer or child process.

Signatures below describe current source. Two-object APIs separate required data from optional settings; `optional = {}` denotes an implementation default. A signature with one object or no arguments is an existing exception: consumers must not assume a second object is accepted by its TypeScript declaration. Shared base types have not been relocated by this contract.

## Root: contract and path resolution

The consumer supplies `SidecarContractDescriptor<TStamp>`: defaults `{host, ipcBase, namespace, projectTmpDirName, windowsPipePrefix}`, environment key names `{base, ipcBase, ipcPath, namespace, source}`, and normalizers `normalizeApp({app})`, `normalizeNamespace({namespace})`, `normalizeSource({source})`, `normalizeStamp({input})`. Each normalizer validates its own vocabulary. `SidecarStampShape` is `{app, ipc, mode, namespace, source}: string`.

| Entry point: current signature | Return |
|---|---|
| `isWindowsNamedPipePath({value: unknown})` | `boolean` |
| `normalizeIpcPath({ipc: unknown})` | `string` |
| `resolveNamespace({contract}, optional = {env?, namespace?})` | `string` |
| `resolveProjectRoot({projectRoot: string})` | `string` |
| `resolveProjectTmpRoot({contract, projectRoot})` | `string` |
| `resolveSourceRuntimeRoot({contract, projectRoot, source})` | `string` |
| `resolveSidecarBase({contract, source}, optional = {base?, env?, projectRoot?})` | `string` |
| `resolveNamespaceRoot({base, contract, namespace})` | `string` |
| `resolveRuntimeNamespaceRoot({contract, runtime: {base, mode, namespace}, runtimeMode})` | `string` |
| `resolveRuntimeRoot({base, contract, namespace, runId})` | `string` |
| `resolvePointerPath({base, contract, namespace})` | `string` |
| `resolveManifestPath({runtimeRoot})` | `string` |
| `resolveLogsDir({app, contract, runtimeRoot})` | `string` |
| `resolveLogFilePath({app, contract, runtimeRoot}, optional = {fileName?})` | `string` |
| `resolveAppRuntimeDir({app, contract, namespaceRoot})` | `string` |
| `resolveAppRuntimePath({app, contract, namespaceRoot, fileName})` | `string` |
| `resolveAppIpcPath({app, contract, namespace}, optional = {env?})` | `string` |
| `createSidecarLaunchEnv({base, contract, stamp}, optional = {extraEnv?})` | `NodeJS.ProcessEnv` |
| `bootstrapSidecarRuntime({stampInput: unknown, env, app, contract}, optional = {base?, projectRoot?})` | `SidecarRuntimeContext<TStamp>` |

Path fields are strings; `env` is `NodeJS.ProcessEnv`. Bootstrap returns `{app, base, ipc, mode, namespace, source}` and mutates the supplied environment only after identity checks succeed. Path resolvers perform no filesystem creation.

## Root: I/O and discovery

| Entry point: current signature | Return / dependencies |
|---|---|
| `allocatePort({}, optional = {host?, label?, port?: number|string|null, reserved?: Set<number>})` | `Promise<PortAllocation>`; native TCP bind and close |
| `readJsonFile<T = any>({filePath})` | `Promise<T|null>`; no schema validation |
| `writeJsonFile({filePath, payload: unknown})` | `Promise<void>`; native filesystem |
| `removeFile({filePath})` | `Promise<void>` |
| `removePointerIfCurrent({pointerPath, runId})` | `Promise<void>` |
| `resolveDaemonRegistryPath({dataDir}, optional = {fileName?})` | `string` |
| `writeDaemonRegistryRecord({registryPath, record: LocalDaemonRegistryRecord})` | `Promise<void>` |
| `removeDaemonRegistryRecordIfCurrent({registryPath, pid: number})` | `Promise<void>` |
| `isProcessAlive({pid: number})` | `boolean`; signal-zero probe |
| `readLiveDaemonRegistryRecord({registryPath})` | `Promise<LocalDaemonRegistryRecord|null>` |
| `createJsonIpcServer({socketPath, handler: JsonIpcHandler}, optional = {maxFrameBytes?, idleTimeoutMs?})` | `Promise<JsonIpcServerHandle>` |
| `requestJsonIpc<T = any>({socketPath, payload: unknown}, optional = {timeoutMs?})` | `Promise<T>`; response result is trusted as `T` |

`PortAllocation = {port: number, source: 'dynamic'|'forced'}`. `LocalDaemonRegistryRecord` has `{url: string, host: string, port: number, pid: number, startedAt: string}`. `JsonIpcHandler({message: any})` returns `unknown|Promise<unknown>`; `JsonIpcServerHandle.close(): Promise<void>` closes the listener and removes a Unix endpoint. The consumer supplies message validation, authentication and authorization inside its handler.

```ts
import { createJsonIpcServer, requestJsonIpc } from '@jini-ai/sidecar';
const server = await createJsonIpcServer({
  socketPath: '/tmp/example-agent.sock',
  handler: ({ message }) => ({ received: message }),
});
try {
  const result = await requestJsonIpc({ socketPath: '/tmp/example-agent.sock', payload: { kind: 'ping' } });
} finally { await server.close(); }
```

## `./respawn-policy`

`createRespawnPolicy({now: () => number}, optional: RespawnPolicyOptions = {}): RespawnPolicy`. Millisecond clock is mandatory. Options are `backoffScheduleMs?: readonly number[]`, `crashLoopWindowMs?`, `crashLoopMaxFailures?`, `portConflictMaxAttempts?` (numbers).

Returned methods: `recordFailure({isPortConflict: boolean}): RespawnDecision`, `reset(): void`, `isTripped(): boolean`. Decisions are `{action:'retry', delayMs, attempt}`, `{action:'give-up', kind:'crash-loop', attempts, windowMs}`, or `{action:'give-up', kind:'port-conflict', attempts}`.

```ts
import { createRespawnPolicy } from '@jini-ai/sidecar/respawn-policy';
const policy = createRespawnPolicy({ now: () => Date.now() });
const decision = policy.recordFailure({ isPortConflict: false });
```

## `./supervisor`

| Entry point: current signature | Return |
|---|---|
| `createDaemonSupervisor(required: DaemonSupervisorRequired, optional: DaemonSupervisorOptions = {})` | `DaemonSupervisor` |
| `createNodeSupervisorScheduler({})` | `SupervisorScheduler` |
| `createSupervisorRegistry({registryPath: string})` | `SupervisorRegistry` |
| `createNodeDaemonProcessAdapter(required: NodeDaemonProcessRequired, optional: NodeDaemonProcessOptions = {})` | `{spawnDaemonProcess(): SpawnedDaemonProcess, terminateProcess({child}): Promise<void>}` |

Supervisor required ports: `spawnDaemonProcess(): SpawnedDaemonProcess`; `terminateProcess({child}): void|Promise<void>`; `policy: RespawnPolicy`; `now(): number`; `scheduler.schedule({delayMs, run}): () => void`; `classifyExit({code: number|null, signal: NodeJS.Signals|null}): {isPortConflict, reason}`; `failureReporter.clear()/record({reason})`; `logger.emit(event: SupervisorEvent)`. Scheduling must defer callbacks until after returning its cancellation function.

Options: `onDemandCooldownMs?: number`, `quietRoutineLifecycle?: boolean`, `formatGiveUp?({decision, lastReason}): string`. Returned methods: `start(): void`, `restart()/ensureStarted(): {ok: boolean, reason?: string}`, `shutdown(): void`. Success means an action was accepted, not that the daemon is ready.

`SpawnedDaemonProcess` supplies optional `pid`, `on({event:'exit', listener: ({code, signal}) => void})` or `on({event:'error', listener: ({error: Error}) => void})`, and `kill({}, optional?: {signal?: NodeJS.Signals}): boolean`. Events are `spawn {at,pid,attempt}`, `exit {at,pid,code,signal,deliberate}`, or `failure {at,reason,decision?}` with a `type` discriminant.

Node adapter requires `{command, args: readonly string[], cwd, env, registry}`. Options are `{stdout?: Writable, stderr?: Writable, platform?: NodeJS.Platform}`; unsupplied output sinks discard drained output. Registry methods: `readLive(): Promise<Record|null>`, `write({record}): Promise<void>`, `removeIfCurrent({pid}): Promise<void>`. The listening child owns registry publication; the adapter only cleans it after tree termination.

```ts
import { createRespawnPolicy } from '@jini-ai/sidecar/respawn-policy';
import { createDaemonSupervisor } from '@jini-ai/sidecar/supervisor';
import { createNodeDaemonProcessAdapter, createNodeSupervisorScheduler,
  createSupervisorRegistry } from '@jini-ai/sidecar/supervisor/node';
const now = () => Date.now();
const registry = createSupervisorRegistry({ registryPath: '/tmp/example-daemon.json' });
const processes = createNodeDaemonProcessAdapter({
  command: '/usr/bin/node', args: ['/opt/example/daemon.js'], cwd: '/opt/example', env: {}, registry,
});
const supervisor = createDaemonSupervisor({
  ...processes, now, policy: createRespawnPolicy({ now }), scheduler: createNodeSupervisorScheduler({}),
  classifyExit: ({ code }) => ({ isPortConflict: code === 9, reason: `exit ${code}` }),
  failureReporter: { clear() {}, record({ reason }) { console.error(reason); } },
  logger: { emit(event) { console.info(event); } },
});
supervisor.start(); // Host calls shutdown() during its own shutdown sequence.
```

Node adapter rows in the lifecycle table above belong to `@jini-ai/sidecar/supervisor/node`.

## Public types and boundary

All exported request/optional-argument types are defined in [types.ts](../../src/types.ts): `AppIpcPathRequest`, `AppRuntimePathRequest`, `BaseResolutionOptions`, `BootstrapSidecarRuntimeOptions`, `NamespaceResolutionOptions`, `NamespaceOptionalArgs`, `BaseResolutionOptionsOptionalArgs`, `AppIpcPathRequestOptionalArgs`, `SidecarLaunchEnvRequestOptionalArgs`, `BootstrapSidecarRuntimeOptionsOptionalArgs`, `PortRequest`, `ProjectRuntimePathRequest`, `RuntimePathRequest`, `RuntimeRootRequest`, `SidecarLaunchEnvRequest`, plus the result/contract/IPC types described above. Generic supervisor exports its required/options/event/process/scheduler types, `DaemonProcessSubscription` and `DaemonSupervisorActionResult`; supervisor/node exports `NodeDaemonProcessRequired`, `NodeDaemonProcessOptions` and `SupervisorRegistry`; policy exports its options/decision/interface types and `RespawnFailureInput`.

`jsonIpcError`, `prepareIpcPath`, `allocateDynamicPort`, `closeServer`, and `listenOnPort` are module-local exports for direct tests, absent from the package export map/barrels. They are not supported consumer entry points. Sources: [root barrel](../../src/index.ts), [policy](../../src/respawn-policy.ts), [supervisor](../../src/supervisor.ts), [Node adapters](../../src/supervisor-node.ts).

## Current manifest boundary

The current `package.json` exposes `.`, `./respawn-policy`, `./supervisor`, `./supervisor/node`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
