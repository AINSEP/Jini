import { PassThrough, Writable } from 'node:stream';
import { expect, test, vi } from 'vitest';
import { createStdioHosting } from '../stdio-hosting.js';

test('a stream error before watch is retained, closes on connection, and dispose is idempotent', async () => {
  const stdin = new PassThrough();
  const stdout = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const hosting = createStdioHosting({ stdin, stdout, options: {} });
  const failure = new Error('host stdout failed');
  const close = vi.fn();
  stdout.emit('error', failure);
  hosting.watch({ close });
  expect(close).toHaveBeenCalledTimes(1);
  const disposed = hosting.dispose();
  expect(hosting.dispose()).toBe(disposed);
  expect(await disposed).toEqual({ error: failure });
  expect(stdout.listenerCount('error')).toBe(0);
  expect(stdin.destroyed).toBe(false);
  expect(stdout.destroyed).toBe(false);
  stdin.destroy(); stdout.destroy();
});

test('an aborted request and a queued request behind dispose never invoke their handlers', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const hosting = createStdioHosting({ stdin, stdout, options: { serial: true } });
  const task = vi.fn(async () => 'must not run');
  await expect(hosting.track({ task, signal: AbortSignal.abort() })).rejects.toThrow('MCP request cancelled');
  const pending = hosting.track({ task, signal: undefined });
  const rejected = expect(pending).rejects.toThrow('MCP request cancelled');
  const disposal = hosting.dispose();
  await rejected; await disposal;
  expect(task).not.toHaveBeenCalled();
  stdin.destroy(); stdout.destroy();
});
