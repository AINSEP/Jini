Spec ID: SPEC-JINI-AGENT-RUNTIME-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:a25cc371c9b4ae40d8a762e9767cdf006bfcc00c71892ed594e3b3417b83f961
spec_mode: reverse_spec


# API Contract Spec: agent-runtime

## Purpose and entry-point registry

Consumer-facing contract for CLI discovery/launch, stream parsing, provider turns, catalogs and OAuth adapters. This specification describes current source. Shared base contracts are owned by `@jini-ai/core/primitives`. [Behavior](behavior.spec.md), [errors](errors.spec.md), [state](state.spec.md) and [callback UI](ui.spec.md) specify their observable contracts.

| Import path | Runtime | Supported surface |
|---|---|---|
| `@jini-ai/agent-runtime` | Node ESM | All root exports inventoried below; includes the three specialized surfaces |
| `@jini-ai/agent-runtime/providers/tool-turn` | Node ESM | runProviderToolTurn, providerTurnAdapters, four Google schema helpers and provider-neutral turn types |
| `@jini-ai/agent-runtime/model-catalog/cache` | Universal ESM | ModelCatalogCache, unionModels and catalog cache port/options types |
| `@jini-ai/agent-runtime/providers/sse-decode` | Universal ESM | decodeSseStream and DecodedSseEvent |

There are no other package export paths. Internal source paths below identify declarations; they are not supported deep imports. Use the specialized universal paths to avoid importing the Node root into a browser. Published paths resolve to dist; this inventory is based on src and package.json, without building distribution output.

## Argument and dependency contract

A required input object comes first; a defined optional object comes second, defaulting to `{}`. The catalogue retains current destructured parameter names and real defaults. Functions taking one object or no input do not gain invented parameters. Event callbacks currently receive one event object; native web/Node collaborator APIs retain their signatures. `Pick<Options, ...>` lists required fields, and `Omit<Options, ...>` carries remaining optional controls. Options and helper-state type definitions are linked in each source group. Some helper types are private to their source module; consumers can infer them through Parameters/ReturnType.

| Consumer capability | Supplied ports / context | Result / ownership |
|---|---|---|
| CLI adapter | RuntimeAgentDef; prompt, imagePaths; optional RuntimeBuildOptions/RuntimeContext | buildArgs returns string[]; caller spawns, applies prompt delivery, permission mode, stdout policy and runtime lock |
| Runtime detection | Per-agent configured environments; optional AmrProfileResolver.resolveProfile({env}) → string | DetectedAgent[] or AsyncGenerator<DetectedAgent>; probes actual filesystem/process environment |
| ACP definition model seam | AcpModelProbe.detectModels(required, optional) → Promise<RuntimeModelOption[]> installed once | No-op default []; distinct from actual detectAcpModels subprocess probe |
| Stream parsing | onEvent(event); JSON-line parser uses onMessage({message, rawLine}) | StreamParser: feed({chunk: string}): void; flush(): void |
| Native ACP session | Spawned child with piped stdin/stdout; prompt; send({event,payload}); optional native permission policy | AcpSessionController; caller supervises process, owns durable session storage |
| pi session | Spawned child with pipes; prompt; send({event,payload}); optional parentSession/cwd/image paths/uploadRoot | PiRpcSession; no built-in turn timeout |
| Provider-neutral turn | Four ProviderTurnAdapters, credentials, messages/system/tools, executeTool(call), onEvent(event) | Promise<ProviderToolTurnResult>; caller owns tool authorization and execution |
| Direct provider turns | Wire-specific inputs and onEvent; optional executeTool, signal, PinnedFetch, DnsLookupFn | Provider-specific raw finish/stop reason and toolTurns; events contain normalized end reason |
| Generic catalog cache | discover({cacheKey}) → Promise<readonly Model[] ∣ null>; core Clock.nowMs() → number; merge({fallback,live}) → readonly Model[] | Instance-owned cache; get returns current merged fallback/live list |
| AMR loading cache | fetchPreset()/fetchRemote() → Promise<RuntimeModelOption[]> per get/warm | AmrModelsResponse; background refresh and host-supplied string identity |
| Voice discovery | resolveCredentials({workspaceKey}) → Promise<{apiKey, baseUrl?}> | Promise<ElevenLabsVoiceOption[]> |
| OAuth | Fixed-issuer configuration, PendingAuthCache, callback receiver; caller-selected token paths; optional native fetch | OAuth token response / bearer or null; caller opens browser and stores token |
| Optional host seams | PromptAugmenter, ArtifactTaxonomy, TelemetrySink, AccountFailureClassifier | No-op implementations exported; host assembles their use |

Default Node filesystem, process, crypto, timers, global fetch and @jini-ai/platform/@jini-ai/oauth helpers are real dependencies. Default adapters retain the documented native effects.

## Principal data contracts

```ts
type StreamParser = { feed(required: { chunk: string }): void; flush(): void };
type ProviderProtocol = 'anthropic' | 'openai' | 'azure' | 'google';
type ProviderToolTurnInput = {
  protocol: ProviderProtocol; adapters: ProviderTurnAdapters;
  apiKey: string; model: string; system: string;
  messages: readonly { role: 'user' | 'assistant'; content: string }[];
  tools: readonly { id: string; description?: string; inputSchema?: unknown }[];
  executeTool: (call: { id: string; name: string; input: unknown }) => Promise<ProviderToolResult>;
  onEvent: (event: ProviderTurnEvent) => void;
};
type ProviderToolResult = {
  content: string | readonly ({ type: 'text'; text: string } |
    { type: 'image'; mimeType: string; data: string })[];
  isError?: boolean;
};
type ProviderToolTurnOptions = {
  baseUrl?: string; maxTokens?: number; maxToolTurns?: number; signal?: AbortSignal;
};
type ProviderToolTurnResult = { stopReason: string | null; toolTurns: number };
type ModelCatalogCacheKey = readonly string[];
type DecodedSseEvent = { readonly event: string | null; readonly data: string };
```

ProviderTurnEvent is a discriminated union: status(label), text_delta(delta), tool_use(id/name/input), tool_result(toolUseId/content/isError), usage(usage or null), error(message), end(reason). Its tool-result content is text even when image payloads are passed to the model. Raw provider events can additionally report fabricated_role_marker; the neutral wrapper suppresses that event while retaining end/contaminated.

createJsonEventStreamHandler accepts a string kind; current dedicated dispatch covers opencode, gemini, kimi, cursor-agent and codex, with generic/raw handling for other input. Its event payload remains Record<string, unknown>; the Claude, Qoder and Copilot parser factories export their explicit event unions. execAgentFile uses native execFile output encoding: default text, Buffer when a buffer/null encoding is requested; its promise also carries the native child handle.

RuntimeModelOption carries id, label and optional per-model reasoning rows. DetectedAgent exposes available, models, modelsSource live/fallback, optional auth status/message, executable path/version and diagnostics; it strips spawn functions and internal configuration. AgentDefinition, CredentialStatus, ModelCatalogOption, ModelProvider and AgentDiagnostic vocabulary are re-exported from @jini-ai/protocol. They are distinct from RuntimeAgentDef and ACP's narrower ModelOption.

## Minimal wiring by public import path

Root discovery/build/parser wiring (executing detection performs CLI probes):

```ts
import { getAgentDef, detectAgents, createClaudeStreamHandler } from '@jini-ai/agent-runtime';
const catalog = await detectAgents({}, { configuredEnvByAgent: {} });
const def = getAgentDef({ id: 'claude' });
if (!def) throw new Error('adapter unavailable');
const args = def.buildArgs({ prompt: 'Hello', imagePaths: [] },
  { options: { permissionMode: 'restricted' } });
const parser = createClaudeStreamHandler({ onEvent: event => console.log(event) });
parser.feed({ chunk: '{"type":"assistant","message":{"content":[]}}\n' });
parser.flush();
// Use catalog/args in the host launch layer; parser receives that child's stdout.
```

Provider-neutral turn with built-in adapters and a host executor:

```ts
import { runProviderToolTurn, providerTurnAdapters } from '@jini-ai/agent-runtime/providers/tool-turn';
const result = await runProviderToolTurn({
  protocol: 'openai', adapters: providerTurnAdapters, apiKey: resolvedApiKey,
  model: selectedModel, system: 'Answer briefly.',
  messages: [{ role: 'user', content: 'Hello' }], tools: [],
  executeTool: async call => ({ content: await hostExecute(call) }),
  onEvent: event => hostEmit(event),
}, { maxToolTurns: 8, signal: abortController.signal });
```

Generic catalog discovery with all collaborators supplied:

```ts
import { ModelCatalogCache, unionModels } from '@jini-ai/agent-runtime/model-catalog/cache';
const cache = new ModelCatalogCache<{ id: string; label: string }>({
  clock: { nowMs: () => Date.now() },
  discover: ({ cacheKey }) => hostDiscover(cacheKey), merge: unionModels,
}, { ttlMs: 300_000 });
const models = await cache.get({
  cacheKey: ['workspace', 'principal', 'provider', 'credential-revision'],
  fallback: [{ id: 'default', label: 'Default' }],
});
```

SSE decoding requires only an async source:

```ts
import { decodeSseStream } from '@jini-ai/agent-runtime/providers/sse-decode';
async function* chunks() { yield 'data: {"text":"Hello"}\n\n'; }
for await (const frame of decodeSseStream({ source: chunks() })) {
  hostReceive(frame); // {event: null, data: '{"text":"Hello"}'}
}
```

Example variables resolvedApiKey, selectedModel, hostExecute, hostEmit, hostDiscover and hostReceive belong to the consumer. They are not package exports.

## Returned handles, class methods and host ports

```ts
new ModelCatalogCache<Model>(required: ModelCatalogCacheDependencies<Model>, optional: ModelCatalogCacheOptions = {});
cache.get(required: {cacheKey: ModelCatalogCacheKey; fallback: readonly Model[]}, optional: ModelCatalogReadOptions<Model> = {}): Promise<readonly Model[]>;
new AmrModelLoadingCache(required: Record<string, never> = {}, optional: {refreshIntervalMs?: number} = {});
amr.get(required: {cacheKey: string; fetchers: {fetchPreset(): Promise<RuntimeModelOption[]>; fetchRemote(): Promise<RuntimeModelOption[]>}}): Promise<AmrModelsResponse>;
amr.warm(required: {cacheKey: string; fetchRemote(): Promise<RuntimeModelOption[]>}): void;
amr.resetForTests(): void;
new PendingAuthCache(required: Record<string, never> = {}, optional: {ttlMs?: number} = {});
pending.put(required: {state: string; value: PendingAuthState}): void;
pending.consume(required: {state: string}): PendingAuthState | null;
pending.size(): number;
pending.stop(): void;
new ElevenLabsCredentialMissingError(); // Error subclass; no code
roleGuard.feedText(required: {text: string}): string;
roleGuard.warningEvent(): RoleMarkerWarningEvent | null;
// roleGuard.contaminated: readonly boolean
acp.hasFatalError(): boolean;
acp.getDurableSessionId(): string | null;
acp.completedSuccessfully(): boolean;
acp.abort(): void;
pi.hasFatalError(): boolean;
pi.getLastSessionPath(): string | null;
pi.abort(): void;
listener.stop(): Promise<void>;
// listener.address: readonly {host: string; port: number}
preparedPrompt.cleanup(): Promise<void>;
preparedLog.cleanup(): Promise<void>;
```

RuntimeAgentDef.buildArgs takes `{prompt, imagePaths}` and optional `{extraAllowedDirs, options, runtimeContext}` and returns string[]. Its optional fetchModels takes `{resolvedBin, env}` and returns Promise<RuntimeModelOption[] | null>; listModels carries args/timeoutMs/parser. deriveReasoningOptions takes `{models}` and returns RuntimeReasoningOption[] | null. RuntimeStdoutPolicy selects buffering plus an optional sanitizer. If a def declares runtimeLock, the host must await acquire({model}) before buildArgs/spawn, then release on process exit or waitForHandoff({logFilePath,model,processExited}) settling; release must be idempotent. These declarations are instructions to the consumer, not automatic supervision performed by buildArgs.

PromptAugmenter exposes contextKinds(): readonly string[], augmentUserRequest({basePrompt,selection,agentId,hasPriorAssistantTurn}): string | Promise<string>, and optional systemOverlay({agentId,turnIndex}): string | null. ArtifactTaxonomy exposes isArtifact({path}): boolean and optional classify({path}): string | null. TelemetrySink exposes emit(RunLifecycleEvent): void and optional reportFinalizedMessage({runId,text,meta}): void. AccountFailureClassifier.classify({text}) returns AccountFailure | null. Native ACP permission policy receives AcpPermissionRequest and returns selected optionId or cancelled, synchronously or asynchronously.

## Complete root callable and type catalogue

The signatures below enumerate functions reachable through the root barrel, including exposed provider reduction helpers. Object fields named state/pending are caller-owned mutable helper state; fields named onEvent/send/executeTool/fetchImpl/lookup/doFetch/resolveCredentials are collaborator ports. Pure URL/token/catalog transformations need only their data objects. Model/launch/probe/OAuth operations use the dependencies listed above. Linked source declarations define detailed option fields and helper-state shapes. Functions with no second object have no additional options. Specialized subpaths expose the matching groups above plus their re-exported types.

### [paths.ts](../../src/paths.ts)

```ts
function expandConfiguredEnv({ configuredEnv }: { configuredEnv: unknown }): Record<string, string>;
function expandHomePath({ value }: { value: string }): string;
```

### [models.ts](../../src/models.ts)

```ts
function getRememberedLiveModels({ agentId }: { agentId: string }, { scope }: { scope?: string | null } = {}): RuntimeModelOption[];
function isKnownModel({ def, modelId }: { def: RuntimeAgentDef; modelId: string | null | undefined }, { scope }: { scope?: string | null } = {} ): boolean;
function preferFreshLiveModels({ freshModels, rememberedModels }: { freshModels: RuntimeModelOption[]; rememberedModels: RuntimeModelOption[] } ): RuntimeModelOption[];
function rememberLiveModels({ agentId, models }: { agentId: string; models: RuntimeModelOption[] }, { scope }: { scope?: string | null } = {}): void;
function resolveModelForAgent({ def, resolved }: { def: RuntimeAgentDef; resolved: string | null }, { env = process.env, liveModelScope }: { env?: Record<string, string | undefined>; liveModelScope?: string | null } = {} ): string | null;
function sanitizeCustomModel({ id }: { id: string | null | undefined }): string | null;
```

### [invocation.ts](../../src/invocation.ts)

```ts
function execAgentFile({ command, args }: { command: string; args: string[] }, { options = {} }: { options?: RuntimeExecOptions } = {} ): Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;
```

### [mmd-routes.ts](../../src/mmd-routes.ts)

```ts
function loadMmdRouteLaunchEnv({ env, modelId }: { env: RuntimeEnv; modelId: string | null | undefined } ): Promise<MmdRouteLaunchEnv | null>;
function loadMmdRouteModels({ env, fallbackModels }: { env: RuntimeEnv; fallbackModels: readonly RuntimeModelOption[] } ): Promise<RuntimeModelOption[] | null>;
function mergeMmdRouteModels({ routeIds, fallbackModels }: { routeIds: readonly string[]; fallbackModels: readonly RuntimeModelOption[] } ): RuntimeModelOption[];
function parseMmdRouteModelIds({ raw }: { raw: unknown }): string[];
function resolveMmdRouteLaunchEnv({ raw, modelId }: { raw: unknown; modelId: string | null | undefined } ): MmdRouteLaunchEnv | null;
function resolveMmdRoutesFile({ env }: { env: RuntimeEnv }): string | null;
```

### [metadata.ts](../../src/metadata.ts)

```ts
function installMetaForAgent({ agentId }: { agentId: string }, { table = DEFAULT_AGENT_INSTALL_LINKS }: { table?: Record<string, AgentInstallMeta> } = {} ): AgentInstallMeta;
```

### [mcp.ts](../../src/mcp.ts)

```ts
function buildAcpMcpServersForAgent({ def, spec }: { def: Pick<RuntimeAgentDef, 'mcpDiscovery' | 'acpMcpEnvFormat'>; spec: AcpMcpServerSpec } ): AcpMcpServerEntry[];
```

### [executables.ts](../../src/executables.ts)

```ts
function agentBinEnvKey({ agentId }: { agentId: string | undefined }): string | null;
function agentSearchDirs(): string[];
function codexAppBundleCandidates(): string[];
function configureExecutableResolutionEnv({ overrides }: { overrides: { agentHomeEnvVar?: string; resourceRootEnvVar?: string; } }): void;
function inspectAgentExecutableResolution({ def }: { def: RuntimeAgentDef }, { configuredEnv = {} }: { configuredEnv?: Record<string, string> } = {} ): { configuredOverridePath: string | null; pathResolvedPath: string | null; selectedPath: string | null; };
function resolveAgentExecutable({ def }: { def: RuntimeAgentDef }, { configuredEnv = {} }: { configuredEnv?: Record<string, string> } = {} ): string | null;
function resolveAmrOpenCodeExecutable({ }: { }, { env = process.env }: { env?: Record<string, string | undefined> } = {} ): string | null;
function resolveOnPath({ bin }: { bin: string }): string | null;
function userToolchainBinDirs(): string[];
```

### [role-marker-guard.ts](../../src/role-marker-guard.ts)

```ts
function createRoleMarkerGuard({ messageId }: { messageId: string }): RoleMarkerGuard;
```

### [auth.ts](../../src/auth.ts)

```ts
function antigravityAuthGuidance({ }: { }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}): string;
function antigravityQuotaGuidance(): string;
function classifyAgentAuthFailure({ agentId, text }: { agentId: string; text: string }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {} ): AgentAuthProbeResult | null;
function classifyAgentServiceFailure({ text }: { text: string }): AgentServiceFailureCode | null;
function claudeAuthGuidance({ }: { }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}): string;
function cursorAuthGuidance({ }: { }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}): string;
function deepseekAuthGuidance({ }: { }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}): string;
function geminiAuthGuidance({ }: { }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}): string;
function isAntigravityAuthFailureText({ text }: { text: string }): boolean;
function isClaudeAuthFailureText({ text }: { text: string }): boolean;
function isCursorAuthFailureText({ text }: { text: string }): boolean;
function isDeepSeekAuthFailureText({ text }: { text: string }): boolean;
function isGeminiAuthFailureText({ text }: { text: string }): boolean;
function isReasonixAuthFailureText({ text }: { text: string }): boolean;
function probeAgentAuthStatus({ def, resolvedBin, env }: { def: Pick<RuntimeAgentDef, 'id' | 'name' | 'authProbe'>; resolvedBin: string; env: RuntimeEnv }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {} ): Promise<AgentAuthProbeResult | null>;
function reasonixAuthGuidance({ }: { }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}): string;
```

### [opencode-log.ts](../../src/opencode-log.ts)

```ts
function extractOpenCodeServiceFailure({ logTail }: { logTail: string }): OpenCodeServiceFailure | null;
function readLatestOpenCodeLogTail({ logDir }: { logDir: string }, options: { maxBytes?: number; since?: number } = {} ): string | null;
function readOpenCodeServiceFailure({ env }: { env: Record<string, string | undefined> }, options: { since?: number } = {} ): OpenCodeServiceFailure | null;
function resolveOpenCodeLogDir({ env }: { env: Record<string, string | undefined> }): string | null;
```

### [env.ts](../../src/env.ts)

```ts
function spawnEnvForAgent({ agentId, baseEnv }: { agentId: string; baseEnv: RuntimeEnvMap }, { configuredEnv = {}, systemProxyEnv = resolveSystemProxyEnv(), hooks = {} }: { configuredEnv?: unknown; systemProxyEnv?: RuntimeEnvMap; hooks?: SpawnEnvHooks } = {} ): NodeJS.ProcessEnv;
```

### [launch.ts](../../src/launch.ts)

```ts
function applyAgentLaunchEnv({ env, launch }: { env: NodeJS.ProcessEnv; launch: Pick<AgentLaunchResolution, 'childPathPrepend'> }, { nodeBinDir = path.dirname(process.execPath), appendPathDirs = userToolchainBinDirs() }: { nodeBinDir?: string; appendPathDirs?: string[] } = {} ): NodeJS.ProcessEnv;
function resolveAgentLaunch({ def }: { def: RuntimeAgentDef }, { configuredEnv = {} }: { configuredEnv?: Record<string, string> } = {} ): AgentLaunchResolution;
```

### [resolution.ts](../../src/resolution.ts)

```ts
function resolveAgentBin({ id }: { id: string }, { configuredEnv = {} }: { configuredEnv?: Record<string, string> } = {}): string | null;
```

### [terminal-launch.ts](../../src/terminal-launch.ts)

```ts
function launchAgentInSystemTerminal({ command }: { command: string }, { platform = process.platform, windowTitle = 'Agent Sign-in' }: { platform?: NodeJS.Platform; windowTitle?: string } = {} ): Promise<TerminalLaunchResult>;
```

### [diagnostics.ts](../../src/diagnostics.ts)

```ts
function buildAuthDiagnostic({ def, auth }: { def: Pick<RuntimeAgentDef, 'id' | 'name'>; auth: AgentAuthProbeResult } ): AgentDiagnostic | null;
function buildExecutableDiagnostic({ def }: { def: Pick<RuntimeAgentDef, 'id' | 'name' | 'bin'> }, { configuredEnv = {} }: { configuredEnv?: Record<string, string> } = {} ): AgentDiagnostic;
function buildNotInvocableDiagnostic({ def, launch, cause }: { def: Pick<RuntimeAgentDef, 'id' | 'name'>; launch: Pick<AgentLaunchResolution, 'selectedPath' | 'launchPath'>; cause: NotInvocableCause } ): AgentDiagnostic;
```

### [detection.ts](../../src/detection.ts)

```ts
function detectAgents({ }: { }, { configuredEnvByAgent = {}, amrProfileResolver = noopAmrProfileResolver }: { configuredEnvByAgent?: Record<string, Record<string, string>>; amrProfileResolver?: AmrProfileResolver } = {} ): Promise<DetectedAgent[]>;
function detectAgentsStream({ }: { }, { configuredEnvByAgent = {}, amrProfileResolver = noopAmrProfileResolver }: { configuredEnvByAgent?: Record<string, Record<string, string>>; amrProfileResolver?: AmrProfileResolver } = {} ): AsyncGenerator<DetectedAgent>;
function ensureAgentCapabilities({ def, launchPath, env }: { def: RuntimeAgentDef; launchPath: string; env: NodeJS.ProcessEnv }): Promise<void>;
function probeAgentModels({ def }: { def: RuntimeAgentDef }, { configuredEnv = {}, amrProfileResolver = noopAmrProfileResolver }: { configuredEnv?: Record<string, string>; amrProfileResolver?: AmrProfileResolver } = {} ): Promise<ProbedAgentModels>;
```

### [prompt-budget.ts](../../src/prompt-budget.ts)

```ts
function checkPromptArgvBudget({ def, composed }: { def: RuntimeAgentDef | null | undefined; composed: unknown }, { platform = process.platform }: { platform?: NodeJS.Platform } = {} ): RuntimePromptBudgetError | null;
function checkWindowsCmdShimCommandLineBudget({ def, resolvedBin, args }: { def: RuntimeAgentDef | null | undefined; resolvedBin: unknown; args: unknown } ): RuntimePromptBudgetError | null;
function checkWindowsDirectExeCommandLineBudget({ def, resolvedBin, args }: { def: RuntimeAgentDef | null | undefined; resolvedBin: unknown; args: unknown } ): RuntimePromptBudgetError | null;
```

### [prompt-file.ts](../../src/prompt-file.ts)

```ts
function preparePromptFileForAgent({ def, prompt, label }: { def: RuntimeAgentDef | null | undefined; prompt: string; label: string } ): Promise<PreparedPromptFile | null>;
```

### [log-file.ts](../../src/log-file.ts)

```ts
function prepareAgentLogFile({ def, label }: { def: RuntimeAgentDef | null | undefined; label: string } ): Promise<PreparedAgentLogFile | null>;
```

### [model-catalog-cache.ts](../../src/model-catalog-cache.ts)

```ts
function unionModels<Model extends { readonly id: string }>({ fallback, live }: { fallback: readonly Model[]; live: readonly Model[] }): Model[];
```

### [registry.ts](../../src/registry.ts)

```ts
function getAgentDef({ id }: { id: string }): RuntimeAgentDef | null;
function runtimeSupportsExternalTools({ def }: { def: Pick<RuntimeAgentDef, 'externalMcpInjection'> }): boolean;
```

### [defs/amr.ts](../../src/defs/amr.ts)

```ts
function fetchVelaBillingSummary({ resolvedBin, env }: { resolvedBin: string; env: NodeJS.ProcessEnv } ): Promise<VelaBillingSummary>;
function fetchVelaPresetModels({ resolvedBin, env }: { resolvedBin: string; env: NodeJS.ProcessEnv } ): Promise<RuntimeModelOption[]>;
function fetchVelaRemoteModelsWithRetry({ resolvedBin, env }: { resolvedBin: string; env: NodeJS.ProcessEnv } ): Promise<RuntimeModelOption[]>;
function normalizeVelaModelId({ rawId }: { rawId: string }): string | null;
function parseVelaModelJson({ stdout, expectedSource }: { stdout: string; expectedSource: VelaModelJsonSource } ): RuntimeModelOption[];
function parseVelaModels({ stdout }: { stdout: string }): RuntimeModelOption[];
```

### [defs/antigravity.ts](../../src/defs/antigravity.ts)

```ts
function parseAgyModels({ stdout }: { stdout: string }): RuntimeModelOption[] | null;
function redactAntigravityAuthUrls({ fullText }: { fullText: string }): string;
```

### [defs/codex.ts](../../src/defs/codex.ts)

```ts
function codexNeedsDangerFullAccessSandbox({ }: { }, { platform = process.platform, env = process.env }: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {} ): boolean;
function parseCodexDebugModels({ stdout }: { stdout: string }): RuntimeModelOption[] | null;
function unionModelReasoningOptions({ models }: { models: readonly RuntimeModelOption[] } ): RuntimeReasoningOption[] | null;
```

### [defs/cursor-agent.ts](../../src/defs/cursor-agent.ts)

```ts
function parseCursorAgentModels({ stdout }: { stdout: string }): RuntimeModelOption[] | null;
```

### [defs/grok-build.ts](../../src/defs/grok-build.ts)

```ts
function parseGrokBuildModels({ stdout }: { stdout: string }): RuntimeModelOption[];
```

### [model-registry.ts](../../src/model-registry.ts)

```ts
function effectiveAgentModelChoice({ agent, choice }: { agent: Pick<AgentDefinition, 'models'> | null | undefined; choice: AgentModelChoice | undefined } ): AgentModelChoice | undefined;
function fingerprintCredential({ value }: { value: string }): string;
function mergeModelOptions({ fetchedModels, suggestedModels }: { fetchedModels: readonly ModelCatalogOption[]; suggestedModels: readonly ModelCatalogOption[] } ): ModelCatalogOption[];
function modelCatalogCacheKey({ providerId, baseUrl, credential }: { providerId: string; baseUrl: string; credential: string }, { variant = '' }: { variant?: unknown } = {} ): string;
function normalizeAgentModelChoice({ agent, choice }: { agent: Pick<AgentDefinition, 'models'> | null | undefined; choice: AgentModelChoice | undefined } ): AgentModelChoice | null;
function resolveCredentialStatus({ provider, hasStoredCredential }: { provider: Pick<ModelProvider, 'credentialsRequired'>; hasStoredCredential: boolean } ): CredentialStatus;
```

### [claude-stream.ts](../../src/claude-stream.ts)

```ts
function createClaudeStreamHandler({ onEvent }: { onEvent: EventSink }, options: ClaudeStreamHandlerOptions = {} ): StreamParser;
```

### [json-event-stream.ts](../../src/json-event-stream.ts)

```ts
function createJsonEventStreamHandler({ kind, onEvent }: { kind: ParserKind; onEvent: StreamEventHandler }): StreamParser;
```

### [qoder-stream.ts](../../src/qoder-stream.ts)

```ts
function createQoderStreamHandler({ onEvent }: { onEvent: QoderEventSink }): StreamParser;
```

### [copilot-stream.ts](../../src/copilot-stream.ts)

```ts
function createCopilotStreamHandler({ onEvent }: { onEvent: EventSink }): StreamParser;
```

### [acp-model-probe.ts](../../src/acp-model-probe.ts)

```ts
function probeAcpModels(requiredArgs: Pick<AcpModelProbeRequest, "bin" | "args">, optionalArgs: Omit<AcpModelProbeRequest, "bin" | "args"> = {}): Promise<RuntimeModelOption[]>;
function setAcpModelProbe({ probe }: { probe: AcpModelProbe | null }): void;
```

### [pi-models.ts](../../src/pi-models.ts)

```ts
function parsePiModels({ stdout }: { stdout: unknown }): RuntimeModelOption[] | null;
```

### [providers/token-params.ts](../../src/providers/token-params.ts)

```ts
function buildLegacyMaxTokensParam({ maxTokens }: { maxTokens: number }): { max_tokens: number };
function buildMaxCompletionTokensParam({ maxTokens }: { maxTokens: number }): { max_completion_tokens: number };
function buildOpenAIChatTokenParam({ model, maxTokens }: { model: string; maxTokens: number } ): { max_tokens: number } | { max_completion_tokens: number };
function isUnsupportedMaxTokensError({ detail }: { detail: string }): boolean;
function usesMaxCompletionTokens({ model }: { model: string }): boolean;
```

### [providers/google.ts](../../src/providers/google.ts)

```ts
function googleGenerateContentUrl({ baseUrl, model }: { baseUrl: string; model: string }): string;
function googleGenerativeLanguageBaseUrl({ baseUrl }: { baseUrl: string }): string;
function googleModelPathSegment({ model }: { model: string }): string;
function googleProviderModelsUrl({ baseUrl, apiKey }: { baseUrl: string; apiKey: string }): string;
function googleStreamGenerateContentUrl({ baseUrl, model }: { baseUrl: string; model: string }): string;
function normalizeGoogleModelId({ model }: { model: string }): string;
```

### [providers/aihubmix.ts](../../src/providers/aihubmix.ts)

```ts
function aihubmixAppCodeHeader(): Record<string, string>;
function aihubmixCatalogUrl({ baseUrl, type }: { baseUrl: string; type: AIHubMixCatalogType }): string;
function aihubmixGeminiImageBytes({ req, doFetch }: { req: AIHubMixGeminiImageRequest; doFetch: (requiredArgs: { url: string; init: RequestInit }) => Promise<Response> } ): Promise<Buffer>;
function aihubmixGeminiImageUrl({ baseUrl, wireModel }: { baseUrl: string; wireModel: string }): string;
function aihubmixHeaders({ apiKey }: { apiKey: string }): Record<string, string>;
function aihubmixOriginFromBase({ baseUrl }: { baseUrl: string }): string;
function aihubmixVideoSeconds({ wireModel, requested }: { wireModel: string; requested: number }): string;
function aihubmixWireModel({ catalogId }: { catalogId: string }): string;
function classifyAIHubMixModel({ model }: { model: string }): AIHubMixProtocol;
function parseAIHubMixCatalog({ data }: { data: unknown }, options: ParseAIHubMixCatalogOptions = {} ): AIHubMixCatalogModel[];
```

### [providers/connection-guard.ts](../../src/providers/connection-guard.ts)

```ts
function defaultDnsLookup({ hostname }: { hostname: string }): Promise<DnsLookupAddress[]>;
function pinnedFetch({ url, init, pinnedAddress }: { url: string; init: PinnedFetchInit; pinnedAddress: DnsLookupAddress | undefined } ): Promise<PinnedFetchResponse>;
function validateBaseUrl({ baseUrl }: { baseUrl: string }): BaseUrlValidationResult;
function validateBaseUrlResolved({ baseUrl, lookup }: { baseUrl: string; lookup: DnsLookupFn } ): Promise<BaseUrlValidationResult>;
```

### [providers/model-catalog.ts](../../src/providers/model-catalog.ts)

```ts
function listProviderModels(requiredArgs: Pick<ProviderModelsInput, "protocol" | "baseUrl" | "apiKey">, optionalArgs: Omit<ProviderModelsInput, "protocol" | "baseUrl" | "apiKey"> = {} ): Promise<ProviderModelsResponse>;
```

### [providers/connection-test.ts](../../src/providers/connection-test.ts)

```ts
function testProviderConnection(requiredArgs: Pick<ProviderConnectionTestInput, "protocol" | "baseUrl" | "apiKey" | "model">, optionalArgs: Omit<ProviderConnectionTestInput, "protocol" | "baseUrl" | "apiKey" | "model"> = {}): Promise<ConnectionTestResponse>;
```

### [providers/sse-decode.ts](../../src/providers/sse-decode.ts)

```ts
function decodeSseStream({ source }: { source: AsyncIterable<Uint8Array | string> } ): AsyncGenerator<DecodedSseEvent>;
```

### [providers/anthropic-messages.ts](../../src/providers/anthropic-messages.ts)

```ts
function anthropicFrameKind({ data, frameEvent }: { data: Record<string, unknown>; frameEvent: string | null }): string;
function anthropicHeaders(requiredArgs: Pick<AnthropicTurnOptions, "apiKey" | "model" | "messages" | "maxTokens" | "onEvent">, optionalArgs: Omit<AnthropicTurnOptions, "apiKey" | "model" | "messages" | "maxTokens" | "onEvent"> = {}): Record<string, string>;
function anthropicLoopExitReason({ outcome, toolTurns, maxToolTurns }: { outcome: SingleRequestOutcome; toolTurns: number; maxToolTurns: number }): AnthropicTurnEndReason | null;
function anthropicRequestBody({ options, messages }: { options: AnthropicTurnOptions; messages: readonly AnthropicMessageParam[] }): Record<string, unknown>;
function anthropicRequestUrl({ baseUrl }: { baseUrl: string | undefined }): string;
function buildAnthropicAssistantContent({ text, toolCalls }: { text: string; toolCalls: readonly AnthropicToolCall[] }): AnthropicContentBlockParam[];
function executeAnthropicToolCalls({ executeTool, calls, onEvent }: { executeTool: AnthropicToolExecutor; calls: readonly AnthropicToolCall[]; onEvent: (event: AnthropicTurnEvent) => void } ): Promise<AnthropicToolResultBlockParam[]>;
function extractAnthropicErrorDetail({ rawText }: { rawText: string }): string;
function guardToolResult({ result }: { result: AnthropicToolResult }): AnthropicToolResult;
function handleAnthropicErrorFrame({ data, onEvent, apiKey }: { data: Record<string, unknown>; onEvent: (event: AnthropicTurnEvent) => void; apiKey: string } ): void;
function handleAnthropicInputJsonDelta({ state, index, partialJson }: { state: AnthropicStreamState; index: number; partialJson: string }): void;
function handleAnthropicTextDelta({ state, index, text, onEvent }: { state: AnthropicStreamState; index: number; text: string; onEvent: (event: AnthropicTurnEvent) => void } ): 'continue' | 'break';
function handleContentBlockDelta({ state, data, onEvent }: { state: AnthropicStreamState; data: Record<string, unknown>; onEvent: (event: AnthropicTurnEvent) => void } ): 'continue' | 'break';
function handleContentBlockStart({ state, data }: { state: AnthropicStreamState; data: Record<string, unknown> }): void;
function handleContentBlockStop({ state, data, onEvent }: { state: AnthropicStreamState; data: Record<string, unknown>; onEvent: (event: AnthropicTurnEvent) => void } ): void;
function handleMessageDelta({ state, data, onEvent }: { state: AnthropicStreamState; data: Record<string, unknown>; onEvent: (event: AnthropicTurnEvent) => void } ): void;
function invalidToolResultContentBlockReason({ block }: { block: AnthropicToolResultContentBlock }): string | null;
function parseAccumulatedToolInputJson({ inputJson }: { inputJson: string }): unknown;
function parseAnthropicSseData({ raw }: { raw: string }): Record<string, unknown> | null;
function runAnthropicToolTurn(requiredArgs: Pick<AnthropicTurnOptions, "apiKey" | "model" | "messages" | "maxTokens" | "onEvent">, optionalArgs: Omit<AnthropicTurnOptions, "apiKey" | "model" | "messages" | "maxTokens" | "onEvent"> = {}): Promise<AnthropicTurnResult>;
```

### [providers/openai-chat.ts](../../src/providers/openai-chat.ts)

```ts
function accumulateOpenAiToolCallDelta({ state, rawCall }: { state: OpenAiStreamState; rawCall: unknown }): void;
function applyOpenAiStreamUsage({ state, data, onEvent }: { state: OpenAiStreamState; data: Record<string, unknown>; onEvent: (event: OpenAiTurnEvent) => void }): void;
function buildOpenAiAssistantToolCallMessage({ text, toolCalls }: { text: string; toolCalls: readonly OpenAiToolCallParam[] }): OpenAiMessageParam;
function buildOpenAiToolExchangeMessages({ toolResultMessages, followUpParts }: { toolResultMessages: readonly OpenAiMessageParam[]; followUpParts: readonly OpenAiContentPart[] } ): OpenAiMessageParam[];
function executeOpenAiToolCalls({ executeTool, calls, onEvent }: { executeTool: OpenAiToolExecutor; calls: readonly OpenAiToolCall[]; onEvent: (event: OpenAiTurnEvent) => void } ): Promise<OpenAiToolExecutionOutcome>;
function extractOpenAiErrorDetail({ rawText }: { rawText: string }): string;
function firstOpenAiChoice({ data }: { data: Record<string, unknown> }): Record<string, unknown> | null;
function handleOpenAiChoiceDelta({ state, choice, onEvent }: { state: OpenAiStreamState; choice: Record<string, unknown>; onEvent: (event: OpenAiTurnEvent) => void }): 'continue' | 'break';
function handleOpenAiTextContentDelta({ state, content, onEvent }: { state: OpenAiStreamState; content: string; onEvent: (event: OpenAiTurnEvent) => void }): 'continue' | 'break';
function invalidOpenAiContentPartReason({ part }: { part: OpenAiContentPart }): string | null;
function newPendingOpenAiToolCall({ rawCall, index }: { rawCall: Record<string, unknown>; index: number }): PendingToolCall;
function openAiHeaders(requiredArgs: Pick<OpenAiTurnOptions, "apiKey" | "model" | "messages" | "onEvent">, optionalArgs: Omit<OpenAiTurnOptions, "apiKey" | "model" | "messages" | "onEvent"> = {}): Record<string, string>;
function openAiLoopExitReason({ outcome, toolTurns, maxToolTurns }: { outcome: OpenAiCompatibleRequestOutcome; toolTurns: number; maxToolTurns: number }): OpenAiTurnEndReason | null;
function openAiRequestBody({ options, messages }: { options: OpenAiTurnOptions; messages: readonly OpenAiMessageParam[] }): Record<string, unknown>;
function openAiRequestUrl({ baseUrl }: { baseUrl: string | undefined }): string;
function parseOpenAiSseData({ raw }: { raw: string }): Record<string, unknown> | null;
function processOpenAiStreamFrame({ state, frame, onEvent }: { state: OpenAiStreamState; frame: DecodedSseEvent; onEvent: (event: OpenAiTurnEvent) => void }): OpenAiFrameResult;
function resolveOpenAiToolCalls({ pending }: { pending: ReadonlyMap<number, PendingToolCall> }): OpenAiToolCall[];
function runOpenAiCompatibleRequest(requiredArgs: Pick<OpenAiCompatibleRequestInit, "url" | "headers" | "body" | "redactSecretsList" | "guardMessageId" | "providerLabel" | "onEvent" | "emitEnd" | "hasEnded">, optionalArgs: Omit<OpenAiCompatibleRequestInit, "url" | "headers" | "body" | "redactSecretsList" | "guardMessageId" | "providerLabel" | "onEvent" | "emitEnd" | "hasEnded"> = {}): Promise<OpenAiCompatibleRequestOutcome>;
function runOpenAiToolTurn(requiredArgs: Pick<OpenAiTurnOptions, "apiKey" | "model" | "messages" | "onEvent">, optionalArgs: Omit<OpenAiTurnOptions, "apiKey" | "model" | "messages" | "onEvent"> = {}): Promise<OpenAiTurnResult>;
function sanitizeOpenAiToolResult({ result }: { result: OpenAiToolResult }): SanitizedOpenAiToolResult;
function splitOpenAiToolResultContent({ content }: { content: string | readonly OpenAiContentPart[] }): SplitOpenAiToolResultContent;
```

### [providers/google-messages.ts](../../src/providers/google-messages.ts)

```ts
function applyGoogleUsage({ state, data, onEvent }: { state: GoogleStreamState; data: Record<string, unknown>; onEvent: (event: GoogleTurnEvent) => void }): void;
function buildGoogleAssistantParts({ text, toolCalls }: { text: string; toolCalls: readonly GoogleToolCall[] }): GooglePart[];
function executeGoogleToolCalls({ executeTool, calls, onEvent }: { executeTool: GoogleToolExecutor; calls: readonly GoogleToolCall[]; onEvent: (event: GoogleTurnEvent) => void } ): Promise<GoogleToolExecutionOutcome>;
function googleLoopExitReason({ outcome, toolTurns, maxToolTurns }: { outcome: SingleRequestOutcome; toolTurns: number; maxToolTurns: number }): GoogleTurnEndReason | null;
function handleGoogleBlockedPrompt({ data, onEvent }: { data: Record<string, unknown>; onEvent: (event: GoogleTurnEvent) => void }): boolean;
function handleGoogleFunctionCallPart({ state, rawPart, onEvent }: { state: GoogleStreamState; rawPart: Record<string, unknown>; onEvent: (event: GoogleTurnEvent) => void }): void;
function handleGoogleTextPart({ state, text, onEvent }: { state: GoogleStreamState; text: string; onEvent: (event: GoogleTurnEvent) => void }): 'continue' | 'break';
function processGoogleFrame({ state, data, onEvent }: { state: GoogleStreamState; data: Record<string, unknown>; onEvent: (event: GoogleTurnEvent) => void }): GoogleFrameOutcome;
function processGoogleRawPart({ state, rawPart, onEvent }: { state: GoogleStreamState; rawPart: unknown; onEvent: (event: GoogleTurnEvent) => void }): 'continue' | 'break';
function runGoogleToolTurn(requiredArgs: Pick<GoogleTurnOptions, "apiKey" | "model" | "contents" | "onEvent">, optionalArgs: Omit<GoogleTurnOptions, "apiKey" | "model" | "contents" | "onEvent"> = {}): Promise<GoogleTurnResult>;
```

### [providers/azure-chat.ts](../../src/providers/azure-chat.ts)

```ts
function azureLoopExitReason({ outcome, toolTurns, maxToolTurns }: { outcome: OpenAiCompatibleRequestOutcome; toolTurns: number; maxToolTurns: number }): AzureTurnEndReason | null;
function buildAzureAssistantToolCalls({ toolCalls }: { toolCalls: readonly AzureToolCall[] }): AzureToolCallParam[];
function buildAzureToolExchangeMessages({ toolResultMessages, followUpParts }: { toolResultMessages: readonly AzureMessageParam[]; followUpParts: readonly AzureContentPart[] } ): AzureMessageParam[];
function executeAzureToolCalls({ executeTool, calls, onEvent }: { executeTool: AzureToolExecutor; calls: readonly AzureToolCall[]; onEvent: (event: AzureTurnEvent) => void } ): Promise<AzureToolExecutionOutcome>;
function runAzureToolTurn(requiredArgs: Pick<AzureTurnOptions, "apiKey" | "baseUrl" | "model" | "messages" | "onEvent">, optionalArgs: Omit<AzureTurnOptions, "apiKey" | "baseUrl" | "model" | "messages" | "onEvent"> = {}): Promise<AzureTurnResult>;
```

### [providers/ollama-chat.ts](../../src/providers/ollama-chat.ts)

```ts
function buildOllamaAssistantToolCalls({ toolCalls }: { toolCalls: readonly OllamaToolCall[] }): OllamaToolCallParam[];
function executeOllamaToolCalls({ executeTool, calls, onEvent }: { executeTool: OllamaToolExecutor; calls: readonly OllamaToolCall[]; onEvent: (event: OllamaTurnEvent) => void } ): Promise<OllamaMessageParam[]>;
function handleOllamaTextContent({ state, content, onEvent }: { state: OllamaStreamState; content: string; onEvent: (event: OllamaTurnEvent) => void }): 'continue' | 'break';
function handleOllamaToolCallsField({ state, message }: { state: OllamaStreamState; message: Record<string, unknown> }): void;
function ollamaLoopExitReason({ outcome, toolTurns, maxToolTurns }: { outcome: SingleRequestOutcome; toolTurns: number; maxToolTurns: number }): OllamaTurnEndReason | null;
function parseNdjsonLine({ line }: { line: string }): unknown;
function* parseNdjsonLines({ rawLines }: { rawLines: readonly string[] }): Generator<unknown>;
function parseOllamaToolCallArguments({ args }: { args: unknown }): unknown;
function processOllamaLine({ state, line, onEvent, emitEnd }: { state: OllamaStreamState; line: Record<string, unknown>; onEvent: (event: OllamaTurnEvent) => void; emitEnd: (reason: OllamaTurnEndReason) => void } ): 'continue' | 'break' | 'done';
function resolveOllamaToolCall({ rawCall, index }: { rawCall: unknown; index: number }): OllamaToolCall | null;
function runOllamaToolTurn(requiredArgs: Pick<OllamaTurnOptions, "apiKey" | "model" | "messages" | "onEvent">, optionalArgs: Omit<OllamaTurnOptions, "apiKey" | "model" | "messages" | "onEvent"> = {}): Promise<OllamaTurnResult>;
function splitNdjsonLines({ buffer }: { buffer: string }): { readonly lines: readonly string[]; readonly remainder: string };
```

### [providers/elevenlabs.ts](../../src/providers/elevenlabs.ts)

```ts
function listElevenLabsVoiceOptions({ workspaceKey, resolveCredentials }: { workspaceKey: string; resolveCredentials: ElevenLabsCredentialResolver }, options: { limit?: number; requestInit?: Pick<RequestInit, 'dispatcher'>; } = {} ): Promise<ElevenLabsVoiceOption[]>;
```

### [providers/pkce.ts](../../src/providers/pkce.ts)

```ts
function buildAuthorizeUrl(requiredArgs: Pick<AuthorizeUrlInput, "authServer" | "clientId" | "redirectUri" | "state" | "codeChallenge">, optionalArgs: Omit<AuthorizeUrlInput, "authServer" | "clientId" | "redirectUri" | "state" | "codeChallenge"> = {}): string;
function deriveCodeChallenge({ verifier }: { verifier: string }): string;
function exchangeCodeForToken({ input }: { input: ExchangeCodeInput }, { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}): Promise<OAuthTokenResponse>;
function generateCodeVerifier(): string;
function generateState(): string;
function refreshAccessToken({ input }: { input: RefreshTokenInput }, { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}): Promise<OAuthTokenResponse>;
```

### [providers/oauth-provider.ts](../../src/providers/oauth-provider.ts)

```ts
function beginOAuthPkce(input: BeginOAuthPkceInput): BeginOAuthPkceResult;
function completeOAuthPkce(requiredArgs: Pick<CompleteOAuthPkceInput, "config" | "pending" | "state" | "code">, optionalArgs: Omit<CompleteOAuthPkceInput, "config" | "pending" | "state" | "code"> = {} ): Promise<OAuthTokenResponse>;
function refreshOAuthPkceToken(requiredArgs: Pick<RefreshOAuthPkceInput, "config" | "refreshToken">, optionalArgs: Omit<RefreshOAuthPkceInput, "config" | "refreshToken"> = {} ): Promise<OAuthTokenResponse>;
function xaiOAuthRedirectUri(): string;
```

### [providers/oauth-callback-server.ts](../../src/providers/oauth-callback-server.ts)

```ts
function startOAuthCallbackListener(requiredArgs: Pick<StartOAuthCallbackListenerInput, "host" | "port" | "path" | "expectedState" | "onCallback">, optionalArgs: Omit<StartOAuthCallbackListenerInput, "host" | "port" | "path" | "expectedState" | "onCallback"> = {} ): Promise<OAuthCallbackListener>;
```

### [providers/oauth-tokens.ts](../../src/providers/oauth-tokens.ts)

```ts
function clearStoredOAuthToken({ dataDir, fileName }: { dataDir: string; fileName: string }): Promise<void>;
function getStoredOAuthToken({ dataDir, fileName }: { dataDir: string; fileName: string } ): Promise<StoredOAuthToken | null>;
function isOAuthTokenExpired({ token }: { token: StoredOAuthToken }, { now = Date.now(), skew = 120_000 }: { now?: number; skew?: number } = {} ): boolean;
function readOAuthTokenFile({ dataDir, fileName }: { dataDir: string; fileName: string }): Promise<OAuthTokenFile>;
function sanitizeOAuthTokenFile({ raw }: { raw: unknown }): OAuthTokenFile;
function setStoredOAuthToken({ dataDir, fileName, token }: { dataDir: string; fileName: string; token: StoredOAuthToken } ): Promise<void>;
```

### [providers/oauth-credentials.ts](../../src/providers/oauth-credentials.ts)

```ts
function resolveOAuthBearer({ config, tokenFileName, dataDir }: { config: OAuthPkceProviderConfig; tokenFileName: string; dataDir: string }, { fetchImpl }: { fetchImpl?: typeof fetch } = {} ): Promise<ResolvedOAuthCredential | null>;
```

### [providers/tool-turn.ts](../../src/providers/tool-turn.ts)

```ts
function runProviderToolTurn(required: ProviderToolTurnInput, optional: ProviderToolTurnOptions = {}): Promise<ProviderToolTurnResult>;
```

### [providers/google-schema.ts](../../src/providers/google-schema.ts)

```ts
function coerceNumericEnumStringsToNumbers({ input, paths }: { input: unknown; paths: readonly string[] }): unknown;
function findNumericEnumPaths({ schema }: { schema: unknown }, { prefix = [] }: { prefix?: readonly string[] } = {}): string[];
function googleParametersOf({ descriptor }: { descriptor: ProviderToolDescriptor }, { maxRefDepth = MAX_GOOGLE_REF_DEPTH }: { maxRefDepth?: number } = {}): Record<string, unknown>;
function sanitizeGoogleSchema({ schema }: { schema: unknown }, { defs = {}, maxRefDepth = MAX_GOOGLE_REF_DEPTH }: { defs?: Readonly<Record<string, unknown>>; maxRefDepth?: number } = {}): unknown;
```

### [agent-protocol/core/json-line-stream.ts](../../src/agent-protocol/core/json-line-stream.ts)

```ts
function createJsonLineStream({ onMessage }: { onMessage: (requiredArgs: { message: unknown; rawLine: string }) => void }): StreamParser;
```

### [agent-protocol/acp/session-params.ts](../../src/agent-protocol/acp/session-params.ts)

```ts
function buildAcpSessionNewParams({ cwd }: { cwd: string }, options: AcpSessionOptions = {}): { cwd: string; mcpServers: Array<{ type: string; name: string; command: string; args: any[]; env: unknown }> };
```

### [agent-protocol/acp/models.ts](../../src/agent-protocol/acp/models.ts)

```ts
function detectAcpModels(requiredArgs: Pick<DetectAcpModelsOptions, "bin" | "args">, optionalArgs: Omit<DetectAcpModelsOptions, "bin" | "args"> = {}): Promise<ModelOption[]>;
function normalizeModels({ models, defaultModelOption }: { models: unknown; defaultModelOption: ModelOption }, { configOptions }: { configOptions?: unknown } = {} ): ModelOption[];
```

### [agent-protocol/acp/session.ts](../../src/agent-protocol/acp/session.ts)

```ts
function attachAcpSession(requiredArgs: Pick<AttachAcpSessionOptions, "child" | "prompt" | "send">, optionalArgs: Omit<AttachAcpSessionOptions, "child" | "prompt" | "send"> = {}): AcpSessionController;
```

### [agent-protocol/pi-rpc/events.ts](../../src/agent-protocol/pi-rpc/events.ts)

```ts
function mapPiRpcEvent({ raw, send, ctx }: { raw: JsonRecord; send: SendAgentEvent; ctx: PiRpcContext } ): 'agent_end' | null;
```

### [agent-protocol/pi-rpc/session.ts](../../src/agent-protocol/pi-rpc/session.ts)

```ts
function attachPiRpcSession(requiredArgs: Pick<PiRpcSessionOptions, "child" | "prompt" | "send">, optionalArgs: Omit<PiRpcSessionOptions, "child" | "prompt" | "send"> = {}): PiRpcSession;
```

### [agent-protocol/pi-rpc/models.ts](../../src/agent-protocol/pi-rpc/models.ts)

```ts
function parsePiRpcModels({ stdout }: { stdout: unknown }): PiModelOption[] | null;
```

## Public values and type exports

Every listed name is exported from the root; source links define fields and literal values. Def values are RuntimeAgentDef-compatible adapter objects, not factories. Registry arrays and capability Map are mutable; providerTurnAdapters alone is a frozen adapter map. Noop values implement the host ports described above.

| Source | Exported values, classes and types |
|---|---|
| [types.ts](../../src/types.ts) | `DetectedAgent`, `RuntimeAgentDef`, `RuntimeBuildOptions`, `RuntimeCapabilityMap`, `RuntimeContext`, `RuntimeEnv`, `RuntimeExecOptions`, `RuntimeListModels`, `RuntimeLock`, `RuntimeLockAcquireContext`, `RuntimeLockHandoffContext`, `RuntimeLockHold`, `RuntimeModelOption`, `RuntimeModelSource`, `RuntimePromptBudgetError`, `RuntimeReasoningInModelId`, `RuntimeReasoningOption`, `RuntimeStdoutPolicy` |
| [models.ts](../../src/models.ts) | `DEFAULT_MODEL_OPTION` |
| [capabilities.ts](../../src/capabilities.ts) | `agentCapabilities` |
| [mmd-routes.ts](../../src/mmd-routes.ts) | `MmdRouteLaunchEnv` |
| [metadata.ts](../../src/metadata.ts) | `AgentInstallMeta`, `DEFAULT_AGENT_INSTALL_LINKS` |
| [mcp.ts](../../src/mcp.ts) | `AcpMcpServerEntry`, `AcpMcpServerSpec` |
| [role-marker-guard.ts](../../src/role-marker-guard.ts) | `FABRICATED_ROLE_MARKER_RE`, `RoleMarkerGuard`, `RoleMarkerWarningEvent` |
| [auth.ts](../../src/auth.ts) | `AgentAuthProbeResult`, `AgentServiceFailureCode` |
| [opencode-log.ts](../../src/opencode-log.ts) | `OpenCodeServiceFailure` |
| [env.ts](../../src/env.ts) | `SpawnEnvHooks` |
| [launch.ts](../../src/launch.ts) | `AgentLaunchKind`, `AgentLaunchResolution` |
| [terminal-launch.ts](../../src/terminal-launch.ts) | `TerminalLaunchResult` |
| [diagnostics.ts](../../src/diagnostics.ts) | `NotInvocableCause` |
| [detection.ts](../../src/detection.ts) | `ProbedAgentModels` |
| [prompt-file.ts](../../src/prompt-file.ts) | `PreparedPromptFile` |
| [log-file.ts](../../src/log-file.ts) | `PreparedAgentLogFile` |
| [amr-model-cache.ts](../../src/amr-model-cache.ts) | `AmrModelLoadingCache`, `AmrModelsResponse`, `amrModelLoadingCache` |
| [model-catalog-cache.ts](../../src/model-catalog-cache.ts) | `ModelCatalogCache`, `ModelCatalogCacheDependencies`, `ModelCatalogCacheKey`, `ModelCatalogCacheOptions`, `ModelCatalogReadOptions`, `ModelDiscovery`, `ModelMerger` |
| [registry.ts](../../src/registry.ts) | `AGENT_DEFS`, `BASE_AGENT_DEFS` |
| [defs/aider.ts](../../src/defs/aider.ts) | `aiderAgentDef` |
| [defs/amp.ts](../../src/defs/amp.ts) | `ampAgentDef` |
| [defs/amr.ts](../../src/defs/amr.ts) | `VelaBillingSummary`, `VelaModelJsonSource`, `amrAgentDef` |
| [defs/antigravity.ts](../../src/defs/antigravity.ts) | `antigravityAgentDef` |
| [defs/auggie.ts](../../src/defs/auggie.ts) | `auggieAgentDef` |
| [defs/claude.ts](../../src/defs/claude.ts) | `claudeAgentDef` |
| [defs/cline.ts](../../src/defs/cline.ts) | `clineAgentDef` |
| [defs/codebuddy.ts](../../src/defs/codebuddy.ts) | `codebuddyAgentDef` |
| [defs/codex.ts](../../src/defs/codex.ts) | `codexAgentDef` |
| [defs/copilot.ts](../../src/defs/copilot.ts) | `copilotAgentDef` |
| [defs/crush.ts](../../src/defs/crush.ts) | `crushAgentDef` |
| [defs/cursor-agent.ts](../../src/defs/cursor-agent.ts) | `cursorAgentDef` |
| [defs/droid.ts](../../src/defs/droid.ts) | `droidAgentDef` |
| [defs/gemini.ts](../../src/defs/gemini.ts) | `geminiAgentDef` |
| [defs/deepseek.ts](../../src/defs/deepseek.ts) | `deepseekAgentDef` |
| [defs/devin.ts](../../src/defs/devin.ts) | `devinAgentDef` |
| [defs/goose.ts](../../src/defs/goose.ts) | `gooseAgentDef` |
| [defs/grok-build.ts](../../src/defs/grok-build.ts) | `grokBuildAgentDef` |
| [defs/hermes.ts](../../src/defs/hermes.ts) | `hermesAgentDef` |
| [defs/kilo.ts](../../src/defs/kilo.ts) | `kiloAgentDef` |
| [defs/kimi.ts](../../src/defs/kimi.ts) | `kimiAgentDef` |
| [defs/kiro.ts](../../src/defs/kiro.ts) | `kiroAgentDef` |
| [defs/mimo.ts](../../src/defs/mimo.ts) | `mimoAgentDef` |
| [defs/opencode.ts](../../src/defs/opencode.ts) | `opencodeAgentDef` |
| [defs/pi.ts](../../src/defs/pi.ts) | `piAgentDef` |
| [defs/qoder.ts](../../src/defs/qoder.ts) | `qoderAgentDef` |
| [defs/qwen.ts](../../src/defs/qwen.ts) | `qwenAgentDef` |
| [defs/reasonix.ts](../../src/defs/reasonix.ts) | `reasonixAgentDef` |
| [defs/trae-cli.ts](../../src/defs/trae-cli.ts) | `traeCliAgentDef` |
| [defs/vibe.ts](../../src/defs/vibe.ts) | `vibeAgentDef` |
| [model-registry.ts](../../src/model-registry.ts) | `AgentModelChoice` |
| [claude-stream.ts](../../src/claude-stream.ts) | `ClaudeStreamEvent` |
| [qoder-stream.ts](../../src/qoder-stream.ts) | `QoderEvent` |
| [copilot-stream.ts](../../src/copilot-stream.ts) | `CopilotStreamEvent` |
| [amr-profile-resolver.ts](../../src/amr-profile-resolver.ts) | `AmrProfileResolver`, `noopAmrProfileResolver` |
| [acp-model-probe.ts](../../src/acp-model-probe.ts) | `AcpModelProbe`, `AcpModelProbeRequest`, `noopAcpModelProbe` |
| [prompt-augmenter.ts](../../src/prompt-augmenter.ts) | `PromptAugmenter`, `RunContextSelection`, `WorkspaceContextItem`, `noopPromptAugmenter` |
| [artifact-taxonomy.ts](../../src/artifact-taxonomy.ts) | `ArtifactTaxonomy`, `noopArtifactTaxonomy` |
| [telemetry-sink.ts](../../src/telemetry-sink.ts) | `RunLifecycleEvent`, `TelemetrySink`, `noopTelemetrySink` |
| [providers/types.ts](../../src/providers/types.ts) | `ConnectionTestKind`, `ConnectionTestProtocol`, `ProviderModelOption`, `ProviderModelsKind`, `ProviderModelsRequest`, `ProviderModelsResponse` |
| [providers/aihubmix.ts](../../src/providers/aihubmix.ts) | `AIHUBMIX_APP_CODE`, `AIHUBMIX_DEFAULT_BASE_URL`, `AIHUBMIX_IMAGE_ASPECT_TO_SIZE`, `AIHubMixCatalogModel`, `AIHubMixCatalogType`, `AIHubMixGeminiImageRequest`, `AIHubMixProtocol`, `ParseAIHubMixCatalogOptions` |
| [providers/connection-guard.ts](../../src/providers/connection-guard.ts) | `BaseUrlValidationResult`, `DnsLookupAddress`, `DnsLookupFn`, `PinnedFetch`, `PinnedFetchInit`, `PinnedFetchResponse` |
| [providers/model-catalog.ts](../../src/providers/model-catalog.ts) | `ProviderModelsInput` |
| [providers/connection-test.ts](../../src/providers/connection-test.ts) | `ConnectionTestResponse`, `ProviderConnectionTestInput`, `ProviderConnectionTestRequest`, `SupportedConnectionTestProtocol` |
| [providers/sse-decode.ts](../../src/providers/sse-decode.ts) | `DecodedSseEvent` |
| [providers/anthropic-messages.ts](../../src/providers/anthropic-messages.ts) | `AnthropicBase64ImageSource`, `AnthropicBlockState`, `AnthropicContentBlockParam`, `AnthropicImageBlockParam`, `AnthropicMessageParam`, `AnthropicStreamState`, `AnthropicTextBlockParam`, `AnthropicToolCall`, `AnthropicToolDef`, `AnthropicToolExecutor`, `AnthropicToolResult`, `AnthropicToolResultBlockParam`, `AnthropicToolResultContentBlock`, `AnthropicToolUseBlockParam`, `AnthropicTurnEndReason`, `AnthropicTurnEvent`, `AnthropicTurnOptions`, `AnthropicTurnResult`, `AnthropicUrlImageSource`, `SingleRequestOutcome` |
| [providers/openai-chat.ts](../../src/providers/openai-chat.ts) | `DEFAULT_OPENAI_MAX_TOKENS`, `OpenAiCompatibleRequestInit`, `OpenAiCompatibleRequestOutcome`, `OpenAiContentPart`, `OpenAiFrameResult`, `OpenAiFunctionToolDef`, `OpenAiImageUrlPart`, `OpenAiMessageParam`, `OpenAiStreamState`, `OpenAiTextPart`, `OpenAiToolCall`, `OpenAiToolCallParam`, `OpenAiToolExecutionOutcome`, `OpenAiToolExecutor`, `OpenAiToolResult`, `OpenAiTurnEndReason`, `OpenAiTurnEvent`, `OpenAiTurnOptions`, `OpenAiTurnResult`, `PendingToolCall`, `SanitizedOpenAiToolResult`, `SplitOpenAiToolResultContent` |
| [providers/google-messages.ts](../../src/providers/google-messages.ts) | `GoogleContent`, `GoogleFrameOutcome`, `GoogleFunctionCallPart`, `GoogleFunctionDeclaration`, `GoogleFunctionResponsePart`, `GoogleInlineDataPart`, `GooglePart`, `GoogleStreamState`, `GoogleTextPart`, `GoogleToolCall`, `GoogleToolDef`, `GoogleToolExecutionOutcome`, `GoogleToolExecutor`, `GoogleToolResult`, `GoogleToolResultPart`, `GoogleTurnEndReason`, `GoogleTurnEvent`, `GoogleTurnOptions`, `GoogleTurnResult` |
| [providers/azure-chat.ts](../../src/providers/azure-chat.ts) | `AzureContentPart`, `AzureFunctionToolDef`, `AzureImageUrlPart`, `AzureMessageParam`, `AzureTextPart`, `AzureToolCall`, `AzureToolCallParam`, `AzureToolExecutionOutcome`, `AzureToolExecutor`, `AzureToolResult`, `AzureTurnEndReason`, `AzureTurnEvent`, `AzureTurnOptions`, `AzureTurnResult` |
| [providers/ollama-chat.ts](../../src/providers/ollama-chat.ts) | `OllamaFunctionToolDef`, `OllamaMessageParam`, `OllamaStreamState`, `OllamaToolCall`, `OllamaToolCallParam`, `OllamaToolExecutor`, `OllamaToolResult`, `OllamaTurnEndReason`, `OllamaTurnEvent`, `OllamaTurnOptions`, `OllamaTurnResult` |
| [providers/elevenlabs.ts](../../src/providers/elevenlabs.ts) | `ElevenLabsCredentialMissingError`, `ElevenLabsCredentialResolver`, `ElevenLabsCredentials`, `ElevenLabsVoiceOption` |
| [providers/pkce.ts](../../src/providers/pkce.ts) | `AuthorizationServerMetadata`, `AuthorizeUrlInput`, `ExchangeCodeInput`, `OAuthTokenResponse`, `PendingAuthCache`, `PendingAuthState`, `RefreshTokenInput` |
| [providers/oauth-provider.ts](../../src/providers/oauth-provider.ts) | `BeginOAuthPkceInput`, `BeginOAuthPkceResult`, `CompleteOAuthPkceInput`, `OAuthPkceProviderConfig`, `RefreshOAuthPkceInput`, `XAI_OAUTH_PROVIDER_CONFIG`, `XAI_OAUTH_PROVIDER_ID`, `XAI_OAUTH_REDIRECT_HOST`, `XAI_OAUTH_REDIRECT_PATH`, `XAI_OAUTH_REDIRECT_PORT` |
| [providers/oauth-callback-server.ts](../../src/providers/oauth-callback-server.ts) | `OAuthCallbackListener`, `OAuthCallbackOutcome`, `StartOAuthCallbackListenerInput` |
| [providers/oauth-tokens.ts](../../src/providers/oauth-tokens.ts) | `OAuthTokenFile`, `StoredOAuthToken` |
| [providers/oauth-credentials.ts](../../src/providers/oauth-credentials.ts) | `ResolvedOAuthCredential` |
| [providers/tool-turn.ts](../../src/providers/tool-turn.ts) | `providerTurnAdapters` |
| [providers/tool-turn-types.ts](../../src/providers/tool-turn-types.ts) | `ProviderChatMessage`, `ProviderProtocol`, `ProviderToolCall`, `ProviderToolDescriptor`, `ProviderToolExecutor`, `ProviderToolResult`, `ProviderToolResultBlock`, `ProviderToolTurnInput`, `ProviderToolTurnOptions`, `ProviderToolTurnResult`, `ProviderTurnAdapters`, `ProviderTurnEvent` |
| [agent-protocol/acp/session-params.ts](../../src/agent-protocol/acp/session-params.ts) | `AcpMcpServerInput` |
| [agent-protocol/acp/models.ts](../../src/agent-protocol/acp/models.ts) | `ModelOption` |
| [agent-protocol/acp/session.ts](../../src/agent-protocol/acp/session.ts) | `AcpPermissionDecision`, `AcpPermissionHandler`, `AcpPermissionOption`, `AcpPermissionRequest`, `AcpSessionController`, `AttachAcpSessionOptions` |
| [agent-protocol/acp/account-failure.ts](../../src/agent-protocol/acp/account-failure.ts) | `AccountFailure`, `AccountFailureClassifier`, `noopAccountFailureClassifier` |
| [agent-protocol/pi-rpc/session.ts](../../src/agent-protocol/pi-rpc/session.ts) | `PiRpcSession`, `PiRpcSessionOptions` |
| @jini-ai/protocol re-exports | `AgentDefinition`, `CredentialStatus`, `ModelCatalogOption`, `ModelProvider`, `AgentDiagnostic`, `AgentDiagnosticReason`, `AgentDiagnosticSeverity`, `AgentFixIntent` |

## Alias and coverage boundaries

`probeAcpModels` delegates to the installed AcpModelProbe; `detectAcpModels` spawns and performs real ACP discovery. `parsePiModels` returns RuntimeModelOption[] or null from the standalone parser; `parsePiRpcModels` names the protocol parser copy. Do not conflate these aliases.

All four package export paths are documented. Detailed unexported implementation helpers, skill content/templates and private helper types are not additional public entry points. No coverage gap is known for the declared paths. Source evidence consists of the current export map, source declarations and read-only inspection of cache, provider, argument-convention and session tests. No runtime validation was performed. Current ownership/signatures were reconciled with source after the architecture wave.

## Kernel consolidation

Catalog-cache clocks are core Clock.nowMs(); ACP arbitrary objects are `UnknownRecord`, not JSON-safe aliases. Provider URL classifiers are imported from platform/net and provider redaction from the core root; these are no longer runtime exports. PKCE/state/code exchange/refresh use the consolidated OAuth root with explicit 64-byte provider verifiers; normalized OAuthTokenSet values are adapted to the existing provider storage DTO. No provider-primitives subpath is consumed.

## Current manifest boundary

The current `package.json` exposes `.`, `./providers/tool-turn`, `./model-catalog/cache`, `./providers/sse-decode`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
