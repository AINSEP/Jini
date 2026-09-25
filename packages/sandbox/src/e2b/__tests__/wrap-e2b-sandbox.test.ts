/**
 * Behavioral tests for `wrapE2bSandbox` against a fake `E2bSandboxHandle` — no network call, no
 * API key, so these assert the actual translation logic (command building, binary conversion,
 * event-kind mapping, pub/sub bridging, liveness checking, error mapping, process tracking for
 * teardown) rather than "was the SDK called."
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SandboxOperationError } from '../../core/errors.js';
import type { ProcessOutputChunk } from '../../core/ports.js';
import type {
  E2bFilesystemEvent,
  E2bRunOptions,
  E2bSandboxHandle,
  E2bWriteEntry,
} from '../e2b-sandbox-handle.js';
import { mapE2bFileChangeKind, wrapE2bSandbox } from '../wrap-e2b-sandbox.js';

interface RunCall {
  readonly cmd: string;
  readonly opts: E2bRunOptions | undefined;
}

/** A fake E2B sandbox handle that records every call it receives instead of touching a network.
 *  `run`'s background branch captures its `onStdout`/`onStderr` callbacks so a test can invoke
 *  them directly, simulating E2B delivering output. `write`/`read`/`list` all default to benign
 *  successes; individual tests override the specific mock they care about. */
function createFakeHandle() {
  const runCalls: RunCall[] = [];
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

  const write = vi.fn().mockResolvedValue(undefined);
  const read = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
  const list = vi.fn().mockResolvedValue([]);

  const handle = {
    commands: { run },
    files: { write, read, list, watchDir },
    getHost: vi.fn((port: number) => `${port}.sandbox.e2b.example`),
    kill,
  } as unknown as E2bSandboxHandle;

  return {
    handle,
    runCalls,
    write,
    read,
    list,
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

  it('wraps a boot-time failure (mkdir) into a SandboxOperationError', async () => {
    const fake = createFakeHandle();
    fake.handle.commands.run = vi.fn().mockRejectedValue(new Error('connection refused'));

    await expect(wrapE2bSandbox(fake.handle, CONFIG)).rejects.toBeInstanceOf(SandboxOperationError);
  });

  it('wraps a boot-time failure (starting the watch) into a SandboxOperationError', async () => {
    const fake = createFakeHandle();
    fake.handle.files.watchDir = vi.fn().mockRejectedValue(new Error('watch unavailable'));

    await expect(wrapE2bSandbox(fake.handle, CONFIG)).rejects.toBeInstanceOf(SandboxOperationError);
  });

  describe('mountFiles', () => {
    it('writes every file in one batched call, not one per file', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      await session.mountFiles([
        { path: 'src/App.jsx', content: 'jsx-content' },
        { path: 'index.html', content: 'html-content' },
      ]);

      expect(fake.write).toHaveBeenCalledOnce();
      const written = fake.write.mock.calls[0]?.[0] as E2bWriteEntry[];
      expect(written).toEqual([
        { path: '/root/src/App.jsx', data: 'jsx-content' },
        { path: '/root/index.html', data: 'html-content' },
      ]);
    });

    it('converts Uint8Array content to an ArrayBuffer with the exact same bytes', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

      await session.mountFiles([{ path: 'assets/images/logo.png', content: pngBytes }]);

      const written = fake.write.mock.calls[0]?.[0] as E2bWriteEntry[];
      expect(written[0]?.path).toBe('/root/assets/images/logo.png');
      expect(written[0]?.data).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(written[0]!.data as ArrayBuffer)).toEqual(pngBytes);
    });

    it('does not call write at all for an empty file list', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      await session.mountFiles([]);

      expect(fake.write).not.toHaveBeenCalled();
    });

    it('wraps a write failure into a SandboxOperationError', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);
      const notEnoughSpace = new Error('disk full');
      notEnoughSpace.name = 'NotEnoughSpaceError';
      fake.write.mockRejectedValueOnce(notEnoughSpace);

      const rejection = session.mountFiles([{ path: 'a.txt', content: 'x' }]);
      await expect(rejection).rejects.toBeInstanceOf(SandboxOperationError);
      await expect(rejection).rejects.toMatchObject({ category: 'unavailable', cause: notEnoughSpace });
    });
  });

  describe('readFile', () => {
    it('reads raw bytes from the project-root-relative path, requesting bytes explicitly', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      const bytes = await session.readFile('src/App.jsx');

      expect(fake.read).toHaveBeenCalledWith('/root/src/App.jsx', { format: 'bytes' });
      expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('wraps a not-found read into a SandboxOperationError with category not-found', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);
      const notFound = new Error('no such file');
      notFound.name = 'FileNotFoundError';
      fake.read.mockRejectedValueOnce(notFound);

      const rejection = session.readFile('missing.txt');
      await expect(rejection).rejects.toMatchObject({ category: 'not-found', cause: notFound });
    });
  });

  describe('listFiles', () => {
    it('defaults to the project root and returns only files, as root-relative paths', async () => {
      const fake = createFakeHandle();
      fake.list.mockResolvedValueOnce([
        { path: '/root/src/App.jsx', type: 'file' },
        { path: '/root/src', type: 'dir' },
        { path: '/root/package.json', type: 'file' },
      ]);
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      const files = await session.listFiles();

      expect(fake.list).toHaveBeenCalledWith('/root', { depth: 20 });
      expect(files).toEqual(['src/App.jsx', 'package.json']);
    });

    it('joins an explicit directory onto the project root', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      await session.listFiles('src');

      expect(fake.list).toHaveBeenCalledWith('/root/src', { depth: 20 });
    });

    it('excludes noise directories like node_modules and .git', async () => {
      const fake = createFakeHandle();
      fake.list.mockResolvedValueOnce([
        { path: '/root/src/App.jsx', type: 'file' },
        { path: '/root/node_modules/react/index.js', type: 'file' },
        { path: '/root/.git/HEAD', type: 'file' },
        { path: '/root/dist/bundle.js', type: 'file' },
      ]);
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      const files = await session.listFiles();

      expect(files).toEqual(['src/App.jsx']);
    });

    it('strips the root prefix correctly even when projectRoot itself already ends with a slash', async () => {
      const fake = createFakeHandle();
      fake.list.mockResolvedValueOnce([{ path: '/root/src/App.jsx', type: 'file' }]);
      const session = await wrapE2bSandbox(fake.handle, { ...CONFIG, projectRoot: '/root/' });

      const files = await session.listFiles();

      expect(files).toEqual(['src/App.jsx']);
    });

    it('returns an entry path unchanged if it does not start with the project root prefix', async () => {
      // Defensive fallback, not an expected real case: if E2B ever echoed a path outside
      // projectRoot, this returns it as-is rather than mangling it with a wrong slice.
      const fake = createFakeHandle();
      fake.list.mockResolvedValueOnce([{ path: '/somewhere/else/file.txt', type: 'file' }]);
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      const files = await session.listFiles();

      expect(files).toEqual(['/somewhere/else/file.txt']);
    });

    it('wraps a list failure into a SandboxOperationError', async () => {
      const fake = createFakeHandle();
      fake.list.mockRejectedValueOnce(new Error('unexpected'));
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      await expect(session.listFiles()).rejects.toBeInstanceOf(SandboxOperationError);
    });
  });

  describe('runCommand', () => {
    it('shell-quotes args, runs in the project root, and maps the result', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      const result = await session.runCommand('npm', ['run', 'my script']);

      // Every arg is quoted, not just the one that needs it — buildCommand doesn't try to guess
      // which args are "safe" to leave bare.
      expect(fake.runCalls.at(-1)).toEqual({
        cmd: "npm 'run' 'my script'",
        opts: { cwd: '/root' },
      });
      expect(result).toEqual({ stdout: 'stdout-output', stderr: 'stderr-output', exitCode: 0 });
    });

    it('with no args runs the bare command', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      await session.runCommand('pwd');

      expect(fake.runCalls.at(-1)?.cmd).toBe('pwd');
      expect(fake.runCalls.at(-1)?.opts).toEqual({ cwd: '/root' });
    });

    it('streams live output via onOutput while still resolving with the final CommandResult', async () => {
      // This is the case the owner most wants: npm install's output scrolling live, not
      // appearing as one frozen wall of text after the command finishes.
      const fake = createFakeHandle();
      fake.handle.commands.run = vi.fn(async (_cmd: string, opts?: E2bRunOptions) => {
        opts?.onStdout?.('installing react...');
        opts?.onStderr?.('warning: peer dep');
        return { stdout: 'installing react...', stderr: 'warning: peer dep', exitCode: 0 };
      }) as unknown as E2bSandboxHandle['commands']['run'];
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      const received: ProcessOutputChunk[] = [];
      const result = await session.runCommand('npm', ['install'], {
        onOutput: (chunk) => received.push(chunk),
      });

      expect(received).toEqual([
        { stream: 'stdout', text: 'installing react...' },
        { stream: 'stderr', text: 'warning: peer dep' },
      ]);
      expect(result.exitCode).toBe(0);
    });

    it('passes no onStdout/onStderr at all when no onOutput option is given', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      await session.runCommand('pwd');

      const opts = fake.runCalls.at(-1)?.opts;
      expect(opts).not.toHaveProperty('onStdout');
      expect(opts).not.toHaveProperty('onStderr');
    });

    it('wraps a command failure into a SandboxOperationError', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);
      // Swapped in only after boot (which itself calls commands.run for the project-root
      // mkdir) has already succeeded — otherwise boot would fail first and this wouldn't be
      // testing runCommand's own error wrapping at all.
      fake.handle.commands.run = vi.fn().mockRejectedValue(new Error('spawn failed'));

      await expect(session.runCommand('pwd')).rejects.toBeInstanceOf(SandboxOperationError);
    });
  });

  describe('installDependencies', () => {
    it('with no packages runs a bare npm install', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      await session.installDependencies();

      expect(fake.runCalls.at(-1)).toEqual({ cmd: 'npm install', opts: { cwd: '/root' } });
    });

    it('with packages installs exactly the named, quoted packages', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      await session.installDependencies(['react', 'left-pad@1.3.0']);

      expect(fake.runCalls.at(-1)).toEqual({
        cmd: "npm install 'react' 'left-pad@1.3.0'",
        opts: { cwd: '/root' },
      });
    });

    it('streams live output via onOutput, same as runCommand', async () => {
      const fake = createFakeHandle();
      fake.handle.commands.run = vi.fn(async (_cmd: string, opts?: E2bRunOptions) => {
        opts?.onStdout?.('added 42 packages');
        return { stdout: 'added 42 packages', stderr: '', exitCode: 0 };
      }) as unknown as E2bSandboxHandle['commands']['run'];
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      const received: ProcessOutputChunk[] = [];
      await session.installDependencies(undefined, { onOutput: (chunk) => received.push(chunk) });

      expect(received).toEqual([{ stream: 'stdout', text: 'added 42 packages' }]);
    });

    it('wraps an install failure into a SandboxOperationError', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);
      fake.handle.commands.run = vi.fn().mockRejectedValue(new Error('npm ENOENT'));

      await expect(session.installDependencies()).rejects.toBeInstanceOf(SandboxOperationError);
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

    it('wraps a kill failure into a SandboxOperationError', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);
      const process = await session.startProcess('npm', ['run', 'dev']);
      fake.backgroundKill.mockRejectedValueOnce(new Error('kill signal lost'));

      await expect(process.kill()).rejects.toBeInstanceOf(SandboxOperationError);
    });

    it('wraps a start failure into a SandboxOperationError', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);
      fake.handle.commands.run = vi.fn().mockRejectedValue(new Error('cannot spawn'));

      await expect(session.startProcess('npm', ['run', 'dev'])).rejects.toBeInstanceOf(
        SandboxOperationError,
      );
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

    it('rejects with SandboxOperationError (category timeout) when nothing answers', async () => {
      const connectionRefused = new TypeError('fetch failed');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(connectionRefused));

      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      await expect(session.getPreview()).rejects.toBeInstanceOf(SandboxOperationError);
      await expect(session.getPreview()).rejects.toMatchObject({
        category: 'timeout',
        cause: connectionRefused,
      });
    });

    it('aborts and rejects once previewCheckTimeoutMs elapses with no response at all', async () => {
      vi.useFakeTimers();
      // A fetch that never settles on its own — the only way it resolves/rejects is via the
      // AbortSignal that checkListening's own setTimeout fires.
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
      const assertion = expect(session.getPreview()).rejects.toBeInstanceOf(SandboxOperationError);
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

    it('kills every process started via startProcess — the data-loss-shaped requirement', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);
      await session.startProcess('npm', ['run', 'dev']);

      await session.teardown();

      // The dev server process must actually be killed, not just the sandbox VM around it —
      // on /local (a future adapter), skipping this would leave a real process holding a port
      // on the user's machine after the session claims to have torn down.
      expect(fake.backgroundKill).toHaveBeenCalledOnce();
    });

    it('does not re-kill a process that was already killed directly by the caller', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);
      const process = await session.startProcess('npm', ['run', 'dev']);
      await process.kill();
      fake.backgroundKill.mockClear();

      await session.teardown();

      expect(fake.backgroundKill).not.toHaveBeenCalled();
    });

    it('still kills the sandbox even when stopping the watch fails', async () => {
      const fake = createFakeHandle();
      fake.watchStop.mockRejectedValueOnce(new Error('stop failed'));
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      await expect(session.teardown()).rejects.toBeInstanceOf(SandboxOperationError);

      expect(fake.kill).toHaveBeenCalledOnce();
    });

    it('surfaces the sandbox-kill failure over a watch-stop failure when both fail', async () => {
      const fake = createFakeHandle();
      fake.watchStop.mockRejectedValueOnce(new Error('stop failed'));
      const killFailure = new Error('kill failed');
      fake.kill.mockRejectedValueOnce(killFailure);
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      await expect(session.teardown()).rejects.toMatchObject({ cause: killFailure });
    });

    it('never deletes the project root — no filesystem call other than the boot-time mkdir', async () => {
      const fake = createFakeHandle();
      const session = await wrapE2bSandbox(fake.handle, CONFIG);

      await session.teardown();

      // The only command this whole lifecycle ever ran is the one mkdir at boot; teardown adds
      // no `rm`, no second `files` call of any kind.
      expect(fake.runCalls.map((call) => call.cmd)).toEqual(["mkdir -p '/root'"]);
      expect(fake.write).not.toHaveBeenCalled();
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
