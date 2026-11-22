import { EventEmitter } from 'node:events';
import { closeSync, openSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockState } from './process-fixtures.js';
import { spawn } from 'node:child_process';

import {
  isProcessAlive,
  spawnBackgroundProcess,
  spawnLoggedProcess,
  stopProcesses,
  waitForProcessExit,
} from '../process.js';
import { collectProcessTreePids } from '@jini-ai/core/contracts/runtime';


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
    ).rejects.toThrow('spawn this-command-does-not-exist-anywhere-xyz ENOENT');
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

describe('@jini-ai/platform — process — collectProcessTreePids', () => {
  it('orders numeric PIDs descending even when a child has a lower PID than its parent', () => {
    expect(collectProcessTreePids({ processes: [
      { command: 'parent', pid: 900, ppid: 0 },
      { command: 'child', pid: 5, ppid: 900 },
      { command: 'grandchild', pid: 3, ppid: 5 },
      { command: 'unrelated', pid: 1000, ppid: 0 },
    ], rootPids: [900, 5, 900] })).toEqual([900, 5, 3]);
  });

  it('returns nothing for an empty or all-invalid root list', () => {
    expect(collectProcessTreePids({ processes: [{ command: 'x', pid: 1, ppid: 0 }], rootPids: [] })).toEqual([]);
    expect(collectProcessTreePids({ processes: [], rootPids: [null, undefined] })).toEqual([]);
  });

  it('de-duplicates repeated root pids', () => {
    expect(collectProcessTreePids({ processes: [{ command: 'root', pid: 1, ppid: 0 }], rootPids: [1, 1, 1] })).toEqual([1]);
  });

  it('skips a pid already visited when it is reachable as a child through more than one parent', () => {
    const processes = [
      { command: 'root', pid: 1, ppid: 0 },
      { command: 'child-a', pid: 2, ppid: 1 },
      { command: 'child-b', pid: 3, ppid: 1 },
      { command: 'shared-via-a', pid: 4, ppid: 2 },
      { command: 'shared-via-b', pid: 4, ppid: 3 },
    ];
    expect([...collectProcessTreePids({ processes, rootPids: [1] })].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
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
