import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn as realSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { listProcessSnapshots, stopProcesses, waitForProcessExit } from '@jini-ai/platform/process';
import { createProcessControlPort, createSpawnPort, nodeCommandShell, type ProcessFunctions } from '../process.js';
import { backupOriginalOnce, withFileLock, writeFileAtomicAsync, writeJsonFileAtomicAsync } from '@jini-ai/platform/fs';
import { createAtomicWriterPort, createFileLockPort } from '../fs.js';

/** The host-side binding a Node host performs: platform's functions handed to the builders. */
const nodeFileLock = createFileLockPort({ withFileLock });
const nodeAtomicWriter = createAtomicWriterPort({ writeFileAtomicAsync, writeJsonFileAtomicAsync, backupOriginalOnce });

const stopped = { alreadyStopped: false, forcedPids: [], matchedPids: [3], remainingPids: [], stoppedPids: [3] };

function recordingFunctions() {
  const functions = {
    listProcessSnapshots: vi.fn(async () => [{ pid: 1, ppid: 0, command: 'init' }]),
    stopProcesses: vi.fn(async (_pids: Array<number | null | undefined>) => stopped),
    waitForProcessExit: vi.fn(async (_pid: number | null | undefined, _timeoutMs?: number) => true),
  } satisfies ProcessFunctions;
  return functions;
}

describe('createProcessControlPort argument shapes', () => {
  it('hands stopProcesses a new array with the same pids, in order', async () => {
    const functions = recordingFunctions();
    const port = createProcessControlPort({ functions });
    const pids = [3, 2, 1] as const;
    await expect(port.stopProcesses({ pids })).resolves.toBe(stopped);
    const received = functions.stopProcesses.mock.calls[0]![0];
    expect(received).toEqual([3, 2, 1]);
    expect(received).not.toBe(pids);
    received.push(9);
    expect(pids).toEqual([3, 2, 1]);
  });

  it('passes the pid positionally and leaves an absent timeout undefined so the platform default applies', async () => {
    const functions = recordingFunctions();
    const port = createProcessControlPort({ functions });
    await port.waitForProcessExit({ pid: 7 });
    await port.waitForProcessExit({ pid: 7 }, {});
    await port.waitForProcessExit({ pid: 7 }, { timeoutMs: 10 });
    await port.waitForProcessExit({ pid: null });
    expect(functions.waitForProcessExit.mock.calls).toEqual([[7, undefined], [7, undefined], [7, 10], [null, undefined]]);
  });

  it('calls listProcessSnapshots with an empty first object and forwards the options', async () => {
    const functions = recordingFunctions();
    const port = createProcessControlPort({ functions });
    await port.listProcessSnapshots();
    await port.listProcessSnapshots({}, { timeoutMs: 5, commandLines: true });
    expect(functions.listProcessSnapshots.mock.calls).toEqual([[{}, {}], [{}, { timeoutMs: 5, commandLines: true }]]);
  });
});

describe('createSpawnPort argument shape', () => {
  const child = { pid: 42 } as ChildProcess;

  it('hands spawn the command, a new mutable copy of the args, and the options, and returns the child itself', () => {
    const spawn = vi.fn((_command: string, _args: string[], _options: SpawnOptions) => child);
    const port = createSpawnPort({ spawn });
    const args = ['--mode', 'plan', 'a b'] as const;
    const options: SpawnOptions = { cwd: '/work', stdio: 'pipe' };
    expect(port({ command: '/bin/agent', args }, options)).toBe(child);
    const [command, received, passed] = spawn.mock.calls[0]!;
    expect(command).toBe('/bin/agent');
    expect(received).toEqual(['--mode', 'plan', 'a b']);
    expect(received).not.toBe(args);
    expect(passed).toBe(options);
  });

  it('defaults absent options to an empty object, and returns synchronously (never a promise)', () => {
    const spawn = vi.fn((_command: string, _args: string[], _options: SpawnOptions) => child);
    const result = createSpawnPort({ spawn })({ command: 'x', args: [] });
    expect(spawn.mock.calls[0]![2]).toEqual({});
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('lets a throwing spawn throw in the same turn', () => {
    const port = createSpawnPort({ spawn: () => { throw new Error('EACCES'); } });
    expect(() => port({ command: 'x', args: [] })).toThrow('EACCES');
  });
});

describe('nodeCommandShell', () => {
  it('states the running platform by default, takes the ComSpec from the env the host passes, and a given platform wins', () => {
    expect(nodeCommandShell({ env: { ComSpec: 'C:\\cmd.exe' } })).toEqual({ platform: process.platform, fallbackComSpec: 'C:\\cmd.exe' });
    expect(nodeCommandShell({ env: { ComSpec: 'C:\\cmd.exe' } }, { platform: 'win32' })).toEqual({ platform: 'win32', fallbackComSpec: 'C:\\cmd.exe' });
    expect(nodeCommandShell({ env: {} }, { platform: 'linux' })).toEqual({ platform: 'linux', fallbackComSpec: undefined });
  });
});

describe('node runtime ports over the real platform functions', () => {
  // The port a Node host builds: platform's functions injected into the adapter.
  const nodeProcessControl = createProcessControlPort({ functions: { listProcessSnapshots, stopProcesses, waitForProcessExit } });
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
  const scratch = async (): Promise<string> => { const root = await mkdtemp(join(tmpdir(), 'runtime-ports-')); roots.push(root); return root; };

  // Moved from daemon's launch-defaults suite: daemon no longer defaults to the real stopper, so the
  // proof that the real one stops a live process lives with the binding that owns it.
  it('stopProcesses stops a live process with SIGTERM', async () => {
    const sleeper = realSpawn('sleep', ['30'], { stdio: 'ignore' });
    const exited = new Promise<NodeJS.Signals | null>((resolve) => sleeper.once('exit', (_code, signal) => resolve(signal)));
    try {
      await expect(nodeProcessControl.stopProcesses({ pids: [sleeper.pid] })).resolves.toMatchObject({ alreadyStopped: false });
      expect(await exited).toBe('SIGTERM');
    } finally {
      sleeper.kill('SIGKILL');
    }
  });

  it('stopProcesses with only unusable pids reports alreadyStopped without touching anything', async () => {
    await expect(nodeProcessControl.stopProcesses({ pids: [null, undefined] })).resolves.toMatchObject({ alreadyStopped: true });
  });

  it('waitForProcessExit resolves true for a pid that is not alive', async () => {
    await expect(nodeProcessControl.waitForProcessExit({ pid: null }, { timeoutMs: 10 })).resolves.toBe(true);
  });

  it('lists this very process', async () => {
    const snapshots = await nodeProcessControl.listProcessSnapshots();
    expect(snapshots.some((snapshot) => snapshot.pid === process.pid)).toBe(true);
  });

  it('fileLock runs the callback under the lock path and releases it', async () => {
    const root = await scratch();
    const lockPath = join(root, 'x.lock');
    const seen = await nodeFileLock.withFileLock({ lockPath, run: async () => access(lockPath).then(() => 'held', () => 'absent') });
    expect(seen).toBe('held');
    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writer writes text, writes JSON from the `data` field with a trailing newline, and backs up once', async () => {
    const root = await scratch();
    const filePath = join(root, 's.json');
    await nodeAtomicWriter.writeText({ filePath, content: 'one' });
    expect(await readFile(filePath, 'utf8')).toBe('one');
    await nodeAtomicWriter.writeJson({ filePath, data: { a: 1 } }, { trailingNewline: true });
    expect(await readFile(filePath, 'utf8')).toBe(`${JSON.stringify({ a: 1 }, null, 2)}\n`);
    await nodeAtomicWriter.backupOriginalOnce({ filePath });
    await writeFile(filePath, 'changed');
    await nodeAtomicWriter.backupOriginalOnce({ filePath });
    expect(await readFile(`${filePath}.jini-backup`, 'utf8')).toBe(`${JSON.stringify({ a: 1 }, null, 2)}\n`);
  });
});
