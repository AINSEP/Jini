import { describe, expect, it } from 'vitest';
import { createTauriSidecarLauncher } from '../tauri-sidecar.js';
import { createFakeTauriSidecarCommandApi } from '../testing.js';

describe('createTauriSidecarLauncher', () => {
  it('waitUntilReady resolves once the probe reports ready', async () => {
    const api = createFakeTauriSidecarCommandApi({});
    const launcher = createTauriSidecarLauncher({ api });
    const handle = await launcher.launch({ command: 'my-sidecar' }, { args: ['--port', '0'] });
    expect(api.spawned).toEqual([{ binaryName: 'my-sidecar', args: ['--port', '0'] }]);
    let calls = 0;
    const status = await handle.waitUntilReady({ probe: async () => ({ ready: ++calls >= 2 }), isReady: ({ status: s }) => s.ready }, { pollIntervalMs: 5, timeoutMs: 2000 });
    expect(status.ready).toBe(true);
  });

  it('waitUntilReady uses its default timeout/pollInterval when none is given', async () => {
    const api = createFakeTauriSidecarCommandApi({});
    const launcher = createTauriSidecarLauncher({ api });
    const handle = await launcher.launch({ command: 'my-sidecar' });
    // Ready on the very first probe call, so this resolves long before the
    // (otherwise 35s) default timeout or the (otherwise 150ms) default poll
    // interval would ever matter — just exercising that both fall back to
    // their defaults rather than throwing when omitted.
    const status = await handle.waitUntilReady({ probe: async () => ({ ready: true }), isReady: ({ status: s }) => s.ready });
    expect(status.ready).toBe(true);
  });

  it('waitUntilReady times out for real when the probe never reports ready and never throws', async () => {
    const api = createFakeTauriSidecarCommandApi({});
    const launcher = createTauriSidecarLauncher({ api });
    const handle = await launcher.launch({ command: 'my-sidecar' });
    await expect(
      handle.waitUntilReady({ probe: async () => ({ ready: false }), isReady: ({ status: s }) => s.ready }, { pollIntervalMs: 5, timeoutMs: 30 }),
    ).rejects.toThrow(/^timed out waiting for sidecar to become ready$/);
  });

  it('waitUntilReady times out for real and includes the last probe error message', async () => {
    const api = createFakeTauriSidecarCommandApi({});
    const launcher = createTauriSidecarLauncher({ api });
    const handle = await launcher.launch({ command: 'my-sidecar' });
    await expect(
      handle.waitUntilReady({ probe: async () => {
          throw new Error('connection refused');
        }, isReady: () => false }, { pollIntervalMs: 5, timeoutMs: 30 }),
    ).rejects.toThrow(/timed out waiting for sidecar to become ready \(connection refused\)/);
  });

  it('waitUntilReady rejects fast on crash before ready (crash recovery signal)', async () => {
    const api = createFakeTauriSidecarCommandApi({}, { exitImmediatelyWithCode: 7 });
    const launcher = createTauriSidecarLauncher({ api });
    const handle = await launcher.launch({ command: 'my-sidecar' });
    await expect(
      handle.waitUntilReady({ probe: async () => {
          throw new Error('not up');
        }, isReady: () => false }, { pollIntervalMs: 5, timeoutMs: 5000 }),
    ).rejects.toThrow(/exited before reporting ready/);
  });

  it('shutdown uses the graceful request before falling back to a signal kill', async () => {
    const api = createFakeTauriSidecarCommandApi({});
    const launcher = createTauriSidecarLauncher({ api });
    const handle = await launcher.launch({ command: 'my-sidecar' });
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

  it('shutdown force-kills a sidecar that ignores graceful shutdown', async () => {
    const api = createFakeTauriSidecarCommandApi({}, { ignoresGracefulShutdown: true });
    const launcher = createTauriSidecarLauncher({ api });
    const handle = await launcher.launch({ command: 'my-sidecar' });
    let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    handle.process.onExit({ listener: ({ code, signal }) => {
      exitInfo = { code, signal };
    } });
    await handle.shutdown({}, {
      requestShutdown: async () => {
        handle.process.kill({}, { signal: 'SIGTERM' });
      },
      gracefulTimeoutMs: 100,
    });
    expect(exitInfo).not.toBeNull();
    expect(exitInfo!.signal).toBe('SIGKILL');
  });

  it('shutdown falls through to process-level termination when requestShutdown rejects', async () => {
    const api = createFakeTauriSidecarCommandApi({});
    const launcher = createTauriSidecarLauncher({ api });
    const handle = await launcher.launch({ command: 'my-sidecar' });
    let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    handle.process.onExit({ listener: ({ code, signal }) => {
      exitInfo = { code, signal };
    } });
    await handle.shutdown({}, {
      requestShutdown: async () => {
        throw new Error('ipc channel already gone');
      },
      gracefulTimeoutMs: 50,
    });
    // requestShutdown's rejection is swallowed; nothing ever calls kill()
    // gracefully, so the first waitForProcessExit times out and shutdown
    // force-kills with SIGKILL.
    expect(exitInfo).not.toBeNull();
    expect(exitInfo!.signal).toBe('SIGKILL');
  });

  it('shutdown falls back to its default gracefulTimeoutMs when none is given', async () => {
    const api = createFakeTauriSidecarCommandApi({});
    const launcher = createTauriSidecarLauncher({ api });
    const handle = await launcher.launch({ command: 'my-sidecar' });
    let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    handle.process.onExit({ listener: ({ code, signal }) => {
      exitInfo = { code, signal };
    } });
    // No gracefulTimeoutMs: exercises the `?? DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS`
    // fallback (5s). requestShutdown kills gracefully itself, so the fake
    // reports exit almost immediately — this does not actually wait 5s.
    await handle.shutdown({}, {
      requestShutdown: async () => {
        handle.process.kill({}, { signal: 'SIGTERM' });
      },
    });
    expect(exitInfo).not.toBeNull();
    expect(exitInfo!.signal).not.toBe('SIGKILL');
  });
});
