import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { RuntimePlatform } from '@jini-ai/core/contracts/runtime';
import type { SpawnFunction } from '@jini-ai/platform/runtime-ports/process';
import { runtimeFixture, type RuntimeFixtureScript } from './runtime-fixture.js';
import { vi } from 'vitest';
import type { AgentLaunchResolution, RuntimeAgentDef, RuntimeLock } from '@jini-ai/core/contracts/agents';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createAgentExecutor } from '../../index.js';
import { fixtureLaunchModel, fixtureModelDiscovery } from './model-discovery-fixture.js';

/**
 * @file Shared rig of the R8a characterization suites: one place that builds an executor around
 * caller-owned process fakes, so a change to how the executor receives them is made here once.
 * `events` records lock and staged-file effects in order.
 */

export interface FakeChild extends EventEmitter {
  pid: number | undefined;
  killed: boolean;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter & { write: () => boolean; end: () => void };
  kill: (signal?: string) => boolean;
}

export function createFakeChild(pid: number | undefined): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write: () => true, end: () => {} });
  child.kill = vi.fn(() => { child.killed = true; return true; });
  return child;
}

export function createDef(overrides: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
  return {
    ...fixtureModelDiscovery,
    id: 'r8a-agent', name: 'R8a Agent', bin: 'r8a-agent', versionArgs: ['--version'], fallbackModels: [],
    buildArgs: () => [], streamFormat: 'plain', promptViaStdin: true, promptInputFormat: 'text',
    ...overrides,
  };
}

export const launchAt = (launchPath: string) => (): AgentLaunchResolution => ({
  selectedPath: launchPath, pathResolvedPath: launchPath, configuredOverridePath: null,
  launchPath, launchKind: 'selected', childPathPrepend: [], diagnostic: null,
});

export const stopResult = { alreadyStopped: false, forcedPids: [], matchedPids: [], remainingPids: [], stoppedPids: [] };

/** Node's own positional spawn shape: the spies keep asserting `(command, args, options)`. */
export type SpawnPort = SpawnFunction;
type StopPort = NonNullable<RuntimeFixtureScript['stopProcesses']>;
type ListPort = NonNullable<RuntimeFixtureScript['listProcessSnapshots']>;

export interface Rig {
  readonly events: string[];
  readonly lifecycle: ReturnType<typeof createRunLifecycle>;
  readonly executor: ReturnType<typeof createAgentExecutor>;
  readonly onCleanupFailure: ReturnType<typeof vi.fn>;
  readonly start: () => Promise<string>;
}

/** An executor wired to caller-owned process fakes; `events` records lock and staged-file effects in order. */
export function createRig(input: {
  readonly def: RuntimeAgentDef;
  readonly spawn: SpawnPort;
  readonly launchPath?: string;
  readonly listProcessSnapshots?: ListPort;
  readonly stopProcesses?: StopPort;
  readonly hostEnv?: NodeJS.ProcessEnv;
  /** The command shell's pinned platform; default Linux. */
  readonly platform?: RuntimePlatform;
}): Rig {
  const events: string[] = [];
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const onCleanupFailure = vi.fn();
  const lock: RuntimeLock = {
    acquire: async () => { events.push('acquire'); return { release: () => { events.push('release'); } }; },
  };
  const def = { ...input.def, runtimeLock: lock, needsAgentLogFile: true } satisfies RuntimeAgentDef;
  const executor = createAgentExecutor({
    lifecycle, hostEnv: input.hostEnv ?? { PATH: '/bin' },
    runtime: runtimeFixture({
      spawn: input.spawn,
      listProcessSnapshots: input.listProcessSnapshots ?? (async () => []),
      stopProcesses: input.stopProcesses ?? (async () => stopResult),
      ...(input.platform ? { platform: input.platform } : {}),
    }),
  }, {
    resolveModelForLaunch: fixtureLaunchModel,
    getAgentDef: ({ id }) => (id === def.id ? def : null),
    resolveAgentLaunch: launchAt(input.launchPath ?? '/fake/bin'), applyAgentLaunchEnv: ({ env }) => env,
    prepareAgentLogFile: (async () => ({ path: '/fake/agent.log', cleanup: async () => { events.push('cleanup'); } })) as never,
    onCleanupFailure,
  });
  const start = async (): Promise<string> => (await lifecycle.start({ contextRef: 'r8a' })).run.id;
  return { events, lifecycle, executor, onCleanupFailure, start };
}

export const flush = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => setImmediate(resolve)); };
