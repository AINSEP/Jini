import type { ProcessSnapshot, RuntimePlatform, StopProcessesResult } from '@jini-ai/core/contracts/runtime';
import { nodeAtomicWriter, nodeFileLock } from '@jini-ai/node-adapters/fs';
import { createSpawnPort, nodeCommandShell, nodeProcessControl, nodeSpawnPort, type SpawnFunction } from '@jini-ai/node-adapters/process';
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
