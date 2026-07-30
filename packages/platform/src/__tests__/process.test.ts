import { EventEmitter } from 'node:events';
import { closeSync, openSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

// `node:child_process` is mocked with a *passthrough* default: unless a test
// installs `mockState.spawnImpl` / `mockState.execFileImpl`, calls go straight
// to the real implementation. This keeps the happy-path tests exercising real
// subprocesses (matching this package's convention in shell.test.ts and
// terminal.test.ts) while still allowing targeted control of hard-to-trigger
// branches (a spawned child reporting no pid, Windows-only snapshot parsing,
// command failures) without spawning fake OSes.
type ExecFileCallback = (error: (Error & { code?: number | string }) | null, stdout: string, stderr: string) => void;

const mockState = vi.hoisted(() => ({
  execFileImpl: null as ((command: string, args: string[], options: unknown, callback: ExecFileCallback) => void) | null,
  spawnImpl: null as ((command: string, args: string[], options: unknown) => unknown) | null,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: (command: string, args: string[], options: unknown, callback: ExecFileCallback) => {
      if (mockState.execFileImpl) return mockState.execFileImpl(command, args, options, callback);
      return (actual.execFile as unknown as (...a: unknown[]) => unknown)(command, args, options, callback);
    },
    spawn: (command: string, args: string[], options: unknown) => {
      if (mockState.spawnImpl) return mockState.spawnImpl(command, args, options);
      return (actual.spawn as unknown as (...a: unknown[]) => unknown)(command, args, options);
    },
  };
});

import { spawn } from 'node:child_process';

import {
  collectProcessTreePids,
  createProcessStampArgs,
  isProcessAlive,
  listProcessSnapshots,
  matchesProcessStamp,
  matchesStampedProcess,
  readFlagValue,
  readProcessStamp,
  readProcessStampFromCommand,
  spawnBackgroundProcess,
  spawnLoggedProcess,
  stopProcesses,
  waitForProcessExit,
  type ProcessStampContract,
} from '../process.js';

afterEach(() => {
  mockState.execFileImpl = null;
  mockState.spawnImpl = null;
});

async function withPlatformAsync<T>(platform: NodeJS.Platform, run: () => Promise<T>): Promise<T> {
  const previous = process.platform;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return await run();
  } finally {
    Object.defineProperty(process, 'platform', { value: previous });
  }
}

function makeFakeChild(options: { emitError?: Error; pid?: number } = {}): EventEmitter & { pid?: number; unref: () => void } {
  const child = new EventEmitter() as EventEmitter & { pid?: number; unref: () => void };
  // `exactOptionalPropertyTypes` treats "assign undefined" differently from
  // "omit the property" — only assign when a real pid was given.
  if (options.pid !== undefined) child.pid = options.pid;
  child.unref = () => {};
  queueMicrotask(() => {
    if (options.emitError) child.emit('error', options.emitError);
    else child.emit('spawn');
  });
  return child;
}

const tempDirsToClean: string[] = [];

afterEach(async () => {
  while (tempDirsToClean.length > 0) {
    const dir = tempDirsToClean.pop();
    if (dir) await rm(dir, { force: true, recursive: true });
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirsToClean.push(dir);
  return dir;
}

// CR-R6: the real-child SIGTERM/SIGKILL tests below spawn an actual OS process. Track every
// pid the moment it's known — before any assertion that could throw — so a failed assertion or
// an early rejection can never orphan a child; force-killing an already-dead pid is a no-op
// (ESRCH, swallowed below), so this is safe to run unconditionally.
const spawnedPidsToKill: number[] = [];

afterEach(() => {
  while (spawnedPidsToKill.length > 0) {
    const pid = spawnedPidsToKill.pop();
    if (pid == null) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already exited (including via the test's own stopProcesses call) — nothing to clean up.
    }
  }
});

/** Bounded readiness wait for a just-spawned real child (CR-R6): the previous unbounded
 *  `new Promise` here would hang the whole suite forever if 'spawn' never fired. */
function waitForRealChildSpawn(child: ReturnType<typeof spawn>, timeoutMs = 5_000): Promise<void> {
  return new Promise<void>((resolveSpawned, rejectSpawned) => {
    const timer = setTimeout(
      () => rejectSpawned(new Error(`timed out after ${timeoutMs}ms waiting for the child process to spawn`)),
      timeoutMs,
    );
    child.once('spawn', () => {
      clearTimeout(timer);
      resolveSpawned();
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      rejectSpawned(err);
    });
  });
}

type FakeStamp = { app: 'api' | 'ui'; namespace: string };

const fakeStampContract: ProcessStampContract<FakeStamp> = {
  stampFields: ['app', 'namespace'],
  stampFlags: { app: '--fake-app', namespace: '--fake-namespace' },
  normalizeStamp(input) {
    const value = input as Partial<FakeStamp>;
    if (value.app !== 'api' && value.app !== 'ui') throw new Error('invalid app');
    if (typeof value.namespace !== 'string' || value.namespace.length === 0) {
      throw new Error('invalid namespace');
    }
    return { app: value.app, namespace: value.namespace };
  },
  normalizeStampCriteria(input = {}) {
    const value = input as Partial<FakeStamp>;
    return {
      ...(value.app == null ? {} : { app: value.app }),
      ...(value.namespace == null ? {} : { namespace: value.namespace }),
    };
  },
};

describe('@jini-ai/platform — process — createProcessStampArgs', () => {
  it('encodes every stamp field as --flag=value', () => {
    expect(createProcessStampArgs<FakeStamp>({ app: 'api', namespace: 'alpha' }, fakeStampContract)).toEqual([
      '--fake-app=api',
      '--fake-namespace=alpha',
    ]);
  });

  it('throws when a normalized field is not a string', () => {
    type LooseStamp = { count: string; id: string };
    const throwingFieldContract: ProcessStampContract<LooseStamp> = {
      stampFields: ['id', 'count'],
      stampFlags: { count: '--count', id: '--id' },
      normalizeStamp: () => ({ count: 42 as unknown as string, id: 'abc' }),
      normalizeStampCriteria: (input) => (input ?? {}) as Partial<LooseStamp>,
    };
    expect(() => createProcessStampArgs({ count: 'x', id: 'abc' }, throwingFieldContract)).toThrow(
      /process stamp field count must normalize to a string/,
    );
  });
});

describe('@jini-ai/platform — process — readFlagValue', () => {
  it('reads both "--flag value" and inline "--flag=value" forms', () => {
    expect(readFlagValue(['--fake-app', 'ui'], '--fake-app')).toBe('ui');
    expect(readFlagValue(['--fake-app=ui'], '--fake-app')).toBe('ui');
  });

  it('returns null when the flag is absent', () => {
    expect(readFlagValue(['--other=1'], '--fake-app')).toBeNull();
  });

  it('returns null when the flag is the last token with no following value', () => {
    expect(readFlagValue(['--fake-app'], '--fake-app')).toBeNull();
  });
});

describe('@jini-ai/platform — process — readProcessStamp / readProcessStampFromCommand', () => {
  it('decodes a valid stamp from args and from a tokenized command line', () => {
    const args = createProcessStampArgs<FakeStamp>({ app: 'ui', namespace: 'alpha' }, fakeStampContract);
    expect(readProcessStamp(args, fakeStampContract)).toEqual({ app: 'ui', namespace: 'alpha' });
    expect(readProcessStampFromCommand(`node   server.js   ${args.join('   ')}`, fakeStampContract)).toEqual({
      app: 'ui',
      namespace: 'alpha',
    });
  });

  it('returns null when normalization fails (missing required field)', () => {
    expect(readProcessStamp(['--fake-app=ui'], fakeStampContract)).toBeNull();
    expect(readProcessStampFromCommand('node server.js --fake-app=ui', fakeStampContract)).toBeNull();
  });
});

describe('@jini-ai/platform — process — matchesProcessStamp / matchesStampedProcess', () => {
  const stamp: FakeStamp = { app: 'ui', namespace: 'alpha' };

  it('matches when every specified criterion equals the stamp field, and unset criteria match anything', () => {
    expect(matchesProcessStamp(stamp, { app: 'ui' }, fakeStampContract)).toBe(true);
    expect(matchesProcessStamp(stamp, undefined, fakeStampContract)).toBe(true);
    expect(matchesProcessStamp(stamp, { app: 'api' }, fakeStampContract)).toBe(false);
  });

  it('decodes the command line and matches criteria against the resulting stamp', () => {
    const command = `node server.js ${createProcessStampArgs(stamp, fakeStampContract).join(' ')}`;
    expect(matchesStampedProcess({ command }, { namespace: 'alpha' }, fakeStampContract)).toBe(true);
  });

  it('returns false for a command whose stamp cannot be decoded', () => {
    expect(matchesStampedProcess({ command: 'node unrelated.js' }, { namespace: 'alpha' }, fakeStampContract)).toBe(
      false,
    );
  });
});

describe('@jini-ai/platform — process — spawnBackgroundProcess', () => {
  it('spawns a detached background process and resolves its pid once it starts', async () => {
    const { pid } = await spawnBackgroundProcess({ args: ['-e', 'process.exit(0)'], command: process.execPath });
    expect(typeof pid).toBe('number');
    await expect(waitForProcessExit(pid, 2000)).resolves.toBe(true);
  });

  it('routes stdout/stderr to a provided log fd', async () => {
    const dir = await makeTempDir('jini-platform-process-log-');
    const logPath = join(dir, 'out.log');
    const fd = openSync(logPath, 'w');
    let pid: number;
    try {
      ({ pid } = await spawnBackgroundProcess({
        args: ['-e', "process.stdout.write('background-log-line')"],
        command: process.execPath,
        logFd: fd,
      }));
      await waitForProcessExit(pid, 2000);
    } finally {
      closeSync(fd);
    }
    expect(await readFile(logPath, 'utf8')).toContain('background-log-line');
  });

  it('honors an explicit cwd', async () => {
    const dir = await makeTempDir('jini-platform-process-cwd-');
    const logPath = join(dir, 'cwd.log');
    const fd = openSync(logPath, 'w');
    let pid: number;
    try {
      ({ pid } = await spawnBackgroundProcess({
        args: ['-e', 'process.stdout.write(process.cwd())'],
        command: process.execPath,
        cwd: dir,
        logFd: fd,
      }));
      await waitForProcessExit(pid, 2000);
    } finally {
      closeSync(fd);
    }
    const written = await readFile(logPath, 'utf8');
    expect(written).toContain(dir.replace(/\/private/, ''));
  });

  it('rejects when the command cannot be spawned', async () => {
    await expect(
      spawnBackgroundProcess({ args: [], command: 'this-command-does-not-exist-anywhere-xyz' }),
    ).rejects.toThrow();
  });

  it('throws a descriptive error when the child reports no pid after spawning', async () => {
    mockState.spawnImpl = () => makeFakeChild({});
    await expect(spawnBackgroundProcess({ args: [], command: 'whatever' })).rejects.toThrow(
      /failed to spawn background process: whatever/,
    );
  });
});

describe('@jini-ai/platform — process — spawnLoggedProcess', () => {
  it('spawns a non-detached process by default and returns the live handle', async () => {
    const child = await spawnLoggedProcess({ args: ['-e', 'process.exit(0)'], command: process.execPath });
    expect(typeof child.pid).toBe('number');
    await new Promise((resolve) => child.once('exit', resolve));
  });

  it('throws a descriptive error when the child reports no pid after spawning', async () => {
    mockState.spawnImpl = () => makeFakeChild({});
    await expect(spawnLoggedProcess({ args: [], command: 'whatever' })).rejects.toThrow(
      /failed to spawn process: whatever/,
    );
  });
});

describe('@jini-ai/platform — process — isProcessAlive', () => {
  it('treats non-number pids as dead', () => {
    expect(isProcessAlive(null)).toBe(false);
    expect(isProcessAlive(undefined)).toBe(false);
  });

  it('reports the current process as alive', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false when the kill probe reports ESRCH', () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    });
    try {
      expect(isProcessAlive(999_999)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('returns true when the kill probe fails with a non-ESRCH error (e.g. EPERM)', () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    });
    try {
      expect(isProcessAlive(1)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('treats a thrown non-object value as carrying no error code, and so alive', () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw 'boom';
    });
    try {
      expect(isProcessAlive(1)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('treats a thrown null as carrying no error code, and so alive', () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw null;
    });
    try {
      expect(isProcessAlive(1)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('treats a thrown Error with no code property as carrying no error code, and so alive', () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('unlabeled failure');
    });
    try {
      expect(isProcessAlive(1)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('treats a thrown object whose code is null as carrying no error code, and so alive', () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw { code: null };
    });
    try {
      expect(isProcessAlive(1)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('@jini-ai/platform — process — waitForProcessExit', () => {
  it('resolves true immediately when the pid is already dead', async () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    });
    try {
      await expect(waitForProcessExit(424_242, 1000)).resolves.toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('resolves false once the timeout elapses for a pid that stays alive', async () => {
    await expect(waitForProcessExit(process.pid, 150)).resolves.toBe(false);
  });
});

describe('@jini-ai/platform — process — listProcessSnapshots (POSIX)', () => {
  it('enumerates real running processes via ps, including the current test process', async () => {
    if (process.platform === 'win32') return;
    const snapshots = await listProcessSnapshots();
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.some((snapshot) => snapshot.pid === process.pid)).toBe(true);
  });

  it('filters out lines that do not match the pid/ppid/command shape', async () => {
    mockState.execFileImpl = (_command, _args, _options, callback) => {
      const stdout = ['  123   1   /bin/real-thing', 'not-a-valid-line', '', '  456   123   another-process --flag'].join(
        '\n',
      );
      callback(null, stdout, '');
    };
    await expect(listProcessSnapshots()).resolves.toEqual([
      { command: '/bin/real-thing', pid: 123, ppid: 1 },
      { command: 'another-process --flag', pid: 456, ppid: 123 },
    ]);
  });

  it('returns an empty list when the ps call fails', async () => {
    mockState.execFileImpl = (_command, _args, _options, callback) => callback(new Error('ps not found'), '', '');
    await expect(listProcessSnapshots()).resolves.toEqual([]);
  });
});

describe('@jini-ai/platform — process — listProcessSnapshots (Windows)', () => {
  it('wraps a single (non-array) Get-CimInstance JSON object into a one-element list', async () => {
    mockState.execFileImpl = (_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ CommandLine: 'C:\\node.exe app.js', ParentProcessId: 1, ProcessId: 100 }), '');
    };
    await expect(withPlatformAsync('win32', () => listProcessSnapshots())).resolves.toEqual([
      { command: 'C:\\node.exe app.js', pid: 100, ppid: 1 },
    ]);
  });

  it('parses an array of records, filtering out ones with blank/missing CommandLine or a non-numeric id', async () => {
    mockState.execFileImpl = (_command, _args, _options, callback) => {
      const records = [
        { CommandLine: 'C:\\a.exe', ParentProcessId: '1', ProcessId: '200' },
        { CommandLine: '   ', ParentProcessId: 1, ProcessId: 201 },
        { CommandLine: 'C:\\b.exe', ParentProcessId: 1, ProcessId: 'not-a-number' },
        { CommandLine: null, ParentProcessId: 1, ProcessId: 202 },
      ];
      callback(null, JSON.stringify(records), '');
    };
    await expect(withPlatformAsync('win32', () => listProcessSnapshots())).resolves.toEqual([
      { command: 'C:\\a.exe', pid: 200, ppid: 1 },
    ]);
  });

  it('returns an empty list for blank stdout', async () => {
    mockState.execFileImpl = (_command, _args, _options, callback) => callback(null, '   \n', '');
    await expect(withPlatformAsync('win32', () => listProcessSnapshots())).resolves.toEqual([]);
  });

  it('returns an empty list when the powershell call fails', async () => {
    mockState.execFileImpl = (_command, _args, _options, callback) => callback(new Error('powershell missing'), '', '');
    await expect(withPlatformAsync('win32', () => listProcessSnapshots())).resolves.toEqual([]);
  });
});

describe('@jini-ai/platform — process — collectProcessTreePids', () => {
  it('returns nothing for an empty or all-invalid root list', () => {
    expect(collectProcessTreePids([{ command: 'x', pid: 1, ppid: 0 }], [])).toEqual([]);
    expect(collectProcessTreePids([], [null, undefined])).toEqual([]);
  });

  it('de-duplicates repeated root pids', () => {
    expect(collectProcessTreePids([{ command: 'root', pid: 1, ppid: 0 }], [1, 1, 1])).toEqual([1]);
  });

  it('skips a pid already visited when it is reachable as a child through more than one parent', () => {
    const processes = [
      { command: 'root', pid: 1, ppid: 0 },
      { command: 'child-a', pid: 2, ppid: 1 },
      { command: 'child-b', pid: 3, ppid: 1 },
      { command: 'shared-via-a', pid: 4, ppid: 2 },
      { command: 'shared-via-b', pid: 4, ppid: 3 },
    ];
    expect([...collectProcessTreePids(processes, [1])].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });
});

describe('@jini-ai/platform — process — stopProcesses', () => {
  it('reports alreadyStopped without calling process.kill for an empty or all-invalid pid list', async () => {
    const spy = vi.spyOn(process, 'kill');
    try {
      const emptyResult = { alreadyStopped: true, forcedPids: [], matchedPids: [], remainingPids: [], stoppedPids: [] };
      await expect(stopProcesses([])).resolves.toEqual(emptyResult);
      await expect(stopProcesses([null, undefined])).resolves.toEqual(emptyResult);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('excludes the current process pid from the target set', async () => {
    const result = await stopProcesses([process.pid]);
    expect(result.alreadyStopped).toBe(true);
  });

  it('swallows ESRCH from the initial SIGTERM when the pid is already gone', async () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    });
    try {
      const result = await stopProcesses([555_555]);
      // signalProcesses swallows the ESRCH from sending SIGTERM, then
      // waitForProcessesToExit's isProcessAlive probe also sees ESRCH and
      // reports the pid as already gone.
      expect(result).toEqual({
        alreadyStopped: false,
        forcedPids: [],
        matchedPids: [555_555],
        remainingPids: [],
        stoppedPids: [555_555],
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('rethrows a non-ESRCH error from the initial SIGTERM (e.g. EPERM)', async () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    });
    try {
      await expect(stopProcesses([555_555])).rejects.toThrow(/operation not permitted/);
    } finally {
      spy.mockRestore();
    }
  });

  it('stops a real child process with SIGTERM alone', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    if (child.pid != null) spawnedPidsToKill.push(child.pid);
    await waitForRealChildSpawn(child);
    const pid = child.pid;
    expect(typeof pid).toBe('number');
    const result = await stopProcesses([pid]);
    expect(result).toEqual({ alreadyStopped: false, forcedPids: [], matchedPids: [pid], remainingPids: [], stoppedPids: [pid] });
  });

  it(
    'escalates to SIGKILL when a child ignores SIGTERM',
    async () => {
      // `spawn`'s 'spawn' event fires once the OS has created the process,
      // not once Node has finished bootstrapping and reached our script's
      // first line — sending SIGTERM immediately after 'spawn' can race the
      // child's `process.on('SIGTERM', …)` registration and kill it before
      // the handler is installed. Wait for an explicit stdout "ready" line
      // (written only after the handler is registered) before signaling.
      const child = spawn(
        process.execPath,
        ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000);"],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );
      if (child.pid != null) spawnedPidsToKill.push(child.pid);
      const readyPromise = new Promise<void>((resolveReady, rejectReady) => {
        const timer = setTimeout(
          () => rejectReady(new Error("timed out waiting for the child's 'ready' stdout line")),
          5_000,
        );
        child.stdout?.on('data', (chunk) => {
          if (String(chunk).includes('ready')) {
            clearTimeout(timer);
            resolveReady();
          }
        });
      });
      await waitForRealChildSpawn(child);
      await readyPromise;
      const pid = child.pid;
      expect(typeof pid).toBe('number');
      const result = await stopProcesses([pid]);
      expect(result.matchedPids).toEqual([pid]);
      expect(result.forcedPids).toEqual([pid]);
      expect(result.stoppedPids).toEqual([pid]);
      expect(result.remainingPids).toEqual([]);
      expect(result.alreadyStopped).toBe(false);
    },
    // The first SIGTERM-wait window is a real, hardcoded 5s poll inside
    // stopProcesses (not parameterized), so this test genuinely takes that
    // long to reach the SIGKILL escalation branch.
    10_000,
  );
});
