import { describe, expect, it, vi } from 'vitest';

import type { FileChangeEvent } from '../../core/ports.js';
import type {
  E2bCommandHandle,
  E2bCommandResult,
  E2bFilesystem,
  E2bFilesystemEvent,
  E2bRunOptions,
  E2bSandboxHandle,
} from '../e2b-sandbox-handle.js';
import { wrapE2bSandbox } from '../wrap-e2b-sandbox.js';

const CONFIG = { projectRoot: '/root/app', previewPort: 4000, previewCheckTimeoutMs: 100 };

function deferred<T>(_required: Record<string, never>, _options: Record<string, never> = {}) {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHandle(_required: Record<string, never>, _options: Record<string, never> = {}) {
  const write = vi.fn<E2bFilesystem['write']>().mockResolvedValue(undefined);
  const read = vi.fn<E2bFilesystem['read']>().mockResolvedValue(new TextEncoder().encode('host'));
  const list = vi.fn<E2bFilesystem['list']>().mockResolvedValue([]);
  let onEvent: (event: E2bFilesystemEvent) => void = () => { throw new Error('Watch not started'); };
  const watchDir = vi.fn<E2bFilesystem['watchDir']>().mockImplementation(async (required) => {
    onEvent = required.onEvent;
    return { stop: async () => {} };
  });
  function run(required: { command: string }, options?: Omit<E2bRunOptions, 'background'>): Promise<E2bCommandResult>;
  function run(required: { command: string; background: true }, options?: Omit<E2bRunOptions, 'background'>): Promise<E2bCommandHandle>;
  async function run(required: { command: string; background?: true }, _options: Omit<E2bRunOptions, 'background'> = {}): Promise<E2bCommandResult | E2bCommandHandle> {
    if (required.background) return { kill: async () => true };
    return { stdout: '', stderr: '', exitCode: 0 };
  }
  const handle: E2bSandboxHandle = {
    commands: { run },
    files: { write, read, list, watchDir },
    getHost: () => 'preview.example',
    kill: async () => true,
  };
  return {
    handle, write, read, list,
    emit({ event }: { event: E2bFilesystemEvent }, _options: Record<string, never> = {}) { onEvent(event); },
  };
}

describe('mountFiles characterization', () => {
  it('writes strings and exact binary views in one batch while the final normalized duplicate owns echoes', async () => {
    const fake = createHandle({});
    const session = await wrapE2bSandbox({ handle: fake.handle, config: CONFIG });
    const events: FileChangeEvent[] = [];
    session.onFileChange({ listener: event => events.push(event) });
    const bytes = new Uint8Array([99, 0, 255, 88]).subarray(1, 3);
    await session.mountFiles({ files: [
      { path: 'src/./a', content: 'first' },
      { path: 'binary', content: bytes },
      { path: 'src/a', content: 'host' },
    ] });

    expect(fake.write).toHaveBeenCalledExactlyOnceWith({ files: [
      { path: '/root/app/src/a', data: 'first' },
      { path: '/root/app/binary', data: new Uint8Array([0, 255]).buffer },
      { path: '/root/app/src/a', data: 'host' },
    ] });
    fake.emit({ event: { name: 'src/a', type: 'create' } });
    await Promise.resolve();
    expect(events).toEqual([]);
    expect(fake.read).toHaveBeenCalledExactlyOnceWith({ path: '/root/app/src/a', format: 'bytes' });
  });

  it('rolls back every failed entry but preserves a newer mount with identical content by identity', async () => {
    const fake = createHandle({});
    const session = await wrapE2bSandbox({ handle: fake.handle, config: CONFIG });
    const events: FileChangeEvent[] = [];
    session.onFileChange({ listener: event => events.push(event) });
    const firstWrite = deferred<void>({});
    fake.write.mockImplementationOnce(() => firstWrite.promise);
    const first = session.mountFiles({ files: [
      { path: 'src/./a', content: 'host' }, { path: 'b', content: 'host' },
    ] });
    const cause = new Error('write failed');
    const rejected = expect(first).rejects.toMatchObject({
      message: 'Failed to write files into the sandbox', cause,
    });
    await session.mountFiles({ files: [{ path: 'src/a', content: 'host' }] });
    fake.emit({ event: { name: 'src/a', type: 'write' } });
    expect(fake.read).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    firstWrite.reject(cause);
    await rejected;

    fake.emit({ event: { name: 'src/a', type: 'write' } });
    fake.emit({ event: { name: 'b', type: 'write' } });
    await Promise.resolve();
    expect(fake.read).toHaveBeenCalledExactlyOnceWith({ path: '/root/app/src/a', format: 'bytes' });
    expect(events).toEqual([{ path: 'b', kind: 'modified' }]);

    fake.read.mockResolvedValueOnce(new TextEncoder().encode('sandbox edit'));
    fake.emit({ event: { name: 'src/a', type: 'write' } });
    await Promise.resolve();
    expect(events).toEqual([{ path: 'b', kind: 'modified' }, { path: 'src/a', kind: 'modified' }]);
  });

  it('loses the earlier echo fingerprint when a newer overlapping mount fails (reported, not fixed)', async () => {
    const fake = createHandle({});
    const session = await wrapE2bSandbox({ handle: fake.handle, config: CONFIG });
    const events: FileChangeEvent[] = [];
    session.onFileChange({ listener: event => events.push(event) });
    const firstWrite = deferred<void>({});
    fake.write.mockImplementationOnce(() => firstWrite.promise);
    const first = session.mountFiles({ files: [{ path: 'a', content: 'host' }] });
    const cause = new Error('later write failed');
    fake.write.mockRejectedValueOnce(cause);
    await expect(session.mountFiles({ files: [{ path: 'a', content: 'newer' }] })).rejects.toMatchObject({ cause });
    fake.emit({ event: { name: 'a', type: 'write' } });
    expect(events).toEqual([]);
    firstWrite.resolve();
    await first;
    fake.emit({ event: { name: 'a', type: 'write' } });
    expect(events).toEqual([{ path: 'a', kind: 'modified' }]);
    expect(fake.read).not.toHaveBeenCalled();
  });

  it('permits parent traversal for mount, read and list (reported, not fixed)', async () => {
    const fake = createHandle({});
    const session = await wrapE2bSandbox({ handle: fake.handle, config: CONFIG });
    await session.mountFiles({ files: [{ path: '../outside', content: 'host' }] });
    expect(fake.write).toHaveBeenCalledExactlyOnceWith({ files: [{ path: '/root/outside', data: 'host' }] });
    expect(await session.readFile({ path: '../outside' })).toEqual(new TextEncoder().encode('host'));
    expect(fake.read).toHaveBeenCalledExactlyOnceWith({ path: '/root/outside', format: 'bytes' });
    expect(await session.listFiles({}, { directory: '..' })).toEqual([]);
    expect(fake.list).toHaveBeenCalledExactlyOnceWith({ path: '/root' }, { depth: 20 });
  });
});
