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
    } as unknown as Parameters<typeof toE2bHandle>[0],
    write,
    read,
    list,
    watchDir,
    getHost,
    kill,
  };
}

describe('toE2bHandle', () => {
  it('passes commands through directly', () => {
    const { sandbox } = createFakeSandbox();
    const handle = toE2bHandle(sandbox);

    expect(handle.commands).toBe(sandbox.commands);
  });

  it('write converts a readonly array into a real mutable array for the real SDK call', async () => {
    const { sandbox, write } = createFakeSandbox();
    const handle = toE2bHandle(sandbox);
    const files = [{ path: '/root/a.txt', data: 'hello' }] as const;

    await handle.files.write(files);

    expect(write).toHaveBeenCalledOnce();
    const passedArg = write.mock.calls[0]?.[0];
    expect(Array.isArray(passedArg)).toBe(true);
    expect(passedArg).toEqual([{ path: '/root/a.txt', data: 'hello' }]);
  });

  it('read passes path and opts through and returns the real bytes', async () => {
    const { sandbox, read } = createFakeSandbox();
    const handle = toE2bHandle(sandbox);

    const bytes = await handle.files.read('/root/a.png', { format: 'bytes' });

    expect(read).toHaveBeenCalledWith('/root/a.png', { format: 'bytes' });
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('list passes path and opts through', async () => {
    const { sandbox, list } = createFakeSandbox();
    const handle = toE2bHandle(sandbox);

    await handle.files.list('/root', { depth: 20 });

    expect(list).toHaveBeenCalledWith('/root', { depth: 20 });
  });

  it('watchDir passes path, listener, and opts through', async () => {
    const { sandbox, watchDir } = createFakeSandbox();
    const handle = toE2bHandle(sandbox);
    const listener = vi.fn();

    await handle.files.watchDir('/root', listener, { recursive: true });

    expect(watchDir).toHaveBeenCalledWith('/root', listener, { recursive: true });
  });

  it('getHost and kill delegate to the real sandbox', async () => {
    const { sandbox, getHost, kill } = createFakeSandbox();
    const handle = toE2bHandle(sandbox);

    expect(handle.getHost(5173)).toBe('abc123.e2b.app');
    expect(getHost).toHaveBeenCalledWith(5173);

    await handle.kill();
    expect(kill).toHaveBeenCalledOnce();
  });
});
