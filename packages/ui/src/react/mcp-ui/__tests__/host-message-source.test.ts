import { describe, expect, it, vi } from 'vitest';
import { createEarlyMessageBuffer } from '../../../features/mcp-ui/early-message-buffer.js';
import {
  forwardWindowMessages,
  subscribeToViewMessages,
  viewMessageBacklogSize,
  type MessageEventTarget,
} from '../host-message-source.js';

describe('host-message-source', () => {
  it('installs its window listener at module scope, so a View that posts before any Host mounts is still heard', async () => {
    // Posted with no subscriber at all — the case a `useEffect`-only listener loses forever.
    window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, '*');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(viewMessageBacklogSize()).toBeGreaterThan(0);

    const handler = vi.fn();
    const unsubscribe = subscribeToViewMessages(handler);
    expect(handler).toHaveBeenCalled();
    expect(viewMessageBacklogSize()).toBe(0);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ data: { jsonrpc: '2.0', method: 'ui/notifications/initialized' } });

    unsubscribe();
  });

  it('delivers live messages to a subscriber, with the origin and source the browser reported', async () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToViewMessages(handler);
    window.postMessage({ hello: 'world' }, '*');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handler).toHaveBeenCalledTimes(1);
    const received = handler.mock.calls[0]?.[0] as { data: unknown; origin: string };
    expect(received.data).toEqual({ hello: 'world' });
    expect(typeof received.origin).toBe('string');
    unsubscribe();
  });

  it('forwardWindowMessages installs nothing and buffers nothing when the scope has no window (server render)', () => {
    const into = createEarlyMessageBuffer();
    expect(() => forwardWindowMessages({}, into)).not.toThrow();
    expect(into.backlogSize).toBe(0);
  });

  it('forwardWindowMessages buffers each message event from the given window with its data, origin and source', () => {
    let listener: ((event: MessageEvent) => void) | undefined;
    const addEventListener = vi.fn((type: 'message', next: (event: MessageEvent) => void) => {
      listener = next;
    });
    const target: MessageEventTarget = { addEventListener };
    const into = createEarlyMessageBuffer();

    forwardWindowMessages({ window: target }, into);
    expect(addEventListener).toHaveBeenCalledWith('message', expect.any(Function));

    listener?.(new MessageEvent('message', { data: { ping: 1 }, origin: 'https://view.example' }));
    expect(into.backlogSize).toBe(1);
    const handler = vi.fn();
    into.subscribe(handler);
    expect(handler).toHaveBeenCalledWith({ data: { ping: 1 }, origin: 'https://view.example', source: null });
  });
});
