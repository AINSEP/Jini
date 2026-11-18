import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createFakeChild, createDef, createRig, stopResult, flush, type SpawnPort } from './r8a-rig.js';

/**
 * @file R8a pins written before step 5 edits the launcher (the cases step 0 left open):
 * - R4a: a refusal before anything is acquired fails the run with its code and reason on the run's
 *   stream and touches nothing (no spawn, no lock, no staged file);
 * - R7: two executors with overlapping runs keep their own process, lock and cleanup bookkeeping;
 * - R8: the exact argv and the exact env values a pinned host env produces at spawn.
 * R12 (one recorder per run, one outcome per success / failure / cancel) is already pinned by
 * `__tests__/ai-trace-lifecycle*.test.ts`.
 */

interface SpawnCall { readonly command: string; readonly args: readonly string[]; readonly options: Record<string, unknown> }

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
