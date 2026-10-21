import { EventEmitter } from 'node:events';
import { spawn as realSpawn, type ChildProcess, type spawn as nodeSpawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createAgentRuntimeState, type AgentLaunchResolution, type RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createAgentExecutor } from '../../index.js';
import { prepareSystemPromptOverlayFileIfNeeded } from '../launch.js';
import { fixtureLaunchModel, fixtureModelDiscovery } from './model-discovery-fixture.js';

/**
 * @file The launch composition's own defaults and its staged-file cleanup, through the real
 * executor: the real launch resolver and PATH builder when a host injects none, the real process
 * stopper on cancellation, a refused permission mode, and the system-prompt overlay file a failed
 * spawn must not leave behind.
 */

const scratch = mkdtempSync(join(tmpdir(), 'jini-launch-defaults-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface FakeChild extends EventEmitter {
  pid: number | undefined;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter & { write: () => boolean; end: () => void };
  kill: () => boolean;
}

function createFakeChild(pid: number | undefined): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write: () => true, end: () => {} });
  child.kill = () => true;
  return child;
}

function createDef(overrides: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
  return {
    ...fixtureModelDiscovery,
    id: 'jini-fake-agent', name: 'Fake Agent', bin: 'jini-fake-agent', versionArgs: ['--version'], fallbackModels: [],
    buildArgs: () => [], streamFormat: 'plain', promptViaStdin: true, promptInputFormat: 'text',
    ...overrides,
  };
}

const fixedLaunch = (): AgentLaunchResolution => ({
  selectedPath: '/fake/bin', pathResolvedPath: '/fake/bin', configuredOverridePath: null,
  launchPath: '/fake/bin', launchKind: 'selected', childPathPrepend: [], diagnostic: null,
});

interface SpawnRecord { command: string; env: NodeJS.ProcessEnv }

/** A spawn that records what it was handed and starts `child` (or throws `throws`). */
function recordingSpawn(child: FakeChild, calls: SpawnRecord[], throws?: Error): typeof nodeSpawn {
  return ((command: string, _args: readonly string[], options: { env: NodeJS.ProcessEnv }) => {
    calls.push({ command, env: options.env });
    if (throws) throw throws;
    queueMicrotask(() => child.emit('spawn'));
    return child as unknown as ChildProcess;
  }) as unknown as typeof nodeSpawn;
}

describe('launch defaults (no launch seams injected)', () => {
  it('resolves the agent on the host PATH and spawns it with node and its own directory first on PATH', async () => {
    const binDir = join(scratch, 'bin');
    mkdirSync(binDir, { recursive: true });
    const bin = join(binDir, 'jini-fake-agent');
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    chmodSync(bin, 0o755);
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
    const child = createFakeChild(4300);
    const calls: SpawnRecord[] = [];
    const def = createDef();
    const executor = createAgentExecutor({ lifecycle }, {
      hostEnv: { PATH: binDir, HOME: join(scratch, 'home') }, runtimeState: createAgentRuntimeState({}),
      resolveModelForLaunch: fixtureLaunchModel, getAgentDef: ({ id }) => (id === def.id ? def : null),
      ensureAgentCapabilities: async () => {}, spawn: recordingSpawn(child, calls),
      listProcessSnapshots: async () => [], stopProcesses: async () => ({ alreadyStopped: true, forcedPids: [], matchedPids: [], remainingPids: [], stoppedPids: [] }),
    });
    const { run } = await lifecycle.start({ contextRef: 'defaults' });
    await executor.run({ runId: run.id, agentId: def.id, prompt: 'hi', cwd: scratch });

    expect(calls[0]?.command).toBe(bin);
    expect(String(calls[0]?.env.PATH).split(delimiter).slice(0, 2)).toEqual([dirname(process.execPath), binDir]);
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal({ runId: run.id });
  });

  it('stops the real process tree with the real stopper when a run is cancelled', async () => {
    const sleeper = realSpawn('sleep', ['30'], { stdio: 'ignore' });
    const exited = new Promise<NodeJS.Signals | null>((resolve) => sleeper.once('exit', (_code, signal) => resolve(signal)));
    try {
      const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
      const child = createFakeChild(sleeper.pid);
      const def = createDef();
      const executor = createAgentExecutor({ lifecycle }, {
        hostEnv: {}, resolveModelForLaunch: fixtureLaunchModel, getAgentDef: ({ id }) => (id === def.id ? def : null),
        resolveAgentLaunch: fixedLaunch, applyAgentLaunchEnv: ({ env }) => env, spawn: recordingSpawn(child, []),
        listProcessSnapshots: async () => [{ pid: sleeper.pid!, ppid: 1, command: 'sleep 30' }],
      });
      const { run } = await lifecycle.start({ contextRef: 'cancel' });
      await executor.run({ runId: run.id, agentId: def.id, prompt: 'hi', cwd: scratch });
      await lifecycle.cancel({ runId: run.id });
      expect(await exited).toBe('SIGTERM');
      child.emit('close', null, 'SIGTERM');
      expect((await lifecycle.waitForTerminal({ runId: run.id })).state).toBe('cancelled');
    } finally {
      sleeper.kill('SIGKILL');
    }
  });
});

it('refuses a permission mode other than restricted or bypass before anything is spawned', async () => {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const calls: SpawnRecord[] = [];
  const def = createDef();
  const executor = createAgentExecutor({ lifecycle }, {
    hostEnv: {}, resolveModelForLaunch: fixtureLaunchModel, getAgentDef: ({ id }) => (id === def.id ? def : null),
    resolveAgentLaunch: fixedLaunch, applyAgentLaunchEnv: ({ env }) => env, spawn: recordingSpawn(createFakeChild(4301), calls),
  });
  const { run } = await lifecycle.start({ contextRef: 'mode' });
  // A JavaScript or wire caller is not held to the TypeScript union.
  const permissionMode = 'yolo' as unknown as 'bypass';
  await expect(executor.run({ runId: run.id, agentId: def.id, prompt: 'hi', cwd: scratch }, { permissionMode }))
    .rejects.toMatchObject({ code: 'AGENT_PERMISSION_MODE_INVALID' });
  expect(calls).toEqual([]);
});

it('removes the staged system-prompt overlay file when the spawn itself throws', async () => {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const calls: SpawnRecord[] = [];
  const def = createDef({ systemPromptDelivery: { strategy: 'config-instructions-file', varName: 'FAKE_CONFIG_CONTENT' } });
  const executor = createAgentExecutor({ lifecycle }, {
    hostEnv: {}, resolveModelForLaunch: fixtureLaunchModel, getAgentDef: ({ id }) => (id === def.id ? def : null),
    resolveAgentLaunch: fixedLaunch, applyAgentLaunchEnv: ({ env }) => env,
    spawn: recordingSpawn(createFakeChild(4302), calls, new Error('spawn EACCES')),
    promptAugmenter: { contextKinds: () => [], augmentUserRequest: ({ basePrompt }) => basePrompt, systemOverlay: () => 'Answer briefly.' },
  });
  const { run } = await lifecycle.start({ contextRef: 'overlay' });
  await expect(executor.run({ runId: run.id, agentId: def.id, prompt: 'hi', cwd: scratch }))
    .rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
  const instructions = (JSON.parse(String(calls[0]?.env.FAKE_CONFIG_CONTENT)) as { instructions: string[] }).instructions;
  const overlayFile = instructions.at(-1)!;
  expect(basename(dirname(overlayFile))).toMatch(/^jini-system-prompt-overlay-/);
  expect(existsSync(dirname(overlayFile))).toBe(false);
});

describe('prepareSystemPromptOverlayFileIfNeeded', () => {
  const def = createDef({ systemPromptDelivery: { strategy: 'config-instructions-file', varName: 'FAKE_CONFIG_CONTENT' } });

  it('names the staging directory "run" when the run id has no usable characters', async () => {
    const prefixes: string[] = [];
    const staged = await prepareSystemPromptOverlayFileIfNeeded({ input: { runId: '', def, overlay: 'Be brief.' }, deps: {
      releaseStagedResources: async () => {}, failBeforeSpawn: async ({ message }) => { throw new Error(message); },
      mkdtemp: (prefix) => { prefixes.push(prefix); return mkdtemp(join(scratch, prefix)); },
    } });
    expect(prefixes).toEqual(['jini-system-prompt-overlay-run-']);
    expect(readdirSync(dirname(staged!.path))).toEqual(['overlay.md']);
    await staged!.cleanup();
    expect(existsSync(dirname(staged!.path))).toBe(false);
  });

  it('releases staged resources and fails before spawn when the directory cannot be created', async () => {
    const releaseStagedResources = vi.fn(async () => {});
    const failures: string[] = [];
    await expect(prepareSystemPromptOverlayFileIfNeeded({ input: { runId: 'r1', def, overlay: 'Be brief.' }, deps: {
      releaseStagedResources,
      failBeforeSpawn: async ({ code, message }) => { failures.push(`${code}: ${message}`); throw new Error(message); },
      mkdtemp: async () => { throw new Error('ENOSPC: no space left on device'); },
    } })).rejects.toThrow('could not stage a system-prompt overlay file');
    expect(releaseStagedResources).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([
      'AGENT_SPAWN_FAILED: AgentExecutor: could not stage a system-prompt overlay file for agent "jini-fake-agent": ENOSPC: no space left on device',
    ]);
  });
});
