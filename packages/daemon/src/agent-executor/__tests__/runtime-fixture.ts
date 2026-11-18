import { createAgentRuntimeBindings, createNativeAgentRuntime, type AgentRuntimeState } from '@jini-ai/agent-runtime';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import type { AgentRuntimePort } from '../../ports/agent-runtime.js';
import type { ProcessSnapshot, RuntimePlatform, StopProcessesResult } from '@jini-ai/core/contracts/runtime';
import { nodeAtomicWriter, nodeFileLock } from '@jini-ai/platform/runtime-ports/fs';
import { createSpawnPort, nodeCommandShell, nodeProcessControl, nodeSpawnPort, type SpawnFunction } from '@jini-ai/platform/runtime-ports/process';
import type { AgentExecutorRuntimePorts } from '../../ports/runtime.js';
import { fakeRuntimePorts, type EffectLog } from '../../ports/__tests__/fakes/runtime.js';

/**
 * What an executor test scripts: Node's own positional `spawn` shape (a spy keeps asserting
 * `(command, args, options)`), a process table, a stopper, and the pinned command shell. Everything
 * else comes from the shared fakes. The spawn spy is bound by the real platform binding, so these
 * tests also run the object-to-positional adapter the hosts use.
 */
export interface RuntimeFixtureScript {
  readonly spawn?: SpawnFunction;
  readonly listProcessSnapshots?: () => Promise<ProcessSnapshot[]>;
  readonly stopProcesses?: (required: { readonly pids: ReadonlyArray<number | null | undefined> }) => Promise<StopProcessesResult>;
  readonly platform?: RuntimePlatform;
  readonly fallbackComSpec?: string;
}

const NOTHING_STOPPED: StopProcessesResult = { alreadyStopped: true, forcedPids: [], matchedPids: [], remainingPids: [], stoppedPids: [] };

/** A full {@link AgentExecutorRuntimePorts} for an executor test; pinned to Linux unless `platform` says otherwise. */
export function runtimeFixture(script: RuntimeFixtureScript = {}, _optional: Record<string, never> = {}): AgentExecutorRuntimePorts & { readonly log: EffectLog } {
  const base = fakeRuntimePorts();
  return {
    ...base,
    ...(script.spawn ? { spawn: createSpawnPort({ spawn: script.spawn }) } : {}),
    processes: {
      listProcessSnapshots: script.listProcessSnapshots ?? (async () => []),
      stopProcesses: script.stopProcesses ?? (async () => NOTHING_STOPPED),
      waitForProcessExit: async () => true,
    },
    commandShell: { platform: script.platform ?? 'linux', fallbackComSpec: script.fallbackComSpec },
  };
}

/**
 * The real Node bindings, for the few integration tests that run an actual child process. `onSpawn`
 * sees each command and argv the executor hands the port, before the real process starts.
 */
export function nodeRuntime(script: { readonly onSpawn?: (required: { readonly command: string; readonly args: readonly string[] }) => void } = {}, _optional: Record<string, never> = {}): AgentExecutorRuntimePorts {
  const { onSpawn } = script;
  return {
    spawn: onSpawn ? (required, options) => { onSpawn(required); return nodeSpawnPort(required, options); } : nodeSpawnPort,
    processes: nodeProcessControl, fileLock: nodeFileLock, writer: nodeAtomicWriter, commandShell: nodeCommandShell({ env: process.env }),
  };
}

/**
 * What an executor test scripts about the agent runtime: members of the port, in the shapes tests used to inject one by one
 * (a lookup, a launch resolver, a session attach). Anything not scripted is the real binding of a real native runtime
 * (`createAgentRuntimeBindings`), so a test that never scripts a member runs the production path. `runtimeState`,
 * `codexDisablePlugins` and `piGracefulShutdownMs` configure that native runtime, as a host would.
 */
export interface AgentRuntimeScript {
  readonly getAgentDef?: (required: { id: string }) => RuntimeAgentDef | null | undefined;
  readonly resolveAgentLaunch?: AgentRuntimePort['launch']['resolve'];
  readonly ensureAgentCapabilities?: AgentRuntimePort['defs']['ensureCapabilities'];
  readonly applyAgentLaunchEnv?: AgentRuntimePort['launch']['applyEnv'];
  readonly resolveModelForLaunch?: AgentRuntimePort['models']['resolveForLaunch'];
  readonly assertClaudeFilesystemSupport?: AgentRuntimePort['filesystem']['assertSupport'];
  readonly attachAcpSession?: AgentRuntimePort['sessions']['attachAcp'];
  readonly attachPiRpcSession?: AgentRuntimePort['sessions']['attachPiRpc'];
  readonly preparePromptFileForAgent?: AgentRuntimePort['launch']['preparePromptFile'];
  readonly prepareAgentLogFile?: AgentRuntimePort['launch']['prepareLogFile'];
  readonly hostEnvNames?: readonly string[];
  readonly capabilities?: AgentRuntimePort['defs']['capabilities'];
  readonly runtimeState?: AgentRuntimeState;
  readonly codexDisablePlugins?: boolean | undefined;
  readonly piGracefulShutdownMs?: number | undefined;
  readonly planRun?: AgentRuntimePort['launch']['planRun'];
}

/** A full {@link AgentRuntimePort} for an executor test: the real binding, with the scripted members replaced. */
export function agentRuntimeFixture(script: AgentRuntimeScript = {}, optional: { readonly env?: NodeJS.ProcessEnv } = {}): AgentRuntimePort {
  const native = createNativeAgentRuntime({ env: optional.env ?? process.env }, {
    ...(script.runtimeState ? { state: script.runtimeState } : {}),
    ...(script.codexDisablePlugins === undefined ? {} : { codex: { disablePlugins: script.codexDisablePlugins } }),
    ...(script.piGracefulShutdownMs === undefined ? {} : { pi: { gracefulShutdownMs: script.piGracefulShutdownMs } }),
  });
  const real = createAgentRuntimeBindings({ runtime: native }) satisfies AgentRuntimePort;
  const lookup = script.getAgentDef;
  const bindScripted = script.runtimeState !== undefined || native.codex.disablePlugins === true;
  return {
    ...real,
    defs: {
      ...real.defs,
      // The runtime's `get` hands out a definition bound to its state and policies. A scripted lookup is bound the same way only when
      // the script gives the runtime something to bind (an own state or the Codex plugin policy): binding wraps `buildArgs`, which a test of plain argv must not see.
      ...(lookup ? { get: (required: { id: string }) => { const def = lookup(required); return def && bindScripted ? real.defs.bind({ def }) : (def ?? null); } } : {}),
      ...(script.capabilities ? { capabilities: script.capabilities } : {}),
      ...(script.ensureAgentCapabilities ? { ensureCapabilities: script.ensureAgentCapabilities } : {}),
    },
    launch: {
      ...real.launch,
      ...(script.resolveAgentLaunch ? { resolve: script.resolveAgentLaunch } : {}),
      ...(script.applyAgentLaunchEnv ? { applyEnv: script.applyAgentLaunchEnv } : {}),
      ...(script.hostEnvNames ? { hostEnvNames: () => script.hostEnvNames ?? [] } : {}),
      ...(script.preparePromptFileForAgent ? { preparePromptFile: script.preparePromptFileForAgent } : {}),
      ...(script.prepareAgentLogFile ? { prepareLogFile: script.prepareAgentLogFile } : {}),
      ...(script.planRun ? { planRun: script.planRun } : {}),
    },
    filesystem: { ...real.filesystem, ...(script.assertClaudeFilesystemSupport ? { assertSupport: script.assertClaudeFilesystemSupport } : {}) },
    models: { ...real.models, ...(script.resolveModelForLaunch ? { resolveForLaunch: script.resolveModelForLaunch } : {}) },
    sessions: {
      ...real.sessions,
      ...(script.attachAcpSession ? { attachAcp: script.attachAcpSession } : {}),
      ...(script.attachPiRpcSession ? { attachPiRpc: script.attachPiRpcSession } : {}),
    },
  };
}
