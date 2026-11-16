import { describe, expect, it } from 'vitest';
import type { ProcessControlPort } from '@jini-ai/core/contracts/runtime';
import { createFakeChild, fakeProcessControl, fakeSpawn } from './fakes/process.js';
import { fakeAtomicWriter, fakeFileLock, fakeRuntimePorts, type EffectLog } from './fakes/runtime.js';

/**
 * @file Self-checks for the port fakes (AP12): each fake must record faithfully what it was given,
 * and a deliberately broken adapter must be caught by the same assertions that guard the real binding.
 */

/** The recording contract every {@link ProcessControlPort} stand-in must meet. */
async function exerciseProcessControl(port: ProcessControlPort): Promise<{ stopped: ReadonlyArray<number | null | undefined> | undefined }> {
  let stopped: ReadonlyArray<number | null | undefined> | undefined;
  const watched: ProcessControlPort = { ...port, stopProcesses: async (input) => { stopped = input.pids; return port.stopProcesses(input); } };
  await watched.stopProcesses({ pids: [30, 20, 10] });
  return { stopped };
}

describe('fakeSpawn', () => {
  it('returns the scripted child in the same synchronous turn and records command, args and options', () => {
    const child = createFakeChild({ pid: 1 });
    const { spawn, calls } = fakeSpawn({ children: [child] });
    const returned = spawn({ command: 'agent', args: ['--mode', 'plan'] }, { cwd: '/work' });
    expect(returned).toBe(child);
    expect(returned).not.toBeInstanceOf(Promise);
    expect(calls).toEqual([{ command: 'agent', args: ['--mode', 'plan'], options: { cwd: '/work' } }]);
  });

  it('runs onSpawn before returning so a child event can be queued where a real one would fire', () => {
    const child = createFakeChild({ pid: 2 });
    const order: string[] = [];
    const { spawn } = fakeSpawn({ children: [child] }, { onSpawn: () => order.push('onSpawn') });
    spawn({ command: 'a', args: [] });
    order.push('returned');
    expect(order).toEqual(['onSpawn', 'returned']);
  });

  it('throws what it was told to, and says so when it runs out of children', () => {
    const failure = new Error('EACCES');
    expect(() => fakeSpawn({ children: [] }, { throws: failure }).spawn({ command: 'a', args: [] })).toThrow(failure);
    expect(() => fakeSpawn({ children: [] }).spawn({ command: 'a', args: [] })).toThrow('no scripted child left');
  });
});

describe('fakeProcessControl', () => {
  it('lists the snapshots, counts each list, and records the exact pids of each stop and wait', async () => {
    const { port, calls } = fakeProcessControl({ snapshots: [{ pid: 1, ppid: 0, command: 'init' }] });
    expect(await port.listProcessSnapshots()).toEqual([{ pid: 1, ppid: 0, command: 'init' }]);
    await port.stopProcesses({ pids: [3, 2] });
    await port.waitForProcessExit({ pid: 7 }, { timeoutMs: 10 });
    expect(calls).toEqual({ listed: 1, stopped: [[3, 2]], waited: [{ pid: 7, timeoutMs: 10 }] });
  });

  it('a broken adapter that ignores its pids is caught by the recording contract', async () => {
    const { port } = fakeProcessControl({ snapshots: [] });
    expect((await exerciseProcessControl(port)).stopped).toEqual([30, 20, 10]);
    const broken: ProcessControlPort = { ...port, stopProcesses: async () => ({ alreadyStopped: true, forcedPids: [], matchedPids: [], remainingPids: [], stoppedPids: [] }) };
    const { port: recorder, calls } = fakeProcessControl({ snapshots: [] });
    await exerciseProcessControl({ ...recorder, stopProcesses: broken.stopProcesses });
    expect(calls.stopped).toEqual([]);
  });
});

describe('fakeFileLock and fakeAtomicWriter share one ordered effect log', () => {
  it('records lock, backup, write, unlock in call order, and still unlocks when the write rejects', async () => {
    const log: EffectLog = [];
    const lock = fakeFileLock({ log });
    const writer = fakeAtomicWriter({ log });
    await lock.withFileLock({ lockPath: '/s.lock', run: async () => { await writer.backupOriginalOnce({ filePath: '/s' }); await writer.writeText({ filePath: '/s', content: 'x' }); } });
    expect(log).toEqual(['lock', 'backup:/s', 'text:/s', 'unlock']);

    const failing: EffectLog = [];
    const failure = new Error('write refused');
    const failingWriter = fakeAtomicWriter({ log: failing }, { failOn: 'writeText', failure });
    await expect(fakeFileLock({ log: failing }).withFileLock({ lockPath: '/s.lock', run: () => failingWriter.writeText({ filePath: '/s', content: 'x' }) })).rejects.toBe(failure);
    expect(failing).toEqual(['lock', 'text:/s', 'unlock']);
  });
});

describe('fakeRuntimePorts', () => {
  it('builds every required member, pins the shell, and lets a test replace one member', () => {
    const ports = fakeRuntimePorts();
    expect(Object.keys(ports).sort()).toEqual(['commandShell', 'fileLock', 'log', 'processes', 'spawn', 'writer']);
    expect(ports.commandShell).toEqual({ platform: 'linux', fallbackComSpec: undefined });
    const shell = { platform: 'win32', fallbackComSpec: 'C:\\cmd.exe' } as const;
    expect(fakeRuntimePorts({}, { commandShell: shell }).commandShell).toBe(shell);
  });
});
