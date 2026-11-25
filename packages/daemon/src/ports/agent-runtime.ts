/** @file Everything `@jini-ai/daemon` needs from an agent runtime, stated as one port. The host binds it (usually
 * `createAgentRuntimeBindings` from `@jini-ai/agent-runtime`) and proves the match with `satisfies AgentRuntimePort`.
 * Vocabulary comes from `@jini-ai/core/contracts/agents`; the Node-typed session types are in `./agent-runtime-sessions.ts`.
 * The binding owns the runtime state, the host env and the per-vendor definition policies (Codex plugins, Pi shutdown
 * grace): the daemon passes none of them. */
import type {
  AgentLaunchResolution, DefaultModelResolution, ModelCatalogSnapshot, ModelDiscoveryContext, ModelIdentityKind,
  NativeToolPolicyInput, PreparedAgentLogFile, PreparedPromptFile, RunPlan, RunPlanHost, RuntimeAgentDef, RuntimeBuildOptions,
  RuntimeCapabilityMap, RuntimeEnv, RuntimePromptBudgetError, NativeCapabilities,
} from '@jini-ai/core/contracts/agents';
import type { AtomicFileWriterPort, FileLockPort } from '@jini-ai/core/contracts/runtime';
import type { AcpAttachOptional, AcpAttachRequired, AcpSessionController, PiRpcAttachOptional, PiRpcAttachRequired, PiRpcSession } from './agent-runtime-sessions.js';

/** A stream parser the launcher feeds the child's stdout. */
export interface AgentStreamHandler { feed(required: { chunk: string }): void; flush(): void }
/** Every parser reports plain records with a `type` discriminant; the launcher translates them. */
export type AgentStreamSink = (event: Record<string, unknown>) => void;

type LaunchProbe = { agentId: string; launchPath: string; env: RuntimeEnv };

export interface RunHomeSeams {
  /**
   * `'codex-toml'` only. Creates a fresh, randomly-named directory the `mcpHome` slot stages
   * as a run's scratch `CODEX_HOME`. **Must be non-deterministic (a real `mkdtemp`, not a
   * caller-computed path)** — unlike `mcpJsonPathForRun`'s deterministic path inside the run's own
   * `cwd`, this directory holds a copy of the operator's real Codex login credential, and
   * `os.tmpdir()` is a shared location on a multi-user host: a guessable name there is a real
   * pre-plant/symlink target for another local user. `fs.mkdtemp`'s random suffix plus its `0700`
   * directory mode is the actual confidentiality control, matching the same reasoning
   * `@jini-ai/agent-runtime`'s `log-file.ts`/`prompt-file.ts` already apply to their own staged temp
   * dirs.
   * @param prefix - A caller-composed, run-id-derived prefix (already sanitized) for the mkdtemp
   * template; the real suffix mkdtemp appends is what makes the path unpredictable.
   * @default `fs.mkdtemp(path.join(os.tmpdir(), prefix))`
   */
  readonly mkdtemp?: ({ prefix }: { readonly prefix: string }) => Promise<string>;
  /**
   * `'codex-toml'` only. Recursively removes the scratch `CODEX_HOME` directory `mkdtemp` above
   * created — the directory-level analogue of `removeFile`, needed because this mechanism stages a
   * whole directory (`config.toml` plus a copied `auth.json`), not one file.
   * @default `fs.rm(path, { recursive: true, force: true })` — already-gone is success, not an error.
   */
  readonly removeDir?: ({ path }: { readonly path: string }) => Promise<void>;
  /** `'codex-toml'` only. Links the run home's sessions/archived_sessions to the operator's
   * persistent rollout store and authentication. Parity also links user home entries; config alone stays isolated.
   * @default Native mkdir (0700) and directory symlinks; errors fail staging before spawn. */
  readonly linkSessionStore?: (required: { runHome: string; sourceHome: string }, optional?: { inheritUserConfig?: boolean }) => Promise<void>;
}

/** A staged, run-scoped home directory: where the child reads its config from, and the release that removes it. */
export type PreparedRunHome = {
  /** Absolute path to hand to the spawned child through the slot's `envVar`. */
  readonly path: string;
  /** Recursively removes the staged directory — the live login link it may hold makes this a confidentiality cleanup, not just tidiness. Safe to call more than once. */
  readonly cleanup: () => Promise<void>;
};

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
  /** A CLI that takes its MCP config from a run-scoped home directory the host stages before spawn. The directory may hold a
   * link to the operator's real login and a bearer token, so `stage` owns isolation and the host owns release: a rejection or a
   * `refused` result leaves nothing staged, and `cleanup` on a staged home removes links, never their targets. Absent: no staged home. */
  readonly mcpHome?: {
    /** The environment variable the spawned child reads the staged directory from; it is also kept from the host env. */
    readonly envVar: string;
    buildDelivery<E>(required: { serverEntry: E }): { readonly kind: 'codex-toml'; readonly serverEntry: E };
    withStagedHome(required: { env: NodeJS.ProcessEnv; homeDir: string }): NodeJS.ProcessEnv;
    /** True when the run turns off personal config, which only a staged home can do: with no staging available the host refuses the start. */
    turnsOffPersonalConfig(required: { nativeCapabilities?: Partial<NativeCapabilities> }): boolean;
    stage(required: {
      runId: string;
      entry: { readonly command: string; readonly args: readonly string[]; readonly env: Readonly<Record<string, string>> } | { readonly url: string; readonly token: string };
      nativeToolAccess?: boolean | undefined;
      nativeCapabilities?: Partial<NativeCapabilities>;
      hostEnv: NodeJS.ProcessEnv;
      io: RunHomeSeams & { readFile(required: { path: string }): Promise<string>; writeFile(required: { path: string; content: string }): Promise<void> };
      toolApprovalOwner?: 'host';
    }): Promise<{ readonly kind: 'staged'; readonly home: PreparedRunHome } | { readonly kind: 'refused'; readonly message: string }>;
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
