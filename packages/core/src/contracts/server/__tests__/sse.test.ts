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
});

describe('lastEventCursor', () => {
  it('prefers the header over the query', () => {
    expect(lastEventCursor({ request: new Request('http://l/s?afterCursor=q', { headers: { 'last-event-id': 'h' } }) })).toBe('h');
    expect(lastEventCursor({ request: new Request('http://l/s?afterCursor=q') })).toBe('q');
    expect(lastEventCursor({ request: new Request('http://l/s') })).toBe(null);
  });
});
