import {
  spawn as nodeSpawn,
  type ChildProcess,
} from 'node:child_process';
import {
  promises as fsPromises,
} from 'node:fs';
import {
  tmpdir,
} from 'node:os';
import {
  join,
} from 'node:path';
import {
  agentCapabilities,
  applyAgentLaunchEnv,
  ensureAgentCapabilities,
  resolveModelForLaunch,
  getAgentDef,
  resolveAgentLaunch,
  attachAcpSession,
  attachPiRpcSession,
  checkPromptArgvBudget,
  checkWindowsCmdShimCommandLineBudget,
  checkWindowsDirectExeCommandLineBudget,
  prepareAgentLogFile,
  preparePromptFileForAgent,
  type AgentLaunchResolution,
  type PreparedAgentLogFile,
  type PreparedPromptFile,
  type PromptAugmenter,
  type RuntimeAgentDef,
  type RuntimeBuildOptions,
  type RuntimeContext,
} from '@jini-ai/agent-runtime';
import {
  collectProcessTreePids,
  createCommandInvocation,
  listProcessSnapshots,
  stopProcesses,
} from '@jini-ai/platform';
import {
  applyImagePromptDelivery,
  type ImagePromptDelivery,
} from '../image-prompt-delivery.js';
import {
  SUPPORTED_STREAM_FORMATS,
  type SupportedStreamFormat,
  type ChildDrivenStreamFormat,
  type AgentExecutorCompatibility,
  type AgentExecutorErrorCode,
  AgentExecutorError,
  type AgentExecutorRunInput,
  type AgentExecutor,
  type CollectProcessTreePidsPort,
  type StopProcessesPort,
  type AgentCleanupFailureContext,
  type McpBridgeDelivery,
  type PreparedCodexHome,
  type PreparedClaudeConfigDir,
  type CreateAgentExecutorOptions,
  type FailBeforeSpawn,
  type SystemPromptOverlayDelivery,
  type PreparedSystemPromptOverlayFile,
  type SpawnAgentChildProcessResult,
} from './contracts.js';
import {
  errorMessage,
} from './values.js';
import {
  defaultCleanupFailureSink,
  DEFAULT_BUFFERED_STDOUT_MAX_BYTES,
  wireChildLifecycle,
  writePromptToStdin,
  runAcpDispatch,
  runPiRpcDispatch,
} from './events.js';
import {
  mergeEnvContentMcpConfig,
  mergeEnvContentInstructions,
  defaultRemoveMcpJsonFile,
  resolveMcpBridgeForRun,
  writeMcpJsonIfNeeded,
  prepareCodexHomeIfNeeded,
  prepareClaudeConfigDirIfNeeded,
} from './mcp-bridge.js';
import {
  acquireRuntimeLockIfConfigured,
  armHandoffWatcher,
} from './handoff.js';

/**
 * Narrows a `RuntimeAgentDef.streamFormat` string to the supported
 * families.
 * @param value - The def's raw `streamFormat` string.
 * @returns `true` when `value` is one of the JSON-stream-parser, ACP, pi-rpc, or plain formats this driver wires.
 * @complexity O(1) — fixed membership check.
 * @overallScore 100/100
 */
export function isSupportedStreamFormat(args: { readonly value: string }): args is { readonly value: SupportedStreamFormat } {
  const { value } = args;
  return (SUPPORTED_STREAM_FORMATS as readonly string[]).includes(value);
}

/**
 * The single source of truth for whether this executor can drive a def.
 *
 * It exists because that knowledge was previously reachable only by *calling* `run()` and inspecting
 * the failure. Anything that lists agents for a user to pick from — a discovery route, an agent
 * picker, a CLI healthcheck — needs the same answer *before* a run exists, and had no way to ask it.
 * The observable symptom was a consumer advertising an agent that its own executor then rejected the
 * instant it was selected.
 *
 * `run()` consumes this rather than re-checking the conditions itself, so the discovery-time answer
 * and the run-time guards cannot disagree. A predicate that merely duplicated the guards would be
 * the same bug in a second location.
 *
 * @param def - The def to assess. Must be the **full** `RuntimeAgentDef`, not a projected
 * `DetectedAgent`: that type omits `maxPromptArgBytes`, one of the three prompt-delivery signals
 * checked here, so the argv-bound defs (`aider`, `deepseek`) would be misjudged as unsupported.
 * @returns A discriminated result — see {@link AgentExecutorCompatibility}. The `reason` text is
 * operator-facing and is what `run()` reports as its `AGENT_RUNTIME_UNSUPPORTED` message.
 * @complexity O(1) — fixed field checks.
 * @overallScore 100/100
 */
export function assessAgentExecutorCompatibility({ def }: { readonly def: RuntimeAgentDef }): AgentExecutorCompatibility {
  const format = { value: def.streamFormat };
  if (!isSupportedStreamFormat(format)) {
    return {
      supported: false,
      reason: `AgentExecutor: agent "${def.id}" has streamFormat "${format.value}", which is not implemented in v1 — only ${SUPPORTED_STREAM_FORMATS.join(', ')} are supported`,
    };
  }
  const streamFormat = format.value;
  if (
    streamFormat !== 'acp-json-rpc' &&
    def.promptViaStdin !== true &&
    def.promptViaFile !== true &&
    typeof def.maxPromptArgBytes !== 'number'
  ) {
    return {
      supported: false,
      reason: `AgentExecutor: agent "${def.id}" does not deliver its prompt via stdin, a staged prompt file, or a byte-budgeted argv — v1 has no other prompt delivery path`,
    };
  }
  return { supported: true, streamFormat };
}

/**
 * Whether `run()` can actually drive this def — the discovery-time counterpart to the guards inside
 * `run()`, so a consumer never offers a user an agent that fails the moment it is selected.
 *
 * @param def - The full `RuntimeAgentDef`; see {@link assessAgentExecutorCompatibility} for why a
 * projected `DetectedAgent` is not sufficient.
 * @returns `true` when this executor would attempt the run.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function isAgentExecutorSupported({ def }: { readonly def: RuntimeAgentDef }): boolean {
  return assessAgentExecutorCompatibility({ def: def }).supported;
}

/**
 * Drops `undefined` values so `NodeJS.ProcessEnv` (whose values are
 * `string | undefined`) can feed `resolveAgentLaunch`'s
 * `Record<string, string>` parameter.
 * @param env - The source environment (the caller-supplied `input.env` escape hatch — the
 * default path builds its env via `buildAgentEnv` instead, never this function on `process.env`).
 * @returns A new object containing only the string-valued entries.
 * @complexity O(n) in the number of env entries.
 * @overallScore 100/100
 */
function toStringEnvRecord(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

/**
 * Fixed baseline of host environment variables every spawned agent subprocess may see by
 * default — resolved from the host's env one name at a time, never derived programmatically
 * from `process.env` as a bag, so this can't silently widen. SEC-001's deny-by-default fix; see
 * `AgentExecutorRunInput.env`'s doc for the full threat model.
 */
const BASELINE_AGENT_ENV_KEYS = [
  'PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'SHELL',
  'LANG', 'LC_ALL', 'LC_CTYPE',
  // `USER` is required for a spawned `claude` CLI to find its own login/credential state — with
  // it omitted (even though `HOME` is present), `claude` fails fast with "Not logged in · Please
  // run /login" despite real credentials existing on disk/keychain. Confirmed by bisection against
  // a real authenticated `claude` install: `BASELINE_AGENT_ENV_KEYS` alone fails, adding back every
  // `CLAUDE_CODE_*`/`CLAUDECODE` var still fails, `LOGNAME`/`SSH_AUTH_SOCK` alone still fail, but
  // `USER` alone flips it to success. Login lookup requires the user identity
  // as well as the home directory.
  'USER',
  'SystemRoot', 'windir', 'ComSpec', 'PATHEXT', // Windows-only; harmless no-ops elsewhere
] as const;

/**
 * Deny-by-default agent subprocess environment: `BASELINE_AGENT_ENV_KEYS` resolved from
 * `hostEnv`, plus this run's explicitly-delegated credential(s) — never a passthrough of
 * `hostEnv` itself. Only reached when the caller omits `AgentExecutorRunInput.env`; supplying
 * `env` bypasses this function entirely (see its call site).
 */
function buildAgentEnv(hostEnv: NodeJS.ProcessEnv, credentialEnv: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of BASELINE_AGENT_ENV_KEYS) {
    const value = hostEnv[key];
    if (typeof value === 'string') result[key] = value;
  }
  for (const [key, value] of Object.entries(credentialEnv ?? {})) {
    result[key] = value;
  }
  return result;
}

/**
 * Resolves once `child` emits `'spawn'`, or rejects on `'error'`. Replicates
 * `@jini-ai/platform`'s own internal (non-exported) `waitForChildSpawn` race
 * idiom inline — see that module's `spawnLoggedProcess`/`spawnBackgroundProcess`.
 * @param child - The just-spawned `ChildProcess` to race.
 * @returns A promise settling on the first of `'spawn'`/`'error'` to fire.
 * @complexity O(1) — two one-time listener registrations.
 * @overallScore 100/100
 */
function waitForSpawnOrError(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', resolve);
  });
}

interface ResolvedAgentRuntimeDeps {
  readonly getAgentDef: typeof getAgentDef;
  readonly resolveAgentLaunch: typeof resolveAgentLaunch;
  readonly ensureAgentCapabilities: typeof ensureAgentCapabilities;
  readonly applyAgentLaunchEnv: typeof applyAgentLaunchEnv;
  readonly attachAcpSession: typeof attachAcpSession;
  readonly attachPiRpcSession: typeof attachPiRpcSession;
  readonly preparePromptFileForAgent: typeof preparePromptFileForAgent;
  readonly prepareAgentLogFile: typeof prepareAgentLogFile;
}

/**
 * Resolves `CreateAgentExecutorOptions`' agent-runtime collaborator seams (registry lookup, launch
 * resolution, ACP/pi-rpc session attachment, prompt/log file staging) to their real
 * `@jini-ai/agent-runtime` defaults. Split out of `createAgentExecutor` together with
 * {@link resolveProcessDeps}/{@link resolveMiscExecutorDeps}: a flat 14-line `options.x ?? default`
 * sequence was that function's entire cyclomatic-complexity excess (one branch point per default) —
 * grouping the same defaults by concern keeps each resulting function's own complexity low without
 * hiding which options belong together. Pure.
 */
function resolveAgentRuntimeDeps(options: CreateAgentExecutorOptions): ResolvedAgentRuntimeDeps {
  return {
    getAgentDef: options.getAgentDef ?? getAgentDef,
    resolveAgentLaunch: options.resolveAgentLaunch ?? resolveAgentLaunch,
    ensureAgentCapabilities: options.ensureAgentCapabilities ?? ensureAgentCapabilities,
    applyAgentLaunchEnv: options.applyAgentLaunchEnv ?? applyAgentLaunchEnv,
    attachAcpSession: options.attachAcpSession ?? attachAcpSession,
    attachPiRpcSession: options.attachPiRpcSession ?? attachPiRpcSession,
    preparePromptFileForAgent: options.preparePromptFileForAgent ?? preparePromptFileForAgent,
    prepareAgentLogFile: options.prepareAgentLogFile ?? prepareAgentLogFile,
  };
}

interface ResolvedProcessDeps {
  readonly createCommandInvocation: typeof createCommandInvocation;
  readonly spawn: typeof nodeSpawn;
  readonly listProcessSnapshots: typeof listProcessSnapshots;
  readonly collectProcessTreePids: CollectProcessTreePidsPort;
  readonly stopProcesses: StopProcessesPort;
}

/** Resolves the OS-process-facing collaborator seams — see {@link resolveAgentRuntimeDeps}'s doc. Pure. */
function resolveProcessDeps(options: CreateAgentExecutorOptions): ResolvedProcessDeps {
  return {
    createCommandInvocation: options.createCommandInvocation ?? createCommandInvocation,
    spawn: options.spawn ?? nodeSpawn,
    listProcessSnapshots: options.listProcessSnapshots ?? listProcessSnapshots,
    collectProcessTreePids: options.collectProcessTreePids ?? (({ processes, rootPids }) => collectProcessTreePids(processes, rootPids)),
    stopProcesses: options.stopProcesses ?? (({ pids }) => stopProcesses(pids)),
  };
}

interface ResolvedMiscExecutorDeps {
  readonly onCleanupFailure: (context: AgentCleanupFailureContext) => void;
  readonly bufferedStdoutMaxBytes: number;
}

/** Resolves the two remaining defaultable options — see {@link resolveAgentRuntimeDeps}'s doc. Pure. */
function resolveMiscExecutorDeps(options: CreateAgentExecutorOptions): ResolvedMiscExecutorDeps {
  return {
    onCleanupFailure: options.onCleanupFailure ?? defaultCleanupFailureSink,
    bufferedStdoutMaxBytes: options.bufferedStdoutMaxBytes ?? DEFAULT_BUFFERED_STDOUT_MAX_BYTES,
  };
}

// ---------------------------------------------------------------------------
// run() phases
//
// `run()` itself (below `createAgentExecutor`) was a single ~400-line function
// (cyclomatic 63 / cognitive 49) sequencing ~15 guarded pre-spawn steps. Each
// phase here owns one step's decision logic and, where the original step could
// fail, its own `failBeforeSpawn`/`releaseStagedResources` call — so `run()`
// reads as a flat sequence of `const x = await phase(...)` statements with no
// guard clauses of its own. A phase that can fail is typed to return the
// success shape and internally `return deps.failBeforeSpawn(...)` (a
// `Promise<never>`, assignable to any return type) on failure; since
// `failBeforeSpawn` always rejects, `run()` never needs to check the result —
// the `await` alone propagates the rejection exactly as the original inline
// `return failBeforeSpawn(...)` did. Every phase takes its collaborators as
// explicit parameters (no closures over `createAgentExecutor`'s scope), so
// each is independently constructible and testable.
// ---------------------------------------------------------------------------

interface ResolvedDefAndFormat {
  readonly def: RuntimeAgentDef;
  readonly streamFormat: SupportedStreamFormat;
}

/** Phase 1: registry lookup + `assessAgentExecutorCompatibility` guard. */
export async function resolveDefAndStreamFormat({ input, deps }: { readonly input: Pick<AgentExecutorRunInput, 'runId' | 'agentId'>; readonly deps: { readonly getAgentDef: typeof getAgentDef; readonly failBeforeSpawn: FailBeforeSpawn } }
): Promise<ResolvedDefAndFormat> {
  const def = deps.getAgentDef({ id: input.agentId });
  if (!def) {
    return deps.failBeforeSpawn({ runId: input.runId, code: 'AGENT_NOT_FOUND', message: `AgentExecutor: unknown agentId "${input.agentId}"` });
  }
  const compatibility = assessAgentExecutorCompatibility({ def: def });
  if (!compatibility.supported) {
    return deps.failBeforeSpawn({ runId: input.runId, code: 'AGENT_RUNTIME_UNSUPPORTED', message: compatibility.reason });
  }
  return { def, streamFormat: compatibility.streamFormat };
}

/** Phase 2: image-prompt-delivery augmentation + argv-budget guard for argv-bound defs. */
export async function resolveImageDeliveryAndArgvBudget({ input, deps }: { readonly input: {
    readonly runId: string;
    readonly def: RuntimeAgentDef;
    readonly prompt: string;
    readonly imagePaths: readonly string[] | undefined;
    readonly extraAllowedDirs: readonly string[] | undefined;
  }; readonly deps: { readonly failBeforeSpawn: FailBeforeSpawn } }
): Promise<ImagePromptDelivery> {
  const imageDelivery = applyImagePromptDelivery({ imageDelivery: input.def.imageDelivery, prompt: input.prompt, imagePaths: input.imagePaths, extraAllowedDirs: input.extraAllowedDirs });
  const argvBudgetError = checkPromptArgvBudget({ def: input.def, composed: imageDelivery.prompt });
  if (argvBudgetError) {
    return deps.failBeforeSpawn({ runId: input.runId, code: 'AGENT_PROMPT_TOO_LARGE', message: argvBudgetError.message });
  }
  return imageDelivery;
}

/**
 * Phase 3a: the subprocess environment this run's launch resolution and spawn should use — the
 * caller-supplied escape hatch verbatim, or the deny-by-default `BASELINE_AGENT_ENV_KEYS` allowlist.
 * Pure.
 */
export function resolveRunEnv({ input, hostEnv }: { readonly input: Pick<AgentExecutorRunInput, 'env' | 'credentialEnv'>; readonly hostEnv: NodeJS.ProcessEnv }
): Record<string, string> {
  return input.env !== undefined ? toStringEnvRecord(input.env) : buildAgentEnv(hostEnv, input.credentialEnv);
}

/** A resolved launch whose `launchPath` is confirmed non-null — see {@link resolveLaunch}. */
type ConfirmedAgentLaunchResolution = AgentLaunchResolution & { readonly launchPath: string };

/** Phase 3b: launch-path resolution + binary-not-resolved guard. */
export async function resolveLaunch({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly resolvedEnv: Record<string, string> }; readonly deps: { readonly resolveAgentLaunch: typeof resolveAgentLaunch; readonly failBeforeSpawn: FailBeforeSpawn } }
): Promise<ConfirmedAgentLaunchResolution> {
  const launch = deps.resolveAgentLaunch({ def: input.def }, { configuredEnv: input.resolvedEnv });
  if (!launch.launchPath) {
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_BINARY_NOT_RESOLVED', message: `AgentExecutor: could not resolve an executable for agent "${input.def.id}" (bin "${input.def.bin}")` },
    );
  }
  // Narrowed by the guard above; `resolveAgentLaunch`'s own return type still declares
  // `launchPath: string | null` since it can't know this call site already checked.
  return launch as ConfirmedAgentLaunchResolution;
}

/** Phase 4a: stage a `promptViaFile` def's prompt to a temp file (a no-op for every other def). */
export async function stagePromptFile({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly prompt: string }; readonly deps: { readonly preparePromptFileForAgent: typeof preparePromptFileForAgent; readonly failBeforeSpawn: FailBeforeSpawn } }
): Promise<PreparedPromptFile | null> {
  try {
    return await deps.preparePromptFileForAgent({ def: input.def, prompt: input.prompt, label: input.runId });
  } catch (err) {
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not stage a prompt file for agent "${input.def.id}": ${errorMessage(err)}` },
    );
  }
}

/** Phase 4b: stage a `needsAgentLogFile` def's diagnostic-log path (a no-op for every other def). */
export async function stageLogFile({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly preparedPromptFile: PreparedPromptFile | null }; readonly deps: { readonly prepareAgentLogFile: typeof prepareAgentLogFile; readonly failBeforeSpawn: FailBeforeSpawn } }
): Promise<PreparedAgentLogFile | null> {
  try {
    return await deps.prepareAgentLogFile({ def: input.def, label: input.runId });
  } catch (err) {
    await (input.preparedPromptFile ? input.preparedPromptFile.cleanup() : Promise.resolve());
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not stage a log file for agent "${input.def.id}": ${errorMessage(err)}` },
    );
  }
}

/**
 * Phase 6a/10c: the subprocess environment every env-riding mechanism uses — mechanism 3+4
 * (`'opencode-env-content'`/`'mimo-env-content'`, merged into whatever the host already set there,
 * never a CLI argument: the config embeds `JINI_DAEMON_TOKEN`, and process arguments are readable
 * by any other local user through `ps`), mechanism 5 (`'codex-toml'`, `CODEX_HOME` relocation),
 * mechanism 6 (`'env-passthrough'`, the bridge entry's flat env vars set directly with no carrier
 * document — see {@link McpBridgeDelivery}'s own doc), a
 * `systemPromptDelivery: 'env-var'` def's overlay (`reasonix`'s `REASONIX_ACP_SYSTEM_APPEND` today
 * — see `resolveSystemPromptOverlayDelivery`'s own doc), and a `'config-instructions-file'` def's
 * staged overlay file (`opencode` today — see {@link mergeEnvContentInstructions}'s own doc). Pure
 * — `codexHomeDir` and `stagedInstructionsFile` arrive already staged by
 * {@link prepareCodexHomeIfNeeded} and {@link prepareSystemPromptOverlayFileIfNeeded} respectively,
 * the only parts of this mechanism that are NOT pure (real `mkdtemp`/`writeFile` calls).
 * @param spawnEnv - The env every other spawn-time step (launch-path resolution, `applyAgentLaunchEnv`) already computed.
 * @param mcpBridge - This run's resolved bridge delivery, or `null` for an unconfigured host / no-strategy def.
 * @param codexHomeDir - The staged scratch `CODEX_HOME` path for a `'codex-toml'` def, or `undefined` for every other run (including a `'codex-toml'` def when `mcpJsonInjection` was never configured — see `prepareCodexHomeIfNeeded`'s own gate).
 * @param systemPromptEnvOverrides - `resolveSystemPromptOverlayDelivery`'s `envOverrides` — `{}` (default) for every def but an `'env-var'`-strategy one with an overlay present, in which case it carries that one var. Applied after `codexHomeDir`, so it can never be shadowed by it — the two never share a key (`CODEX_HOME` vs. e.g. `REASONIX_ACP_SYSTEM_APPEND`), so the ordering is a documentation choice, not a correctness one.
 * @param stagedInstructionsFile - `varName` (from the def's own `systemPromptDelivery` declaration) and the staged overlay file's `path`, or `undefined` for every def but a `'config-instructions-file'` one with an overlay present. Merged into `varName`'s value AFTER the `mcp` merge above (reading `envContentApplied`, not the original `spawnEnv`, for that same key) so both a `mcp` entry and an `instructions` entry from the two mechanisms survive together in one document — confirmed live this coexistence is safe (see {@link mergeEnvContentInstructions}'s doc).
 * @complexity O(1) plus `mergeEnvContentMcpConfig`'s and `mergeEnvContentInstructions`'s own `JSON.parse`/`JSON.stringify` cost.
 * @overallScore 100/100
 */
export function computeChildEnv({ spawnEnv, mcpBridge }: { readonly spawnEnv: NodeJS.ProcessEnv; readonly mcpBridge: McpBridgeDelivery | null }, { codexHomeDir, systemPromptEnvOverrides, stagedInstructionsFile, claudeConfigDir }: { readonly codexHomeDir?: string; readonly systemPromptEnvOverrides?: Readonly<Record<string, string>>; readonly stagedInstructionsFile?: { readonly varName: string; readonly path: string }; readonly claudeConfigDir?: string } = {}
): NodeJS.ProcessEnv {
  const envContentApplied =
    mcpBridge?.kind === 'env-content'
      ? {
          ...spawnEnv,
          [mcpBridge.envVarName]: mergeEnvContentMcpConfig({ existingRaw: spawnEnv[mcpBridge.envVarName], entry: mcpBridge.serverEntry }),
        }
      : spawnEnv;
  // `'env-passthrough'` (antigravity): no document, no named carrier variable — the bridge
  // entry's own `env` keys (`JINI_RUN_ID`/`JINI_DAEMON_URL`/`JINI_DAEMON_TOKEN`) are set directly
  // on the child's environment, for the spawned CLI to inherit down to its own globally
  // pre-registered MCP child in turn. See `McpBridgeDelivery`'s own doc for why this def has no
  // config document to merge into at all.
  const envPassthroughApplied =
    mcpBridge?.kind === 'env-passthrough' ? { ...envContentApplied, ...mcpBridge.serverEntry.env } : envContentApplied;
  const instructionsApplied =
    stagedInstructionsFile === undefined
      ? envPassthroughApplied
      : {
          ...envPassthroughApplied,
          [stagedInstructionsFile.varName]: mergeEnvContentInstructions({ existingRaw: envPassthroughApplied[stagedInstructionsFile.varName], instructionsFilePath: stagedInstructionsFile.path }
          ),
        };
  const codexHomeApplied = codexHomeDir === undefined ? instructionsApplied : { ...instructionsApplied, CODEX_HOME: codexHomeDir };
  // Finding 1 of SEC-assistant-env-isolation-2026-09-07: same "only set when staged" shape as
  // codexHomeApplied above — mutually exclusive with it in practice (codexHomeDir is only ever set
  // for a 'codex-toml' bridge, claudeConfigDir only ever for a `claude`-id run), so both existing
  // side by side here is a documentation convenience, not a real collision risk.
  const claudeConfigDirApplied =
    claudeConfigDir === undefined ? codexHomeApplied : { ...codexHomeApplied, CLAUDE_CONFIG_DIR: claudeConfigDir };
  return systemPromptEnvOverrides === undefined ? claudeConfigDirApplied : { ...claudeConfigDirApplied, ...systemPromptEnvOverrides };
}

/**
 * Phase 6b: the `RuntimeContext` `buildArgs` receives — `undefined` unless a file, bridge path, or
 * session id was staged. Pure.
 *
 * `resumeSessionId`/`newSessionId` round-trip a prior run's `RunEndPayload.sessionRef` (see
 * `@jini-ai/protocol`'s doc on that field) back into this run's `RuntimeContext`, letting a
 * `resumesSessionViaCli` def (e.g. claude) continue its own CLI session across turns instead of
 * spawning cold every time. Either one alone must still produce a context — a run supplying ONLY a
 * session id, with no prompt/log file staged and no claude-mcp-json bridge, is exactly the common
 * case for a resumed turn.
 */
export function computeRuntimeContext({ preparedPromptFile, preparedLogFile, mcpBridge }: { readonly preparedPromptFile: PreparedPromptFile | null; readonly preparedLogFile: PreparedAgentLogFile | null; readonly mcpBridge: McpBridgeDelivery | null }, { resumeSessionId, newSessionId }: { readonly resumeSessionId?: string | null; readonly newSessionId?: string } = {}
): RuntimeContext | undefined {
  // Matches claude.ts buildArgs' own `typeof x === 'string' && x` truthiness check, so an empty
  // string or explicit `null` (no resume target yet) is treated as absent here too, rather than
  // manufacturing a context that carries a session field the def would ignore anyway.
  const hasResumeSessionId = typeof resumeSessionId === 'string' && resumeSessionId.length > 0;
  const hasNewSessionId = typeof newSessionId === 'string' && newSessionId.length > 0;
  if (
    !preparedPromptFile
    && !preparedLogFile
    && mcpBridge?.kind !== 'claude-mcp-json'
    && !hasResumeSessionId
    && !hasNewSessionId
  ) {
    return undefined;
  }
  return {
    ...(preparedPromptFile ? { promptFilePath: preparedPromptFile.path } : {}),
    ...(preparedLogFile ? { agentLogFilePath: preparedLogFile.path } : {}),
    // Safe to pass before the file exists: `writeMcpJsonForRun` runs after buildArgs but still
    // before spawn, so the path is real by the time the child process starts.
    ...(mcpBridge?.kind === 'claude-mcp-json' ? { mcpJsonPath: mcpBridge.mcpJsonPath } : {}),
    ...(hasResumeSessionId ? { resumeSessionId } : {}),
    ...(hasNewSessionId ? { newSessionId } : {}),
  };
}

/**
 * Phase 8: the host's `PromptAugmenter.systemOverlay()` result, if configured — see
 * `CreateAgentExecutorOptions.promptAugmenter`'s doc for `turnIndex`'s coarse 0/1 proxy.
 */
function computeSystemPromptOverlay(
  promptAugmenter: PromptAugmenter | undefined,
  agentId: string,
  runtimeContext: RuntimeContext | undefined,
): string | null | undefined {
  return promptAugmenter?.systemOverlay?.({
    agentId,
    turnIndex: runtimeContext?.hasPriorAssistantTurn ? 1 : 0,
  });
}

/** Phase 9a: the def's `buildArgs` 4th argument. Historically omitted when every override was absent;
 * that let defs silently enable auto-approval. Always supply the validated restricted default now. Pure. */
export function buildAgentBuildArgsOptions({ input, systemPromptOverlay }: { readonly input: Pick<AgentExecutorRunInput, 'model' | 'reasoning' | 'permissionMode' | 'disallowedTools' | 'allowedTools' | 'settingSources' | 'settings'>; readonly systemPromptOverlay: string | null | undefined }
): RuntimeBuildOptions | undefined {
  const permissionMode = input.permissionMode ?? 'restricted';
  if (permissionMode !== 'restricted' && permissionMode !== 'bypass') {
    throw new AgentExecutorError({ code: 'AGENT_PERMISSION_MODE_INVALID', message: 'AgentExecutor: permissionMode must be restricted or bypass' });
  }
  const hasOverlay = systemPromptOverlay !== undefined && systemPromptOverlay !== null;
  const options: RuntimeBuildOptions = {
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
    permissionMode,
    ...(input.disallowedTools !== undefined ? { disallowedTools: input.disallowedTools } : {}),
    ...(input.allowedTools !== undefined ? { allowedTools: input.allowedTools } : {}),
    ...(input.settingSources !== undefined ? { settingSources: input.settingSources } : {}),
    ...(input.settings !== undefined ? { settings: input.settings } : {}),
    ...(hasOverlay ? { systemPromptOverlay } : {}),
  };
  return Object.keys(options).length === 0 ? undefined : options;
}

/**
 * **The single dispatch point from a computed system-prompt overlay to its delivery mechanism** —
 * see `RuntimeAgentDef.systemPromptDelivery`'s own doc for the declared shape. Pure and
 * synchronous, mirroring {@link buildMcpBridgeDelivery}'s "keyed off the declared strategy, never
 * off the def's id" contract: a def earns overlay delivery by declaring a strategy, not by being
 * named in this file. That is what makes every def with no declaration work via the fallback
 * without any of their own files being touched.
 *
 * The fallback (no declared strategy — every def but `claude` today) prefixes the overlay directly
 * onto the composed prompt text, clearly delimited from the user's own request. It is gated on
 * session state, not merely on whether an overlay exists: a def that carries its own conversation
 * memory across spawns (`resumesSessionViaCli` / `resumesSessionViaAcpLoad`) persists whatever its
 * session-creating turn sends it — see `RuntimeContext.resumeSessionId`'s own doc: its presence on
 * a run means "continue a prior session", not "start one". Prefixing on every later turn of that
 * same session would therefore bake the overlay into the CLI's own stored history again and again,
 * compounding without bound turn over turn. So the fallback prefixes only when there is no resume
 * target yet (the session's own first turn, or a def with no session memory at all, which never
 * replays anything back at the CLI and so gets it on every turn).
 *
 * `'append-flag'` and `'env-var'` defs are the opposite case: the flag/env var is a fresh,
 * un-stored per-spawn directive — never part of what a resumed session replays — so it is set on
 * every turn unconditionally, exactly `claude`'s pre-existing (now-centralized) behavior before
 * this function existed.
 *
 * @param input.defId - Looks up this def's probed capabilities for an `'append-flag'` strategy's
 * `capabilityKey`. Otherwise unused — the dispatch itself is keyed off `systemPromptDelivery`, per
 * this function's own doc above, never off the id.
 * @param input.systemPromptDelivery - The def's declared strategy, or `undefined` for the fallback.
 * @param input.resumesSessionViaCli - The def's own flag (see `RuntimeAgentDef`'s doc).
 * @param input.resumesSessionViaAcpLoad - The def's own flag (see `RuntimeAgentDef`'s doc).
 * @param input.overlay - The computed `PromptAugmenter.systemOverlay()` result. `null`/`undefined`/
 * empty short-circuits to "no delivery" — byte-identical to no `PromptAugmenter` configured at all.
 * @param input.prompt - The composed prompt `buildArgs` would otherwise receive verbatim.
 * @param input.resumeSessionId - This run's `RuntimeContext.resumeSessionId`; presence means an
 * existing session is being continued, not created.
 * @returns A {@link SystemPromptOverlayDelivery}: the prefix this run's prompt text must carry
 * (`''` unless the fallback applies), that prefix already applied to `input.prompt`, any extra argv
 * to append to whatever `buildArgs` itself returns, and any env var overrides to merge into the
 * spawn env (`{}` for every strategy but `'env-var'`). Every one of `run()`'s four prompt
 * transports consumes this same result — see the interface's own no-double-delivery note.
 * @complexity O(n) in the overlay/prompt lengths — string concatenation only, no I/O.
 * @overallScore 100/100
 */
export function resolveSystemPromptOverlayDelivery(input: {
  readonly defId: string;
  readonly systemPromptDelivery: RuntimeAgentDef['systemPromptDelivery'];
  readonly resumesSessionViaCli: boolean | undefined;
  readonly resumesSessionViaAcpLoad: boolean | undefined;
  readonly overlay: string | null | undefined;
  readonly prompt: string;
  readonly resumeSessionId: string | null | undefined;
}): SystemPromptOverlayDelivery {
  const { defId, systemPromptDelivery, resumesSessionViaCli, resumesSessionViaAcpLoad, overlay, prompt, resumeSessionId } = input;
  if (typeof overlay !== 'string' || overlay.length === 0) {
    return { promptPrefix: '', prompt, extraArgs: [], envOverrides: {} };
  }

  if (systemPromptDelivery?.strategy === 'append-flag') {
    const capabilityKey = systemPromptDelivery.capabilityKey;
    // `!== false`, not a truthiness check: mirrors `claude.ts`'s own pre-existing
    // `agentCapabilities.get('claude') || {}` gate exactly (moved here, not changed) — an
    // undetected/never-probed capability defaults to allowed, and only an EXPLICIT `false` (the
    // `--help` probe ran and did not find the flag) withholds it. `capabilityKey === undefined`
    // (e.g. `pi`'s existing `--append-system-prompt`, trusted unconditionally) always passes, same
    // as an absent key.
    const capabilityOk = capabilityKey === undefined || agentCapabilities.get(defId)?.[capabilityKey] !== false;
    return { promptPrefix: '', prompt, extraArgs: capabilityOk ? [systemPromptDelivery.flag, overlay] : [], envOverrides: {} };
  }

  if (systemPromptDelivery?.strategy === 'env-var') {
    // No capability gate, unlike `'append-flag'`: an unrecognized env var is inert to a CLI (it
    // simply never reads it), never a fatal "unknown option" exit — there is no equivalent hazard
    // to probe-gate against here. Set verbatim, not merged with any existing value — a dedicated
    // single-purpose var, not a shared config channel (see this field's own `types.ts` doc).
    return { promptPrefix: '', prompt, extraArgs: [], envOverrides: { [systemPromptDelivery.varName]: overlay } };
  }

  if (systemPromptDelivery?.strategy === 'config-instructions-file') {
    // Delivered elsewhere, not here: unlike `'append-flag'`/`'env-var'`, this mechanism needs real
    // filesystem I/O (staging the overlay to a temp file — `opencode`'s `instructions` array only
    // accepts a file path or URL, confirmed live, never inline text), which this function's "pure
    // and synchronous" contract cannot perform. `prepareSystemPromptOverlayFileIfNeeded` (a separate
    // async phase in `run()`, gated on this same strategy check) stages the file, and
    // `computeChildEnv` merges its path into the config document via `mergeEnvContentInstructions`.
    // This branch's only job is to make sure the universal prefix fallback below does NOT ALSO run
    // for a def that already has this strategy declared — the same "no double delivery" concern
    // `imageDelivery`'s doc calls out for its own native-vs-fallback split.
    return { promptPrefix: '', prompt, extraArgs: [], envOverrides: {} };
  }

  const isContinuingExistingSession =
    (resumesSessionViaCli === true || resumesSessionViaAcpLoad === true) &&
    typeof resumeSessionId === 'string' &&
    resumeSessionId.length > 0;
  if (isContinuingExistingSession) {
    return { promptPrefix: '', prompt, extraArgs: [], envOverrides: {} };
  }

  // KNOWN TRADE-OFF, deliberate: for a resume-capable def with no `'append-flag'`/`'env-var'`
  // mechanism yet (`codex`, `codebuddy`, `opencode`, `amr` — all four presently on this fallback),
  // the overlay is therefore only injected on the SESSION-CREATING turn, not every turn. A host
  // whose `PromptAugmenter.systemOverlay()` result can change mid-conversation (e.g. a host that
  // lets an operator edit its own stored instructions and re-reads them before every run — see
  // `prompt-augmenter.ts`'s own doc for the seam) will see NO effect from such an edit until a NEW
  // session starts for one of these four defs specifically — a real, silent limitation, not a
  // theoretical one. This is the correct
  // trade against the alternative (re-injecting every turn would bake the overlay into that def's
  // own CLI-persisted session history again and again, compounding without bound) — do not change
  // this gating to "fix" the staleness. The actual fix is giving each of the four its own
  // `'append-flag'`-equivalent `systemPromptDelivery` (an argv flag or an env var, neither of which
  // is part of what a resumed session replays), which removes this limitation entirely for that
  // def. See `reasonix.ts`'s and `opencode.ts`'s module docs for the two already-identified,
  // not-yet-wired native mechanisms.
  const promptPrefix = `${overlay}\n\n---\n\n`;
  return { promptPrefix, prompt: `${promptPrefix}${prompt}`, extraArgs: [], envOverrides: {} };
}

/**
 * Phase 9b: calls the def's `buildArgs`, releasing staged resources and failing the run on a throw.
 *
 * @param input.overlayDelivery - This run's already-resolved overlay decision, computed once in
 * `run()` rather than here. It is resolved upstream because `buildArgs` is only ONE of the four
 * channels that can carry the prompt: the staged prompt file is written *before* this function
 * runs, and stdin/ACP/pi-rpc send theirs *after* spawn. A decision made inside this function could
 * therefore only ever reach the 7 defs whose `buildArgs` reads its first argument at all — the
 * other 17 declare it `_prompt` and discard it, which is exactly how the overlay used to go missing.
 */
export async function buildRunArgs({ input, deps }: { readonly input: {
    readonly runId: string;
    readonly def: RuntimeAgentDef;
    readonly imageDelivery: ImagePromptDelivery;
    readonly imagePaths: readonly string[] | undefined;
    readonly runInput: Pick<AgentExecutorRunInput, 'model' | 'reasoning' | 'permissionMode'>;
    readonly systemPromptOverlay: string | null | undefined;
    readonly overlayDelivery: SystemPromptOverlayDelivery;
    readonly runtimeContext: RuntimeContext | undefined;
  }; readonly deps: { readonly releaseStagedResources: () => Promise<void>; readonly failBeforeSpawn: FailBeforeSpawn } }
): Promise<{ readonly args: string[]; readonly envOverrides: Readonly<Record<string, string>> }> {
  try {
    const delivery = input.overlayDelivery;
    const options = buildAgentBuildArgsOptions({ input: input.runInput, systemPromptOverlay: input.systemPromptOverlay });
    const args = input.def.buildArgs(
      { prompt: delivery.prompt, imagePaths: [...(input.imagePaths ?? [])] }, {
        ...(input.imageDelivery.extraAllowedDirs === undefined ? {} : { extraAllowedDirs: [...input.imageDelivery.extraAllowedDirs] }),
        ...(options === undefined ? {} : { options }),
        ...(input.runtimeContext === undefined ? {} : { runtimeContext: input.runtimeContext }),
      },
    );
    // `'append-flag'` delivery's extra argv (empty for every other def/strategy) is appended after
    // whatever the def's own `buildArgs` returned — safe because it is only ever non-empty for a
    // `promptViaStdin` def with no trailing positional argv (`claude`/`pi` today; see
    // `resolveSystemPromptOverlayDelivery`'s doc for why a future 'append-flag' def must keep that
    // property too). `envOverrides` (non-empty only for `'env-var'` — `reasonix` today) is handed
    // back rather than applied here, since the spawn env isn't finalized until `computeChildEnv`
    // runs, later in `run()`.
    return { args: [...args, ...delivery.extraArgs], envOverrides: delivery.envOverrides };
  } catch (err) {
    await deps.releaseStagedResources();
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not build launch arguments for agent "${input.def.id}": ${errorMessage(err)}` },
    );
  }
}

/**
 * Phase 10b1: `systemPromptDelivery: { strategy: 'config-instructions-file' }`'s one effect —
 * stages the computed overlay to a fresh, run-scoped temp file, so `computeChildEnv` has a real
 * path to merge into that def's `instructions` config array (see
 * {@link mergeEnvContentInstructions}'s own doc for the live verification this mechanism rests on).
 * `null` for every other strategy, an unset `systemPromptDelivery`, or no overlay present at all —
 * byte-identical to before this mechanism existed, matching {@link writeMcpJsonIfNeeded}'s and
 * {@link prepareCodexHomeIfNeeded}'s identical no-op-when-inapplicable gate.
 *
 * `opencode`'s `instructions` field only accepts a file path or a remote URL — confirmed live
 * (2026-09-01): a literal instruction string in the array is silently ignored (no error, just never
 * honored), so an inline-text shortcut is not available and this staging step is load-bearing, not
 * a defensive extra.
 * @param input.def - Only used for its `id`, in the failure message, and its `systemPromptDelivery` declaration.
 * @param input.overlay - The computed `PromptAugmenter.systemOverlay()` result for this run.
 * @complexity O(1) plus one directory creation and one file write.
 * @overallScore 100/100
 */
export async function prepareSystemPromptOverlayFileIfNeeded({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly overlay: string | null | undefined }; readonly deps: { readonly releaseStagedResources: () => Promise<void>; readonly failBeforeSpawn: FailBeforeSpawn } }
): Promise<PreparedSystemPromptOverlayFile | null> {
  if (
    input.def.systemPromptDelivery?.strategy !== 'config-instructions-file' ||
    typeof input.overlay !== 'string' ||
    input.overlay.length === 0
  ) {
    return null;
  }
  try {
    const safeRunId = input.runId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'run';
    const dir = await fsPromises.mkdtemp(join(tmpdir(), `jini-system-prompt-overlay-${safeRunId}-`));
    const filePath = join(dir, 'overlay.md');
    await fsPromises.writeFile(filePath, input.overlay, { encoding: 'utf8', mode: 0o600 });
    return {
      path: filePath,
      cleanup: async () => {
        await fsPromises.rm(dir, { recursive: true, force: true });
      },
    };
  } catch (err) {
    await deps.releaseStagedResources();
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not stage a system-prompt overlay file for agent "${input.def.id}": ${errorMessage(err)}` },
    );
  }
}

/** Phase 11: post-`buildArgs` guard for argv-bound defs whose resolved binary is a Windows shim/.exe — a no-op off-Windows and for non-argv-bound defs. */
export async function guardWindowsCommandLineBudget({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly launchPath: string; readonly args: readonly string[] }; readonly deps: { readonly releaseStagedResources: () => Promise<void>; readonly failBeforeSpawn: FailBeforeSpawn } }
): Promise<void> {
  const windowsBudgetError =
    checkWindowsCmdShimCommandLineBudget({ def: input.def, resolvedBin: input.launchPath, args: input.args }) ??
    checkWindowsDirectExeCommandLineBudget({ def: input.def, resolvedBin: input.launchPath, args: input.args });
  if (windowsBudgetError) {
    await deps.releaseStagedResources();
    await deps.failBeforeSpawn({ runId: input.runId, code: 'AGENT_PROMPT_TOO_LARGE', message: windowsBudgetError.message });
  }
}

/**
 * Phase 12: the real `node:child_process.spawn` call.
 *
 * **Deliberately synchronous, unlike every other phase in this file.** A spawned child can emit
 * `'error'` on the very next microtask tick (Node schedules it eagerly on some failure modes, and a
 * test harness simulating "the child emits 'error' before 'spawn'" does so explicitly via
 * `queueMicrotask`). `run()` must register its `'error'` listeners (`wireChildLifecycle`'s safety net,
 * then `waitForSpawnOrError`'s `child.once('error', reject)`) in the *same synchronous turn* as this
 * spawn call — Node's `EventEmitter` throws synchronously when `'error'` fires with zero listeners
 * attached. Wrapping this call in an `async function` and `await`ing it (as every other phase here
 * does) would insert a microtask tick between spawn and listener registration, occasionally losing
 * that race — confirmed by a real test failure during this refactor (an uncaught `EventEmitter`
 * `'error'` exception) before this function was changed back to a plain, unawaited call returning a
 * result object instead of throwing/rejecting.
 * @returns `{kind:'ok', child}` on success, `{kind:'error', error}` on a synchronous throw from `spawn`
 * — `run()` itself is responsible for cleanup and `failBeforeSpawn` on the error variant, both of
 * which are safe to make asynchronous since no child (and hence no listener race) exists yet.
 * @complexity O(1) plus `spawn`'s own cost.
 */
export function spawnAgentChildProcess({ input, deps }: { readonly input: {
    readonly cwd: string;
    readonly childEnv: NodeJS.ProcessEnv;
    readonly invocation: ReturnType<typeof createCommandInvocation>;
  }; readonly deps: { readonly spawn: typeof nodeSpawn } }
): SpawnAgentChildProcessResult {
  try {
    return {
      kind: 'ok',
      child: deps.spawn(input.invocation.command, input.invocation.args, {
        cwd: input.cwd,
        env: input.childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsVerbatimArguments: input.invocation.windowsVerbatimArguments,
      }),
    };
  } catch (error) {
    return { kind: 'error', error };
  }
}

/** Named predicate replacing an inline `streamFormat === 'acp-json-rpc' || streamFormat === 'pi-rpc'` check — the two formats that own their own prompt/event protocol and skip `wireChildLifecycle`. */
export function isStdinDrivenFormat(args: { readonly streamFormat: SupportedStreamFormat }): args is { readonly streamFormat: ChildDrivenStreamFormat } {
  const { streamFormat } = args;
  return streamFormat !== 'acp-json-rpc' && streamFormat !== 'pi-rpc';
}

/** Phase 13: awaits spawn confirmation, routing a failure through the same `failBeforeSpawn` shape every earlier guard uses. */
export async function confirmChildSpawned({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly child: ChildProcess }; readonly deps: { readonly releaseStagedResources: () => Promise<void>; readonly failBeforeSpawn: FailBeforeSpawn } }
): Promise<void> {
  try {
    await waitForSpawnOrError(input.child);
  } catch (err) {
    await deps.releaseStagedResources();
    await deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: failed to spawn agent "${input.def.id}": ${errorMessage(err)}` },
    );
  }
}

/**
 * Creates the `AgentExecutor` reference implementation: an in-process
 * `RunLifecycle` driver over real (by default) `@jini-ai/agent-runtime`
 * registry lookup, launch resolution, and stream parsing, plus a real
 * `node:child_process.spawn`. Every collaborator is an injectable seam
 * (matching this package's established convention — see
 * `tool-executor.ts`/`run-lifecycle.ts`) so tests can drive a fake child
 * process and a fake registry without touching the filesystem or spawning
 * a real subprocess.
 *
 * @param options.lifecycle - The `RunLifecycle` this executor drives — its `start()` must already have been called for any `runId` passed to `run()`.
 * @returns An `AgentExecutor` whose `run()` never bare-throws (see index.ts module doc's Invariant).
 * @complexity `run()`'s own setup is O(1); steady-state cost is the chosen stream parser's.
 * @overallScore 100/100
 */
export function createAgentExecutor(requiredArgs: Pick<CreateAgentExecutorOptions, "lifecycle">, optionalArgs: Pick<CreateAgentExecutorOptions, "getAgentDef" | "resolveAgentLaunch" | "resolveModelForLaunch" | "ensureAgentCapabilities" | "applyAgentLaunchEnv" | "createCommandInvocation" | "spawn" | "attachAcpSession" | "acpPermissionHandler" | "attachPiRpcSession" | "preparePromptFileForAgent" | "prepareAgentLogFile" | "listProcessSnapshots" | "collectProcessTreePids" | "stopProcesses" | "onCleanupFailure" | "journal" | "continuation" | "classifyFailure" | "mcpJsonInjection" | "claudeConfigDirIsolation" | "claudeConfigDirIsolationEnabled" | "bufferedStdoutMaxBytes" | "promptAugmenter"> = {}): AgentExecutor {
  const options: CreateAgentExecutorOptions = { ...requiredArgs, ...optionalArgs };
  const lifecycle = options.lifecycle;
  const {
    getAgentDef: getAgentDefFn,
    resolveAgentLaunch: resolveAgentLaunchFn,
    ensureAgentCapabilities: ensureAgentCapabilitiesFn,
    applyAgentLaunchEnv: applyAgentLaunchEnvFn,
    attachAcpSession: attachAcpSessionFn,
    attachPiRpcSession: attachPiRpcSessionFn,
    preparePromptFileForAgent: preparePromptFileForAgentFn,
    prepareAgentLogFile: prepareAgentLogFileFn,
  } = resolveAgentRuntimeDeps(options);
  const {
    createCommandInvocation: createCommandInvocationFn,
    spawn: spawnFn,
    listProcessSnapshots: listProcessSnapshotsFn,
    collectProcessTreePids: collectProcessTreePidsFn,
    stopProcesses: stopProcessesFn,
  } = resolveProcessDeps(options);
  const { onCleanupFailure: onCleanupFailureFn, bufferedStdoutMaxBytes } = resolveMiscExecutorDeps(options);
  const journal = options.journal;
  const continuation = options.continuation;
  const classifyFailure = options.classifyFailure;
  const mcpJsonInjection = options.mcpJsonInjection;
  const claudeConfigDirIsolation = options.claudeConfigDirIsolation;
  const claudeConfigDirIsolationEnabled = options.claudeConfigDirIsolationEnabled ?? false;
  const promptAugmenter = options.promptAugmenter;

  /**
   * Transitions `runId` to `'failed'` (idempotent, never resumable — no
   * classifier exists, see index.ts module doc) then rejects with a typed
   * {@link AgentExecutorError}. Every pre-spawn guard in `run()` returns
   * this call directly.
   * @param runId - The run to transition.
   * @param code - The machine-readable failure reason.
   * @param message - The human-readable rejection message.
   * @throws Always — this function never returns normally.
   * @complexity O(1) plus `lifecycle.finish()`'s own cost.
   * @overallScore 100/100
   */
  async function failBeforeSpawn({ runId, code, message }: { readonly runId: string; readonly code: AgentExecutorErrorCode; readonly message: string }): Promise<never> {
    // The reason goes on the run's own stream before `end`, not only into the thrown error: the
    // thrown error reaches the server log, while a chat client sees only this stream. Without it
    // the user got a bare "Run failed". Best-effort: a stream that will not take the event must not
    // stop the run from finishing.
    await lifecycle
      .emit({ runId: runId, input: { event: 'error', data: { message: `The assistant could not start: ${message.replace(/^AgentExecutor:\s*/, '')}` } } })
      .catch(() => undefined);
    await lifecycle.finish({ runId, status: 'failed', code: null, signal: null, resumable: false });
    throw new AgentExecutorError({ code: code, message: message });
  }

  /**
   * `AgentExecutor.run()` — see that interface method's own doc for the
   * public contract. Implementation note on shape: every guard below
   * returns `failBeforeSpawn(...)` directly (a `Promise<never>`, valid
   * wherever `Promise<void>` is expected) rather than `await`-then-`return`,
   * so each failure path reads as a single, obviously-terminal statement.
   * @param input - `{runId, agentId, prompt, cwd, model?, reasoning?, imagePaths?, extraAllowedDirs?, uploadRoot?, env?}` — `runId` must already be `lifecycle.start()`-ed.
   * @throws {@link AgentExecutorError} — see index.ts module doc's Invariant; never a bare `Error`.
   * @complexity O(1) setup (registry lookup, launch resolution, one spawn call); steady-state cost thereafter belongs to {@link wireChildLifecycle}.
   * @overallScore 100/100
   */
  async function run(requiredArgs: Pick<AgentExecutorRunInput, "runId" | "agentId" | "prompt" | "cwd">, optionalArgs: Pick<AgentExecutorRunInput, "model" | "reasoning" | "permissionMode" | "imagePaths" | "imageContents" | "extraAllowedDirs" | "uploadRoot" | "credentialEnv" | "env" | "resumeSessionId" | "newSessionId" | "disallowedTools" | "allowedTools" | "settingSources" | "settings"> = {}): Promise<void> {
  const input: { -readonly [K in keyof AgentExecutorRunInput]: AgentExecutorRunInput[K] } = { ...requiredArgs, ...optionalArgs, permissionMode: optionalArgs.permissionMode ?? 'restricted' };
    if (input.permissionMode !== 'restricted' && input.permissionMode !== 'bypass') {
      return failBeforeSpawn({ runId: input.runId, code: 'AGENT_PERMISSION_MODE_INVALID', message: 'AgentExecutor: permissionMode must be restricted or bypass' });
    }
    const { def, streamFormat } = await resolveDefAndStreamFormat({ input: { runId: input.runId, agentId: input.agentId }, deps: { getAgentDef: getAgentDefFn, failBeforeSpawn } }
    );

    // Computed once, before anything downstream ever looks at "the prompt" or "the allowed
    // dirs" — a no-op (`{prompt: input.prompt, extraAllowedDirs: input.extraAllowedDirs}`,
    // literally unchanged) unless `def.imageDelivery === 'prompt-path'` AND `input.imagePaths`
    // is non-empty, so this can never affect a 'native'-delivery def (ACP, pi-rpc, qoder) or a
    // run with no attachments. See `image-prompt-delivery.ts`'s own doc for the full mechanism;
    // every use of `input.prompt`/`input.extraAllowedDirs` below that reflects what the CLI
    // actually receives reads `imageDelivery.*` instead — the two ACP/pi-rpc `wire*Lifecycle`
    // calls further down deliberately keep reading `input.prompt` verbatim, since those two
    // defs' own native protocol already delivers the image and must never also get this
    // treatment (the double-delivery hazard this mechanism exists to avoid).
    const imageDelivery = await resolveImageDeliveryAndArgvBudget({ input: { runId: input.runId, def, prompt: input.prompt, imagePaths: input.imagePaths, extraAllowedDirs: input.extraAllowedDirs }, deps: { failBeforeSpawn } }
    );

    // Phase 8, hoisted deliberately above EVERY step that writes or sends the prompt. Four
    // different channels carry a prompt in this driver, and they do not all run at the same point:
    // the `promptViaFile` staging below writes its file BEFORE `buildArgs`, `buildArgs` itself runs
    // mid-`run()`, and stdin/ACP/pi-rpc all send theirs AFTER spawn. Resolving the overlay once,
    // here, is what lets all four consume the same decision; resolving it later (as this used to,
    // inside `buildRunArgs`) could only ever reach `buildArgs`, so the 17 defs that discard that
    // argument, plus grok-build's staged file, silently received no overlay at all.
    //
    // `computeSystemPromptOverlay`'s third argument is the pre-staging `RuntimeContext`: it reads
    // only `hasPriorAssistantTurn`, which `computeRuntimeContext` never populates from any of the
    // staged-file/MCP inputs added to the fuller context built further down, so nothing between
    // here and there can change the overlay this returns. Passing the narrower context makes that
    // independence explicit rather than relying on the ordering staying lucky.
    //
    // `turnIndex` is a coarse 0/1 proxy (no exact turn counter exists on this driver) — sufficient
    // because every `PromptAugmenter.systemOverlay()` implementation this seam has today wants the
    // same overlay on every turn, not a first-turn-only one; a caller that needs finer-grained turn
    // numbering can track it itself and ignore this arg.
    const preStagingRuntimeContext = computeRuntimeContext({ preparedPromptFile: null, preparedLogFile: null, mcpBridge: null }, {
      ...(input.resumeSessionId === undefined ? {} : { resumeSessionId: input.resumeSessionId }),
      ...(input.newSessionId === undefined ? {} : { newSessionId: input.newSessionId }),
    });
    const systemPromptOverlay = computeSystemPromptOverlay(promptAugmenter, def.id, preStagingRuntimeContext);
    const overlayDelivery = resolveSystemPromptOverlayDelivery({
      defId: def.id,
      systemPromptDelivery: def.systemPromptDelivery,
      resumesSessionViaCli: def.resumesSessionViaCli,
      resumesSessionViaAcpLoad: def.resumesSessionViaAcpLoad,
      overlay: systemPromptOverlay,
      prompt: imageDelivery.prompt,
      resumeSessionId: preStagingRuntimeContext?.resumeSessionId,
    });

    // The def's own declared env (e.g. claude's `ENABLE_TOOL_SEARCH=false`) is a default the run's
    // env can override. Detection already spawns with it (`detection.ts`); without this the run
    // spawn silently dropped it. Declared by the def itself, so it never widens SEC-001's allowlist.
    const resolvedEnv = { ...(def.env ?? {}), ...resolveRunEnv({ input: input, hostEnv: process.env }) };
    const launch = await resolveLaunch({ input: { runId: input.runId, def, resolvedEnv }, deps: { resolveAgentLaunch: resolveAgentLaunchFn, failBeforeSpawn } }
    );

    const spawnEnv = applyAgentLaunchEnvFn({ env: { ...resolvedEnv }, launch });
    // Resolve from the launch environment before staging or sending any prompt. Pin the same
    // concrete ID that the picker displays; an opaque native route cannot silently start a run.
    try {
      const selection = await (options.resolveModelForLaunch ?? resolveModelForLaunch)({ def, context: {
        executable: launch.launchPath, cwd: input.cwd, env: spawnEnv,
        ...(input.model && input.model !== 'default' ? { model: input.model } : {}),
        ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
        ...(input.settingSources ? { settingSources: input.settingSources } : {}),
        ...(input.settings ? { settings: input.settings } : {}),
      } });
      input.model = selection.model;
    } catch {
      return failBeforeSpawn({ runId: input.runId, code: 'AGENT_MODEL_UNRESOLVED', message: 'AgentExecutor: pick a concrete model; the starting model could not be resolved for this launch.' });
    }
    // Fill the def's `--help` capability gate before `buildArgs` reads it. Without this, only a
    // host that happened to call `detectAgents` in THIS process ever had the gate filled, so e.g.
    // `claude` never got `--include-partial-messages` (no streamed text). Probes once per binary;
    // never rejects (a failed probe keeps the safe no-optional-flags baseline).
    await ensureAgentCapabilitiesFn({ def, launchPath: launch.launchPath, env: spawnEnv });

    // Stage a promptViaFile def's (grok-build) prompt to a temp file before buildArgs runs — its
    // buildArgs throws without runtimeContext.promptFilePath. A no-op (returns null) for every
    // def without promptViaFile: true (preparePromptFileForAgent's own guard).
    //
    // `overlayDelivery.prompt`, not `imageDelivery.prompt`: for a `promptViaFile` def this file IS
    // the prompt transport — its `buildArgs` declares `_prompt` and passes only the path — so the
    // overlay has to be in the bytes written here or the CLI never sees it at all.
    const preparedPromptFile = await stagePromptFile({ input: { runId: input.runId, def, prompt: overlayDelivery.prompt }, deps: { preparePromptFileForAgent: preparePromptFileForAgentFn, failBeforeSpawn } }
    );
    // Stage a needsAgentLogFile def's (antigravity) diagnostic-log path, on the same terms and at
    // the same point as the prompt file above: before buildArgs, since buildArgs is what turns the
    // path into a `--log-file <path>` argument. A no-op (returns null) for every def without
    // `needsAgentLogFile: true` (prepareAgentLogFile's own guard). Sequenced after the prompt file
    // rather than concurrently so the failure path above has exactly one thing to clean up.
    const preparedLogFile = await stageLogFile({ input: { runId: input.runId, def, preparedPromptFile }, deps: { prepareAgentLogFile: prepareAgentLogFileFn, failBeforeSpawn } }
    );

    // Cleaned up after the child exits (wireChildLifecycle/wireAcpLifecycle/wirePiRpcLifecycle's
    // close handlers) and on every pre-spawn/spawn-failure path below — a leaked temp file
    // containing the full prompt, or whatever the CLI chose to write into its log, is a
    // confidentiality gap, not just a disk leak. One composed closure covering both staged files;
    // see `WireChildLifecycleContext.cleanupStagedFiles`'s doc for why they are not two fields.
    /**
     * Set once `writeMcpJsonForRun` has actually written this run's MCP config, so `cleanupStagedFiles`
     * knows there is a file holding a live bearer token to remove. Cleared as it is consumed, so the
     * removal happens exactly once across the several paths that may call the cleanup. Only the
     * `'claude-mcp-json'` mechanism stages a file at all — `'acp-merge'` and `'env-content'` leave
     * nothing on disk, so this stays `undefined` for those.
     */
    let writtenMcpJsonPath: string | undefined;
    const removeMcpJsonFileFn = mcpJsonInjection?.removeFile ?? defaultRemoveMcpJsonFile;
    /**
     * Set once `prepareCodexHomeIfNeeded` has actually staged this run's scratch `CODEX_HOME`, so
     * `cleanupStagedFiles` knows there is a directory holding a copied login credential to remove.
     * Cleared as it is consumed, matching `writtenMcpJsonPath`'s identical single-removal discipline.
     * Only the `'codex-toml'` mechanism stages a directory at all.
     */
    let preparedCodexHome: PreparedCodexHome | null = null;
    /**
     * Set once `prepareClaudeConfigDirIfNeeded` has actually staged this run's scratch
     * `CLAUDE_CONFIG_DIR`, so `cleanupStagedFiles` knows there is a directory (possibly holding a
     * copied login credential) to remove. Cleared as it is consumed, matching `preparedCodexHome`'s
     * identical single-removal discipline. Only a `claude`-id run stages a directory this way.
     */
    let preparedClaudeConfigDir: PreparedClaudeConfigDir | null = null;
    /**
     * Set once `prepareSystemPromptOverlayFileIfNeeded` has actually staged this run's overlay file
     * for a `'config-instructions-file'` def, so `cleanupStagedFiles` knows there is a temp
     * directory to remove. Cleared as it is consumed, matching `preparedCodexHome`'s identical
     * single-removal discipline. Only that one strategy stages a file this way — `null` for every
     * other def/strategy/no-overlay run.
     */
    let preparedSystemPromptOverlayFile: PreparedSystemPromptOverlayFile | null = null;
    const cleanupStagedFiles: () => Promise<void> = async () => {
      if (preparedPromptFile) await preparedPromptFile.cleanup();
      if (preparedLogFile) await preparedLogFile.cleanup();
      if (writtenMcpJsonPath !== undefined) {
        const mcpJsonFileToRemove = writtenMcpJsonPath;
        writtenMcpJsonPath = undefined;
        await removeMcpJsonFileFn({ path: mcpJsonFileToRemove });
      }
      if (preparedCodexHome) {
        const codexHomeToRemove = preparedCodexHome;
        preparedCodexHome = null;
        await codexHomeToRemove.cleanup();
      }
      if (preparedClaudeConfigDir) {
        const claudeConfigDirToRemove = preparedClaudeConfigDir;
        preparedClaudeConfigDir = null;
        await claudeConfigDirToRemove.cleanup();
      }
      if (preparedSystemPromptOverlayFile) {
        const overlayFileToRemove = preparedSystemPromptOverlayFile;
        preparedSystemPromptOverlayFile = null;
        await overlayFileToRemove.cleanup();
      }
    };
    // Resolve this run's MCP bridge delivery once, before buildArgs — the `'claude-mcp-json'`
    // variant's path has to be in `runtimeContext` for that def's own `--mcp-config` argv, and
    // resolving here means the per-run bearer credential is minted exactly once no matter which of
    // the five mechanisms ends up carrying it. `null` for an unconfigured host or a def declaring
    // no strategy — see `buildMcpBridgeDelivery`'s doc.
    const mcpBridge = await resolveMcpBridgeForRun({ input: { runId: input.runId, cwd: input.cwd, def }, deps: { mcpJsonInjection, cleanupStagedFiles, failBeforeSpawn } }
    );

    const runtimeContext = computeRuntimeContext({ preparedPromptFile: preparedPromptFile, preparedLogFile: preparedLogFile, mcpBridge: mcpBridge }, {
      ...(input.resumeSessionId === undefined ? {} : { resumeSessionId: input.resumeSessionId }),
      ...(input.newSessionId === undefined ? {} : { newSessionId: input.newSessionId }),
    }
    );

    // A `runtimeLock` def's buildArgs mutates process-global state its own CLI reads back at
    // startup, so the mutex must be held from before buildArgs until the spawned child has
    // demonstrably consumed it — see `RuntimeLock`'s own doc for the concrete race. Undefined for
    // 23 of 24 defs, in which case nothing below waits on anything.
    const selectedModel = input.model;
    const runtimeLockHold = await acquireRuntimeLockIfConfigured(def, selectedModel);
    // Aborts once the spawned process is gone — or immediately, on a path where no process ever
    // ran — so a def's own handoff watcher can never outlive the run it was polling for.
    const processExitedController = new AbortController();
    /**
     * Releases the runtime lock and cancels any handoff watcher. Safe to call from any number of
     * paths: `AbortController.abort()` after the first is a no-op, and `RuntimeLockHold.release`
     * is idempotent by contract.
     */
    const releaseRuntimeLock = (): void => {
      processExitedController.abort();
      runtimeLockHold?.release();
    };
    /** Both staged-file and lock release, for the pre-spawn/spawn-failure paths that own neither a child nor a close handler. */
    const releaseStagedResources = async (): Promise<void> => {
      releaseRuntimeLock();
      await cleanupStagedFiles();
    };

    // Guarded, like every other step between staging and spawn: a `runtimeLock` def's `buildArgs` is
    // guarded precisely *because* it performs real filesystem writes (antigravity writes its model
    // choice into a shared settings file), so EACCES on a read-only home, ENOSPC, or a malformed
    // existing settings file all reach here as a throw. Unguarded, that escaped `run()` as a bare
    // `Error` — breaking this driver's "never a bare throw, always an `AgentExecutorError`" contract
    // — and left the run `'running'` forever while still holding the process-global mutex and both
    // staged files, so no later run of that def could ever acquire the lock either.
    const { args, envOverrides: systemPromptEnvOverrides } = await buildRunArgs({ input: { runId: input.runId, def, imageDelivery, imagePaths: input.imagePaths, runInput: input, systemPromptOverlay, overlayDelivery, runtimeContext }, deps: { releaseStagedResources, failBeforeSpawn } }
    );

    // Mechanism 1 of 5's one effect — stage this run's own MCP config file (run-scoped, see
    // `mcpJsonPathForRun`) before spawn so the `--mcp-config <path>` argv buildArgs just produced
    // points at a real file. Skipped entirely for the other four mechanisms and whenever no bridge
    // was resolved at all. `writtenMcpJsonPath` is set only once the write actually happens, so
    // `cleanupStagedFiles` knows there is a live-token file to remove afterward.
    writtenMcpJsonPath = await writeMcpJsonIfNeeded({ input: { runId: input.runId, cwd: input.cwd, def, mcpBridge }, deps: { mcpJsonInjection, releaseStagedResources, failBeforeSpawn } }
    );

    // Mechanism 5 of 5's one effect — stage this run's scratch `CODEX_HOME` directory. Skipped
    // entirely for the other four mechanisms and whenever no bridge was resolved at all.
    // `codex.ts`'s `buildArgs` needs no argv change for this (CODEX_HOME is an env var, not a flag),
    // so — unlike the `.mcp.json` staging above — this can run after `buildArgs` with no ordering
    // constraint of its own; it is placed here only to keep the two staging steps adjacent.
    preparedCodexHome = await prepareCodexHomeIfNeeded({ input: { runId: input.runId, def, mcpBridge }, deps: { mcpJsonInjection, hostEnv: process.env, releaseStagedResources, failBeforeSpawn } }
    );
    // Finding 1 of SEC-assistant-env-isolation-2026-09-07's one effect — stage this run's scratch
    // `CLAUDE_CONFIG_DIR` directory. Unconditional for a `claude`-id run (unlike CODEX_HOME above,
    // this does not depend on `mcpJsonInjection` being configured at all — see
    // `prepareClaudeConfigDirIfNeeded`'s own doc for why). Placed here only to stay adjacent to the
    // other pre-`computeChildEnv` staging steps; `claude.ts`'s `buildArgs` needs no argv change for
    // this (CLAUDE_CONFIG_DIR is an env var, not a flag), same as CODEX_HOME.
    preparedClaudeConfigDir = await prepareClaudeConfigDirIfNeeded({ input: { runId: input.runId, def }, deps: {
        enabled: claudeConfigDirIsolationEnabled,
        claudeConfigDirIsolation,
        hostEnv: process.env,
        releaseStagedResources,
        failBeforeSpawn,
      } }
    );
    // `'config-instructions-file'`'s one effect — stage the overlay to a temp file so
    // `computeChildEnv` below has a real path to merge into that def's `instructions` array. A
    // no-op (`null`) for every other def/strategy or a run with no overlay at all. Independent of
    // `mcpBridge`/`preparedCodexHome` above (a different strategy field entirely), so placed here
    // only to stay adjacent to the other pre-`computeChildEnv` staging steps, not for any ordering
    // requirement between them.
    preparedSystemPromptOverlayFile = await prepareSystemPromptOverlayFileIfNeeded({ input: { runId: input.runId, def, overlay: systemPromptOverlay }, deps: { releaseStagedResources, failBeforeSpawn } }
    );
    // Computed only now, not right after `mcpBridge` resolution: mechanism 5's directory path is
    // not known until the staging step directly above actually runs `mkdtemp` (see
    // `McpBridgeDelivery`'s `'codex-toml'` variant doc for why it cannot be pre-computed the way
    // `'claude-mcp-json'`'s deterministic path is). Nothing between the old, earlier call site and
    // here ever read `childEnv`, so moving the call cost nothing.
    const childEnv = computeChildEnv({ spawnEnv: spawnEnv, mcpBridge: mcpBridge }, {
      ...(preparedCodexHome === null ? {} : { codexHomeDir: preparedCodexHome.path }),
      systemPromptEnvOverrides,
      ...(preparedSystemPromptOverlayFile && def.systemPromptDelivery?.strategy === 'config-instructions-file'
        ? { stagedInstructionsFile: { varName: def.systemPromptDelivery.varName, path: preparedSystemPromptOverlayFile.path } }
        : {}),
      ...(preparedClaudeConfigDir === null ? {} : { claudeConfigDir: preparedClaudeConfigDir.path }),
    }
    );

    // Post-buildArgs guard for argv-bound defs whose resolved binary is a
    // Windows .cmd/.bat shim or a direct .exe: a prompt under the raw byte
    // budget can still expand past CreateProcess's command-line cap once
    // quote-escaped. Both are no-ops off-Windows / for non-argv-bound defs.
    await guardWindowsCommandLineBudget({ input: { runId: input.runId, def, launchPath: launch.launchPath, args }, deps: { releaseStagedResources, failBeforeSpawn } }
    );

    const invocation = createCommandInvocationFn({ command: launch.launchPath, args, env: childEnv });

    // Kept a synchronous call (no `await`) on purpose — see `spawnAgentChildProcess`'s own doc for
    // the microtask-timing race this avoids. The error branch's own cleanup/failBeforeSpawn calls are
    // async, which is fine: no child exists yet on that path, so nothing is racing a listener.
    const spawnResult = spawnAgentChildProcess({ input: { cwd: input.cwd, childEnv, invocation }, deps: { spawn: spawnFn } });
    if (spawnResult.kind === 'error') {
      await releaseStagedResources();
      return failBeforeSpawn(
        { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: spawn threw synchronously for agent "${def.id}": ${errorMessage(spawnResult.error)}` },
      );
    }
    const child = spawnResult.child;

    // Registered before the spawn-confirmation await below, for the same reason
    // `wireChildLifecycle` is: a child that exits immediately must not slip past the listener.
    // `'exit'` rather than `'close'` on purpose — a `runtimeLock` guards state the *process* reads,
    // so the process being gone is the release condition, not its stdio pipes draining (which a
    // grandchild inheriting them can delay arbitrarily). A spawn that never produced a process at
    // all emits no `'exit'`, and is covered instead by `releaseStagedResources` on the reject path.
    child.once('exit', releaseRuntimeLock);

    const formatForStdin = { streamFormat };
    const stdinHandle = isStdinDrivenFormat(formatForStdin)
      ? wireChildLifecycle({
          startingModel: input.model!,
          runId: input.runId,
          def,
          streamFormat: formatForStdin.streamFormat,
          child,
          lifecycle,
          listProcessSnapshots: listProcessSnapshotsFn,
          collectProcessTreePids: collectProcessTreePidsFn,
          stopProcesses: stopProcessesFn,
          onCleanupFailure: onCleanupFailureFn,
          cleanupStagedFiles,
          journal,
          continuation,
          classifyFailure,
          bufferedStdoutMaxBytes,
          expectsJiniBridge: writtenMcpJsonPath !== undefined,
        })
      : null;

    await confirmChildSpawned({ input: { runId: input.runId, def, child }, deps: { releaseStagedResources, failBeforeSpawn } });

    // Now — and only now — is there a live process that could consume the locked side effect, so
    // this is where a def's handoff watcher starts. Deliberately not awaited: the whole point is to
    // release the lock as soon as the child confirms the handoff, in parallel with this run
    // continuing. Rejection releases too — a lock stuck open because a watcher threw is strictly
    // worse than releasing early (see `RuntimeLockHold.waitForHandoff`'s own doc).
    armHandoffWatcher({ runtimeLockHold: runtimeLockHold, handoffInput: { logFilePath: preparedLogFile?.path, model: selectedModel, processExited: processExitedController.signal }, release: releaseRuntimeLock }
    );

    if (streamFormat === 'acp-json-rpc') {
      await runAcpDispatch({ input: {
          runId: input.runId,
          agentId: def.id,
          child,
      // `overlayDelivery.promptPrefix` applied to `input.prompt`, NOT `overlayDelivery.prompt`:
      // this call site deliberately sends the raw input prompt rather than the image-delivery
      // rewrite (see `resolveImageDeliveryAndArgvBudget`'s call site above — an ACP def delivers
      // images natively and must never also get `'prompt-path'`'s appended paths), and the prefix
      // is the part of the overlay decision that applies to whatever prompt text a transport was
      // already sending. `''` for `reasonix` (env-var) and any resumed ACP session, so those keep
      // sending byte-identical text and never receive the overlay twice.
          prompt: `${overlayDelivery.promptPrefix}${input.prompt}`,
          cwd: input.cwd,
          model: input.model,
          imagePaths: input.imagePaths ?? [],
          envFormat: def.acpMcpEnvFormat,
          mcpBridge,
        }, deps: {
          lifecycle,
          attachAcpSession: attachAcpSessionFn,
          onPermissionRequest: options.acpPermissionHandler,
          listProcessSnapshots: listProcessSnapshotsFn,
          collectProcessTreePids: collectProcessTreePidsFn,
          stopProcesses: stopProcessesFn,
          onCleanupFailure: onCleanupFailureFn,
          cleanupStagedFiles,
          journal,
          classifyFailure,
          releaseStagedResources,
          failBeforeSpawn,
        } }
      );
      return;
    }

    if (streamFormat === 'pi-rpc') {
      await runPiRpcDispatch({ input: {
          runId: input.runId,
          agentId: def.id,
          child,
          // Same reasoning as the ACP call site above. `pi` declares an `'append-flag'` strategy,
          // so its prefix is `''` and this stays byte-identical to the raw prompt — the overlay
          // rides `--append-system-prompt` instead, exactly once.
          prompt: `${overlayDelivery.promptPrefix}${input.prompt}`,
          cwd: input.cwd,
          model: input.model,
          imagePaths: input.imagePaths ?? [],
          uploadRoot: input.uploadRoot,
        }, deps: {
          lifecycle,
          attachPiRpcSession: attachPiRpcSessionFn,
          listProcessSnapshots: listProcessSnapshotsFn,
          collectProcessTreePids: collectProcessTreePidsFn,
          stopProcesses: stopProcessesFn,
          onCleanupFailure: onCleanupFailureFn,
          cleanupStagedFiles,
          journal,
          classifyFailure,
          releaseStagedResources,
          failBeforeSpawn,
        } }
      );
      return;
    }

    // The overlay reaches stdin only for a def that declares stdin as its prompt transport. The
    // four `plain`-format defs that do not (`aider`/`antigravity`/`deepseek` put the prompt in
    // argv, `grok-build` in a staged file) are still written to and closed here exactly as before,
    // because this driver always spawns with `stdio: ['pipe','pipe','pipe']` and their CLIs need
    // the EOF — but their prompt already carried the overlay through argv or the staged file, so
    // sending the overlaid text here too would deliver it twice. This is the one place the
    // resolver's own `''`-prefix rule is not sufficient on its own: those four defs are on the
    // fallback strategy, so their prefix is genuinely non-empty; what makes stdin the wrong
    // channel for them is the def's declared transport, not the strategy.
    const stdinPrompt = def.promptViaStdin === true ? overlayDelivery.prompt : imageDelivery.prompt;
    if (input.imageContents !== undefined) stdinHandle!.imageContents = input.imageContents;
    writePromptToStdin(def, child, stdinPrompt, stdinHandle!);
  }

  return { run };
}
