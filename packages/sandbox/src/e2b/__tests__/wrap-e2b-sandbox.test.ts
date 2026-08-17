/**
 * Behavioral tests for `wrapE2bSandbox` against a fake `E2bSandboxHandle` — no network call, no
 * API key, so these assert the actual translation logic (command building, event-kind mapping,
 * pub/sub bridging, liveness checking) rather than "was the SDK called."
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProcessOutputChunk } from '../../core/ports.js';
import type {
  E2bFilesystemEvent,
  E2bRunOptions,
  E2bSandboxHandle,
} from '../e2b-sandbox-handle.js';
import {
  mapE2bFileChangeKind,
  SandboxPreviewNotReadyError,
  wrapE2bSandbox,
} from '../wrap-e2b-sandbox.js';

interface RunCall {
  readonly cmd: string;
  // Not `opts?:` — the fake always records the argument it received, including an explicit
  // `undefined` when the caller passed none. `exactOptionalPropertyTypes` treats an optional key
  // and "present but undefined" as different things; this type says the key is always present.
  readonly opts: E2bRunOptions | undefined;
}

/** A fake E2B sandbox handle that records every call it receives instead of touching a network.
 *  `run`'s background branch captures its `onStdout`/`onStderr` callbacks so a test can invoke
 *  them directly, simulating E2B delivering output — that is the seam `startProcess`'s
 *  broadcast-to-listeners logic actually needs to prove itself against. */
function createFakeHandle() {
  const runCalls: RunCall[] = [];
  const writeCalls: Array<{ path: string; data: string }> = [];
  const backgroundKill = vi.fn().mockResolvedValue(true);
  let backgroundOpts: E2bRunOptions | undefined;
  let watchListener: ((event: E2bFilesystemEvent) => void) | undefined;
  const watchStop = vi.fn().mockResolvedValue(undefined);
  const kill = vi.fn().mockResolvedValue(true);
  const watchDir = vi.fn(
    async (
      _path: string,
      onEvent: (event: E2bFilesystemEvent) => void,
      _opts?: { readonly recursive?: boolean },
    ) => {
      watchListener = onEvent;
      return { stop: watchStop };
    },
  );

  const run = vi.fn(async (cmd: string, opts?: E2bRunOptions) => {
    runCalls.push({ cmd, opts });
    if (opts?.background) {
      backgroundOpts = opts;
      return { kill: backgroundKill };
    }
    return { stdout: 'stdout-output', stderr: 'stderr-output', exitCode: 0 };
  });

  const write = vi.fn(async (path: string, data: string) => {
    writeCalls.push({ path, data });
    return {};
  });

  const handle = {
    commands: { run },
    files: { write, read: vi.fn(), watchDir },
    getHost: vi.fn((port: number) => `${port}.sandbox.e2b.example`),
    kill,
  } as unknown as E2bSandboxHandle;

  return {
    handle,
    runCalls,
    writeCalls,
    watchStop,
    kill,
    backgroundKill,
    emitFileEvent: (event: E2bFilesystemEvent) => watchListener?.(event),
    getBackgroundOpts: () => backgroundOpts,
  };
}

const CONFIG = { projectRoot: '/root', previewPort: 4000, previewCheckTimeoutMs: 100 };

describe('wrapE2bSandbox', () => {
  it('creates the project root and starts a recursive watch before returning', async () => {
    const fake = createFakeHandle();
    await wrapE2bSandbox(fake.handle, CONFIG);

    expect(fake.runCalls[0]).toEqual({ cmd: "mkdir -p '/root'", opts: undefined });
    expect(fake.handle.files.watchDir).toHaveBeenCalledWith('/root', expect.any(Function), {
      recursive: true,
    });
  });

  it('mountFiles writes each file under the project root, in order', async () => {
    const fake = createFakeHandle();
    const session = await wrapE2bSandbox(fake.handle, CONFIG);

    await session.mountFiles([
      { path: 'src/App.jsx', content: 'jsx-content' },
      { path: 'index.html', content: 'html-content' },
    ]);

    expect(fake.writeCalls).toEqual([
      { path: '/root/src/App.jsx', data: 'jsx-content' },
      { path: '/root/index.html', data: 'html-content' },
    ]);
  });

  it('runCommand shell-quotes args, runs in the project root, and maps the result', async () => {
    const fake = createFakeHandle();
    const session = await wrapE2bSandbox(fake.handle, CONFIG);

    const result = await session.runCommand('npm', ['run', 'my script']);

    // Every arg is quoted, not just the one that needs it — buildCommand doesn't try to guess
    // which args are "safe" to leave bare, since that judgment call is exactly how quoting
    // bugs happen.
    expect(fake.runCalls.at(-1)).toEqual({
      cmd: "npm 'run' 'my script'",
      opts: { cwd: '/root' },
    });
    expect(result).toEqual({ stdout: 'stdout-output', stderr: 'stderr-output', exitCode: 0 });
  });

  it('runCommand with no args runs the bare command', async () => {
    const fake = createFakeHandle();
    const session = await wrapE2bSandbox(fake.handle, CONFIG);

    await session.runCommand('pwd');

    expect(fake.runCalls.at(-1)?.cmd).toBe('pwd');
  });

  it('installDependencies with no packages runs a bare npm install', async () => {
    const fake = createFakeHandle();
    const session = await wrapE2bSandbox(fake.handle, CONFIG);

    await session.installDependencies();

    expect(fake.runCalls.at(-1)).toEqual({ cmd: 'npm install', opts: { cwd: '/root' } });
  });

  it('installDependencies with packages installs exactly the named, quoted packages', async () => {
    const fake = createFakeHandle();
    const session = await wrapE2bSandbox(fake.handle, CONFIG);

    await session.installDependencies(['react', 'left-pad@1.3.0']);

    expect(fake.runCalls.at(-1)).toEqual({
      cmd: "npm install 'react' 'left-pad@1.3.0'",
      opts: { cwd: '/root' },
    });
  });

  describe('startProcess', () => {
    it('starts in the background and broadcasts output to every current subscriber', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      const process = await session.startProcess('npm', ['run', 'dev']);
      expect(fake.runCalls.at(-1)?.cmd).toBe("npm 'run' 'dev'");
      expect(fake.getBackgroundOpts()?.cwd).toBe('/root');

      const listenerA: ProcessOutputChunk[] = [];
      const listenerB: ProcessOutputChunk[] = [];
      process.onOutput((chunk) => listenerA.push(chunk));
      process.onOutput((chunk) => listenerB.push(chunk));

      fake.getBackgroundOpts()?.onStdout?.('Local: http://localhost:5173');
      fake.getBackgroundOpts()?.onStderr?.('warning: something');

      const expected: ProcessOutputChunk[] = [
        { stream: 'stdout', text: 'Local: http://localhost:5173' },
        { stream: 'stderr', text: 'warning: something' },
      ];
      expect(listenerA).toEqual(expected);
      expect(listenerB).toEqual(expected);
    });

    it('stops delivering to a listener once it unsubscribes, without affecting others', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);
      const process = await session.startProcess('npm', ['run', 'dev']);

      const stillSubscribed: ProcessOutputChunk[] = [];
      const unsubscribedEarly: ProcessOutputChunk[] = [];
      process.onOutput((chunk) => stillSubscribed.push(chunk));
      const unsubscribe = process.onOutput((chunk) => unsubscribedEarly.push(chunk));

      unsubscribe();
      fake.getBackgroundOpts()?.onStdout?.('after unsubscribe');

      expect(unsubscribedEarly).toEqual([]);
      expect(stillSubscribed).toEqual([{ stream: 'stdout', text: 'after unsubscribe' }]);
    });

    it('kill delegates to the underlying E2B command handle', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);
      const process = await session.startProcess('npm', ['run', 'dev']);

      await process.kill();

      expect(fake.backgroundKill).toHaveBeenCalledOnce();
    });
  });

  describe('getPreview', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it('resolves with the forwarded host once something answers', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
      vi.stubGlobal('fetch', fetchMock);

      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      const preview = await session.getPreview();

      expect(preview).toEqual({ url: 'https://4000.sandbox.e2b.example' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://4000.sandbox.e2b.example',
        expect.objectContaining({ method: 'HEAD' }),
      );
    });

    it('rejects with SandboxPreviewNotReadyError when nothing answers', async () => {
      const connectionRefused = new TypeError('fetch failed');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(connectionRefused),
      );

      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      await expect(session.getPreview()).rejects.toThrow(SandboxPreviewNotReadyError);
      await expect(session.getPreview()).rejects.toMatchObject({
        url: 'https://4000.sandbox.e2b.example',
        cause: connectionRefused,
      });
    });

    it('aborts and rejects once previewCheckTimeoutMs elapses with no response at all', async () => {
      vi.useFakeTimers();
      // A fetch that never settles on its own — the only way it resolves/rejects is via the
      // AbortSignal that checkListening's own setTimeout fires. This is what actually proves the
      // timeout wiring works, versus a fetch that just happens to reject quickly on its own.
      const fetchMock = vi.fn(
        (_url: string, opts: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      // Attach the rejection handler before advancing the fake clock — otherwise the promise
      // can reject before `.rejects` has subscribed, which Node reports as an unhandled
      // rejection even though the test goes on to handle it a tick later.
      const assertion = expect(session.getPreview()).rejects.toThrow(SandboxPreviewNotReadyError);
      await vi.advanceTimersByTimeAsync(CONFIG.previewCheckTimeoutMs);
      await assertion;
    });
  });

  describe('onFileChange', () => {
    it('delivers create/write/rename/remove as their mapped kind, and drops chmod', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      const received: Array<{ path: string; kind: string }> = [];
      session.onFileChange((event) => received.push(event));

      fake.emitFileEvent({ name: 'a.txt', type: 'create' });
      fake.emitFileEvent({ name: 'b.txt', type: 'write' });
      fake.emitFileEvent({ name: 'c.txt', type: 'rename' });
      fake.emitFileEvent({ name: 'd.txt', type: 'remove' });
      fake.emitFileEvent({ name: 'e.txt', type: 'chmod' });

      expect(received).toEqual([
        { path: 'a.txt', kind: 'created' },
        { path: 'b.txt', kind: 'modified' },
        { path: 'c.txt', kind: 'modified' },
        { path: 'd.txt', kind: 'deleted' },
      ]);
    });

    it('stops delivering to an unsubscribed listener', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      const received: unknown[] = [];
      const unsubscribe = session.onFileChange((event) => received.push(event));
      unsubscribe();
      fake.emitFileEvent({ name: 'a.txt', type: 'create' });

      expect(received).toEqual([]);
    });
  });

  describe('teardown', () => {
    it('stops the watch and kills the sandbox', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      await session.teardown();

      expect(fake.watchStop).toHaveBeenCalledOnce();
      expect(fake.kill).toHaveBeenCalledOnce();
    });

    it('still kills the sandbox even when stopping the watch fails', async () => {
      const fake = createFakeHandle();
      fake.watchStop.mockRejectedValueOnce(new Error('stop failed'));
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      await expect(session.teardown()).rejects.toThrow('stop failed');

      expect(fake.kill).toHaveBeenCalledOnce();
    });
  });
});

describe('mapE2bFileChangeKind', () => {
  it('maps every real FilesystemEventType value exhaustively', () => {
    expect(mapE2bFileChangeKind('create')).toBe('created');
    expect(mapE2bFileChangeKind('write')).toBe('modified');
    expect(mapE2bFileChangeKind('rename')).toBe('modified');
    expect(mapE2bFileChangeKind('remove')).toBe('deleted');
    expect(mapE2bFileChangeKind('chmod')).toBeNull();
  });
});
