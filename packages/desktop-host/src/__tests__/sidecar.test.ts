import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendSidecarLifecycleLog, createNodeSidecarLauncher } from '../sidecar.js';

const node = process.execPath;

function waitForExit(handle: { process: { onExit({ listener }: { listener: (args: { code: number | null; signal: NodeJS.Signals | null }) => void }): void } }) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    handle.process.onExit({ listener: ({ code, signal }) => resolve({ code, signal }) });
  });
}

describe('createNodeSidecarLauncher', () => {
  it('waitUntilReady resolves once the probe reports ready', async () => {
    const launcher = createNodeSidecarLauncher({});
    const handle = await launcher.launch({ command: node }, { args: ['-e', 'setInterval(() => {}, 1000)'] });
    try {
      let calls = 0;
      const status = await handle.waitUntilReady({ probe: async () => ({ ready: ++calls >= 2 }), isReady: ({ status: s }) => s.ready }, { pollIntervalMs: 10, timeoutMs: 2000 });
      expect(status.ready).toBe(true);
      expect(calls).toBeGreaterThanOrEqual(2);
    } finally {
      await handle.shutdown({}, { gracefulTimeoutMs: 200 });
    }
  });

  it('waitUntilReady rejects fast when the child exits before reporting ready (crash recovery signal)', async () => {
    const launcher = createNodeSidecarLauncher({});
    const handle = await launcher.launch({ command: node }, { args: ['-e', 'process.exit(3)'] });
    await expect(
      handle.waitUntilReady({ probe: async () => {
          throw new Error('not up yet');
        }, isReady: () => false }, { pollIntervalMs: 10, timeoutMs: 5000 }),
    ).rejects.toThrow(/exited before reporting ready/);
  });

  it('waitUntilReady times out when the probe never reports ready', async () => {
    const launcher = createNodeSidecarLauncher({});
    const handle = await launcher.launch({ command: node }, { args: ['-e', 'setInterval(() => {}, 1000)'] });
    try {
      await expect(
        handle.waitUntilReady({ probe: async () => ({ ready: false }), isReady: () => false }, { pollIntervalMs: 10, timeoutMs: 80 }),
      ).rejects.toThrow(/timed out waiting/);
    } finally {
      await handle.shutdown({}, { gracefulTimeoutMs: 200 });
    }
  });

  it('shutdown uses the caller-supplied graceful request before falling back to a signal kill', async () => {
    const launcher = createNodeSidecarLauncher({});
    const handle = await launcher.launch({ command: node }, { args: ['-e', "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"] });
    let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    handle.process.onExit({ listener: ({ code, signal }) => {
      exitInfo = { code, signal };
    } });
    await handle.shutdown({}, {
      requestShutdown: async () => {
        handle.process.kill({}, { signal: 'SIGTERM' });
      },
      gracefulTimeoutMs: 2000,
    });
    expect(exitInfo).not.toBeNull();
    expect(exitInfo!.signal).not.toBe('SIGKILL');
  });

  it('shutdown force-kills a child that never exits on its own', async () => {
    const launcher = createNodeSidecarLauncher({});
    const handle = await launcher.launch({ command: node }, { args: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"] });
    let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    handle.process.onExit({ listener: ({ code, signal }) => {
      exitInfo = { code, signal };
    } });
    await handle.shutdown({}, { gracefulTimeoutMs: 150 });
    expect(exitInfo).not.toBeNull();
    expect(exitInfo!.signal).toBe('SIGKILL');
  }, 10_000);

  it('shutdown falls through to process-level termination when requestShutdown rejects', async () => {
    const launcher = createNodeSidecarLauncher({});
    const handle = await launcher.launch({ command: node }, { args: ['-e', "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"] });
    const exited = waitForExit(handle);
    await handle.shutdown({}, {
      requestShutdown: async () => {
        throw new Error('graceful request transport failed');
      },
      gracefulTimeoutMs: 2000,
    });
    // The rejected requestShutdown call must not prevent the process-level
    // fallback: waitForProcessExit/kill('SIGKILL') still run afterward.
    const exitInfo = await exited;
    expect(exitInfo.signal).toBe('SIGKILL');
  });

  it('shutdown uses the default graceful timeout when none is provided', async () => {
    const launcher = createNodeSidecarLauncher({});
    const handle = await launcher.launch({ command: node }, { args: ['-e', "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"] });
    const exited = waitForExit(handle);
    // No gracefulTimeoutMs: exercises the DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS
    // fallback. The child exits promptly via requestShutdown, so this does
    // not actually wait out the (much longer) default timeout.
    await handle.shutdown({}, {
      requestShutdown: async () => {
        handle.process.kill({}, { signal: 'SIGTERM' });
      },
    });
    const exitInfo = await exited;
    expect(exitInfo.signal).not.toBe('SIGKILL');
  });

  it('launch defaults args to an empty array when omitted', async () => {
    const launcher = createNodeSidecarLauncher({});
    // A bare `node` invocation with stdin ignored (closed) reads EOF
    // immediately and exits on its own — proving `args` defaulted to `[]`
    // rather than throwing/hanging on an undefined args array.
    const handle = await launcher.launch({ command: node });
    const exited = waitForExit(handle);
    await expect(exited).resolves.toBeDefined();
  });

  it('waitUntilReady uses the default poll interval and timeout when neither is provided', async () => {
    const launcher = createNodeSidecarLauncher({});
    const handle = await launcher.launch({ command: node }, { args: ['-e', 'setInterval(() => {}, 1000)'] });
    try {
      const status = await handle.waitUntilReady({ probe: async () => ({ ready: true }), isReady: ({ status: s }) => s.ready });
      expect(status.ready).toBe(true);
    } finally {
      await handle.shutdown({}, { gracefulTimeoutMs: 200 });
    }
  });

  it('waitUntilReady includes the last probe error message when it times out', async () => {
    const launcher = createNodeSidecarLauncher({});
    const handle = await launcher.launch({ command: node }, { args: ['-e', 'setInterval(() => {}, 1000)'] });
    try {
      await expect(
        handle.waitUntilReady({ probe: async () => {
            throw new Error('probe transport unavailable');
          }, isReady: () => false }, { pollIntervalMs: 10, timeoutMs: 80 }),
      ).rejects.toThrow(/timed out waiting for sidecar to become ready \(probe transport unavailable\)/);
    } finally {
      await handle.shutdown({}, { gracefulTimeoutMs: 200 });
    }
  });

  it('recognizes a child already exited via signal before waitUntilReady/shutdown observe it', async () => {
    const launcher = createNodeSidecarLauncher({});
    const handle = await launcher.launch({ command: node }, { args: ['-e', 'setInterval(() => {}, 1000)'] });
    const exited = waitForExit(handle);
    handle.process.kill({}, { signal: 'SIGKILL' });
    await exited;
    // Let Node fully record exitCode/signalCode before re-checking — a
    // process killed by a signal (rather than exiting on its own) leaves
    // `exitCode` null and `signalCode` set, the other half of the
    // already-exited fast-path check both waitUntilReady and
    // waitForProcessExit make.
    await new Promise((resolve) => setImmediate(resolve));

    await expect(
      handle.waitUntilReady({ probe: async () => ({ ready: false }), isReady: () => false }, { pollIntervalMs: 10, timeoutMs: 2000 }),
    ).rejects.toThrow(/exited before reporting ready/);

    // shutdown on an already-exited child should resolve via the fast
    // path too, without waiting out the graceful timeout.
    await expect(handle.shutdown({}, { gracefulTimeoutMs: 2000 })).resolves.toBeUndefined();
  });

  describe('with a log file', () => {
    let dir: string | null = null;

    afterEach(async () => {
      if (dir != null) await rm(dir, { recursive: true, force: true });
      dir = null;
    });

    it('opens the log file, wires child stdio to it, points crash errors at it, and closes it on shutdown', async () => {
      dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-sidecar-'));
      const logPath = join(dir, 'sidecar.log');
      const launcher = createNodeSidecarLauncher({});
      const handle = await launcher.launch({ command: node }, { args: ['-e', "console.log('booting'); process.exit(3)"], logPath });
      expect(handle.logPath).toBe(logPath);

      await expect(
        handle.waitUntilReady({ probe: async () => {
            throw new Error('not up yet');
          }, isReady: () => false }, { pollIntervalMs: 10, timeoutMs: 5000 }),
      ).rejects.toThrow(new RegExp(`see ${logPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} for details`));

      // Closing the (already-exited) child's log handle on shutdown must
      // not throw, and the sidecar's own stdout ('booting') should have
      // landed in the log file via the wired stdio fd.
      await handle.shutdown({}, { gracefulTimeoutMs: 200 });
      const contents = await readFile(logPath, 'utf8');
      expect(contents).toContain('booting');
    });
  });
});

describe('appendSidecarLifecycleLog', () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir != null) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it('creates the log directory and appends a message line', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-lifecycle-'));
    const logPath = join(dir, 'nested', 'lifecycle.log');
    await appendSidecarLifecycleLog({ logPath, message: 'sidecar launched' });
    const contents = await readFile(logPath, 'utf8');
    expect(contents).toBe('sidecar launched\n');
  });
});
