import { type ChildProcessByStdio, spawn } from 'node:child_process';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Real-process integration suite for `installGracefulShutdown` — see Finding 1 of the 2026-08-16
 * Jini failure-mode audit: `createLocalNodeDaemon` had no OS signal handling anywhere in its own
 * package, `packages/daemon/src`, or `packages/cli/src`, so the ordinary way any long-lived Unix
 * daemon is stopped (a container runtime's `SIGTERM`, a process manager restart, an operator's
 * `kill`) bypassed the graceful `stop()` entirely.
 *
 * Runs `fixtures/graceful-shutdown-child.ts` as a genuine, separate child process and sends it a
 * real OS signal — the only way to observe Node's actual default signal-termination behavior versus
 * the library's graceful path. `host-bootstrap.test.ts` covers `installGracefulShutdown`'s own
 * re-entrancy/timeout/uninstall logic in isolation via `process.emit(...)`, which is faster but
 * cannot exercise a real OS signal at all — this suite is what proves the wiring actually works
 * end-to-end against a live daemon.
 */

const FIXTURE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'graceful-shutdown-child.ts');
const READY_TIMEOUT_MS = 15_000;
const EXIT_TIMEOUT_MS = 5_000;

function spawnChild(mode: '--with-guard' | '--without-guard'): ChildProcessByStdio<null, Readable, Readable> {
  return spawn(process.execPath, ['--import', 'tsx', FIXTURE_PATH, mode], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function waitForStdoutLine(child: ChildProcessByStdio<null, Readable, Readable>, predicate: (line: string) => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (predicate(line)) {
          cleanup();
          resolve(line);
          return;
        }
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`child exited (code=${code}, signal=${signal ?? 'none'}) before the expected stdout line arrived; buffered: ${JSON.stringify(buffer)}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for expected stdout line; buffered so far: ${JSON.stringify(buffer)}`));
    }, READY_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
    };
    child.stdout.on('data', onData);
    child.once('exit', onExit);
  });
}

function waitForExit(child: ChildProcessByStdio<null, Readable, Readable>): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timed out waiting for child to exit'));
    }, EXIT_TIMEOUT_MS);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

const liveChildren: ChildProcessByStdio<null, Readable, Readable>[] = [];
afterEach(() => {
  while (liveChildren.length > 0) {
    const child = liveChildren.pop();
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

describe('installGracefulShutdown wired into a real createLocalNodeDaemon child process', () => {
  it(
    'negative control: without the guard, a real SIGTERM kills the daemon immediately with no graceful teardown — proves the daemon has no default handling, so the positive case below is a real effect',
    async () => {
      const child = spawnChild('--without-guard');
      liveChildren.push(child);

      await waitForStdoutLine(child, (line) => line.startsWith('READY '));

      const stdoutAfterReady: string[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdoutAfterReady.push(chunk.toString('utf8')));

      child.kill('SIGTERM');
      const { code, signal } = await waitForExit(child);

      // Node's unmodified default: a process with no listener for SIGTERM is terminated by the
      // signal itself, not via a normal `process.exit()` — reported as `code: null, signal: 'SIGTERM'`.
      expect(signal).toBe('SIGTERM');
      expect(code).toBeNull();
      expect(stdoutAfterReady.join('')).not.toContain('STOPPED');
    },
    READY_TIMEOUT_MS + EXIT_TIMEOUT_MS,
  );

  it(
    'positive case: with the guard installed, a real SIGTERM runs stop() and the process exits cleanly with the HTTP listener already closed',
    async () => {
      const child = spawnChild('--with-guard');
      liveChildren.push(child);

      await waitForStdoutLine(child, (line) => line.startsWith('READY '));
      const stoppedLinePromise = waitForStdoutLine(child, (line) => line.startsWith('STOPPED '));

      child.kill('SIGTERM');
      const stoppedLine = await stoppedLinePromise;
      const { code, signal } = await waitForExit(child);

      expect(stoppedLine).toBe('STOPPED code=0 listening=false');
      expect(code).toBe(0);
      expect(signal).toBeNull();
    },
    READY_TIMEOUT_MS + EXIT_TIMEOUT_MS,
  );

  it(
    'reacts to a real SIGINT the same way',
    async () => {
      const child = spawnChild('--with-guard');
      liveChildren.push(child);

      await waitForStdoutLine(child, (line) => line.startsWith('READY '));
      const stoppedLinePromise = waitForStdoutLine(child, (line) => line.startsWith('STOPPED '));

      child.kill('SIGINT');
      const stoppedLine = await stoppedLinePromise;
      const { code } = await waitForExit(child);

      expect(stoppedLine).toBe('STOPPED code=0 listening=false');
      expect(code).toBe(0);
    },
    READY_TIMEOUT_MS + EXIT_TIMEOUT_MS,
  );

  it(
    'is re-entrant against a real double signal: a second SIGTERM sent immediately after the first does not crash, hang, or double-run shutdown',
    async () => {
      const child = spawnChild('--with-guard');
      liveChildren.push(child);

      await waitForStdoutLine(child, (line) => line.startsWith('READY '));
      const stoppedLines: string[] = [];
      child.stdout.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split('\n')) {
          if (line.startsWith('STOPPED ')) stoppedLines.push(line);
        }
      });

      child.kill('SIGTERM');
      child.kill('SIGTERM');
      const { code } = await waitForExit(child);

      expect(code).toBe(0);
      expect(stoppedLines).toHaveLength(1);
    },
    READY_TIMEOUT_MS + EXIT_TIMEOUT_MS,
  );
});
