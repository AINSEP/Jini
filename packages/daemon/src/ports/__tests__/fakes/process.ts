import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { ProcessControlPort, ProcessSnapshot, StopProcessesResult } from '@jini-ai/core/contracts/runtime';
import type { ProcessSpawnPort } from '../../process.js';

/** A scriptable stand-in for `ChildProcess`: an `EventEmitter` with the members the executor reads. */
export interface FakeChild extends EventEmitter {
  pid: number | undefined;
  killed: boolean;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter & { write: () => boolean; end: () => void };
  kill: (signal?: string) => boolean;
}

export function createFakeChild(required: { readonly pid: number | undefined }, _optional: Record<string, never> = {}): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = required.pid;
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write: () => true, end: () => {} });
  child.kill = () => { child.killed = true; return true; };
  return child;
}

export interface SpawnCall { readonly command: string; readonly args: readonly string[]; readonly options: Record<string, unknown> }

/**
 * A synchronous {@link ProcessSpawnPort} that records what it was given and returns the next
 * scripted child. `onSpawn` runs inside the call, before it returns, so a test can queue the child's
 * first event exactly where a real child would.
 */
export function fakeSpawn(required: { readonly children: readonly FakeChild[] }, optional: { readonly onSpawn?: (child: FakeChild) => void; readonly throws?: unknown } = {}): { spawn: ProcessSpawnPort; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  let next = 0;
  const spawn: ProcessSpawnPort = ({ command, args }, options = {}) => {
    calls.push({ command, args: [...args], options: { ...options } });
    if (optional.throws !== undefined) throw optional.throws;
    const child = required.children[next++];
    if (child === undefined) throw new Error('fakeSpawn: no scripted child left');
    optional.onSpawn?.(child);
    return child as unknown as ChildProcess;
  };
  return { spawn, calls };
}

const NOTHING_STOPPED: StopProcessesResult = { alreadyStopped: true, forcedPids: [], matchedPids: [], remainingPids: [], stoppedPids: [] };

export interface ProcessControlCalls {
  listed: number;
  readonly stopped: Array<ReadonlyArray<number | null | undefined>>;
  readonly waited: Array<{ pid: number | null | undefined; timeoutMs: number | undefined }>;
}

/** A recording {@link ProcessControlPort} over a fixed snapshot list; `stopResult` is what every stop reports. */
export function fakeProcessControl(required: { readonly snapshots: readonly ProcessSnapshot[] }, optional: { readonly stopResult?: StopProcessesResult; readonly stopFails?: unknown } = {}): { port: ProcessControlPort; calls: ProcessControlCalls } {
  const calls: ProcessControlCalls = { listed: 0, stopped: [], waited: [] };
  const port: ProcessControlPort = {
    listProcessSnapshots: async () => { calls.listed += 1; return [...required.snapshots]; },
    stopProcesses: async ({ pids }) => {
      calls.stopped.push([...pids]);
      if (optional.stopFails !== undefined) throw optional.stopFails;
      return optional.stopResult ?? NOTHING_STOPPED;
    },
    waitForProcessExit: async ({ pid }, { timeoutMs } = {}) => { calls.waited.push({ pid, timeoutMs }); return true; },
  };
  return { port, calls };
}
