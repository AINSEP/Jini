/**
 * `toE2bHandle` exists for one reason: TypeScript can't reliably check a real `Sandbox`
 * instance's overloaded `files.write` against `E2bSandboxHandle`'s batch-only signature (see its
 * doc comment in provider.ts). These tests prove the wrapper it builds actually delegates to the
 * real object's methods with the right arguments — not just that it compiles.
 */
import { describe, expect, it, vi } from 'vitest';

import { toE2bHandle } from '../provider.js';

function createFakeSandbox() {
  const write = vi.fn().mockResolvedValue([]);
  const read = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
  const list = vi.fn().mockResolvedValue([]);
  const watchDir = vi.fn().mockResolvedValue({ stop: vi.fn() });
  const getHost = vi.fn().mockReturnValue('abc123.e2b.app');
  const kill = vi.fn().mockResolvedValue(true);

  return {
    sandbox: {
      commands: { run: vi.fn() },
      files: { write, read, list, watchDir },
      getHost,
      kill,
      // Fields a real Sandbox carries that this adapter never touches — present so a reader
      // can see the fake is deliberately partial, not accidentally missing something used.
    } as unknown as Parameters<typeof toE2bHandle>[0]["sandbox"],
    write,
    read,
    list,
    watchDir,
    getHost,
    kill,
  };
}

describe('toE2bHandle', () => {
  it('translates SDK output strings into object callback payloads', async () => {
    const { sandbox } = createFakeSandbox();
    const stdout = vi.fn(); const stderr = vi.fn();
    const run = vi.mocked(sandbox.commands.run);
    run.mockImplementation(async (_command, options) => {
      options?.onStdout?.('out'); options?.onStderr?.('err');
      return { stdout: 'out', stderr: 'err', exitCode: 0 } as never;
    });
    await toE2bHandle({ sandbox }).commands.run({ command: 'echo value' }, { onStdout: stdout, onStderr: stderr });
    expect(stdout).toHaveBeenCalledWith({ data: 'out' });
    expect(stderr).toHaveBeenCalledWith({ data: 'err' });
  });
  it('translates object command inputs to the SDK arguments', async () => {
    const { sandbox } = createFakeSandbox();
    const handle = toE2bHandle({ sandbox });

    await handle.commands.run({ command: 'npm install' }, { cwd: '/root' });
    expect(sandbox.commands.run).toHaveBeenCalledWith('npm install', { cwd: '/root' });
  });

  it('translates a background process selector at the SDK boundary', async () => {
    const { sandbox } = createFakeSandbox();
    const handle = toE2bHandle({ sandbox });
    await handle.commands.run({ command: 'npm run dev', background: true }, { cwd: '/root' });
    expect(sandbox.commands.run).toHaveBeenCalledWith('npm run dev', { cwd: '/root', background: true });
  });

  it('write converts a readonly array into a real mutable array for the real SDK call', async () => {
    const { sandbox, write } = createFakeSandbox();
    const handle = toE2bHandle({ sandbox });
    const files = [{ path: '/root/a.txt', data: 'hello' }] as const;

    await handle.files.write({ files });

    expect(write).toHaveBeenCalledOnce();
    const passedArg = write.mock.calls[0]?.[0];
    expect(Array.isArray(passedArg)).toBe(true);
    expect(passedArg).toEqual([{ path: '/root/a.txt', data: 'hello' }]);
  });

  it('read passes path and opts through and returns the real bytes', async () => {
    const { sandbox, read } = createFakeSandbox();
    const handle = toE2bHandle({ sandbox });

    const bytes = await handle.files.read({ path: '/root/a.png', format: 'bytes' });

    expect(read).toHaveBeenCalledWith('/root/a.png', { format: 'bytes' });
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('list passes path and opts through', async () => {
    const { sandbox, list } = createFakeSandbox();
    const handle = toE2bHandle({ sandbox });

    await handle.files.list({ path: '/root' }, { depth: 20 });

    expect(list).toHaveBeenCalledWith('/root', { depth: 20 });
  });

  it('watchDir passes path, listener, and opts through', async () => {
    const { sandbox, watchDir } = createFakeSandbox();
    const handle = toE2bHandle({ sandbox });
    const listener = vi.fn();

    await handle.files.watchDir({ path: '/root', onEvent: listener }, { recursive: true });

    expect(watchDir).toHaveBeenCalledWith('/root', listener, { recursive: true });
  });

  it('getHost and kill delegate to the real sandbox', async () => {
    const { sandbox, getHost, kill } = createFakeSandbox();
    const handle = toE2bHandle({ sandbox });

    expect(handle.getHost({ port: 5173 })).toBe('abc123.e2b.app');
    expect(getHost).toHaveBeenCalledWith(5173);

    await handle.kill();
    expect(kill).toHaveBeenCalledOnce();
  });
});
