import { describe, expect, it } from 'vitest';
import { createSseStream, lastEventCursor, type SseEvent, type SseSchedulerPort } from '../sse.js';

const event = (n: number): SseEvent => ({ opaqueCursor: String(n), kind: 'tick' });

function fakeScheduler() {
  const state = { tick: undefined as (() => void) | undefined, cancelled: 0 };
  const scheduler: SseSchedulerPort = {
    every: ({ callback }) => { state.tick = callback; return 'h'; },
    cancel: () => { state.cancelled += 1; },
  };
  return { state, scheduler };
}

describe('createSseStream', () => {
  it('writes frames with event-stream headers and ends after an end event', async () => {
    const { scheduler } = fakeScheduler();
    const stream = createSseStream<SseEvent>({ scheduler }, { isEndEvent: ({ event: e }) => e.opaqueCursor === '2' });
    stream.send({ event: event(1) });
    stream.send({ event: event(2) });
    expect(stream.response.headers.get('content-type')).toBe('text/event-stream');
    const text = await stream.response.text();
    expect(text).toContain('id: 1\nevent: tick');
    expect(text).toContain('id: 2');
    expect(stream.closed).toBe(true);
  });
  it('drops a client whose backlog passes the cap', () => {
    const { scheduler } = fakeScheduler();
    let closed = 0;
    const stream = createSseStream<SseEvent>({ scheduler }, { maxQueuedEvents: 2, onClose: () => { closed += 1; } });
    for (let i = 0; i < 3; i += 1) stream.send({ event: event(i) });
    expect([stream.closed, closed]).toEqual([true, 1]);
  });
  it('stops the keepalive and calls onClose once when the client cancels', async () => {
    const { scheduler, state } = fakeScheduler();
    let closed = 0;
    const stream = createSseStream<SseEvent>({ scheduler }, { onClose: () => { closed += 1; } });
    await stream.response.body?.cancel();
    stream.end();
    expect([state.cancelled, closed, stream.closed]).toEqual([1, 1, true]);
  });
  it('closes when the abort signal fires and sends keepalive pings', async () => {
    const { scheduler, state } = fakeScheduler();
    const controller = new AbortController();
    const stream = createSseStream<SseEvent>({ scheduler }, { signal: controller.signal });
    state.tick?.();
    const reader = stream.response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(': ping\n\n');
    controller.abort();
    expect(stream.closed).toBe(true);
  });
  it('closes at once and stops the keepalive when the signal is already aborted', async () => {
    const { scheduler, state } = fakeScheduler();
    const controller = new AbortController();
    controller.abort();
    let closed = 0;
    const stream = createSseStream<SseEvent>({ scheduler }, { signal: controller.signal, onClose: () => { closed += 1; } });
    expect([stream.closed, closed, state.cancelled]).toEqual([true, 1, 1]);
    expect(await stream.response.body!.getReader().read()).toEqual({ done: true, value: undefined });
  });
});

describe('createSseStream keepalive option', () => {
  function recordingScheduler() {
    const every: number[] = [];
    let cancelled = 0;
    const scheduler: SseSchedulerPort = { every: ({ intervalMs }) => { every.push(intervalMs); return 'h'; }, cancel: () => { cancelled += 1; } };
    return { scheduler, every, cancelled: () => cancelled };
  }
  it('keepAliveMs: false schedules no timer at all and writes no bytes while idle', async () => {
    const { scheduler, every, cancelled } = recordingScheduler();
    const stream = createSseStream<SseEvent>({ scheduler }, { keepAliveMs: false });
    stream.end();
    expect(await stream.response.text()).toBe('');
    expect([every, cancelled()]).toEqual([[], 0]);
  });
  it('a number still schedules the keepalive at that interval, and the default is 15 seconds', () => {
    const custom = recordingScheduler();
    createSseStream<SseEvent>({ scheduler: custom.scheduler }, { keepAliveMs: 5000 });
    const standard = recordingScheduler();
    createSseStream<SseEvent>({ scheduler: standard.scheduler });
    expect([custom.every, standard.every]).toEqual([[5000], [15000]]);
  });
  it('cancels the timer it scheduled when it closes, and only then', () => {
    const { scheduler, cancelled } = recordingScheduler();
    const stream = createSseStream<SseEvent>({ scheduler }, {});
    expect(cancelled()).toBe(0);
    const reader = stream.response.body!.getReader();
    void reader.cancel();
    expect(cancelled()).toBe(1);
  });
});

describe('createSseStream backlog frames', () => {
  const idsOf = (text: string) => [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
  it('a replay burst larger than the cap is delivered whole, because backlog frames are not counted against it', async () => {
    const { scheduler } = fakeScheduler();
    const stream = createSseStream<SseEvent>({ scheduler }, { maxQueuedEvents: 3, keepAliveMs: false });
    for (let i = 0; i < 10; i += 1) stream.send({ event: event(i) }, { backlog: true });
    expect(stream.closed).toBe(false);
    stream.send({ event: event(10) });
    stream.end();
    expect(idsOf(await stream.response.text())).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
  it('live frames keep the cap: the frame past it drops the client even with a backlog queued', () => {
    const { scheduler } = fakeScheduler();
    const stream = createSseStream<SseEvent>({ scheduler }, { maxQueuedEvents: 2, keepAliveMs: false });
    for (let i = 0; i < 5; i += 1) stream.send({ event: event(i) }, { backlog: true });
    stream.send({ event: event(5) });
    stream.send({ event: event(6) });
    expect(stream.closed).toBe(false);
    stream.send({ event: event(7) });
    expect(stream.closed).toBe(true);
  });
  it('a frame leaves the live count once the client has read it, so a slow reader is only capped on what it has not read', async () => {
    const { scheduler } = fakeScheduler();
    const stream = createSseStream<SseEvent>({ scheduler }, { maxQueuedEvents: 2, keepAliveMs: false });
    const reader = stream.response.body!.getReader();
    stream.send({ event: event(0) });
    stream.send({ event: event(1) });
    await reader.read();
    stream.send({ event: event(2) });
    expect(stream.closed).toBe(false);
  });
  it('omitting the option or passing backlog: false counts the frame (the existing behaviour)', () => {
    const { scheduler } = fakeScheduler();
    const stream = createSseStream<SseEvent>({ scheduler }, { maxQueuedEvents: 2, keepAliveMs: false });
    stream.send({ event: event(0) }, { backlog: false });
    stream.send({ event: event(1) });
    stream.send({ event: event(2) });
    expect(stream.closed).toBe(true);
  });
});

describe('lastEventCursor', () => {
  it('reads no cursor when afterCursor is repeated: which of two values the client meant is unknown (Express gave an array, which the old reader refused)', () => {
    expect(lastEventCursor({ request: new Request('http://l/s?afterCursor=a&afterCursor=b') })).toBe(null);
  });
  it('reads no cursor from an empty afterCursor', () => {
    expect(lastEventCursor({ request: new Request('http://l/s?afterCursor=') })).toBe(null);
  });
  it('prefers the header over the query', () => {
    expect(lastEventCursor({ request: new Request('http://l/s?afterCursor=q', { headers: { 'last-event-id': 'h' } }) })).toBe('h');
    expect(lastEventCursor({ request: new Request('http://l/s?afterCursor=q') })).toBe('q');
    expect(lastEventCursor({ request: new Request('http://l/s') })).toBe(null);
  });
});

it('resumes from the sole query cursor when the reconnect header is absent or empty', () => {
  const url = 'http://local/events?afterCursor=evt%3A42%2B7';
  expect(lastEventCursor({ request: new Request(url) })).toBe('evt:42+7');
  expect(lastEventCursor({ request: new Request(url, { headers: { 'last-event-id': '' } }) })).toBe('evt:42+7');
  expect(lastEventCursor({ request: new Request('http://local/events') })).toBeNull();
});

it('wakes a reader waiting on an idle stream for each later event and finally for EOF', async () => {
  const { scheduler } = fakeScheduler();
  const stream = createSseStream<SseEvent>({ scheduler }, { keepAliveMs: false });
  const reader = stream.response.body!.getReader();
  const decoder = new TextDecoder();
  const read = async (cursor: number) => {
    const pending = reader.read();
    await Promise.resolve();
    stream.send({ event: event(cursor) });
    const { value, done } = await pending;
    expect(done).toBe(false);
    expect(decoder.decode(value)).toBe(`id: ${cursor}\nevent: tick\ndata: {"opaqueCursor":"${cursor}","kind":"tick"}\n\n`);
  };
  try {
    await read(1);
    await read(2);
    const pending = reader.read();
    await Promise.resolve();
    stream.end();
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(stream.closed).toBe(true);
  } finally {
    await reader.cancel();
  }
});
