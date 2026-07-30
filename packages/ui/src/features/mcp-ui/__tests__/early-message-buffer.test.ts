import { describe, expect, it, vi } from 'vitest';
import { MAX_BUFFERED_MESSAGES, createEarlyMessageBuffer, type BufferedWindowMessage } from '../early-message-buffer.js';

function message(data: unknown): BufferedWindowMessage {
  return { data, origin: 'null', source: null };
}

describe('createEarlyMessageBuffer', () => {
  it('replays messages pushed before anyone subscribed, in arrival order', () => {
    const buffer = createEarlyMessageBuffer();
    buffer.push(message('first'));
    buffer.push(message('second'));
    expect(buffer.backlogSize).toBe(2);

    const seen: unknown[] = [];
    buffer.subscribe((received) => seen.push(received.data));
    expect(seen).toEqual(['first', 'second']);
    expect(buffer.backlogSize).toBe(0);
  });

  it('delivers straight to live subscribers without buffering', () => {
    const buffer = createEarlyMessageBuffer();
    const seen: unknown[] = [];
    buffer.subscribe((received) => seen.push(received.data));
    buffer.push(message('live'));
    expect(seen).toEqual(['live']);
    expect(buffer.backlogSize).toBe(0);
  });

  it('subscribing with an empty backlog delivers nothing', () => {
    const buffer = createEarlyMessageBuffer();
    const handler = vi.fn();
    buffer.subscribe(handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it('broadcasts to every live subscriber, not just the most recent', () => {
    const buffer = createEarlyMessageBuffer();
    const first = vi.fn();
    const second = vi.fn();
    buffer.subscribe(first);
    buffer.subscribe(second);
    buffer.push(message('x'));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe removes only its own handler, and buffering resumes once none are left', () => {
    const buffer = createEarlyMessageBuffer();
    const kept = vi.fn();
    const dropped = vi.fn();
    buffer.subscribe(kept);
    const unsubscribe = buffer.subscribe(dropped);

    unsubscribe();
    buffer.push(message('after-unsubscribe'));
    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();

    unsubscribe();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it('survives a handler that unsubscribes itself mid-broadcast', () => {
    const buffer = createEarlyMessageBuffer();
    const other = vi.fn();
    const unsubscribe = buffer.subscribe(() => unsubscribe());
    buffer.subscribe(other);
    expect(() => buffer.push(message('x'))).not.toThrow();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('does not replay a message a draining handler pushes back in during its own drain', () => {
    const buffer = createEarlyMessageBuffer();
    buffer.push(message('original'));
    const seen: unknown[] = [];
    let pushedBack = false;
    buffer.subscribe((received) => {
      seen.push(received.data);
      if (pushedBack) return;
      pushedBack = true;
      buffer.push(message('echo'));
    });
    // The echo lands via the live-handler path (the subscriber is already registered), so it is
    // delivered once and never enters the backlog being drained.
    expect(seen).toEqual(['original', 'echo']);
    expect(buffer.backlogSize).toBe(0);
  });

  it('evicts oldest-first once the backlog cap is hit', () => {
    const buffer = createEarlyMessageBuffer(3);
    for (const index of [1, 2, 3, 4, 5]) buffer.push(message(index));
    expect(buffer.backlogSize).toBe(3);
    const seen: unknown[] = [];
    buffer.subscribe((received) => seen.push(received.data));
    expect(seen).toEqual([3, 4, 5]);
  });

  it('defaults its cap to MAX_BUFFERED_MESSAGES', () => {
    const buffer = createEarlyMessageBuffer();
    for (let index = 0; index < MAX_BUFFERED_MESSAGES + 5; index += 1) buffer.push(message(index));
    expect(buffer.backlogSize).toBe(MAX_BUFFERED_MESSAGES);
  });
});
