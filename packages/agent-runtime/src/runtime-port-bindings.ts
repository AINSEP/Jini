/** @file One binding of the agent runtime to daemon's `AgentRuntimePort` shape, shared by every host (a product, the
 * `server` preset). It imports nothing from daemon: the result is checked with `satisfies AgentRuntimePort` by the host.
 * The runtime's state, host env and definition policies are closed over here, so a launcher never passes them. */
import type {
  AgentLaunchResolution, ModelDiscoveryContext, NativeToolPolicyInput, RunPlanHost, RuntimeAgentDef, RuntimeBuildOptions, RuntimeEnv,
} from '@jini-ai/core/contracts/agents';
import { attachAcpSession, type AttachAcpSessionOptions } from './agent-protocol/acp/session.js';
import { attachPiRpcSession, type PiRpcSessionOptions } from './agent-protocol/pi-rpc/session.js';
import {
  claudeFilesystemRuntimePaths, claudeFilesystemSettings, createClaudeFilesystemSupportProbe, validateFilesystemLaunch, validateReadOnlyExtraDirs,
} from './claude-filesystem-policy.js';
import { createClaudeStreamHandler } from './claude-stream.js';
import { modelIdentityKind } from './core/model-discovery-shared.js';
import { ensureAgentCapabilities } from './detection.js';
import { startupFailureMessage } from './diagnostics.js';
import { userToolchainBinDirs } from './executables.js';
import { createJsonEventStreamHandler } from './json-event-stream.js';
import { applyAgentLaunchEnv } from './launch.js';
import { prepareAgentLogFile } from './log-file.js';
import { getRuntimeModelDiscoveryDeps } from './model-discovery-adapters.js';
import { resolveModelForLaunch } from './model-discovery-native.js';
import { planRun, resolveNativeToolPolicy } from './native-tool-policy.js';
import type { NativeAgentRuntime } from './native-runtime.js';
import { checkPromptArgvBudget, checkWindowsCmdShimCommandLineBudget, checkWindowsDirectExeCommandLineBudget } from './prompt-budget.js';
import { preparePromptFileForAgent } from './prompt-file.js';
import { createQoderStreamHandler } from './qoder-stream.js';
import { bindRuntimeAgentDef } from './runtime-def-binding.js';

type StreamSink = (event: Record<string, unknown>) => void;
type LaunchProbe = { agentId: string; launchPath: string; env: RuntimeEnv };
type PlanningDef = Parameters<typeof planRun>[0]['def'];
type AcpRequired = Pick<AttachAcpSessionOptions, 'child' | 'prompt' | 'send'>;
type PiRequired = Pick<PiRpcSessionOptions, 'child' | 'prompt' | 'send'>;

function bindDefs({ runtime }: { runtime: NativeAgentRuntime }, _optional: Record<string, never> = {}) {
  const { state, codex } = runtime;
  return {
    get: ({ id }: { id: string }) => runtime.getAgentDef({ id }),
    bind: ({ def }: { def: RuntimeAgentDef }) => bindRuntimeAgentDef({ def, state }, { codex }),
    capabilities: ({ defId }: { defId: string }) => state.capabilities.get(defId),
    ensureCapabilities: (required: { def: RuntimeAgentDef; launchPath: string; env: RuntimeEnv }) => ensureAgentCapabilities(required, { state }),
  };
}

function bindLaunch({ runtime }: { runtime: NativeAgentRuntime }, _optional: Record<string, never> = {}) {
  const { state, hostEnv } = runtime;
  return {
    resolve: (required: { def: RuntimeAgentDef }, optional: { configuredEnv?: Record<string, string>; env?: RuntimeEnv } = {}) => runtime.resolveAgentLaunch(required, optional),
    // The toolchain dirs come from this runtime's state and host env, never from the process defaults.
    applyEnv: (required: { env: RuntimeEnv; launch: Pick<AgentLaunchResolution, 'childPathPrepend'> }, optional: { nodeBinDir?: string; appendPathDirs?: string[] } = {}) =>
      applyAgentLaunchEnv(required, { appendPathDirs: userToolchainBinDirs({}, { state, env: hostEnv }), ...optional }),
    toolchainBinDirs: (_required: Record<string, never>, optional: { env?: RuntimeEnv } = {}) => userToolchainBinDirs({}, { env: hostEnv, ...optional, state }),
    hostEnvNames: (): readonly string[] => Object.values(state.executable.envNames),
    planRun: (required: { def: PlanningDef; policy: NativeToolPolicyInput; host?: RunPlanHost }) => planRun(required),
    resolveNativeToolPolicy: (required: { def: { name?: string; fullCliAccessOnly?: boolean }; policy: NativeToolPolicyInput }) => resolveNativeToolPolicy(required),
    promptArgvBudget: (required: { def: RuntimeAgentDef; composed: unknown }, optional: { platform?: NodeJS.Platform } = {}) => checkPromptArgvBudget(required, optional),
    windowsCmdShimBudget: (required: { def: RuntimeAgentDef; resolvedBin: unknown; args: unknown }) => checkWindowsCmdShimCommandLineBudget(required),
    windowsDirectExeBudget: (required: { def: RuntimeAgentDef; resolvedBin: unknown; args: unknown }) => checkWindowsDirectExeCommandLineBudget(required),
    preparePromptFile: (required: { def: RuntimeAgentDef; prompt: string; label: string }) => preparePromptFileForAgent(required),
    prepareLogFile: (required: { def: RuntimeAgentDef; label: string }) => prepareAgentLogFile(required),
  };
}

/** Claude filesystem policy. One support-probe cache per bound runtime. */
function bindFilesystem(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const assertFilesystemSupport = createClaudeFilesystemSupportProbe({});
  return {
    validateLaunch: (required: Parameters<typeof validateFilesystemLaunch>[0]) => validateFilesystemLaunch(required),
    validateReadOnlyExtraDirs: (required: { filesystemRoot: string; dirs: readonly string[] }, optional: { homeDir?: string } = {}) => validateReadOnlyExtraDirs(required, optional),
    assertSupport: (required: LaunchProbe) => assertFilesystemSupport(required),
    createSupportProbe: () => {
      const probe = createClaudeFilesystemSupportProbe({});
      return (required: LaunchProbe) => probe(required);
    },
    runtimePaths: (required: { launchPath: string }) => claudeFilesystemRuntimePaths(required),
    settings: (required: { options: RuntimeBuildOptions }, optional: { platform?: NodeJS.Platform; homeDir?: string; tempDir?: string; uid?: number; realpath?: (path: string) => string } = {}) =>
      claudeFilesystemSettings(required, optional),
  };
}

function bindSessionsAndStreams({ runtime }: { runtime: NativeAgentRuntime }, _optional: Record<string, never> = {}) {
  const { pi } = runtime;
  // The runtime's Pi shutdown grace always applies (explicit host option, else PI_GRACEFUL_SHUTDOWN_MS, else 5000 ms).
  const piGrace = pi.gracefulShutdownMs === undefined ? {} : { gracefulShutdownMs: pi.gracefulShutdownMs };
  return {
    sessions: {
      attachAcp: (required: AcpRequired, optional: Omit<AttachAcpSessionOptions, keyof AcpRequired> = {}) => attachAcpSession(required, optional),
      attachPiRpc: (required: PiRequired, optional: Omit<PiRpcSessionOptions, keyof PiRequired | 'gracefulShutdownMs'> = {}) => attachPiRpcSession(required, { ...optional, ...piGrace }),
    },
    streams: {
      claude: (required: { onEvent: StreamSink }, optional: { costBasis?: 'session' | 'run'; suppressHtmlArtifactsAfterFileWrite?: boolean; nowMs?: () => number } = {}) => createClaudeStreamHandler(required, optional),
      qoder: (required: { onEvent: StreamSink }) => createQoderStreamHandler(required),
      jsonEvents: (required: { kind: string; onEvent: StreamSink }) => createJsonEventStreamHandler(required),
    },
  };
}

/** Bind a native runtime to the launcher's port shape. Every member forwards its arguments unchanged except where a
 * comment above says what the binding adds. @example createAgentRuntimeBindings({ runtime }) satisfies AgentRuntimePort */
export function createAgentRuntimeBindings({ runtime }: { runtime: NativeAgentRuntime }, _optional: Record<string, never> = {}) {
  const { state } = runtime;
  return {
    defs: bindDefs({ runtime }),
    launch: bindLaunch({ runtime }),
    filesystem: bindFilesystem({}),
    models: {
      resolveForLaunch: (required: { def: RuntimeAgentDef; context: ModelDiscoveryContext; effort?: string }, optional: { signal?: AbortSignal } = {}) =>
        resolveModelForLaunch(required, { ...optional, deps: getRuntimeModelDiscoveryDeps({ state }) }),
      identityKind: ({ id }: { id: string }) => modelIdentityKind({ id }),
    },
    ...bindSessionsAndStreams({ runtime }),
    failures: {
      startupMessage: (required: { stage: string; error: unknown }, optional: { exactSecrets?: readonly string[]; notice?: string } = {}) => startupFailureMessage(required, optional),
    },
  };
}
