import { describe, expect, it } from 'vitest';
import { MAX_BUFFERED_MESSAGES, createEarlyMessageBuffer, type BufferedWindowMessage } from './mcpui-lab-message-buffer.js';

function msg(data: unknown, origin = 'http://view.example'): BufferedWindowMessage {
  return { data, origin, source: null };
}

describe('createEarlyMessageBuffer', () => {
  it('delivers a message pushed before any subscriber exists, once one subscribes', () => {
    // This is the actual race the fixture exists to survive: postMessage does not queue for a
    // listener that doesn't exist yet, so the only way to not lose the message is to buffer it.
    const buffer = createEarlyMessageBuffer();
    buffer.push(msg({ jsonrpc: '2.0', id: 'v1', method: 'ui/initialize' }));

    const received: BufferedWindowMessage[] = [];
    buffer.subscribe((message) => received.push(message));

    expect(received).toHaveLength(1);
    expect(received[0]?.data).toEqual({ jsonrpc: '2.0', id: 'v1', method: 'ui/initialize' });
  });

  it('drains multiple backlogged messages to a new subscriber in arrival order', () => {
    const buffer = createEarlyMessageBuffer();
    buffer.push(msg({ seq: 1 }));
    buffer.push(msg({ seq: 2 }));
    buffer.push(msg({ seq: 3 }));

    const received: unknown[] = [];
    buffer.subscribe((message) => received.push(message.data));

    expect(received).toEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
  });

  it('delivers directly to a live subscriber without ever touching the backlog', () => {
    const buffer = createEarlyMessageBuffer();
    const received: unknown[] = [];
    buffer.subscribe((message) => received.push(message.data));

    buffer.push(msg({ seq: 'live' }));

    expect(received).toEqual([{ seq: 'live' }]);
    expect(buffer.backlogSize).toBe(0);
  });

  it('reports backlog size while nothing is subscribed', () => {
    const buffer = createEarlyMessageBuffer();
    expect(buffer.backlogSize).toBe(0);
    buffer.push(msg('a'));
    buffer.push(msg('b'));
    expect(buffer.backlogSize).toBe(2);
  });

  it('evicts the OLDEST message once the cap is exceeded, so a flood cannot grow it unbounded', () => {
    const buffer = createEarlyMessageBuffer(3);
    buffer.push(msg('oldest'));
    buffer.push(msg('middle'));
    buffer.push(msg('newest-1'));
    buffer.push(msg('newest-2')); // pushes the cap to 4; 'oldest' must be evicted

    expect(buffer.backlogSize).toBe(3);
    const received: unknown[] = [];
    buffer.subscribe((message) => received.push(message.data));
    expect(received).toEqual(['middle', 'newest-1', 'newest-2']);
  });

  it('defaults the cap to MAX_BUFFERED_MESSAGES', () => {
    const buffer = createEarlyMessageBuffer();
    for (let i = 0; i < MAX_BUFFERED_MESSAGES + 10; i += 1) buffer.push(msg(i));
    expect(buffer.backlogSize).toBe(MAX_BUFFERED_MESSAGES);
  });

  it('stops delivering to a handler after it unsubscribes', () => {
    const buffer = createEarlyMessageBuffer();
    const received: unknown[] = [];
    const unsubscribe = buffer.subscribe((message) => received.push(message.data));
    buffer.push(msg('before-unsubscribe'));
    unsubscribe();
    buffer.push(msg('after-unsubscribe'));

    expect(received).toEqual(['before-unsubscribe']);
    // With nobody live, the post-unsubscribe message must go back to the backlog rather than
    // vanish — a remount (a new subscriber) must still see it.
    expect(buffer.backlogSize).toBe(1);
  });

  it("a stale unsubscribe cannot cancel a NEWER subscriber's registration", () => {
    // Models a React StrictMode double-mount / fast remount: an old effect's cleanup running
    // after a new effect has already subscribed must not silently deafen the current Host.
    const buffer = createEarlyMessageBuffer();
    const firstReceived: unknown[] = [];
    const secondReceived: unknown[] = [];
    const unsubscribeFirst = buffer.subscribe((message) => firstReceived.push(message.data));
    buffer.subscribe((message) => secondReceived.push(message.data));

    unsubscribeFirst(); // stale — the second subscriber is now live, this must be a no-op

    buffer.push(msg('after-stale-unsubscribe'));

    expect(secondReceived).toEqual(['after-stale-unsubscribe']);
    expect(firstReceived).toEqual([]);
  });

  it('keeps independent buffers fully isolated from one another', () => {
    const bufferA = createEarlyMessageBuffer();
    const bufferB = createEarlyMessageBuffer();
    bufferA.push(msg('only-in-a'));
    expect(bufferA.backlogSize).toBe(1);
    expect(bufferB.backlogSize).toBe(0);
  });
});
