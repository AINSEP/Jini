import { expect, test, vi } from 'vitest';
import { readFetchResponseText } from '../fetch-with-timeout.js';

test.each(['throw', 'reject'] as const)('reader cancellation may %s without replacing a source failure', async mode => {
  const failure = new Error('source failed');
  const cancel = vi.fn(() => {
    if (mode === 'throw') throw new Error('cancel failed');
    return Promise.reject(new Error('cancel failed'));
  });
  const releaseLock = vi.fn();
  const reader = { read: async () => { throw failure; }, cancel, releaseLock };
  const response = { body: { getReader: () => reader } } as unknown as Response;
  await expect(readFetchResponseText({ response }, { strictUtf8: true })).rejects.toBe(failure);
  expect(cancel).toHaveBeenCalledWith(failure);
  expect(releaseLock).toHaveBeenCalledTimes(1);
});

test('a lock-release fault after successful decoding remains observable', async () => {
  const failure = new Error('release failed');
  const cancel = vi.fn(async () => {});
  const reader = { read: async () => ({ done: true }), cancel, releaseLock: () => { throw failure; } };
  const response = { body: { getReader: () => reader } } as unknown as Response;
  await expect(readFetchResponseText({ response }, { maxResponseBytes: 1 })).rejects.toBe(failure);
  expect(cancel).not.toHaveBeenCalled();
});

test('an empty response still validates a details-mode cap before returning an exact empty result', async () => {
  expect(await readFetchResponseText({ response: new Response(null), result: 'details', maxResponseBytes: 0 })).toEqual({
    text: '', byteLength: 0, truncated: false,
  });
  await expect(readFetchResponseText({ response: new Response(null), result: 'details', maxResponseBytes: -1 })).rejects.toThrow(RangeError);
});
