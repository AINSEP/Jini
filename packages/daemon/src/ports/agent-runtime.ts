/** @file Everything `@jini-ai/daemon` needs from an agent runtime, stated as one port. The host binds it (usually
 * `createAgentRuntimeBindings` from `@jini-ai/agent-runtime`) and proves the match with `satisfies AgentRuntimePort`.
 * Vocabulary comes from `@jini-ai/core/contracts/agents`; the Node-typed session types are in `./agent-runtime-sessions.ts`.
 * The binding owns the runtime state, the host env and the per-vendor definition policies (Codex plugins, Pi shutdown
 * grace): the daemon passes none of them. */
import type {
  AgentLaunchResolution, DefaultModelResolution, ModelCatalogSnapshot, ModelDiscoveryContext, ModelIdentityKind,
  NativeToolPolicyInput, PreparedAgentLogFile, PreparedPromptFile, RunPlan, RunPlanHost, RuntimeAgentDef, RuntimeBuildOptions,
  RuntimeCapabilityMap, RuntimeEnv, RuntimePromptBudgetError,
} from '@jini-ai/core/contracts/agents';
import type { AtomicFileWriterPort, FileLockPort } from '@jini-ai/core/contracts/runtime';
import type { AcpAttachOptional, AcpAttachRequired, AcpSessionController, PiRpcAttachOptional, PiRpcAttachRequired, PiRpcSession } from './agent-runtime-sessions.js';

/** A stream parser the launcher feeds the child's stdout. */
export interface AgentStreamHandler { feed(required: { chunk: string }): void; flush(): void }
/** Every parser reports plain records with a `type` discriminant; the launcher translates them. */
export type AgentStreamSink = (event: Record<string, unknown>) => void;

type LaunchProbe = { agentId: string; launchPath: string; env: RuntimeEnv };

/** Vendor behaviour for one definition. Every slot is optional: a definition that needs none gets `{}`, and the launcher
 * then does nothing vendor-specific for it. The binding picks each slot from what the definition declares. */
export interface AgentRuntimeStrategies {
  /** Re-shapes one parsed stream event so a native tool call carries its bridge-correlation candidate; absent: events pass unchanged. */
  readonly toolCallReceipt?: (required: { event: Record<string, unknown> }) => Record<string, unknown>;
  /** For a `*-env-content` MCP delivery: the env variable that carries the serialised config document. */
  readonly mcpDelivery?: { readonly envContentVar: string };
  /** Persists whatever the CLI itself requires before an MCP bridge launch (e.g. a permission grant in its own settings file).
   * Runs through the host's lock and writer ports; a rejection fails the run before spawn. Absent: nothing to prepare. */
  readonly mcpBridge?: {
    prepare(required: { delivery: { readonly kind: string } | null; serverName: string; fileLock: FileLockPort; writer: AtomicFileWriterPort }): Promise<void>;
  };
  /** The CLI's private filesystem policy hooks around a folder-limited launch: acquire a runtime temp, degrade when the
   * CLI cannot confine itself, apply the shared read-block and settings policy. `supported` alone is bound for every
   * definition so the policy still applies to a definition whose probe reports support; `prepare`/`unsupported` are
   * the CLI's own extras and absent elsewhere. */
  readonly filesystem?: {
    prepare?(required: { input: RuntimeBuildOptions & { filesystemRuntimeTempBase?: string }; spawnEnv: NodeJS.ProcessEnv; runtimeTemps: string[] }): Promise<void> | void;
    unsupported?(required: { input: RuntimeBuildOptions }): void;
    supported(required: { input: RuntimeBuildOptions & { filesystemRuntimeReadPaths?: readonly string[] }; launchPath: string; spawnEnv: NodeJS.ProcessEnv }, optional: { filesystem: { runtimePaths(required: { launchPath: string }): readonly string[]; settings(required: { options: RuntimeBuildOptions }): string } }): void;
  };
  /** A scratch config directory the CLI reads instead of the operator's own, handed to the child under `envKey`.
   * `stage` may copy a credential into it; the host owns the returned `cleanup`. Absent: nothing to stage. */
  readonly configDir?: {
    readonly envKey: string;
    stage(required: { runId: string; hostEnv: NodeJS.ProcessEnv }, optional?: { seams?: { mkdtemp?: (required: { prefix: string }) => Promise<string>; readFile?: (required: { path: string }) => Promise<string>; writeFile?: (required: { path: string; content: string }) => Promise<void>; removeDir?: (required: { path: string }) => Promise<void> } | undefined }): Promise<{ readonly path: string; readonly cleanup: () => Promise<void> }>;
  };
  /** A run-scoped JSON MCP config file the CLI is pointed at. Generic over the host's server-entry shape, which the CLI only echoes. */
  readonly mcpConfigFile?: {
    build<Entry extends { readonly command: string; readonly args: string[]; readonly env: Readonly<Record<string, string>> }>(required: { cwd: string; runId: string; serverEntry: Entry }): { kind: 'claude-mcp-json'; mcpJsonPath: string; serverEntry: Entry };
    write(required: { cwd: string; delivery: { readonly kind: string; readonly mcpJsonPath?: string; readonly serverEntry?: { readonly command: string; readonly args: string[]; readonly env: Readonly<Record<string, string>> } }; options: { readonly readFile?: (required: { path: string }) => Promise<string>; readonly writeFile?: (required: { path: string; content: string }) => Promise<void> }; serverName: string }, optional?: { inheritUserConfig?: boolean | undefined }): Promise<string>;
    prepareHttp(required: { cwd: string; endpoint: { readonly url: string; readonly token: string }; serverName: string }, optional?: { inheritUserMcp?: boolean; readFile?: (required: { path: string }) => Promise<string> }): Promise<{ path: string; cleanup: () => Promise<void> }>;
  };
  /** Settings JSON that registers the CLI's own subagent-start hook so each child loads the parent's plugins. */
  readonly subagentStart?: {
    prepare(required: { directory: string; context: { ids: readonly string[]; instructions: string }; settings?: string }): Promise<string>;
  };
}

export interface AgentRuntimePort {
  readonly defs: {
    /** The definition for an id, or `null` when the runtime does not know it. */
    get(required: { id: string }): RuntimeAgentDef | null;
    /** A copy bound to the runtime's state and definition policies; the registry entry is not mutated. */
    bind(required: { def: RuntimeAgentDef }): RuntimeAgentDef;
    /** Probed capabilities, read when the run launches. `undefined` means not probed: a gate must treat only an explicit `false` as withheld. */
    capabilities(required: { defId: string }): RuntimeCapabilityMap | undefined;
    ensureCapabilities(required: { def: RuntimeAgentDef; launchPath: string; env: RuntimeEnv }): Promise<void>;
  };
  readonly launch: {
    resolve(required: { def: RuntimeAgentDef }, optional?: { configuredEnv?: Record<string, string>; env?: RuntimeEnv }): AgentLaunchResolution;
    applyEnv(required: { env: RuntimeEnv; launch: Pick<AgentLaunchResolution, 'childPathPrepend'> }, optional?: { nodeBinDir?: string; appendPathDirs?: string[] }): RuntimeEnv;
    toolchainBinDirs(required: Record<string, never>, optional?: { env?: RuntimeEnv }): string[];
    /** Names of the host-configured env variables the runtime reads; the launcher copies only allowlisted names. */
    hostEnvNames(): readonly string[];
    planRun(required: { def: { name: string; supportsNativeToolAccess?: boolean; mcpIsolation?: 'none' | 'no-client' | { readonly perRun: string }; externalMcpInjection?: string; mcpHttp?: boolean }; policy: NativeToolPolicyInput; host?: RunPlanHost }): RunPlan;
    resolveNativeToolPolicy(required: { def: { name?: string; fullCliAccessOnly?: boolean }; policy: NativeToolPolicyInput }): NativeToolPolicyInput;
    /** Each budget check returns `null` when the launch fits. */
    promptArgvBudget(required: { def: RuntimeAgentDef; composed: unknown }, optional?: { platform?: NodeJS.Platform }): RuntimePromptBudgetError | null;
    windowsCmdShimBudget(required: { def: RuntimeAgentDef; resolvedBin: unknown; args: unknown }): RuntimePromptBudgetError | null;
    windowsDirectExeBudget(required: { def: RuntimeAgentDef; resolvedBin: unknown; args: unknown }): RuntimePromptBudgetError | null;
    /** `null` when the definition takes its prompt another way. The caller owns `cleanup`. */
    preparePromptFile(required: { def: RuntimeAgentDef; prompt: string; label: string }): Promise<PreparedPromptFile | null>;
    /** `null` when the definition needs no log file. The caller owns `cleanup`. */
    prepareLogFile(required: { def: RuntimeAgentDef; label: string }): Promise<PreparedAgentLogFile | null>;
  };
  /** Claude filesystem policy (vendor policy called from the launcher; follow-up F2 moves it behind the definition). */
  readonly filesystem: {
    validateLaunch(required: { filesystemRoot: string; cwd: string; extraAllowedDirs?: readonly string[]; imagePaths?: readonly string[] }): string;
    validateReadOnlyExtraDirs(required: { filesystemRoot: string; dirs: readonly string[] }, optional?: { homeDir?: string }): string[];
    /** Uses one probe cache per bound runtime. */
    assertSupport(required: LaunchProbe): Promise<boolean | void>;
    /** A probe with its own cache, for a caller that must not share the runtime's. */
    createSupportProbe(): (required: LaunchProbe) => Promise<boolean | void>;
    runtimePaths(required: { launchPath: string }): readonly string[];
    settings(required: { options: RuntimeBuildOptions }, optional?: { platform?: NodeJS.Platform; homeDir?: string; tempDir?: string; uid?: number; realpath?: (path: string) => string }): string;
  };
  readonly strategies: {
    /** The slots bound to this definition; `{}` when it declares nothing. The result is read, never mutated. */
    for(required: { def: RuntimeAgentDef }): AgentRuntimeStrategies;
  };
  readonly models: {
    resolveForLaunch(required: { def: RuntimeAgentDef; context: ModelDiscoveryContext; effort?: string }, optional?: { signal?: AbortSignal }):
      Promise<{ model: string; catalog: ModelCatalogSnapshot; resolution: DefaultModelResolution }>;
    identityKind(required: { id: string }): ModelIdentityKind;
  };
  readonly sessions: {
    attachAcp(required: AcpAttachRequired, optional?: AcpAttachOptional): AcpSessionController;
    /** The Pi shutdown grace is the binding's; a caller cannot set it. */
    attachPiRpc(required: PiRpcAttachRequired, optional?: Omit<PiRpcAttachOptional, 'gracefulShutdownMs'>): PiRpcSession;
  };
  readonly streams: {
    claude(required: { onEvent: AgentStreamSink }, optional?: { costBasis?: 'session' | 'run'; suppressHtmlArtifactsAfterFileWrite?: boolean; nowMs?: () => number }): AgentStreamHandler;
    qoder(required: { onEvent: AgentStreamSink }): AgentStreamHandler;
    jsonEvents(required: { kind: string; onEvent: AgentStreamSink }): AgentStreamHandler;
  };
  readonly failures: {
    startupMessage(required: { stage: string; error: unknown }, optional?: { exactSecrets?: readonly string[]; notice?: string }): string;
  };
}

export type { BaseUrlGuardPort, BaseUrlValidationResult } from '@jini-ai/core/contracts/agents';
