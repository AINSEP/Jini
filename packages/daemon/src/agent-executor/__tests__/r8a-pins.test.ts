import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createAgentExecutor } from '../../index.js';
import { createFakeChild, createDef, createRig, launchAt, stopResult, flush, type SpawnPort } from './r8a-rig.js';
import { fixtureLaunchModel } from './model-discovery-fixture.js';
import { runtimeFixture, agentRuntimeFixture } from './runtime-fixture.js';
import * as childInput from '../child-input.js';

/**
 * @file R8a pins written before step 5 edits the launcher (the cases step 0 left open):
 * - R4a: a refusal before anything is acquired fails the run with its code and reason on the run's
 *   stream and touches nothing (no spawn, no lock, no staged file);
 * - R7: two executors with overlapping runs keep their own process, lock and cleanup bookkeeping;
 * - R8: the exact argv and the exact env values a pinned host env produces at spawn.
 * - Step 4: the antigravity permission grant locks, backs up and writes through the host's `runtime`.
 * R12 (one recorder per run, one outcome per success / failure / cancel) is already pinned by
 * `__tests__/ai-trace-lifecycle*.test.ts`.
 */

interface SpawnCall { readonly command: string; readonly args: readonly string[]; readonly options: Record<string, unknown> }

it('a synchronous spawn failure releases an acquired lock and each staged home once', async () => {
  const order: string[] = [];
  const release = vi.fn(() => { order.push('release-lock'); });
  const cleanupHome = vi.fn(async () => { order.push('cleanup-home'); });
  const cleanupConfig = vi.fn(async () => { order.push('cleanup-config'); });
  const dispatch = vi.spyOn(childInput, 'writePromptToStdin');
  const def = createDef({ externalMcpInjection: 'codex-toml', mcpHttp: true,
    runtimeLock: { acquire: async () => ({ release }) } });
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const agentRuntime = agentRuntimeFixture({ getAgentDef: () => def, resolveModelForLaunch: fixtureLaunchModel,
    resolveAgentLaunch: launchAt('/fake/bin'), applyAgentLaunchEnv: ({ env }) => env });
  const executor = createAgentExecutor({ lifecycle, hostEnv: { PATH: '/bin' },
    runtime: runtimeFixture({ spawn: () => { throw new Error('spawn failed'); } }),
    agentRuntime: { ...agentRuntime, strategies: { for: () => ({
      mcpHome: {
        envVar: 'FIXTURE_HOME', deliveryKind: 'codex-toml',
        buildDelivery: ({ serverEntry }) => ({ kind: 'codex-toml', serverEntry }),
        withStagedHome: ({ env, homeDir }) => ({ ...env, FIXTURE_HOME: homeDir }),
        turnsOffPersonalConfig: () => false,
        stage: async () => { order.push('stage-home'); return { kind: 'staged', home: { path: '/fake/home', cleanup: cleanupHome } }; },
      },
      configDir: { envKey: 'FIXTURE_CONFIG', stage: async () => {
        order.push('stage-config'); return { path: '/fake/config', cleanup: cleanupConfig };
      } },
    }) } },
  }, { claudeConfigDirIsolationEnabled: true, mcpJsonInjection: {
    command: 'fixture', daemonUrl: 'http://daemon.invalid',
    prepareHttp: async () => ({ url: 'http://127.0.0.1:1234/mcp', token: 'fixture', close: async () => {} }),
  } });
  const { run } = await lifecycle.start({ contextRef: 'g06' });
  await expect(executor.run({ runId: run.id, agentId: def.id, prompt: 'hi', cwd: '/work' })).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
  expect(release).toHaveBeenCalledTimes(1);
  expect(cleanupHome).toHaveBeenCalledTimes(1);
  expect(cleanupConfig).toHaveBeenCalledTimes(1);
  expect(order).toEqual(['stage-home', 'stage-config', 'release-lock', 'cleanup-home', 'cleanup-config']);
  expect(dispatch).not.toHaveBeenCalled();
  dispatch.mockRestore();
});

it('an immediate child exit cannot beat lifecycle registration', async () => {
  const child = createFakeChild(8400);
  const rig = createRig({ def: createDef(), spawn: () => {
    queueMicrotask(() => { child.emit('spawn'); child.emit('exit', 0, null); child.emit('close', 0, null); });
    return child as unknown as ChildProcess;
  } });
  const runId = await rig.start();
  await rig.executor.run({ runId, agentId: 'r8a-agent', prompt: 'hi', cwd: '/work' });
  await flush();
  expect(await rig.executor.sendUserMessage({ runId, text: 'late' })).toBe('not-running');
  expect(rig.events.filter((event) => event === 'release')).toEqual(['release']);
});

it('prepare-phase failure before the lock uses cleanupStagedFiles only', async () => {
  const acquire = vi.fn(async () => ({ release: vi.fn() }));
  const close = vi.fn(async () => {});
  const spawn = vi.fn();
  const def = createDef({ externalMcpInjection: 'claude-mcp-json', mcpHttp: true, runtimeLock: { acquire } });
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const agentRuntime = agentRuntimeFixture({ getAgentDef: () => def, resolveModelForLaunch: fixtureLaunchModel,
    resolveAgentLaunch: launchAt('/fake/bin'), applyAgentLaunchEnv: ({ env }) => env });
  const executor = createAgentExecutor({ lifecycle, hostEnv: { PATH: '/bin' }, runtime: runtimeFixture({ spawn }),
    agentRuntime: { ...agentRuntime, strategies: { for: (required) => {
      const slots = agentRuntime.strategies.for(required);
      return { ...slots, ...(slots.mcpConfigFile === undefined ? {} : { mcpConfigFile: {
        ...slots.mcpConfigFile, prepareHttp: async () => { throw new Error('HTTP config staging failed'); },
      } }) };
    } } },
  }, { mcpJsonInjection: { command: 'fixture', daemonUrl: 'http://daemon.invalid',
    prepareHttp: async () => ({ url: 'http://127.0.0.1:1234/mcp', token: 'fixture', close }),
  } });
  const { run } = await lifecycle.start({ contextRef: 'g06' });
  await expect(executor.run({ runId: run.id, agentId: def.id, prompt: 'hi', cwd: '/work' })).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
  expect(acquire).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
  expect(spawn).not.toHaveBeenCalled();
});

function recordingSpawn(children: ReadonlyArray<ReturnType<typeof createFakeChild>>): { spawn: SpawnPort; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawn = ((command: string, args: readonly string[], options: Record<string, unknown>) => {
    const child = children[calls.length]!;
    calls.push({ command, args: [...args], options });
    queueMicrotask(() => child.emit('spawn'));
    return child as unknown as ChildProcess;
  }) as unknown as SpawnPort;
  return { spawn, calls };
}

describe('R4a: a refusal before anything is acquired', () => {
  it('fails the run with the policy code and reason on its stream, and spawns, locks and stages nothing', async () => {
    const { spawn, calls } = recordingSpawn([]);
    const rig = createRig({ def: createDef(), spawn });
    const runId = await rig.start();
    await expect(rig.executor.run({ runId, agentId: 'r8a-agent', prompt: 'hi', cwd: '/work' }, { nativeToolAccess: true, nativeCapabilities: { shell: false } }))
      .rejects.toMatchObject({ code: 'NATIVE_TOOL_POLICY_UNSUPPORTED', message: expect.stringContaining('R8a Agent needs your approval') });
    expect(calls).toHaveLength(0);
    expect(rig.events).toEqual([]);
    expect((await rig.lifecycle.get({ runId }))?.state).toBe('failed');
    const stream: string[] = [];
    await rig.lifecycle.stream({ runId, onEvent: (event) => { if (event.kind === 'error') stream.push(event.payload.error?.code ?? ''); } });
    expect(stream).toEqual(['NATIVE_TOOL_POLICY_UNSUPPORTED']);
  });
});

describe('R7: two executors with overlapping runs', () => {
  it('cancelling one run stops only its own tree and leaves the other run, lock and files untouched', async () => {
    const childA = createFakeChild(8100);
    const childB = createFakeChild(8200);
    const stopA = vi.fn(async (_input: { pids: ReadonlyArray<number | null | undefined> }) => stopResult);
    const stopB = vi.fn(async (_input: { pids: ReadonlyArray<number | null | undefined> }) => stopResult);
    const rigA = createRig({ def: createDef(), spawn: recordingSpawn([childA]).spawn, stopProcesses: stopA });
    const rigB = createRig({ def: createDef(), spawn: recordingSpawn([childB]).spawn, stopProcesses: stopB });
    const [runA, runB] = [await rigA.start(), await rigB.start()];
    await Promise.all([
      rigA.executor.run({ runId: runA, agentId: 'r8a-agent', prompt: 'a', cwd: '/work' }),
      rigB.executor.run({ runId: runB, agentId: 'r8a-agent', prompt: 'b', cwd: '/work' }),
    ]);
    await rigA.lifecycle.cancel({ runId: runA });
    await flush();
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).not.toHaveBeenCalled();
    expect(childB.kill).not.toHaveBeenCalled();
    expect(rigB.events).toEqual(['acquire']);
    childA.emit('exit', null, 'SIGTERM');
    childA.emit('close', null, 'SIGTERM');
    await rigA.lifecycle.waitForTerminal({ runId: runA });
    expect(rigA.events).toEqual(['acquire', 'release', 'cleanup']);
    expect(rigB.events).toEqual(['acquire']);
    childB.emit('exit', 0, null);
    childB.emit('close', 0, null);
    await rigB.lifecycle.waitForTerminal({ runId: runB });
    await flush();
    expect(rigB.events).toEqual(['acquire', 'release', 'cleanup']);
  });
});

describe('R8: argv and env at spawn, for a pinned host env', () => {
  it('hands spawn the def\'s exact argv and exactly the allowlisted env values (nothing else from the host)', async () => {
    const child = createFakeChild(8300);
    const { spawn, calls } = recordingSpawn([child]);
    const rig = createRig({ def: createDef({ buildArgs: () => ['--print', '--model', 'm1'] }), spawn, launchPath: '/opt/agent/bin',
      hostEnv: { PATH: '/bin', HOME: '/home/pinned', CODEX_HOME: '/pinned/codex', SECRET_TOKEN: 'must-not-leak' } });
    const runId = await rig.start();
    await rig.executor.run({ runId, agentId: 'r8a-agent', prompt: 'hi', cwd: '/work' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(['--print', '--model', 'm1']);
    // The pinned host env reaches the child only through the allowlist: PATH and HOME ride along, the
    // codex-only home and the unrelated secret do not.
    expect(calls[0]!.options.env).toEqual({ PATH: '/bin', HOME: '/home/pinned' });
    child.emit('close', 0, null);
    await rig.lifecycle.waitForTerminal({ runId });
  });
});

describe('step 4: the antigravity permission grant runs through the host runtime', () => {
  it('locks, writes the settings and unlocks via runtime.fileLock / runtime.writer, in that order, before the child is spawned', async () => {
    const child = createFakeChild(8400);
    const { spawn, calls } = recordingSpawn([child]);
    const runtime = runtimeFixture({ spawn });
    const def = createDef({ id: 'antigravity', name: 'Antigravity', externalMcpInjection: 'env-passthrough' });
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
    const executor = createAgentExecutor({ lifecycle, hostEnv: { PATH: '/bin' }, runtime, agentRuntime: agentRuntimeFixture({ resolveModelForLaunch: fixtureLaunchModel, getAgentDef: ({ id }) => (id === def.id ? def : null), resolveAgentLaunch: launchAt('/fake/bin'), applyAgentLaunchEnv: ({ env }) => env, ensureAgentCapabilities: async () => {} }) }, { mcpJsonInjection: { command: 'jini-mcp', daemonUrl: 'http://localhost:4317' } });
    const runId = (await lifecycle.start({ contextRef: 'r8a-agy' })).run.id;
    await executor.run({ runId, agentId: def.id, prompt: 'hi', cwd: '/work' }, { nativeCapabilities: { userMcp: true } });
    // Where the settings file lives is the user's home; the order and the ports are what is pinned.
    expect(runtime.log[0]).toBe('lock');
    expect(runtime.log.at(-1)).toBe('unlock');
    expect(runtime.log.filter((entry) => entry.startsWith('text:'))).toHaveLength(1);
    expect(runtime.log.find((entry) => entry.startsWith('text:'))).toMatch(/\.gemini[\\/]antigravity-cli[\\/]settings\.json$/);
    expect(calls).toHaveLength(1);
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal({ runId });
  });
});
