import { afterEach, expect, it, vi } from 'vitest';
import { openFetchFrontendStream } from '../frontend-session-bridge.js';

afterEach(() => { vi.useRealTimers(); });

const none = () => ({});

it('fetch stream reconnects after a dropped stream and resets the backoff once an event arrives', async () => {
  vi.useFakeTimers();
  const send = vi.fn<typeof fetch>(async () => new Response('data: {"type":"attached"}\n\n'));
  const stream = openFetchFrontendStream({ url: '/stream', headers: none }, { fetch: send as typeof fetch });
  const errors = vi.fn();
  stream.addEventListener('error', errors);
  try {
    await vi.advanceTimersByTimeAsync(0); expect(send).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); expect(send).toHaveBeenCalledTimes(2);
    // The delivered event reset the delay, so the next attempt is 1s away again, not 2s.
    await vi.advanceTimersByTimeAsync(1000); expect(send).toHaveBeenCalledTimes(3);
  } finally { stream.close(); }
});

it.each([401, 403, 404, 429])('fetch stream does not retry a terminal %i refusal', async (status) => {
  vi.useFakeTimers();
  const send = vi.fn<typeof fetch>(async () => new Response('', { status }));
  const stream = openFetchFrontendStream({ url: '/stream', headers: none }, { fetch: send as typeof fetch });
  const errors = vi.fn();
  stream.addEventListener('error', errors);
  try {
    await vi.advanceTimersByTimeAsync(120_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
  } finally { stream.close(); }
});

it('fetch stream sends same-origin credentials and refuses redirects', async () => {
  const send = vi.fn<typeof fetch>(async () => new Response('', { status: 403 }));
  const stream = openFetchFrontendStream({ url: '/stream', headers: () => ({ 'x-tab': 't' }) }, { fetch: send as typeof fetch });
  try {
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith('/stream', expect.objectContaining({
      credentials: 'same-origin', mode: 'same-origin', redirect: 'error', headers: { 'x-tab': 't' },
    }));
  } finally { stream.close(); }
});

it('aborting during a read stops delivery, emits no error and schedules no retry', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const send = vi.fn<typeof fetch>(async (_url, init) => {
    signal = init?.signal ?? undefined;
    return new Response(new ReadableStream<Uint8Array>({ start(c) { controller = c; } }));
  });
  const stream = openFetchFrontendStream({ url: '/stream', headers: none }, { fetch: send as typeof fetch });
  const frames: string[] = [];
  const errors = vi.fn();
  stream.addEventListener('message', event => frames.push((event as MessageEvent<string>).data));
  stream.addEventListener('error', errors);
  await vi.advanceTimersByTimeAsync(0);
  controller.enqueue(new TextEncoder().encode('data: one\n\n'));
  await vi.advanceTimersByTimeAsync(0);
  expect(frames).toEqual(['one']);
  stream.close();
  expect(signal?.aborted).toBe(true);
  controller.enqueue(new TextEncoder().encode('data: two\n\n'));
  controller.close();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(frames).toEqual(['one']);
  expect(errors).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(1);
});
