import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { openSettingsChangeStream } from '../stream.js';

// Moved from core's log-safety-a test with the stream itself (settings/express now lives in http-kit).
const sentinel = 'lilac otter private orchard';
const failure = () => Object.assign(new Error(sentinel), { stack: sentinel });
afterEach(() => vi.restoreAllMocks());

it('retries a failed poll and releases every schedule even when the reporter throws', async () => {
  const request = Object.assign(new EventEmitter(), { headers: {}, httpVersionMajor: 1 }) as Request;
  const response = Object.assign(new EventEmitter(), { write: vi.fn(), writeHead: vi.fn(), end: vi.fn(), writableEnded: false, destroyed: false }) as unknown as Response;
  const callbacks: Array<() => void> = [];
  const cancel = vi.fn();
  const collect = vi.fn().mockRejectedValueOnce(failure()).mockResolvedValue({ namespaces: ['public'], cursor: 2, examinedCount: 1 });
  const onError = vi.fn(() => { throw failure(); });
  const close = await openSettingsChangeStream({ request, response, workspaceId: 'w', principalId: 'p', permission: 'read', authorize: async () => ({ allowed: true, reason: '' }), changeFeed: { head: async () => 2, collect }, scheduler: { every: ({ callback }: { callback: () => void }) => { callbacks.push(callback); return cancel; } }, onClose: () => {}, isDisposed: () => false }, { onError });
  callbacks[0]!();
  await new Promise<void>(resolve => queueMicrotask(resolve));
  callbacks[0]!();
  await new Promise<void>(resolve => queueMicrotask(resolve));
  expect(collect).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(vi.mocked(response.write).mock.calls)).not.toContain(sentinel);
  close();
  expect(cancel).toHaveBeenCalledTimes(3);
  expect(response.end).toHaveBeenCalledTimes(1);
  expect(request.listenerCount('close')).toBe(0);
  expect(response.listenerCount('close')).toBe(0);
});
