import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProcessControlPort, nodeProcessControl, type ProcessFunctions } from '../process.js';
import { nodeAtomicWriter, nodeFileLock } from '../fs.js';

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

describe('node runtime ports over the real platform functions', () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
  const scratch = async (): Promise<string> => { const root = await mkdtemp(join(tmpdir(), 'runtime-ports-')); roots.push(root); return root; };

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
    await expect(access(lockPath)).rejects.toThrow();
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
