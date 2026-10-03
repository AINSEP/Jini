Spec ID: SPEC-JINI-DAEMON-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:3dddc754b353716bab2eccf83004bd5227bc76c6398e7aabe9acccafdf454cae
spec_mode: reverse_spec


# API contract: @jini-ai/daemon

## Entry points and calling convention

| Import suffix | Public surface | Consumer supplies |
|---|---|---|
| package root | Event log, run lifecycle, tool/agent execution, frontend/terminal sessions, continuation, routines, migration, analytics helpers and tokens | Node runtime; ports listed below |
| `/store/event-log/sqlite` | SQLite EventLog factory, opener and retention constant | Borrowed handle or explicit synchronous opener |
| `/store/agent-sessions` | AgentSessionStore port, error, in-memory factory | No database |
| `/store/agent-sessions/sqlite` | Kernel session adapter and synchronous legacy session helpers/DDL | SQLite kernel or borrowed handle |
| `/store/agent-sessions/pglite` | Kernel session adapter | PostgreSQL-dialect kernel, pglite or pglite-socket transport |
| `/store/agent-sessions/postgres` | Kernel session adapter | PostgreSQL-dialect kernel, node-postgres transport |

Consumer adapters should use `(required, optional = {})`. The signatures below retain the actual source: a number of factories accept one object and native callbacks keep their framework ABI. This specification does not add a second argument where none exists. Exported interfaces/types are the authoritative structural shapes; named low-level helper shapes that are not exported can be obtained with `Parameters<typeof helper>` and `ReturnType<typeof helper>`.

## EventLog and RunLifecycle

```ts
createInMemoryEventLog(_requiredArgs: Record<string, never>, options: InMemoryEventLogOptions = {}): EventLog;
createRunLifecycle(requiredArgs: Pick<CreateRunLifecycleInput, "eventLog">, optionalArgs: Pick<CreateRunLifecycleInput, "onInternalError" | "terminalRetentionMs" | "maxTerminalRuns" | "slowRunThresholdMs"> = {}): RunLifecycle;
```

Lifecycle requires `{eventLog}`; optional onInternalError receives background failures. Defaults: terminalRetentionMs = 86400000, maxTerminalRuns = 1000, slowRunThresholdMs = 45000; null disables slow notices. Corresponding exported constants are `DEFAULT_TERMINAL_RETENTION_MS`, `DEFAULT_MAX_TERMINAL_RUNS`, `DEFAULT_SLOW_RUN_THRESHOLD_MS`. The host drives runs, controls authority, and calls/awaits rehydrate before accepting requests after restart.

| EventLog method | Promise result |
|---|---|
| `append({runId, event, data}, {dedupeKey?} = {})` | EventLogEntry `{id, event, data, recordedAt}` |
| `replay({runId, afterCursor})` | EventLogReplayResult discriminated success/unknown-run/invalid-cursor/replay-gap |
| `listRunIds({})` / `drop({runId})` | readonly string[] / void |

| RunLifecycle method, current signature | Return |
|---|---|
| `start({contextRef}, {agentId?, idempotencyKey?, runId?, inactivityTimeoutMs?} = {})` | Promise<{run: RunStatus; started: boolean}> |
| `get({runId})` / `list({}, {contextRef?} = {})` | Promise<RunStatus or undefined> / Promise<readonly RunStatus[]> |
| `rehydrate({})` | Promise<void> |
| `cancel(request: RunCancelRequest)` | Promise<RunStatus>; cancellation intent |
| `onCancelRequested({runId, listener})` | unsubscribe function |
| `emit({runId, input: DriverEmittableInput})` | Promise<RunProtocolEvent>; agent/stdout/stderr/error input only |
| `finish({runId, status, code, signal, resumable}, {sessionRef?} = {})` | Promise<RunStatus>; status succeeded/failed/cancelled, code/signal nullable |
| `resume({runId})` | Promise<{run: RunStatus; resumed: boolean}> |
| `suspendSlowRunNotice({runId})` / `resumeSlowRunNotice({runId})` | void |
| `waitForTerminal({runId})` | Promise<RunStatus>; no timeout |
| `stream({runId, onEvent}, options: {afterCursor?: string \| null} = {})` | Promise<StreamSubscribeResult>; subscription or replay failure |

RunStatus contains id/contextRef/agentId/idempotencyKey/state/cancelRequested/timing and terminal outcome as declared in [run-lifecycle.ts](../../src/run-lifecycle.ts). The package re-exports protocol EventLog, replay and run event/payload types rather than creating a second wire model.

```ts
import { createInMemoryEventLog, createRunLifecycle } from '@jini-ai/daemon';
const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
await lifecycle.rehydrate({});
const { run } = await lifecycle.start({ contextRef: 'workspace' });
await lifecycle.emit({ runId: run.id, input: { event: 'agent', data: { type: 'text', text: 'Hello' } } });
await lifecycle.finish({runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false});
```

### Lifecycle utilities exported by the root wildcard

These are low-level helpers, not an alternative persistence protocol. They require the maps/records/callbacks explicitly listed.

| Current signature | Return |
|---|---|
| `classifyRunCloseStatus({cancelRequested, code, signal?})` | TerminalRunOutcome |
| `resolveTimeoutMs({envVar?, agentDefaultMs?, defaultMs, maxMs, env?})` | number |
| `createInactivityWatchdog({timeoutMs, onTimeout})` | InactivityWatchdog `{noteActivity():void, cancel():void}` |
| `resolveIdempotentReplayRunId({ idempotencyIndex, idempotencyKey }: { readonly idempotencyIndex: ReadonlyMap<string, string>; readonly idempotencyKey: string \| undefined })` | string or undefined |
| `registerIdempotencyKeyIfPresent({ idempotencyIndex, idempotencyKey, runId }: { readonly idempotencyIndex: Map<string, string>; readonly idempotencyKey: string \| undefined; readonly runId: string })` / `clearIdempotencyIndexEntryIfMatching({ idempotencyIndex, idempotencyKey, runId }: { readonly idempotencyIndex: Map<string, string>; readonly idempotencyKey: string \| undefined; readonly runId: string })` | void |
| `computeRetentionDelayMs({ terminalAt, retentionMs, now }: { readonly terminalAt: number; readonly retentionMs: number; readonly now: number })` | number |
| `buildStartPayload({ runId, startInput }: { readonly runId: string; readonly startInput: Pick<StartRunInput, 'contextRef' \| 'agentId' \| 'idempotencyKey'> })` | RunStartPayload |
| `armWatchdogIfConfigured({ record, timeoutMs, onTimeout }: { readonly record: { watchdog: InactivityWatchdog \| undefined }; readonly timeoutMs: number \| undefined; readonly onTimeout: () => void })` / `armSlowRunWatchdogIfConfigured({ record, timeoutMs, onTimeout }: { readonly record: { slowRunWatchdog: InactivityWatchdog \| undefined }; readonly timeoutMs: number \| undefined; readonly onTimeout: () => void })` | void; supplied record holds respective watchdog |
| `deliverReplayedEvents({ runId, entries, onEvent }: { readonly runId: string; readonly entries: readonly EventLogEntry[]; readonly onEvent: (event: RunProtocolEvent) => void })` | Set<string> of delivered IDs |
| `deliverUndeliveredEvents({ events, deliveredEventIds, onEvent }: { readonly events: readonly RunProtocolEvent[]; readonly deliveredEventIds: Set<string>; readonly onEvent: (event: RunProtocolEvent) => void })` | void |
| `finishStreamSubscription(record: {subscribers: Set<(event: RunProtocolEvent) => void>}, subscriber, terminal: boolean)` | StreamSubscribeResult |

## Tool execution and event bridges

```ts
createToolExecutor(requiredArgs: Pick<CreateToolExecutorOptions, "registry">, optionalArgs: Pick<CreateToolExecutorOptions, "delegate" | "now"> = {}): ToolExecutor;
createDelegatedToolBridge(options: CreateDelegatedToolBridgeOptions): DelegatedToolBridge;
createRemoteToolEventRecorder(options: CreateRemoteToolEventRecorderOptions): RemoteToolEventRecorder;
```

The host supplies registered descriptor/handler/policy triples through core's ToolRegistry, a Principal, and a RunRef. ExecutionDelegate optionally vetoes authorization and supplies confirmation; it cannot override policy denial.

| Current method/function | Result |
|---|---|
| executor `execute({principal, run, toolId, input}, {signal?, emitSurface?} = {})` | Promise<ToolExecutionResult> |
| executor `resumeConfirmation({executionId, decision})` / `cancel({executionId})` | void |
| executor `getAuditRecord({executionId})` | ToolExecutionAuditRecord or null |
| bridge `execute({runId, toolUseId, toolId, principal, input}, {signal?} = {})` | Promise<ToolExecutionResult>; emits use/result and human-only surfaces |
| recorder `recordToolUse({runId, record: {toolUseId, toolId, input}})` | Promise<RunProtocolEvent> |
| recorder `recordToolResult({runId, record: {toolUseId, content, isError?}})` | Promise<RunProtocolEvent> |
| `serializeDelegatedToolOutput({ output }: { readonly output: unknown })` / `resultContent({ result }: { readonly result: ToolExecutionResult })` | string |

ToolExecutionResult carries executionId/status and optional output/truncated/error/errorKind. Status is completed/denied/confirmation-denied/timed-out/cancelled/failed; errorKind can be validation/internal. The recorder does not execute or authorize tools; the host must authenticate remote recording and supply matching correlation IDs. `MCP_UI_EVENT_TYPE = 'mcp-ui'` is exported.

```ts
const executor = createToolExecutor({ registry: hostRegistry }, { delegate: hostConfirmation });
const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor: executor });
await bridge.execute({runId: run.id, toolUseId: 'call-1', toolId: 'host.inspect', principal, input: {}});
```

## Frontend session routing

```ts
createFrontendSessionRegistry(requiredArgs: Record<string, never>, optionalArgs: Pick<CreateFrontendSessionRegistryOptions, "newInvocationId" | "newBindToken"> = {}): FrontendSessionRegistry;
createFrontendCapabilityRegistrations(requiredArgs: Pick<CreateFrontendCapabilityRegistrationsOptions, "registry" | "capabilities">, optionalArgs: Pick<CreateFrontendCapabilityRegistrationsOptions, "policy" | "timeoutMs" | "maxOutputBytes"> = {}): readonly ToolRegistration[];
```

Capabilities are `{id, description, requiresConfirmation?, inputSchema?}`. Default policy is exported `denyAllFrontendCapabilityPolicy`; `DEFAULT_FRONTEND_CAPABILITY_TIMEOUT_MS = 30000`. A frontend transport supplies delivery and settlement; the host supplies policy and binds runs only after authenticating the originating session.

| Registry method | Return |
|---|---|
| `attach({descriptor: {sessionId, capabilities}, deliver})` | `{sessionId, bindToken, detach():void}` |
| `bindRun({runId, sessionId})` / `bindRunByToken({runId, bindToken})` | unbind function; direct binding is trusted in-process authority |
| `invoke({runId, capabilityId, input}, {signal?} = {})` | Promise<unknown> |
| `settle({sessionId, invocationId, outcome})` | boolean; false for stale/foreign/already-settled invocation |
| `capabilitiesFor({runId})` / `sessionFor({runId})` | readonly string[] / FrontendSessionDescriptor or undefined |

Example: attach a host transport, pass its bind token into authenticated run-start wiring, register `createFrontendCapabilityRegistrations({registry, capabilities: manifest, policy: hostPolicy})`, and forward frontend replies through settle. Registry invocation has no intrinsic timeout; descriptor timeout belongs to ToolExecutor.

## Agent process driver

```ts
createAgentExecutor(requiredArgs: Pick<CreateAgentExecutorOptions, "lifecycle">, optionalArgs: Pick<CreateAgentExecutorOptions, "getAgentDef" | "resolveAgentLaunch" | "ensureAgentCapabilities" | "applyAgentLaunchEnv" | "createCommandInvocation" | "spawn" | "attachAcpSession" | "acpPermissionHandler" | "attachPiRpcSession" | "preparePromptFileForAgent" | "prepareAgentLogFile" | "listProcessSnapshots" | "collectProcessTreePids" | "stopProcesses" | "onCleanupFailure" | "journal" | "continuation" | "classifyFailure" | "mcpJsonInjection" | "claudeConfigDirIsolation" | "claudeConfigDirIsolationEnabled" | "bufferedStdoutMaxBytes" | "promptAugmenter"> = {}): AgentExecutor;
// AgentExecutor.run(input: AgentExecutorRunInput): Promise<void>
```

Only lifecycle is mandatory. Run input requires `{runId, agentId, prompt, cwd}`; optional model/reasoning/permissionMode/imagePaths/extraAllowedDirs/uploadRoot/credentialEnv/env/resumeSessionId/newSessionId/disallowedTools/allowedTools/settingSources/settings are forwarded according to the runtime definition. Start a lifecycle run before calling run. The returned promise confirms dispatch/spawn; use lifecycle.waitForTerminal for process completion.

Optional seams include runtime-definition lookup, launch/help resolution, command invocation, spawn, ACP/pi-RPC attachment, prompt/log staging, process enumeration/tree stopping, permission handler, cleanup reporting, journal, failure classifier and prompt augmenter. `continuation` requires toolExecutor/principal and optional autonomousToolNames. Default collaborators use real processes/filesystem/runtime discovery. Omitted permissionMode selects the runtime's bypass default; host policy must choose an appropriate explicit mode.

MCP JSON injection requires command/daemonUrl and optionally args/env/credential(runId) plus read/write/remove/mkdtemp/removeDir seams. Claude configuration isolation defaults disabled. bufferedStdoutMaxBytes defaults to exported DEFAULT_BUFFERED_STDOUT_MAX_BYTES = 8 MiB. credentialEnv merges into a baseline environment allowlist; explicit env bypasses filtering.

```ts
const driver = createAgentExecutor({ lifecycle }, { spawn: hostSpawn, getAgentDef: hostRuntimeLookup });
await driver.run({ runId: run.id, agentId: 'runtime', prompt: 'Inspect', cwd: workspaceRoot });
const outcome = await lifecycle.waitForTerminal({runId: run.id});
```

### Agent helper exports

The root wildcard exposes the following functions. These are composition/testing seams with the source's current object signatures. `P<F>` below means `Parameters<typeof F>[0]`, `D<F>` means `Parameters<typeof F>[1]`, and `R<F>` means `ReturnType<typeof F>`; these aliases retain the full required fields and result types for helpers whose named structural types are private. Consumers should import the function, not its private input type. Detailed collaborator properties reside in [agent-executor.ts](../../src/agent-executor.ts).

| Current signature | Return/ports |
|---|---|
| `isSupportedStreamFormat(args: { readonly value: string })` | type guard SupportedStreamFormat |
| `assessAgentExecutorCompatibility({ def }: { readonly def: RuntimeAgentDef })` / `isAgentExecutorSupported({ def }: { readonly def: RuntimeAgentDef })` | AgentExecutorCompatibility / boolean |
| `extractUsageTokens({ rawUsage }: { readonly rawUsage: Record<string, unknown> \| undefined })` | optional input_tokens/output_tokens object or undefined |
| `translateStatusEvent({ rawEvent }: { readonly rawEvent: Record<string, unknown> })` / `translateToolResultEvent({ rawEvent }: { readonly rawEvent: Record<string, unknown> })` / `translateErrorEvent({ rawEvent }: { readonly rawEvent: Record<string, unknown> })` / `translateTurnEndEvent({ rawEvent }: { readonly rawEvent: Record<string, unknown> })` | AgentRuntimeEventTranslation; rawEvent Record<string,unknown> |
| `translateAgentRuntimeEvent({ rawEvent }: { readonly rawEvent: unknown })` / `unavailableJiniBridgeStatus({ rawEvent }: { readonly rawEvent: unknown })` | AgentRuntimeEventTranslation / string or undefined |
| `buildMcpJsonServerEntry({ runId, options }: { readonly runId: string; readonly options: Pick<McpJsonInjectionOptions, 'command' \| 'args' \| 'daemonUrl' \| 'env'> }, { credential }: { readonly credential?: string } = {})` | McpJsonServerEntry |
| `mergeMcpJsonContent({ existingRaw, serverEntry }: { readonly existingRaw: string \| undefined; readonly serverEntry: McpJsonServerEntry })` / `mergeEnvContentMcpConfig({ existingRaw, entry }: { readonly existingRaw: string \| undefined; readonly entry: McpJsonServerEntry })` | string |
| `buildAcpMcpBridgeServers({ entry }: { readonly entry: McpJsonServerEntry })` | AcpMcpServerInput[] |
| `mergeEnvContentInstructions({ existingRaw, instructionsFilePath }: { readonly existingRaw: string \| undefined; readonly instructionsFilePath: string })` | string |
| `buildCodexMcpServerToml({ entry }: { readonly entry: McpJsonServerEntry })` / `buildCodexHomeConfigToml({ existingRaw, entry }: { readonly existingRaw: string \| undefined; readonly entry: McpJsonServerEntry })` | string |
| `resolveSourceCodexHomeDir({ hostEnv }: { readonly hostEnv: NodeJS.ProcessEnv })` / `resolveSourceClaudeConfigDir({ hostEnv }: { readonly hostEnv: NodeJS.ProcessEnv })` | string |
| `buildMcpBridgeDelivery(input: { readonly cwd: string; readonly runId: string; readonly strategy: RuntimeAgentDef['externalMcpInjection']; readonly options: McpJsonInjectionOptions \| undefined; readonly credential: string \| undefined; })` | McpBridgeDelivery or null; supplied cwd/runId/strategy/options/credential |
| `applyAgentTranslationSideEffects({ payload, sessionId, sink }: { readonly payload: RunAgentPayload; readonly sessionId: string \| undefined; readonly sink: AgentTranslationSideEffectSink })` | void |
| `resolveDefAndStreamFormat({ input, deps }: { readonly input: Pick<AgentExecutorRunInput, 'runId' \| 'agentId'>; readonly deps: { readonly getAgentDef: typeof getAgentDef; readonly failBeforeSpawn: FailBeforeSpawn } })` | Promise<ResolvedDefAndFormat>; getAgentDef/failBeforeSpawn |
| `resolveImageDeliveryAndArgvBudget({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly prompt: string; readonly imagePaths: readonly string[] \| undefined; readonly extraAllowedDirs: readonly string[] \| undefined; }; readonly deps: { readonly failBeforeSpawn: FailBeforeSpawn } })` | Promise<ImagePromptDelivery>; failBeforeSpawn |
| `resolveRunEnv({ input, hostEnv }: { readonly input: Pick<AgentExecutorRunInput, 'env' \| 'credentialEnv'>; readonly hostEnv: NodeJS.ProcessEnv })` | Record<string,string> |
| `resolveLaunch({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly resolvedEnv: Record<string, string> }; readonly deps: { readonly resolveAgentLaunch: typeof resolveAgentLaunch; readonly failBeforeSpawn: FailBeforeSpawn } })` | Promise<ConfirmedAgentLaunchResolution>; resolveAgentLaunch/failBeforeSpawn |
| `stagePromptFile({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly prompt: string }; readonly deps: { readonly preparePromptFileForAgent: typeof preparePromptFileForAgent; readonly failBeforeSpawn: FailBeforeSpawn } })` | Promise<PreparedPromptFile or null>; preparePromptFileForAgent/failBeforeSpawn |
| `stageLogFile({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly preparedPromptFile: PreparedPromptFile \| null }; readonly deps: { readonly prepareAgentLogFile: typeof prepareAgentLogFile; readonly failBeforeSpawn: FailBeforeSpawn } })` | Promise<PreparedAgentLogFile or null>; prepareAgentLogFile/failBeforeSpawn |
| `resolveMcpBridgeForRun({ input, deps }: { readonly input: { readonly runId: string; readonly cwd: string; readonly def: RuntimeAgentDef }; readonly deps: { readonly mcpJsonInjection: McpJsonInjectionOptions \| undefined; readonly cleanupStagedFiles: () => Promise<void>; readonly failBeforeSpawn: FailBeforeSpawn; } })` | Promise<McpBridgeDelivery or null>; mcpJsonInjection/cleanupStagedFiles/failBeforeSpawn |
| `computeChildEnv(spawnEnv, mcpBridge, codexHomeDir?, systemPromptEnvOverrides?, stagedInstructionsFile?: {varName:string; path:string}, claudeConfigDir?)` | NodeJS.ProcessEnv |
| `computeRuntimeContext({ preparedPromptFile, preparedLogFile, mcpBridge }: { readonly preparedPromptFile: PreparedPromptFile \| null; readonly preparedLogFile: PreparedAgentLogFile \| null; readonly mcpBridge: McpBridgeDelivery \| null }, { resumeSessionId, newSessionId }: { readonly resumeSessionId?: string \| null; readonly newSessionId?: string } = {})` | RuntimeContext or undefined |
| `buildAgentBuildArgsOptions({ input, systemPromptOverlay }: { readonly input: Pick<AgentExecutorRunInput, 'model' \| 'reasoning' \| 'permissionMode' \| 'disallowedTools' \| 'allowedTools' \| 'settingSources' \| 'settings'>; readonly systemPromptOverlay: string \| null \| undefined })` | RuntimeBuildOptions or undefined |
| `resolveSystemPromptOverlayDelivery(input: { readonly defId: string; readonly systemPromptDelivery: RuntimeAgentDef['systemPromptDelivery']; readonly resumesSessionViaCli: boolean \| undefined; readonly resumesSessionViaAcpLoad: boolean \| undefined; readonly overlay: string \| null \| undefined; readonly prompt: string; readonly resumeSessionId: string \| null \| undefined; })` | SystemPromptOverlayDelivery |
| `buildRunArgs({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly imageDelivery: ImagePromptDelivery; readonly imagePaths: readonly string[] \| undefined; readonly runInput: Pick<AgentExecutorRunInput, 'model' \| 'reasoning' \| 'permissionMode'>; readonly systemPromptOverlay: string \| null \| undefined; readonly overlayDelivery: SystemPromptOverlayDelivery; readonly runtimeContext: RuntimeContext \| undefined; }; readonly deps: { readonly releaseStagedResources: () => Promise<void>; readonly failBeforeSpawn: FailBeforeSpawn } })` | Promise<{args:string[]; envOverrides:Readonly<Record<string,string>>}>; releaseStagedResources/failBeforeSpawn |
| `writeMcpJsonIfNeeded({ input, deps }: { readonly input: { readonly runId: string; readonly cwd: string; readonly def: RuntimeAgentDef; readonly mcpBridge: McpBridgeDelivery \| null }; readonly deps: { readonly mcpJsonInjection: McpJsonInjectionOptions \| undefined; readonly releaseStagedResources: () => Promise<void>; readonly failBeforeSpawn: FailBeforeSpawn; } })` | Promise<string or undefined>; injection/release/failure seams |
| `prepareSystemPromptOverlayFileIfNeeded({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly overlay: string \| null \| undefined }; readonly deps: { readonly releaseStagedResources: () => Promise<void>; readonly failBeforeSpawn: FailBeforeSpawn } })` | Promise<PreparedSystemPromptOverlayFile or null>; release/failure seams |
| `prepareCodexHomeIfNeeded({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly mcpBridge: McpBridgeDelivery \| null }; readonly deps: { readonly mcpJsonInjection: McpJsonInjectionOptions \| undefined; readonly hostEnv: NodeJS.ProcessEnv; readonly releaseStagedResources: () => Promise<void>; readonly failBeforeSpawn: FailBeforeSpawn; } })` | Promise<PreparedCodexHome or null>; injection/hostEnv/release/failure seams |
| `prepareClaudeConfigDirIfNeeded({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef }; readonly deps: { readonly enabled: boolean; readonly claudeConfigDirIsolation: ClaudeConfigDirIsolationOptions \| undefined; readonly hostEnv: NodeJS.ProcessEnv; readonly releaseStagedResources: () => Promise<void>; readonly failBeforeSpawn: FailBeforeSpawn; } })` | Promise<PreparedClaudeConfigDir or null>; enabled/isolation/hostEnv/release/failure seams |
| `guardWindowsCommandLineBudget({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly launchPath: string; readonly args: readonly string[] }; readonly deps: { readonly releaseStagedResources: () => Promise<void>; readonly failBeforeSpawn: FailBeforeSpawn } })` | Promise<void>; release/failure seams |
| `spawnAgentChildProcess({ input, deps }: { readonly input: { readonly cwd: string; readonly childEnv: NodeJS.ProcessEnv; readonly invocation: ReturnType<typeof createCommandInvocation>; }; readonly deps: { readonly spawn: typeof nodeSpawn } })` | SpawnAgentChildProcessResult; spawn seam |
| `isStdinDrivenFormat(args: { readonly streamFormat: SupportedStreamFormat })` | type guard ChildDrivenStreamFormat |
| `confirmChildSpawned({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly child: ChildProcess }; readonly deps: { readonly releaseStagedResources: () => Promise<void>; readonly failBeforeSpawn: FailBeforeSpawn } })` | Promise<void>; release/failure seams |
| `armHandoffWatcher(runtimeLockHold: RuntimeLockHold \| undefined, handoffInput: {logFilePath:string \| undefined; model:string \| undefined; processExited:AbortSignal}, release: () => void)` | void |
| `runAcpDispatch({ input, deps }: { readonly input: RunAcpDispatchInput; readonly deps: RunAcpDispatchDeps })` / `runPiRpcDispatch({ input, deps }: { readonly input: RunPiRpcDispatchInput; readonly deps: RunPiRpcDispatchDeps })` | Promise<void>; corresponding attachment/lifecycle/staged-resource ports |

`MCP_BRIDGE_UNAVAILABLE` is the exported protocol-error marker. Type exports describe executor options/run input, runtime compatibility, MCP delivery, dispatch/translation, staged resources and injected collaborators; they do not acquire resources by themselves.

## Terminal manager

```ts
createTerminalSessionManager(requiredArgs: Record<string, never>, optionalArgs: Pick<CreateTerminalSessionManagerOptions, "terminalService" | "loadSpawnPty" | "maxEvents" | "maxBufferBytes" | "exitTailBytes" | "flushIntervalMs" | "flushThresholdBytes" | "ttlMs" | "shutdownGraceMs"> = {}): TerminalSessionManager;
loadRealSpawnPty(_requiredArgs: Record<string, never>): Promise<PtySpawn>;
createTerminalToolRegistrations(requiredArgs: Pick<CreateTerminalToolRegistrationsOptions, "manager">, optionalArgs: Pick<CreateTerminalToolRegistrationsOptions, "policy" | "requiresConfirmation" | "timeoutMs"> = {}): TerminalToolRegistrations;
```

The host can inject TerminalService and loadSpawnPty, plus maxEvents/maxBufferBytes/exitTailBytes/flushIntervalMs/flushThresholdBytes/ttlMs/shutdownGraceMs tuning forwarded to platform. Default PTY loader imports optional node-pty lazily. Tool registrations return `{create}` for `TERMINAL_CREATE_TOOL_ID = 'terminal.create'`; exported denyAllTerminalCreatePolicy is the default.

| Manager method | Return |
|---|---|
| `create({principal, options: {cwd, resourceRef?, cols?, rows?, shell?}})` | Promise<TerminalSessionInfo> |
| `get({principal, id})` / `list({principal}, {filter?: {resourceRef?: string}} = {})` | ok/session or not-found / readonly TerminalSessionInfo[] |
| `write({principal, id, input})` / `resize({principal, id, cols, rows})` / `kill({principal, id}, {signal?} = {})` | Promise<TerminalSessionActionResult> |
| `attach({principal, id, lastEventId, sink})` | attached/ended/not-found |
| `detach({id, sink})` | void |
| `shutdownActive(options?: {graceMs?: number})` | Promise<void> |

Example: `const terminals = createTerminalSessionManager({loadSpawnPty: hostPtyLoader}); const session = await terminals.create({principal, options: {cwd}});` Wire SSE sinks explicitly; call shutdownActive during host teardown.

## Continuation and routines

| Current signature | Return / ports |
|---|---|
| `createRunByteJournal({ eventLog }: { readonly eventLog: EventLog })` | RunByteJournal; record({runId,entry: JournalEntry}):Promise<void>, read({runId}):Promise<readonly JournalEntry[]>; use a separate journal log |
| `createRunScopedContextStore<T>({lifecycle})` | RunScopedContextStore<T>; lifecycle.waitForTerminal required; bind({runId,value}):void, resolve({runId}):T, has({runId}):boolean, size:number |
| `createDefaultRunStartHandler({agentExecutor, resolveRunInput})` | async handler accepting `{request:{contextRef,agentId?},run:{id}}` |
| `resolveContinuationTransport({ def }: { readonly def: RuntimeAgentDef })` | 'mcp-callback'/'stdin-injection'/'none' |
| `new RoutineService({persistence}, {now?,newId?} = {})` | scheduler described below |
| `createInMemoryRoutineStore(_requiredArgs: Record<string, never>, { now = Date.now, newId = randomUUID }: { now?: () => number; newId?: () => string } = {})` | InMemoryRoutineStore |
| `summarizeLastRun({ run }: { readonly run: RoutineRun \| null })` | Record<string,unknown> or null |

resolveRunInput receives `{runId,contextRef,agentId?}` and supplies required agentId/prompt/cwd plus optional permissionMode/model/reasoning/env/credentialEnv/imagePaths/extraAllowedDirs/uploadRoot. Example: `const onRunStarted = createDefaultRunStartHandler({agentExecutor: driver, resolveRunInput: hostInputResolver});` Attach this callback to the host's run creation path.

RoutinePersistence is synchronous: list(); insertRun({run},{scheduledSlotAt?}); updateRun({id,patch}); getLatestRun({routineId}). false on insert means an already-claimed slot. RoutineRunHandler receives one record with routine/trigger/startedAt/runId and returns projectId/conversationId/agentRunId/completion plus optional prepare/start/discard/discardUnstarted hooks.

| RoutineService method | Return |
|---|---|
| `setRunHandler({handler})` / `start({})` / `stop({})` / `rescheduleAll({})` | void |
| `rescheduleOne({routineId})` / `unschedule({routineId})` | void |
| `nextRunAt({routineId})` / `runNow({routineId})` | Date or null / Promise<RoutineRunHandlerStart> |

RoutineStore methods are async: list(); get({id}); create({name,prompt,schedule,target},{skillId?,agentId?,context?,enabled?}); update({id,patch}); delete({id}):boolean; listRuns({routineId,limit}); getLatestRun({routineId}). InMemoryRoutineStore additionally has recordRun({run}) and patchRun({id,patch}). enabled defaults true; validation helpers are separate from create.

Example: use createInMemoryRoutineStore for CRUD, adapt its recordRun/patchRun to RoutinePersistence, set the host's run handler, then start the scheduler. stop clears future scheduling; it does not stop already running agent work.

### Schedule math and run diagnostics

| Current signature | Result |
|---|---|
| `partsInTimezone({ timezone, atUtc }: { readonly timezone: string; readonly atUtc: Date })` | {year,month,day,hour,minute,second,weekday} |
| `tzWallToUtcCandidates({ timezone, year, month, day, hour, minute }: { readonly timezone: string; readonly year: number; readonly month: number; readonly day: number; readonly hour: number; readonly minute: number })` / `tzWallToUtcGapFallback({ timezone, year, month, day, hour, minute }: { readonly timezone: string; readonly year: number; readonly month: number; readonly day: number; readonly hour: number; readonly minute: number })` | Date[] / Date or null |
| `nextHourlyRunAt({ minute }: { readonly minute: number }, { now = new Date() }: { readonly now?: Date } = {})` | Date |
| `nextWallTimeMatching({ timezone, time, predicate, now }: { readonly timezone: string; readonly time: string; readonly predicate: (weekday: Weekday) => boolean; readonly now: Date })` | Date or null |
| `nextRunAtForSchedule({ schedule }: { readonly schedule: RoutineSchedule }, { now = new Date() }: { readonly now?: Date } = {})` | Date or null |
| `isValidWallTime({ time }: { readonly time: string })` / `isValidTimezone({ tz }: { readonly tz: string })` | boolean |
| `validateSchedule({ schedule }: { readonly schedule: RoutineSchedule })` / `validateTarget({ target }: { readonly target: RoutineProjectTarget })` | void or throw |
| `runResultFromStatus({ status }: { readonly status: string \| undefined })` | RunResult |
| `deriveRunErrorCode({ status }: { readonly status: RunStatusForAnalytics })` | string or undefined |
| `computeRetryBackoffMs({ attemptIndex, category }: { readonly attemptIndex: number; readonly category: RunFailureCategory \| undefined }, { random = Math.random }: { readonly random?: () => number } = {})` | number |
| `classifyProcessExitFailure({ code, signal }: { readonly code: number \| null; readonly signal: string \| null })` | RunRetryFailureSignal |
| `resumableFromProcessExit({ code, signal }: { readonly code: number \| null; readonly signal: string \| null }, { sideEffects }: { readonly sideEffects?: Pick<RunRetrySideEffectState, 'userVisibleOutputSeen' \| 'toolCallSeen'> } = {})` | boolean |
| `decideSafeRunRetry(requiredArgs: Pick<RunRetryPolicyInput, "result" \| "attemptCount">, optionalArgs: Pick<RunRetryPolicyInput, "failure" \| "maxAttempts" \| "sideEffects" \| "random"> = {})` | RunRetryPolicyDecision |
| `stderrLineCountBucket({ count }: { readonly count: number })` | StderrLineCountBucket |
| `collectStderrTailSummary(_requiredArgs: Record<string, never>, { events = [], redact = identityRedactor }: { readonly events?: RunEventForDiagnostics[]; readonly redact?: TailRedactor } = {})` / `collectStdoutTailSummary(_requiredArgs: Record<string, never>, { events = [], redact = identityRedactor }: { readonly events?: RunEventForDiagnostics[]; readonly redact?: TailRedactor } = {})` | StreamTailSummary or undefined |
| `summarizeRunDiagnosticsForAnalytics(args: { events?: RunEventForDiagnostics[]; exitCode?: number \| null; signal?: string \| null; cancelRequested?: boolean; streamErrorSeen?: boolean; fatalRpcErrorSeen?: boolean; emptyOutputFailure?: boolean; firstTokenSeen?: boolean; artifactWriteSeen?: boolean; liveArtifactSeen?: boolean; })` | RunDiagnosticsAnalytics |

RoutineSchedule supports hourly minute, daily/weekdays time+timezone, weekly time+timezone+weekday 0–6. RoutineProjectTarget is create_each_run or reuse with projectId. Retry constants: DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS=1, SAFE_RUN_RETRY_STRATEGY='same_run_transient', RATE_LIMIT_RETRY_BASE_DELAY_MS=1000, TRANSIENT_RETRY_BASE_DELAY_MS=500, RETRY_BACKOFF_MULTIPLIER=2, MAX_RETRY_BACKOFF_DELAY_MS=8000. Diagnostics accept events and optional exit/cancel/stream/fatal/empty-output/token/artifact flags; no analytics transport is supplied or invoked.

## SQLite event log

```ts
createSqliteEventLog(input: { db: SqliteDb }, options: SqliteEventLogOptions = {}): SqliteEventLog;
openSqliteEventLog(input: { file: string; open: SqliteSyncOpener }, options: SqliteEventLogOptions = {}): SqliteEventLog;
```

Options supply maxEntriesPerRun (DEFAULT_MAX_ENTRIES_PER_RUN=2000) and core Clock; omitted clock uses system wall time. Borrowed create accepts only {db}; owned open requires {file,open}. Factories create their tables. SqliteEventLog extends EventLog with close({}):Promise<void>; borrowed handles remain host-owned, opened handles are owned and use WAL.

```ts
import { openSqliteEventLog } from '@jini-ai/daemon/store/event-log/sqlite';
const log = openSqliteEventLog({file: logFile, open: hostSqliteOpen}, {clock: hostClock});
const lifecycle = createRunLifecycle({eventLog: log});
await lifecycle.rehydrate({});
// On host shutdown, after drivers finish:
await log.close({});
```

## Agent-session stores

```ts
createInMemoryAgentSessionStore(_requiredArgs: Record<string, never>): AgentSessionStore;
createSqliteAgentSessionStore(input:{kernel:StorageKernel<DB>},options:{clock?:Clock}={}): AgentSessionStore;
createPgliteAgentSessionStore(input:{kernel:StorageKernel<DB>},options:{clock?:Clock}={}): AgentSessionStore;
createPostgresAgentSessionStore(input:{kernel:StorageKernel<DB>},options:{clock?:Clock}={}): AgentSessionStore;
```

AgentSessionStore methods: getSessionId({conversationId,agentId}):Promise<string|null>, setSessionId({conversationId,agentId,sessionId}):Promise<void>, clearSessionId({conversationId,agentId}):Promise<void>. Kernel adapters take {kernel}, optional {clock: Clock}, and require the migrated assistant_agent_sessions table. They never acquire/migrate/close handles; hosts supply authority and transaction scope.

```ts
import { createInMemoryAgentSessionStore } from '@jini-ai/daemon/store/agent-sessions';
import { createSqliteAgentSessionStore } from '@jini-ai/daemon/store/agent-sessions/sqlite';
import { createPgliteAgentSessionStore } from '@jini-ai/daemon/store/agent-sessions/pglite';
import { createPostgresAgentSessionStore } from '@jini-ai/daemon/store/agent-sessions/postgres';
const memory = createInMemoryAgentSessionStore({});
const sqlite = createSqliteAgentSessionStore({kernel: hostSqliteKernel}, {clock: hostClock});
const embedded = createPgliteAgentSessionStore({kernel: hostPgliteKernel});
const network = createPostgresAgentSessionStore({kernel: hostPostgresKernel});
await memory.setSessionId({conversationId: 'conversation', agentId: 'agent', sessionId: 'native-session'});
```

The SQLite subpath also exports legacy helpers with object arguments: getAgentSession/getAgentSessionRecord/clearAgentSession({db,conversationId,agentId}); upsertAgentSession({db,input}); latestCompletedAssistantMessageId({db,conversationId,excludeMessageId},{resumableMessageId = null} = {}); updateAgentSessionStableHash({db,conversationId,agentId,stablePromptHash}). LEGACY_AGENT_SESSIONS_DDL bootstraps the rich agent_sessions schema. These helpers do not synchronize with the simple kernel session store.

## Migration and DI tokens

`migrateLegacyDataDirSync(requiredArgs: Pick<MigrateLegacyDataDirOptions, "legacyDir" \| "dataDir" \| "payloadEntries" \| "proofEntry">, optionalArgs: Pick<MigrateLegacyDataDirOptions, "logger" \| "writeMarker" \| "markerFile" \| "filesystem"> = {})` returns `{status:'noop'|'migrated'|'skipped',reason,copied?}` synchronously. Required options: legacyDir:string|undefined, dataDir, payloadEntries:readonly string[], proofEntry:string. Optional markerFile defaults '.migrated-from', logger supplies info, writeMarker replaces marker writing. Host chooses source/destination/proof boundaries; migration performs filesystem I/O.

Public synchronous helpers: dataDirIsEmptyOrFresh(dataDir,config):boolean; legacyDirHasPayload(legacyDir,config):boolean; dataDirHasExistingPayload(dataDir,config):string[]; promoteStaged(stagingDir,dataDir,entries:readonly string[]):readonly string[]. Config types are the source-derived Parameters of each helper. Example: `migrateLegacyDataDirSync({legacyDir: oldDir, dataDir: newDir, payloadEntries: ['state.sqlite'], proofEntry: 'state.sqlite'});`.

Tokens RunLifecycleToken/EventLogToken/ToolExecutorToken/AgentExecutorToken use IDs jini.runLifecycle/jini.eventLog/jini.toolExecutor/jini.agentExecutor. Bind them to the host-owned instances; importing tokens does not start services.

## Export gaps and evidence

The manifest now exposes `/http`, `/read-only-tools`, `/scheduler`, `/tool-audit`, `/surface-exchanges`, `/session-coordination` and `/run-credentials` in addition to root and session/log adapters. Domain routes are imported from `/http`, not root. No UI code is exported.

Evidence: exported source and tests covering lifecycle replay/recovery, cancellation/watchdogs, confirmation/policy, frontend settlement, driver dispatch, routines, migration and adapter transaction/ownership behavior. Tests were read, not executed.

## ./http: domain routes and ports


Registrars use `({app: Express, deps: D, adapter: AdapterContext}, {}) => void`. They register paths; they do not open a listening server. Stream-only `registerRunEventStream({app, deps}, {}) => void` omits adapter. Public route constants are `JsonRouteSpec<I,O,D>` with `parse(raw)` and `handle({input, deps}, {signal?})`; return values are `Result<O>`. Table response names are public interfaces unless a structural shape is shown.

| Registrar | Consumer dependency contract |
|---|---|
| `registerRunRoutes` / `registerRunEventStream` | `RunHttpDeps`: `lifecycle: RunLifecycle`; optional `onStarted(RunStartContext)`, `onInternalError(RunInternalErrorContext)` |
| `registerAgentRoutes` | `AgentsHttpDeps`: `listAgents() => AgentSummary[] \| Promise<readonly AgentSummary[]>`; optional `rescanAgents()` |
| `registerHealthRoutes` | `HealthHttpDeps`: `getVersion() => string \| Promise<string>`; optional async `checkReadiness() => {ok, checks: Record<string,boolean>}` |
| `registerDaemonStatusRoutes` | `DaemonStatusDeps`: `getVersion`, `host`, `getPort`, `dataDir`, `isShuttingDown`, `requestShutdown` callbacks/values |
| `registerActiveContextRoutes` | `ActiveContextDeps`: `resolveResource({resourceRef}) => {name?: string \| null} \| null \| undefined`; optional `now() => number` |
| `registerRoutineRoutes` | `RoutineHttpDeps`: `store: RoutineStore`, `scheduler: Pick<RoutineService,'nextRunAt' \| 'rescheduleOne' \| 'runNow' \| 'unschedule'>`; optional `projectExists({projectId})` |
| `registerDaemonDbRoutes` | `({app, deps: DaemonDbHttpDeps, adapter}, {}) => void`; deps requires `toolExecutor: ToolExecutor`, explicit `principal: Principal`; optional private `onInternalError` sink |
| `registerComponentCatalogRoutes` | `ComponentCatalogHttpDeps.catalog.search({query}, {limit?}) => readonly ComponentCatalogSearchHit[]`, `describe({id}, {}) => ComponentCatalogEntry \| null` |
| `registerDelegatedToolRoutes` | `DelegatedToolsHttpDeps`: `lifecycle`, `toolExecutor`, `resolvePrincipal({request}) => Principal \| Promise<Principal>`; optional `toolRegistry`, `onInternalError`, `isModelSafeToolFailure({result})`, `describeInternalError(context)` |
| `registerRemoteRunEventRoutes` | `RemoteRunEventHttpDeps`: `lifecycle`, `recorder: RemoteToolEventRecorder`; optional `tokenConfig`, `env`, `onInternalError` |
| `registerFrontendSessionRoutes` | `FrontendSessionsHttpDeps`: `registry: FrontendSessionRegistry`; optional `newSessionId()`, `onInternalError` |
| `registerTerminalRoutes` / `registerTerminalEventStream` | `TerminalsHttpDeps`: `manager: TerminalSessionManager`, `toolExecutor`, `principal`; optional `resolveRoot`, `onInternalError` |
| `registerModelProxyRoutes` | `ModelProxyHttpDeps`: optional provider tool executors `anthropicExecuteTool`, `openaiExecuteTool`, `azureExecuteTool`, `googleExecuteTool`, `ollamaExecuteTool`; optional `onInternalError`, `fetchImpl`, `dnsLookup` |
| `registerConnectorsRoutes` | `ConnectorsHttpDeps`: optional `auth`, `storage`, `payments`, `db`, `realtime` provider ports and `onInternalError`; omitted providers return unavailable |
| `registerResearchRoutes` | `ResearchHttpDeps`: optional `resolveCredentials({providerId}) => Promise<{apiKey?, baseUrl?, model?}>`, `onInternalError` |
| `registerMediaRoutes` | `MediaHttpDeps`: `engine.generate({surface, model}, remainingOptions)`, `taskStore` with async create/get/update/listByOwner/delete, optional `onInternalError` |
| `registerAttachmentRoutes` | `AttachmentsHttpDeps`: `store: AttachmentStore`; optional `maxConcurrentUploads`, `maxAttachmentBytes`, `maxCleanupPaths`, `requireSameOrigin`, `onInternalError`, trusted `resolveOwnerId({req})` |
| `registerXaiRoutes` | `XaiHttpDeps`: every dependency field is optional: data/token path, provider config, callback host/port/path, pending cache, listener slot/factory, search base/model/fetch/deadline, private error sink |
| `registerHostToolsRoutes` | `({app, adapter}, {resolveRoot?, probeEnv?, spawnImpl?} = {}) => void` |
| `registerMemoryRoutes` / `registerMemoryEventStream` | `({app, deps: MemoryHttpDeps, adapter}, {}) => void`; `deps = {notes, extractions, verifications, dataDir}` |
| `registerToolCatalogRoutes` | `({app, deps: ToolCatalogHttpDeps, adapter}, {}) => void`; catalog declares `search({query}, {limit?})`, `describe({id}, {})` |

Auth/ownership/rate limits are host composition concerns unless a registrar explicitly installs a gate. Same-origin is not user authentication. JSON routes default to status 200; exceptions are noted below. Response records and structural ports are defined in the corresponding `src/<family>.ts` files; no database driver or domain store is created implicitly.

## Public route constants and wire contracts

Named constants below are `/http` exports. Path ids are nonempty strings unless narrowed further by their parsers. JSON parse failures use the shared errors contract. `S` means the route requests same-origin checking; `H` means host-mounted middleware supplies security.

| Constants | Method/path; request → successful response |
|---|---|
| `healthRoute`, `apiHealthRoute` | GET `/health`, `/api/health` H; no input → `{ok:true, version}` |
| `readyRoute`, `apiReadyRoute` | GET `/ready`, `/api/ready` H; no input → `{ok:true, ready:true, version, checks}` |
| `versionInfoRoute`, `apiVersionInfoRoute` | GET `/version`, `/api/version` H; no input → `{version}` |
| `daemonStatusRoute`, `daemonShutdownRoute` | GET `/api/daemon/status` H → `{ok:true,version,host,port,dataDir,shuttingDown,pid}`; POST `/api/daemon/shutdown` S → `{ok:true,scheduled:true}` |
| `runStartRoute` | POST `/api/runs` S; `{contextRef, agentId?, idempotencyKey?}` → 201 `{run: RunStatus, started:boolean}` |
| `runListRoute`, `runStatusRoute`, `runCancelRoute` | GET `/api/runs` H with `contextRef?` → `{runs}`; GET `/api/runs/:runId` H → `{run}`; POST `/api/runs/:runId/cancel` S with `{reason?}` → `{run}` |
| `RUN_EVENTS_ROUTE_PATH` | GET `/api/runs/:runId/events` H; `Last-Event-ID`/`afterCursor` → run protocol SSE |
| `agentListRoute`, `agentRescanRoute` | GET `/api/agents` H, POST `/api/agents/rescan` S → `{agents: readonly AgentSummary[]}` |
| `setActiveRoute`, `getActiveRoute` | POST `/api/active` S `{resourceRef,detail?}` or `{active:false}` → `{active:false}` or `{active:true,resourceRef,detail,ts}`; GET same path S additionally returns `resourceName`, `ageMs` |
| `hostEditorsRoute` | GET `/api/editors` H → `HostEditorsResponse`; registrar also mounts POST `/api/resources/:resourceRef/open-in` S `{editorId,detail?}` → `{ok:true,editorId,path}`; open-in spec is not root-exported |
| `routineListRoute`, `routineCreateRoute` | GET `/api/routines` H → `{routines}`; POST same path S `RoutineCreateInput` → 201 `{routine}` |
| `routineGetRoute`, `routineUpdateRoute`, `routineDeleteRoute` | GET `/api/routines/:id` H → `{routine}`; PATCH S `RoutineUpdateInput` → `{routine}`; DELETE S → `{ok:true}` |
| `routineRunNowRoute`, `routineRunsListRoute` | POST `/api/routines/:id/run` S → 202 `{routine,run,projectId,conversationId,agentRunId}`; GET `/api/routines/:id/runs` H with `limit?` → `{runs}` |
| `daemonDbInspectRoute`, `daemonDbVerifyRoute`, `daemonDbVacuumRoute` | GET `/api/daemon/db` S → declared `DaemonDbStatusReport`; POST `/api/daemon/db/verify` S query `quick` (`1`/`true` case-insensitive means true; other single strings/absence false) → declared `DbIntegrityReport`; POST `/api/daemon/db/vacuum` S → declared `DaemonDbVacuumResult` |
| `toolCatalogSearchRoute`, `toolCatalogDescribeRoute` | GET `/api/tools/search` S `q`, optional integer `limit` → declared `{hits: ToolCatalogSearchHit[]}`; GET `/api/tools/:id` S → declared `ToolCatalogEntry` |
| `componentCatalogSearchRoute`, `componentCatalogDescribeRoute` | GET `/api/components/search` S `q`, `limit?` → `{hits: ComponentCatalogSearchHit[]}`; GET `/api/components/:id` S → `ComponentCatalogEntry` |
| `delegatedToolExecuteRoute` | POST `/api/delegated-tool-calls` S `{runId,toolUseId,toolId,input?,requireReadOnly?}` → `{result: ToolExecutionResult}` for completed execution |
| `remoteToolUseRoute`, `remoteToolResultRoute` | POST `/api/runs/:runId/tool-use`, `/tool-result` H + dedicated bearer; use `{toolUseId,toolId,input?}`, result `{toolUseId,content,isError?}` → `{recorded:true}` |
| `frontendSessionResponseRoute` | POST `/api/frontend-sessions/:sessionId/responses` S `{invocationId,ok:true,output?}` or `{invocationId,ok:false,message}` → `{settled:boolean}` |
| `FRONTEND_SESSION_STREAM_ROUTE_PATH`, `FRONTEND_SESSION_RESPONSE_ROUTE_PATH` | GET `/api/frontend-sessions/stream` S with repeatable `capability` → SSE `FrontendSessionStreamEvent`; response path above |
| `terminalCreateRoute`, `terminalListRoute` | POST `/api/terminals` S `{resourceRef,detail?,cols?,rows?,shell?}` → 201 `TerminalSessionInfo`; GET same path H `resourceRef?` → `{terminals}` |
| `terminalStdinRoute`, `terminalResizeRoute`, `terminalKillRoute`, `terminalDeleteRoute` | POST `/api/terminals/:id/stdin` S `{data:string}`, `/resize` S `{cols,rows}`, `/kill` S; DELETE `/api/terminals/:id` S → `TerminalActionResponse` |
| `mediaGenerateRoute`, `mediaTaskGetRoute`, `mediaTaskDeleteRoute`, `mediaTaskListRoute` | POST `/api/media/generate` S `{ownerRef,surface,model,...generationOptions}` → 202 `{task}`; GET `/api/media/tasks/:id` S → `{task}`; DELETE S → `{ok:true}`; GET `/api/media/tasks` S `ownerRef`, `includeTerminal?` → `{tasks}` |
| `researchSearchRoute` | POST `/api/research/search` S `{query,maxSources?,providers?}` → `{query,summary,sources,provider,depth:'shallow',fetchedAt}` |
| `xaiOauthStartRoute`, `xaiOauthCompleteRoute`, `xaiOauthCancelRoute`, `xaiOauthDisconnectRoute` | POST `/api/xai/oauth/start` S → `{authorizeUrl,state,callback:{host,port}}`; `/complete` S `{state,code}` → `{ok:true}`; `/cancel`, `/disconnect` S → `{ok:true}` |
| `xaiAuthStatusRoute`, `xaiSearchRoute` | GET `/api/xai/auth/status` S → `{connected,expiresAt,scope,savedAt,listening}`; POST `/api/xai/search` S `{query,allowedXHandles?,excludedXHandles?,fromDate?,toDate?,enableImageUnderstanding?,enableVideoUnderstanding?,model?}` → `{answer,citations,model}` |

Remote paths and stream paths are current source contracts. Additional hand-mounted streams: GET `/api/terminals/:id/stream` S returns terminal data/exit SSE; POST `/api/proxy/{anthropic,openai,azure,google,ollama}/stream` and `/api/proxy/:provider/stream` S accept provider-specific model/messages/tools/credentials and return provider-turn SSE. Anthropic requires `maxTokens`; Azure additionally requires `baseUrl`, `apiVersion`; Google uses nonempty `contents`; Ollama uses model/messages and does not require an API key. Optional turn fields include `baseUrl`, `temperature`, `maxToolTurns`; exact provider payloads are narrowed in `src/model-proxy.ts`.

Connector constants use `ConnectorsHttpDeps`. Mutations and auth-session verification require same-origin; storage/payment/database GETs do not. They select the corresponding optional provider port, return `NOT_CONFIGURED` if absent, and do not add a principal/session policy. Auth signup, payment charge and database insert return 201; other successful operations return 200:

| Constants | Method/path; input → output |
|---|---|
| `connectorsAuthSignUpRoute`, `connectorsAuthSignInRoute`, `connectorsAuthSignOutRoute`, `connectorsAuthSessionRoute` | POST `/api/connectors/auth/signup`, `/signin` with `{email,password}` → `{user}` / `{session}`; `/signout` with `{token}` → `{ok:true}`; `/session` with `{token}` → `{user: AuthUser \| null}` |
| `connectorsStoragePutRoute`, `connectorsStorageGetRoute`, `connectorsStorageDeleteRoute`, `connectorsStorageListRoute` | PUT `/api/connectors/storage/:key` `{dataBase64,contentType?}` → `{object}`; GET same path → `{dataBase64}`; DELETE → `{ok:true}`; GET `/api/connectors/storage` `prefix?` → `{objects}` |
| `connectorsPaymentsChargeRoute`, `connectorsPaymentsGetRoute`, `connectorsPaymentsRefundRoute` | POST `/api/connectors/payments/charge` `{amountCents,currency,customerRef,description?}` → `{charge}`; GET `/api/connectors/payments/:id`, POST `/:id/refund` → `{charge}` |
| `connectorsDbInsertRoute`, `connectorsDbGetRoute`, `connectorsDbUpdateRoute`, `connectorsDbDeleteRoute`, `connectorsDbQueryRoute` | POST `/api/connectors/db/:collection` record with nonempty `id` → `{record}`; GET `/:collection/:id` → `{record}`; PATCH same path record patch → `{record}`; DELETE → `{ok:true}`; GET `/:collection` optional serialized `where` → `{records}` |
| `connectorsRealtimePublishRoute` | POST `/api/connectors/realtime/:channel/publish` `{event:unknown}` → `{ok:true}` |

Provider ports: auth uses `signUp(credentials)`, `signIn(credentials)`, `signOut({token})`, `verifySession({token})`; storage uses `put({key,data}, {contentType?})`, `get({key})`, `delete({key})`, `list({}, {prefix?})`; payments uses `charge({amountCents,currency,customerRef}, {description?})`, `getCharge({id})`, `refund({id})`; database uses `insert({collection,record})`, `get({collection,id})`, `update({collection,id,patch})`, `delete({collection,id})`, `query({collection}, {where?})`; realtime uses `publish({channel,event}) => Promise<void>`, `subscribe({channel,handler:({event})=>void}) => () => void`. These methods return promises of the corresponding public `AuthUser`, `AuthSession`, `StorageObjectMeta`, `Charge`, `DbRecord` values or null for missing lookups.

Memory constants use the generic object-shaped route adapter:

| Constants | Method/path; declared input/output |
|---|---|
| `memoryOverviewRoute`, `memoryTreeRoute` | GET `/api/memory` → `MemoryOverviewResponse`; GET `/api/memory/tree` → `MemoryTreeResponse` |
| `memoryUpdateTreeNodeRoute`, `memoryWriteIndexRoute`, `memoryWriteConfigRoute` | PATCH `/api/memory/tree/:id` `MemoryTreeNodePatch` → `MemoryUpdateTreeNodeResponse`; PUT `/api/memory/index` `{index:string}` → `MemoryIndexResponse`; PATCH `/api/memory/config` `{enabled?:boolean}` → `MemoryConfigResponse` |
| `memoryListExtractionsRoute`, `memoryClearExtractionsRoute`, `memoryRemoveExtractionRoute` | GET `/api/memory/extractions` → `MemoryExtractionsResponse`; DELETE same path or `/:id` → `MemoryRemovedResponse` |
| `memoryListVerificationsRoute`, `memoryClearVerificationsRoute`, `memoryRemoveVerificationRoute` | GET `/api/memory/verifications` → `MemoryVerificationsResponse`; DELETE same path or `/:id` → `MemoryRemovedResponse` |
| `memoryCreateEntryRoute`, `memoryReadEntryRoute`, `memoryUpdateEntryRoute`, `memoryDeleteEntryRoute` | POST `/api/memory` `MemoryEntryInput` → `MemoryEntryResponse`; GET `/api/memory/:id` → same; PUT same path with entry input → same; DELETE → `MemoryDeleteEntryResponse` |

MemoryNoteStore methods take objects: `dir/readConfig/readIndex/listEntries/buildTree({dataDir})`, `writeConfig({dataDir,patch})`, `writeIndex({dataDir,body})`, `readEntry/deleteEntry({dataDir,id})`, `upsertEntry({dataDir,input})`, `updateTreeNode({dataDir,id,patch})`. Logs expose native `list()/clear()` and `remove({id})`; their EventEmitter `on/off` ABI remains positional. Memory SSE uses object-shaped origin/response/channel calls and unsubscribes all three emitters on closure.

## Other ./http factories and helpers

| Export | Current signature/result |
|---|---|
| `createDaemonDbToolRegistrations` | `({operations: {inspect(), verify({quick}), vacuum()}}, {policy?, requiresConfirmation?, timeoutMs?} = {}) => {inspect,verify,vacuum: ToolRegistration}` |
| `denyAllDaemonDbPolicy` | `ToolPolicy`, always denies; tool ids `DB_INSPECT_TOOL_ID = 'daemon.db.inspect'`, `DB_VERIFY_TOOL_ID = 'daemon.db.verify'`, `DB_VACUUM_TOOL_ID = 'daemon.db.vacuum'` |
| `requireRemoteToolBridgeToken` | `({}, {tokenConfig?: {tokenEnvVar?}, env?} = {}) => RequestHandler` |
| `readOnlyRefusalMessage` | `({toolId}, {}) => string`; gateway compatibility wording; `READ_ONLY_UNVERIFIABLE_MESSAGE` is also public |
| `parseCapabilityQuery` | `({raw: unknown}, {}) => readonly string[] \| null` |
| `handleFrontendSessionStream` | `({req,res,deps: FrontendSessionsHttpDeps}, {}) => void`; caller must apply authorization/origin guard first |
| `createFrontendControl` | `({capabilities: readonly FrontendCapabilitySpec[], resolveBindToken: ({request:RunCreateRequest}) => string \| undefined}, {policy?, timeoutMs?, maxOutputBytes?, onBindError?} = {}) => FrontendControl` |
| `currentPlatform` / `applicableForPlatform` | `({}, {nodePlatform?} = {}) => Platform`; `({entry:CatalogueEntry,platform}, {}) => boolean` |
| `defaultProbeEnv`, `pathDirs` | `({}, {}) => HostToolProbeEnv`; **one object** `(probeEnv) => string[]` |
| `probeCommandOnPath`, `probeMacBundle` | `({command,probeEnv}, {}) => Promise<string \| null>`; `({name:string \| readonly string[],probeEnv}, {}) => Promise<{name,path} \| null>` |
| `resolveEntry` | `({entry}, {probeEnv?} = {}) => Promise<{available:false} \| {available:true,resolvedPath,launch:{command,argsForDir({workingDir}):string[]}}>` |
| `resolveHostToolLaunchPlan` | `({editorId,workingDir}, {probeEnv?} = {}) => Promise<HostToolLaunchPlan>` |
| `launchHostTool` | `({command,args:string[]}, {spawnImpl?} = {}) => Promise<{ok:true} \| {ok:false,error:string}>` |
| `listAvailableEditors` | `({}, {probeEnv?} = {}) => Promise<HostEditorsResponse>`; `CATALOGUE` exposes `readonly CatalogueEntry[]` |
| `sanitizeAttachmentName`, `detectAttachmentKind` | `({requestedName:unknown}, {}) => string`; `({body:Uint8Array}, {}) => 'image' \| 'file'` |
| `isUnchangedAttachment` | `({recorded:RecordedAttachmentIdentity, observed:ObservedAttachmentIdentity}, {}) => boolean`; compares regular-file identity, size and canonical path |
| `writeBoundedAttachmentBody` | `({request:AsyncIterable<unknown>,filePath,maxBytes}, {mode?} = {}) => Promise<{size:number,signature:Uint8Array}>` |
| `createDiskAttachmentStore` | `({uploadDirectory}, {maxAttachments?,maxBatchBytes?,maxStoredAttachments?,maxStoredBytes?,retentionMs?,retainAcrossRestarts?} = {}) => Promise<AttachmentStore>` |
| `handleAttachmentUpload` / `handleAttachmentCleanup` | `({req,res,deps,state:{activeUploads:number}}, {})` / `({req,res,deps}, {}) => Promise<void>`; origin/auth is the caller's responsibility |
| `AttachmentRejectedError` | `new AttachmentRejectedError({reason,message}, {})`; exposes reason |

`FrontendControl` exposes `httpExtension({app,context:{adapter}}, {}) => void`, `toolRegistrations`, and `bindOnStarted(context: RunStartContext) => void | Promise<void>`. It hides its session registry. `RunStartContext = {request,run,lifecycle}`. `HostToolProbeEnv = {access({path,mode}):Promise<void>,env,platform}`; native spawn is optional. `Platform` is `darwin | win32 | linux | unknown`; `RealPlatform` excludes unknown. `HostEditor` and `HostEditorsResponse` expose display/availability metadata rather than tool execution authority.

`AttachmentStore` async methods: `createBatchDirectory({batchId}) => string`, `register({input:{batchId,path,name,kind,size,ownerId?}}) => StoredAttachment`, `claim({attachments,runId}) => AttachmentClaim`, `resolveForRun({ref,runId}) => StoredAttachment | undefined`, `listPendingForOwner({ownerId}) => PendingAttachmentSummary[]`, `deleteUnclaimed({batchId,paths}) => void`, `cleanupRun({runId}) => void`, `pruneExpired({}, {now?}) => void`, and current parameterless `dispose() => void`. `StoredAttachment = {path,name,kind,size?,order?}`; upload path is an opaque capability, claimed path is absolute and server-private. `AttachmentClaim = {attachments,batchDirectory?}`. POST `/api/attachments?batch=...&name=...` accepts raw bytes and returns 201 `{attachment}`; DELETE same path accepts `{batchId,paths:string[]}` and returns 204. `ATTACHMENTS_ROUTE_PATH` is public.


## ./http: run credential middleware


`createDaemonAuthMiddleware({authorizationHeaderName,authorize}, {validateDelegatedRunId = false} = {}) => RequestHandler`. Policy `authorize({request:{method,path,headers,body?}}, {validateDelegatedRunId}) => RunAccessDecision` is synchronous. **One-object** factories `createRunOwnershipMiddleware({principalHeaderName,isEventStream:({path})=>boolean,authorize:({runId,principalId,eventStream})=>Promise<RunAccessDecision>})` and `createOwnedRunListHandler<Run>({principalHeaderName,listRuns:({}, {contextRef?})=>Promise<readonly Run[]>,filterOwnedRuns:({runs,principalId})=>decision})` return RequestHandlers.

`RunAccessDecision = {allowed:true,principalHeader?:{name,value}} | {allowed:false,status:400|401|403|404|503,body:unknown}`. List filtering's allowed branch instead carries `runs:Run[]`. Required interface names are `DaemonAuthRequired`, `RunOwnershipRequired`, `OwnedRunListRequired`.

```ts
import { createDaemonAuthMiddleware, createRunOwnershipMiddleware } from '@jini-ai/daemon/http';
app.use(createDaemonAuthMiddleware({ authorizationHeaderName, authorize: daemonPolicy }));
app.use('/api/runs/:runId', createRunOwnershipMiddleware({ principalHeaderName, isEventStream, authorize: ownershipPolicy }));
```


## ./read-only-tools


All functions below use a required object plus an empty optional object. Flat root exports include the four check/message helpers; all seven functions and `ReadOnlyConstrainedPrincipal` are available through `readOnlyTools`.

| Export | Required → result |
|---|---|
| `constrainPrincipalToReadOnlyTools` | `{principal}` → copied `ReadOnlyConstrainedPrincipal` with `toolAccess:'read-only'` |
| `principalIsReadOnlyConstrained` | `{principal}` → boolean |
| `readOnlyToolRefusalMessage` | `{toolId,messages}` → string |
| `checkReadOnlyTool` | `{toolId,registry: Pick<ToolRegistry,'list'> \| undefined,messages}` → refusal string or null |
| `refuseNonReadOnlyDispatch` | Same plus `{principal}` → refusal string or null |
| `readOnlyRemedyRefusalMessage` | `{refusal,formatMessage:({refusal})=>string}` → string |
| `withReadOnlyToolConstraint` | `{inner:ToolExecutor,registry,idGenerator,messages}` → `ToolExecutor`; returned executor uses the kernel object-shaped methods |

`ReadOnlyToolMessages = {unverifiableMessage,toolRefusalMessage({toolId}):string}`; `IdGenerator.newId({}) => string`. `ReadOnlyToolCheckRequired` and `ReadOnlyToolConstraintRequired` name the rows above.

```ts
import { withReadOnlyToolConstraint, constrainPrincipalToReadOnlyTools } from '@jini-ai/daemon/read-only-tools';
const gate = withReadOnlyToolConstraint({ inner: bareExecutor, registry, idGenerator, messages });
const result = await gate.execute(constrainPrincipalToReadOnlyTools({ principal }), run, toolId, input);
```


## Dedicated coordination, exchange, audit and credential entries

`./scheduler` exports SchedulerPort with `schedule({delayMs, callback}): () => void`. Host callbacks must execute asynchronously and cancellation must be idempotent.

`./surface-exchanges`: `createSurfaceExchangeStore({scheduler, clock: Clock, idGenerator: IdGenerator, defaultChannel}, {idleTtlMs = 300000, maxLifetimeMs = 330000} = {}): SurfaceExchangeStore`. Store methods are `open({binding, emit})`, `deliver({exchangeId, params, principalId}, {toolId?, channel?} = {})`, `findTypedAnswerTarget({principalId, toolId})`, and native `size()`. Binding requires toolId/principalId and optionally channel. Exchanges expose id, async `send({emission})`, async `receive({})`, and `close({})`. Receive returns received/params, expired or abandoned. Deliver returns `{ok:true}` or unknown-or-closed/binding-mismatch. `askOnce({exchange, emission})`, `askThenReport({exchange, confirmationEmission, handle})`, `resolveConfirmationDecision({exchange, emission})` close in finally; `classifyConfirmationAnswer({answer})` accepts only literal decision confirm. Constants are SURFACE_EXCHANGE_ID_PARAM, SURFACE_DISMISSED_PARAM, SURFACE_TYPED_ANSWER_PARAM and both default deadline constants. Structural types: SurfaceAnswerChannel, SurfaceExchangeBinding, SurfaceMessage, SurfaceDeliveryRejectionReason, DeliverResult, SurfaceExchange, SurfaceDeliverySpec, SurfaceExchangeStore, ConfirmationOutcome, AssistantSurfaceDeps, SchedulerPort. [Source](../../src/surface-exchanges.ts).

`./session-coordination`: `createLiveRunTracker({})` exposes register/unregister/hasConcurrentLiveRun/concurrentLiveRunIds with `{conversationId,runId}` and conversationIdForRun({runId}). `createConversationStartLock({})` exposes `run({conversationId: string|undefined, critical})` and trackedConversationCount(). `waitForStoppingRuns({tracker,lifecycle,scheduler,conversationId,runId}, {timeoutMs = STOPPING_RUN_WAIT_MS = 20000} = {})` waits only for peers already synchronously reporting cancellation. `failRunBeforeStart({lifecycle,runId,message})` attempts an error event then always finishes failed. Capability helpers `agentAcceptsHostMintedSessionId` / `agentCarriesOwnMemory` take `{agentId,agents}`. Session helpers: `resolveHostMintedSessionId({conversationId,effectiveResumeSessionId,acceptsHostMintedSessionId,mint})`, `resolveNewSessionField({hostMintedSessionId})`, `resolveResumeSessionField({storedSessionId})`, `extractSessionRefFromEndEvent({event})`, `shouldClearSessionOnFailedResume({event,attemptedResumeSessionId})`, `wouldForcedColdStartLoseConversationContext({storedSessionId,hasConcurrentLiveRun,carriesOwnMemory})`. Ports/types: ConversationRun, LiveRunTracker, ConversationStartLock, StoppingRunLifecycle, FailingRunLifecycle, AgentCapabilities, AgentCapabilityResolver. [Source](../../src/session-coordination.ts).

`./tool-audit`: `withToolAttemptAudit({sink,now,newAttemptId,inner,workspaceId,readErrorId}, {onSinkError?} = {}): AuditedToolExecutor`. The returned executor has object-shaped execute/resumeConfirmation/cancel/getAuditRecord. `withToolCatalogAudit({sink,now,newAttemptId,catalog,identity,searchToolId,describeToolId}, {onSinkError?} = {})` preserves object-shaped search/describe. `appendToolCatalogAttempt({sink,now,newAttemptId,event}, options = {})` returns void and appends asynchronously. `describeInput({input})`, `searchToolsAuditDetail({query,limit,hits})`, `describeToolAuditDetail({id,entry})` return value-free summaries. Exported ToolAttemptPhase/TOOL_ATTEMPT_PHASES share executor phases plus unknown-tool. ToolAttemptEvent has attempt/execution/workspace/run/tool/principal IDs, phase, ISO at and optional detail; sink.append takes required fields and optional detail. ToolAuditDependencies, ToolAuditOptions, AuditedToolExecutor, ToolCatalogAuditIdentity, ToolCatalogAttemptEvent and ToolCatalogAuditSource are structural host contracts. [Source](../../src/tool-audit.ts).

`./run-credentials`: `createNodeCredentialCrypto({}): CredentialCryptoPort` supplies mintToken({}), digest({token}), tokensMatch({presented,expected}). `createRunScopedCredentials({principalOfLiveRun,crypto}): RunScopedCredentials` has mint({runId}), resolveCaller/resolvePrincipal({token}), revoke({runId}); RunScopedCaller contains runId/principalId. `ensureAgentDaemonToken({env,envVarName,crypto}): string` retains or writes the host-named env key. `createRouteAccessPolicy({runPathPrefix,delegatedToolCallsPath,eventStreamSuffix,allowedRoutes})` supplies targetRun({path}), allowsRunScoped/isDelegatedCall({method,path}) and isEventStream({path}). `authorizeDaemonRequest({request,env,envVarName,principalHeaderName,authorizationHeaderName,crypto,routes}, {exemptPaths = [],runScopedCallers?,validateDelegatedRunId = false} = {}): AccessDecision`. `createRunOwnerRegistry({})` exposes record({runId,principalId}), ownerOf/forget({runId}). `authorizeRunOwnership({runId,principalId,principalHeaderName,registry,runExists,eventStream})` is async; `listOwnedRuns({runs,registry,principalId,principalHeaderName})` returns allowed rows or refusal. Types: RunScopedCaller, CredentialCryptoPort, RunScopedCallerResolver, RunScopedCredentials, RouteAccessPolicy, AccessDecision, RunOwnerRegistry. These low-level factories take one required object; they do not declare an empty optional object. [Source](../../src/run-credentials.ts).

`./http` additionally exposes WorkspaceRootRequest, WorkspaceRootResolver, WorkspaceRootDeniedError and `resolveWorkspaceRoot({request}, {resolveRoot?} = {})`; resolver receives `{request}`. JINI_ROUTE_MANIFEST/routeFamilyManifest({family})/routeFamiliesManifest({families}) inventory health, runs, agents, toolCatalog and delegatedToolCalls only; unknown families are absent, not empty. Import domain constants and helpers from this entry.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Function and declared parameters | Declaration |
|---|---|
| `cancelRunsOwnedBy({ runs, contextRef }: { readonly runs: RunCancellationService; readonly contextRef: string }, _optional: Record<string, never> = {})` | [cancel-owned-runs.ts](../../src/http/cancel-owned-runs.ts) |
| `manifestRoutesForFamilies({ families }: { readonly families: readonly string[] }, _optional: Record<string, never> = {})` | [route-manifest.ts](../../src/http/route-manifest.ts) |

| Additional exported names | Kind and source |
|---|---|
| `ACTIVE_CONTEXT_TTL_MS` | const; [active-context.ts](../../src/http/active-context.ts) |
| `ActiveContextResource` | type; [active-context.ts](../../src/http/active-context.ts) |
| `AgentCleanupFailureContext`, `ClaudeConfigDirSeams`, `ContinuationOptions`, `FailureClassificationContext` | interface; [agent-executor.ts](../../src/agent-executor.ts) |
| `AgentCleanupFailurePhase`, `AgentExecutorErrorCode`, `ClassifyFailure`, `CollectProcessTreePidsPort`, `StopProcessesPort` | type; [agent-executor.ts](../../src/agent-executor.ts) |
| `AgentExecutorError` | class; [agent-executor.ts](../../src/agent-executor.ts) |
| `AgentListResponse`, `AgentModelSummary` | type; [agents.ts](../../src/http/agents.ts) |
| `AgentSessionDatabase` | type; [sql.ts](../../src/store/agent-sessions/sql.ts) |
| `AgentSessionStoreError` | class; [errors.ts](../../src/store/agent-sessions/errors.ts) |
| `AttachmentRejectionReason`, `AttachmentUploadResponse`, `AttachmentsInternalErrorContext`, `CreateDiskAttachmentStoreOptions` | type; [attachments.ts](../../src/http/attachments.ts) |
| `AuthCredentials`, `AuthProvider`, `ChargeInput`, `ChargeStatus`, `ConnectorsAuthSessionResponse`, `ConnectorsAuthUserResponse`, `ConnectorsAuthVerifyResponse`, `ConnectorsChargeResponse`, `ConnectorsDbQueryResponse`, `ConnectorsDbRecordResponse`, `ConnectorsInternalErrorContext`, `ConnectorsOkResponse`, `ConnectorsStorageGetResponse`, `ConnectorsStorageListResponse`, `ConnectorsStorageMetaResponse`, `DbProvider`, `DbQuery`, `PaymentsProvider`, `RealtimeProvider`, `StorageProvider`, `StoragePutOptions` | type; [connectors.ts](../../src/http/connectors.ts) |
| `CloseStatusInput`, `CreateInactivityWatchdogInput`, `ResolveTimeoutMsInput` | interface; [close-status.ts](../../src/close-status.ts) |
| `ComponentCatalogQuery` | type; [component-catalog.ts](../../src/http/component-catalog.ts) |
| `ConfirmationDecision`, `ToolExecutionErrorKind`, `ToolExecutionPhase`, `ToolExecutionStatus` | type; [tool-executor.ts](../../src/tool-executor.ts) |
| `ContinuationTransport` | type; [continuation-transport.ts](../../src/continuation/continuation-transport.ts) |
| `CreateDaemonDbToolRegistrationsOptions`, `DaemonDbInternalErrorContext`, `DaemonDbOperations`, `DaemonDbTableInfo`, `DaemonDbToolRegistrations`, `DbIntegrityIssue`, `DbIntegrityIssueKind` | type; [db-ops.ts](../../src/http/db-ops.ts) |
| `CreateDefaultRunStartHandlerOptions`, `ResolveRunInputContext`, `ResolvedRunInput`, `RunStartDriverContext` | interface; [run-start-handler.ts](../../src/continuation/run-start-handler.ts) |
| `CreateFrontendControlOptions`, `FrontendBindErrorContext`, `FrontendHttpExtension` | type; [frontend-control.ts](../../src/http/frontend-control.ts) |
| `CreateRunScopedContextStoreOptions` | interface; [run-scoped-context-store.ts](../../src/continuation/run-scoped-context-store.ts) |
| `CreateTerminalSessionOptions`, `TerminalSessionListFilter` | interface; [terminal-session.ts](../../src/terminal-session.ts) |
| `DEFAULT_SURFACE_IDLE_TTL_MS`, `DEFAULT_SURFACE_MAX_LIFETIME_MS` | const; [surface-exchanges.ts](../../src/surface-exchanges.ts) |
| `DaemonShutdownResponse`, `DaemonStatusResponse` | type; [daemon-status.ts](../../src/http/daemon-status.ts) |
| `DefaultRunStartHandler`, `ResolveRunInput` | type; [run-start-handler.ts](../../src/continuation/run-start-handler.ts) |
| `DelegatedToolExecuteRequest`, `DelegatedToolExecuteResponse`, `DelegatedToolsInternalErrorContext` | type; [delegated-tools.ts](../../src/http/delegated-tools.ts) |
| `DelegatedToolInvocation` | interface; [delegated-tool-bridge.ts](../../src/delegated-tool-bridge.ts) |
| `EventLogAppendInput`, `EventLogAppendOptions` | type; [index.ts](../../../protocol/src/index.ts) |
| `FinishRunInput`, `ResumeRunResult`, `RunLifecycleInternalErrorContext`, `StartRunResult`, `StreamOptions` | interface; [run-lifecycle.ts](../../src/run-lifecycle.ts) |
| `FrontendInvocation`, `FrontendSessionHandle` | interface; [frontend-session-registry.ts](../../src/frontend-session-registry.ts) |
| `FrontendOutcome` | type; [frontend-session-registry.ts](../../src/frontend-session-registry.ts) |
| `FrontendSessionAttachedEvent`, `FrontendSessionErrorEvent`, `FrontendSessionInvocationEvent`, `FrontendSessionResponseBody`, `FrontendSessionResponseRequest` | type; [frontend-sessions.ts](../../src/http/frontend-sessions.ts) |
| `HealthReadinessResult`, `LivenessResponse`, `ReadinessResponse`, `VersionResponse` | type; [health.ts](../../src/http/health.ts) |
| `LaunchHostToolResult` | type; [host-tools.ts](../../src/http/host-tools.ts) |
| `LegacyDataMigrationConfig`, `MigrateLegacyDataDirResult` | interface; [legacy-data-migration.ts](../../src/legacy-data-migration.ts) |
| `LegacyFilesystemPort`, `MigrateStatus` | type; [legacy-data-migration.ts](../../src/legacy-data-migration.ts) |
| `LegacyMigrationError` | class; [legacy-data-migration.ts](../../src/legacy-data-migration.ts) |
| `MediaGenerateResponse`, `MediaInternalErrorContext`, `MediaTaskDeleteResponse`, `MediaTaskListResponse`, `MediaTaskResponse` | type; [media.ts](../../src/http/media.ts) |
| `MemoryChangeEmitter`, `MemoryExtractionLog`, `MemoryNoteEntry`, `MemoryNoteEntrySummary`, `MemoryNoteStoreOptions`, `MemoryTreeNode`, `MemoryVerifyLog` | type; [memory.ts](../../src/http/memory.ts) |
| `ModelProxyInternalErrorContext` | type; [model-proxy.ts](../../src/http/model-proxy.ts) |
| `RemoteRunEventResponse`, `RemoteToolBridgeTokenConfig`, `RemoteToolResultRequest`, `RemoteToolUseRequest` | type; [remote-run-events.ts](../../src/http/remote-run-events.ts) |
| `RemoteToolResultRecord`, `RemoteToolUseRecord` | interface; [remote-tool-bridge.ts](../../src/remote-tool-bridge.ts) |
| `ResearchInternalErrorContext`, `ResearchProviderCredentials`, `ResearchSearchResponse`, `ResearchSource` | type; [research.ts](../../src/http/research.ts) |
| `ResolveWorkspaceRootOptions` | type; [workspace-root.ts](../../src/http/workspace-root.ts) |
| `Routine`, `RoutineContextSelection`, `RoutineRunCompletion` | interface; [types.ts](../../src/routines/types.ts) |
| `RoutineDeleteResponse`, `RoutineListResponse`, `RoutineResponse`, `RoutineRunNowResponse`, `RoutineRunsResponse`, `RoutineScheduler` | type; [routines.ts](../../src/http/routines.ts) |
| `RoutineRunStatus`, `RoutineRunTrigger` | type; [types.ts](../../src/routines/types.ts) |
| `RunCancelResponse`, `RunListResponse`, `RunStartHandler`, `RunStartResponse`, `RunStatusResponse` | type; [runs.ts](../../src/http/runs.ts) |
| `RunCancellationService` | type; [cancel-owned-runs.ts](../../src/http/cancel-owned-runs.ts) |
| `RunCloseReason`, `RunDiagnosticSource`, `StderrTailSummary`, `StdoutTailSummary` | type; [index.ts](../../src/run/diagnostics/index.ts) |
| `RunContextNotBoundError` | class; [run-scoped-context-store.ts](../../src/continuation/run-scoped-context-store.ts) |
| `RunFailureDetail`, `RunFailureResult`, `RunFailureStage`, `RunRetryStrategy`, `RunRetrySuppressedReason` | type; [index.ts](../../src/run/core/index.ts) |
| `ScheduledRunPersistenceError` | class; [scheduler.ts](../../src/routines/scheduler.ts) |
| `TerminalCreateRequest`, `TerminalListResponse`, `TerminalsInternalErrorContext` | type; [terminals.ts](../../src/http/terminals.ts) |
| `TerminalSessionAccessResult`, `TerminalSessionAttachResult` | type; [terminal-session.ts](../../src/terminal-session.ts) |
| `TerminalSseSink` | type; [index.ts](../../../platform/src/index.ts) |
| `ToolAttemptAuditSink` | interface; [tool-audit.ts](../../src/tool-audit.ts) |
| `ToolAuthorizationRequest`, `ToolConfirmationRequest`, `ToolExecutionAuditEvent` | interface; [tool-executor.ts](../../src/tool-executor.ts) |
| `ToolCatalogQuery` | type; [tool-catalog.ts](../../src/http/tool-catalog.ts) |
| `Unsubscribe` | type; [run-lifecycle.ts](../../src/run-lifecycle.ts) |
| `XaiAuthStatusResponse`, `XaiInternalErrorContext`, `XaiOauthStartResponse`, `XaiOkResponse`, `XaiSearchResponse` | type; [xai.ts](../../src/http/xai.ts) |
| `defaultDaemonMessages` | const; [read-only-tools.ts](../../src/read-only-tools.ts) |
| `denyAllWorkspaceRoots` | const; [workspace-root.ts](../../src/http/workspace-root.ts) |

## Current manifest boundary

The current `package.json` exposes `.`, `./store/event-log/sqlite`, `./store/agent-sessions`, `./store/agent-sessions/sqlite`, `./store/agent-sessions/pglite`, `./store/agent-sessions/postgres`, `./http`, `./read-only-tools`, `./scheduler`, `./tool-audit`, `./surface-exchanges`, `./session-coordination`, `./run-credentials`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
