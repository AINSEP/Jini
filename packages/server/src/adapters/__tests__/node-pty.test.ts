import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ensureSpawnHelperExecutable as EnsureSpawnHelperExecutableFn, spawnHelperCandidatePaths as SpawnHelperCandidatePathsFn } from '@jini-ai/platform';
import type { PtyProcess, PtySpawnOptions } from '@jini-ai/core/contracts/runtime';
import { createTerminalSessionManager } from '@jini-ai/daemon';
import { createTerminalService } from '@jini-ai/platform';
import { loadRealSpawnPty } from '../node-pty.js';

// `loadRealSpawnPty` touches the real filesystem (`ensureSpawnHelperExecutable`) and dynamically
// imports the real `node-pty` addon — mocked out here so the daemon test suite never spawns a
// real OS process or mutates real files on disk, matching this codebase's "no real subprocess or
// filesystem by default in tests" convention (see `agent-executor`'s injectable `spawn`).
const spawnHelperCandidatePathsMock = vi.fn<typeof SpawnHelperCandidatePathsFn>(() => ['/fake/candidate/spawn-helper']);
const ensureSpawnHelperExecutableMock = vi.fn<typeof EnsureSpawnHelperExecutableFn>();
vi.mock('@jini-ai/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@jini-ai/platform')>();
  return {
    ...actual,
    spawnHelperCandidatePaths: (...args: Parameters<typeof actual.spawnHelperCandidatePaths>) => spawnHelperCandidatePathsMock(...args),
    ensureSpawnHelperExecutable: (...args: Parameters<typeof actual.ensureSpawnHelperExecutable>) => ensureSpawnHelperExecutableMock(...args),
  };
});

class FakeIPty {
  dataListener: ((chunk: string) => void) | null = null;
  exitListener: ((event: { exitCode: number; signal?: number }) => void) | null = null;
  writeCalls: string[] = [];
  resizeCalls: Array<[number, number]> = [];
  killCalls: Array<string | undefined> = [];

  onData(cb: (chunk: string) => void) {
    this.dataListener = cb;
    return { dispose: () => {} };
  }
  onExit(cb: (event: { exitCode: number; signal?: number }) => void) {
    this.exitListener = cb;
    return { dispose: () => {} };
  }
  write(input: string): void {
    this.writeCalls.push(input);
  }
  resize(cols: number, rows: number): void {
    this.resizeCalls.push([cols, rows]);
  }
  kill(signal?: string): void {
    this.killCalls.push(signal);
  }
  emitData(chunk: string): void {
    this.dataListener?.(chunk);
  }
  emitExit(exitCode: number, signal?: number): void {
    this.exitListener?.(signal === undefined ? { exitCode } : { exitCode, signal });
  }
}

const nodePtySpawnMock = vi.fn<(shell: string, args: string[], options: PtySpawnOptions) => FakeIPty>();
vi.mock('node-pty', () => ({
  spawn: (shell: string, args: string[], options: PtySpawnOptions) => nodePtySpawnMock(shell, args, options),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const alice = { id: 'alice' };

describe('loadRealSpawnPty', () => {
  it('repairs the spawn-helper executable bit using a resolver anchored at this module before the first import, and adapts a real IPty to PtyProcess', async () => {
    const fakePty = new FakeIPty();
    nodePtySpawnMock.mockReturnValue(fakePty);

    const spawnPty = await loadRealSpawnPty({  });

    expect(ensureSpawnHelperExecutableMock).toHaveBeenCalledWith({}, { candidatePaths: ['/fake/candidate/spawn-helper'] });
    const [candidatesCallOptions] = spawnHelperCandidatePathsMock.mock.calls[0]!;
    expect(typeof candidatesCallOptions?.resolve).toBe('function');
    // The injected resolver must actually resolve something (this module's own `node-pty`
    // dependency), not silently no-op — proving it is anchored at `@jini-ai/server`, which declares
    // `node-pty`, rather than `@jini-ai/platform`'s own default resolver, which would throw since
    // that package deliberately does not depend on `node-pty`.
    expect(candidatesCallOptions!.resolve!('node-pty')).toEqual(expect.stringContaining('node-pty'));

    const process: PtyProcess = spawnPty('/bin/bash', ['-l'], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: '/work',
      env: {},
    });
    expect(nodePtySpawnMock).toHaveBeenCalledWith('/bin/bash', ['-l'], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: '/work',
      env: {},
    });

    const dataChunks: string[] = [];
    process.onData((chunk) => dataChunks.push(chunk));
    fakePty.emitData('hello');
    expect(dataChunks).toEqual(['hello']);

    const exits: Array<{ exitCode: number; signal?: number }> = [];
    process.onExit((event) => exits.push(event));
    fakePty.emitExit(0, 15);
    expect(exits).toEqual([{ exitCode: 0, signal: 15 }]);

    process.write('echo hi\n');
    expect(fakePty.writeCalls).toEqual(['echo hi\n']);

    process.resize(100, 40);
    expect(fakePty.resizeCalls).toEqual([[100, 40]]);

    process.kill('SIGTERM');
    expect(fakePty.killCalls).toEqual(['SIGTERM']);
    process.kill();
    expect(fakePty.killCalls).toEqual(['SIGTERM', undefined]);
  });
});

describe('loadRealSpawnPty feeding a session manager', () => {
  it('uses the host-injected native loader through a host-built service', async () => {
    const fakePty = new FakeIPty();
    nodePtySpawnMock.mockReturnValue(fakePty);
    const terminalService = createTerminalService({ loadSpawnPty: () => loadRealSpawnPty({}), maxEvents: 10, maxBufferBytes: 1024, exitTailBytes: 256, flushIntervalMs: 1, flushThresholdBytes: 64, shutdownGraceMs: 1 });
    const manager = createTerminalSessionManager({ terminalService });
    const session = await manager.create({ principal: alice, options: { cwd: '/work' } });
    expect(session.status).toBe('running');
    expect(nodePtySpawnMock).toHaveBeenCalledTimes(1);
  });
});
