import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createFakeChild, createDef, createRig, stopResult, flush, type FakeChild, type SpawnPort } from './r8a-rig.js';

/**
 * @file R8a step 0: characterization of the executor's process boundary, written against the
 * override options that exist today so the same assertions survive the move to required ports
 * (only the way the fakes are passed changes). Pins, each proven to fail by one local mutation
 * (recorded in cloud-results/daemon-r8a.md):
 * - spawn and listener registration happen in one synchronous turn (R1);
 * - the run's lock is released before its staged files are cleaned, once each (R2);
 * - a cancel lists processes once and stops exactly the child's tree (R5);
 * - failing process ports surface as typed errors or cleanup reports (R6);
 * - every CLI argument reaches spawn, on Linux and on a pinned win32 `.cmd` shim (R14).
 */


describe('R1: spawn and listener registration share one synchronous turn', () => {
  it('a child that emits "error" on the very next microtask is heard, fails the run once, and releases lock then files', async () => {
    const child = createFakeChild(5001);
    const emitFailures: unknown[] = [];
    const spawn = (() => {
      // Queued BEFORE spawn returns: any await between spawn() and the 'error' listener
      // registration lets this microtask run first, with nobody listening (EventEmitter throws).
      queueMicrotask(() => {
        try { child.emit('error', new Error('spawn ENOENT r8a')); }
        catch (error) { emitFailures.push(error); }
      });
      return child as unknown as ChildProcess;
    }) as unknown as SpawnPort;
    const rig = createRig({ def: createDef(), spawn });
    const runId = await rig.start();
    // A lost 'error' leaves run() waiting forever; bound it so the failure is an assertion, not a hang.
    const deadline = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('run() never settled: the error event was lost')), 1500));
    await expect(Promise.race([rig.executor.run({ runId, agentId: 'r8a-agent', prompt: 'hi', cwd: '/work' }), deadline]))
      .rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED', message: expect.stringContaining('spawn ENOENT r8a') });
    expect(emitFailures).toEqual([]);
    expect(rig.events).toEqual(['acquire', 'release', 'cleanup']);
  });
});

describe('R2: lock and staged files outlive run() and are released in order, once', () => {
  it('keeps both while the child lives; on exit the lock goes first, then the files on close', async () => {
    const child = createFakeChild(5002);
    const spawn = (() => { queueMicrotask(() => child.emit('spawn')); return child as unknown as ChildProcess; }) as unknown as SpawnPort;
    const rig = createRig({ def: createDef(), spawn });
    const runId = await rig.start();
    await rig.executor.run({ runId, agentId: 'r8a-agent', prompt: 'hi', cwd: '/work' });
    await flush();
    expect(rig.events).toEqual(['acquire']);
    child.emit('exit', 0, null);
    expect(rig.events).toEqual(['acquire', 'release']);
    child.emit('close', 0, null);
    await rig.lifecycle.waitForTerminal({ runId });
    await flush();
    expect(rig.events).toEqual(['acquire', 'release', 'cleanup']);
  });

  it('on a synchronous spawn failure the lock is released before the staged files are cleaned', async () => {
    const spawn = (() => { throw new Error('EACCES r8a'); }) as unknown as SpawnPort;
    const rig = createRig({ def: createDef(), spawn });
    const runId = await rig.start();
    await expect(rig.executor.run({ runId, agentId: 'r8a-agent', prompt: 'hi', cwd: '/work' }))
      .rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
    expect(rig.events).toEqual(['acquire', 'release', 'cleanup']);
  });
});

describe('R5: cancel stops exactly the child tree', () => {
  it('lists processes once and hands stopProcesses the child and its descendant, not the unrelated process', async () => {
    const child = createFakeChild(6000);
    const spawn = (() => { queueMicrotask(() => child.emit('spawn')); return child as unknown as ChildProcess; }) as unknown as SpawnPort;
    const listProcessSnapshots = vi.fn(async () => [
      { pid: 6000, ppid: 1, command: 'r8a-agent' },
      { pid: 6001, ppid: 6000, command: 'r8a-agent --helper' },
      { pid: 7777, ppid: 1, command: 'unrelated' },
    ]);
    const stopProcesses = vi.fn(async (_input: { pids: ReadonlyArray<number | null | undefined> }) => stopResult);
    const rig = createRig({ def: createDef(), spawn, listProcessSnapshots, stopProcesses });
    const runId = await rig.start();
    await rig.executor.run({ runId, agentId: 'r8a-agent', prompt: 'hi', cwd: '/work' });
    await rig.lifecycle.cancel({ runId });
    await flush();
    expect(listProcessSnapshots).toHaveBeenCalledTimes(1);
    expect(stopProcesses).toHaveBeenCalledTimes(1);
    expect([...stopProcesses.mock.calls[0]![0].pids].sort()).toEqual([6000, 6001]);
    expect(rig.onCleanupFailure).not.toHaveBeenCalled();
    child.emit('close', null, 'SIGTERM');
    await rig.lifecycle.waitForTerminal({ runId });
  });

  it.each([
    ['an Error', new Error('EPERM r8a')],
    ['a non-Error', 'EPERM r8a'],
  ])('reports a stopProcesses failure (%s) and falls back to killing the child directly', async (_label, failure) => {
    const child = createFakeChild(6100);
    const spawn = (() => { queueMicrotask(() => child.emit('spawn')); return child as unknown as ChildProcess; }) as unknown as SpawnPort;
    const stopProcesses = vi.fn(async (): Promise<typeof stopResult> => { throw failure; });
    const rig = createRig({ def: createDef(), spawn, stopProcesses });
    const runId = await rig.start();
    await rig.executor.run({ runId, agentId: 'r8a-agent', prompt: 'hi', cwd: '/work' });
    await rig.lifecycle.cancel({ runId });
    await flush();
    expect(rig.onCleanupFailure).toHaveBeenCalledTimes(1);
    expect(rig.onCleanupFailure.mock.calls[0]![0]).toMatchObject({ runId, pid: 6100 });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('close', null, 'SIGKILL');
    await rig.lifecycle.waitForTerminal({ runId });
  });
});

describe('R6: a failing spawn surfaces as the typed startup error', () => {
  it.each([
    ['an Error', new Error('boom r8a')],
    ['a non-Error', 'boom r8a'],
  ])('spawn throwing %s fails the run with AGENT_SPAWN_FAILED naming the cause', async (_label, failure) => {
    const spawn = (() => { throw failure; }) as unknown as SpawnPort;
    const rig = createRig({ def: createDef(), spawn });
    const runId = await rig.start();
    await expect(rig.executor.run({ runId, agentId: 'r8a-agent', prompt: 'hi', cwd: '/work' }))
      .rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED', message: expect.stringContaining('boom r8a') });
  });
});

describe('R14: every CLI argument reaches spawn', () => {
  const ARGS = ['--mode', 'plan', 'a b', '50%'];

  function recordSpawn(child: FakeChild, calls: Array<{ command: string; args: readonly string[]; options: Record<string, unknown> }>): SpawnPort {
    return ((command: string, args: readonly string[], options: Record<string, unknown>) => {
      calls.push({ command, args: [...args], options });
      queueMicrotask(() => child.emit('spawn'));
      return child as unknown as ChildProcess;
    }) as unknown as SpawnPort;
  }

  it('passes a non-empty argv through unchanged on a POSIX host', async () => {
    const child = createFakeChild(6200);
    const calls: Array<{ command: string; args: readonly string[]; options: Record<string, unknown> }> = [];
    const rig = createRig({ def: createDef({ buildArgs: () => ARGS }), spawn: recordSpawn(child, calls), launchPath: '/opt/agent/bin' });
    const runId = await rig.start();
    await rig.executor.run({ runId, agentId: 'r8a-agent', prompt: 'hi', cwd: '/work' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe('/opt/agent/bin');
    expect(calls[0]!.args).toEqual(ARGS);
    child.emit('close', 0, null);
    await rig.lifecycle.waitForTerminal({ runId });
  });

  it('quotes and percent-escapes (exact golden) and marks verbatim a win32 .cmd shim without dropping an argument', async () => {
    // The shell's platform is a host-stated input, so a Linux run pins win32 without touching `process`.
    const child = createFakeChild(6201);
    const calls: Array<{ command: string; args: readonly string[]; options: Record<string, unknown> }> = [];
    const rig = createRig({ def: createDef({ buildArgs: () => ARGS }), spawn: recordSpawn(child, calls), launchPath: 'C:\\agent\\agent.cmd', platform: 'win32' });
    const runId = await rig.start();
    await rig.executor.run({ runId, agentId: 'r8a-agent', prompt: 'hi', cwd: '/work' });
    expect(calls).toHaveLength(1);
    const spawned = calls[0]!;
    expect(spawned.options.windowsVerbatimArguments).toBe(true);
    // Golden: the planner's exact output today (quoting and the `^%` escape), joined for readability.
    expect(spawned.args.join(' ')).toBe('/d /s /c "C:\\agent\\agent.cmd --mode plan "a b" "50"^%"""');
    child.emit('close', 0, null);
    await rig.lifecycle.waitForTerminal({ runId });
  });
});
