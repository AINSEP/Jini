import { describe, expect, it, vi } from 'vitest';
import { createInMemoryRealtimeProvider } from '../realtime.js';

describe('createInMemoryRealtimeProvider', () => {
  it('delivers a published event to a subscriber on the same channel', async () => {
    const realtime = createInMemoryRealtimeProvider({});
    const handler = vi.fn();
    realtime.subscribe({ channel: 'room:1', handler });
    await realtime.publish({ channel: 'room:1', event: { text: 'hi' } });
    expect(handler).toHaveBeenCalledWith({ event: { text: 'hi' } });
  });

  it('delivers to every subscriber on the channel', async () => {
    const realtime = createInMemoryRealtimeProvider({});
    const a = vi.fn();
    const b = vi.fn();
    realtime.subscribe({ channel: 'room:1', handler: a });
    realtime.subscribe({ channel: 'room:1', handler: b });
    await realtime.publish({ channel: 'room:1', event: 'event' });
    expect(a).toHaveBeenCalledWith({ event: 'event' });
    expect(b).toHaveBeenCalledWith({ event: 'event' });
  });

  it('does not deliver to a subscriber on a different channel', async () => {
    const realtime = createInMemoryRealtimeProvider({});
    const handler = vi.fn();
    realtime.subscribe({ channel: 'room:1', handler });
    await realtime.publish({ channel: 'room:2', event: 'event' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('publish on a channel with no subscribers resolves without error', async () => {
    const realtime = createInMemoryRealtimeProvider({});
    await expect(realtime.publish({ channel: 'empty', event: 'event' })).resolves.toBeUndefined();
  });

  it('unsubscribe stops further delivery', async () => {
    const realtime = createInMemoryRealtimeProvider({});
    const handler = vi.fn();
    const unsubscribe = realtime.subscribe({ channel: 'room:1', handler });
    unsubscribe();
    await realtime.publish({ channel: 'room:1', event: 'event' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribe is idempotent', async () => {
    const realtime = createInMemoryRealtimeProvider({});
    const handler = vi.fn();
    const unsubscribe = realtime.subscribe({ channel: 'room:1', handler });
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
    await realtime.publish({ channel: 'room:1', event: 'event' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('a handler that unsubscribes itself mid-publish does not affect delivery to other current subscribers', async () => {
    const realtime = createInMemoryRealtimeProvider({});
    const calls: string[] = [];
    let unsubscribeA: () => void;
    const a = vi.fn(() => {
      calls.push('a');
      unsubscribeA();
    });
    const b = vi.fn(() => calls.push('b'));
    unsubscribeA = realtime.subscribe({ channel: 'room:1', handler: a });
    realtime.subscribe({ channel: 'room:1', handler: b });
    await realtime.publish({ channel: 'room:1', event: 'event' });
    expect(calls).toEqual(['a', 'b']);

    calls.length = 0;
    await realtime.publish({ channel: 'room:1', event: 'event2' });
    expect(calls).toEqual(['b']);
  });
});
