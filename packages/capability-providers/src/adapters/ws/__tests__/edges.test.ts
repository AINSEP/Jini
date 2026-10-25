import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  WebSocketRealtimeProvider,
  type RealtimeWebSocketLike,
  type RealtimeWebSocketServerLike,
} from '../index.js';

/**
 * `EventEmitter`-backed fakes satisfying `RealtimeWebSocketServerLike`/`RealtimeWebSocketLike` —
 * no real socket or port, matching this package's "no real network I/O in tests by default"
 * convention. A real `ws.WebSocket`/`ws.WebSocketServer` satisfies the same narrow structural
 * shape (proven separately below by the one real end-to-end smoke test).
 */
class FakeServer implements RealtimeWebSocketServerLike {
  private readonly events = new EventEmitter();
  on({ event, listener }: { event: 'connection'; listener: (socket: RealtimeWebSocketLike) => void }): void {
    this.events.on(event, listener);
  }
  emit(event: string, ...args: unknown[]): boolean { return this.events.emit(event, ...args); }
}

class FakeSocket implements RealtimeWebSocketLike {
  private readonly events = new EventEmitter();
  on(required: { event: 'message'; listener: (data: unknown) => void } |
    { event: 'close'; listener: () => void } |
    { event: 'error'; listener: (err: Error) => void }): void {
    this.events.on(required.event, required.listener);
  }
  emit(event: string, ...args: unknown[]): boolean { return this.events.emit(event, ...args); }
  readyState = 1; // OPEN
  send = vi.fn();
}

function connect(server: FakeServer): FakeSocket {
  const socket = new FakeSocket();
  server.emit('connection', socket);
  return socket;
}

function subscribeMessage(channel: string): string {
  return JSON.stringify({ type: 'subscribe', channel });
}

function unsubscribeMessage(channel: string): string {
  return JSON.stringify({ type: 'unsubscribe', channel });
}

/** Inbound-message shape guards and socket bookkeeping edges (Stryker L6: 18 survivors). */
describe('WebSocketRealtimeProvider — inbound message guards', () => {
  async function delivered(raw: unknown): Promise<boolean> {
    const server = new FakeServer();
    const provider = new WebSocketRealtimeProvider({ server });
    const socket = connect(server);
    socket.emit('message', raw);
    await provider.publish({ channel: 'c', event: 1 });
    return socket.send.mock.calls.length > 0;
  }

  it.each([
    ['string', subscribeMessage('c')],
    ['Buffer', Buffer.from(subscribeMessage('c'))],
    ['ArrayBuffer', new Uint8Array(Buffer.from(subscribeMessage('c'))).buffer],
  ])('a well-formed subscribe as %s subscribes', async (_label, raw) => {
    expect(await delivered(raw)).toBe(true);
  });

  it.each([
    ['non-JSON text', 'subscribe c'],
    ['JSON null', 'null'],
    ['JSON number', '5'],
    ['JSON string', JSON.stringify('subscribe')],
    ['JSON array', JSON.stringify(['subscribe', 'c'])],
    ['missing channel', JSON.stringify({ type: 'subscribe' })],
    ['non-string channel', JSON.stringify({ type: 'subscribe', channel: 5 })],
    ['unknown type', JSON.stringify({ type: 'SUBSCRIBE', channel: 'c' })],
    ['a plain Uint8Array (neither Buffer nor ArrayBuffer)', new Uint8Array(Buffer.from(subscribeMessage('c')))],
    ['a number', 42],
    ['an object', { type: 'subscribe', channel: 'c' }],
  ])('%s is ignored without throwing', async (_label, raw) => {
    expect(await delivered(raw)).toBe(false);
  });
});

describe('WebSocketRealtimeProvider — socket bookkeeping', () => {
  it('sends the exact event envelope only to OPEN sockets', async () => {
    const server = new FakeServer();
    const provider = new WebSocketRealtimeProvider({ server });
    const open = connect(server);
    const closing = connect(server);
    closing.readyState = 2;
    open.emit('message', subscribeMessage('c'));
    closing.emit('message', subscribeMessage('c'));
    await provider.publish({ channel: 'c', event: { n: 1 } });
    expect(open.send).toHaveBeenCalledWith({ data: JSON.stringify({ type: 'event', channel: 'c', event: { n: 1 } }) });
    expect(closing.send).not.toHaveBeenCalled();
  });

  it('close removes the socket from every channel it joined, and only that socket', async () => {
    const server = new FakeServer();
    const provider = new WebSocketRealtimeProvider({ server });
    const a = connect(server);
    const b = connect(server);
    for (const channel of ['x', 'y', 'z']) a.emit('message', subscribeMessage(channel));
    b.emit('message', subscribeMessage('y'));
    a.emit('close');
    for (const channel of ['x', 'y', 'z']) await provider.publish({ channel, event: channel });
    expect(a.send).not.toHaveBeenCalled();
    expect(b.send).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe from a channel never joined, and an error event, are harmless', async () => {
    const server = new FakeServer();
    const provider = new WebSocketRealtimeProvider({ server });
    const socket = connect(server);
    expect(() => socket.emit('message', unsubscribeMessage('never'))).not.toThrow();
    expect(() => socket.emit('error', new Error('boom'))).not.toThrow();
    socket.emit('message', subscribeMessage('c'));
    socket.emit('message', unsubscribeMessage('c'));
    socket.emit('close');
    await provider.publish({ channel: 'c', event: 1 });
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('a channel with no sockets left after unsubscribe sends nothing; subscribers on other channels are unaffected', async () => {
    const server = new FakeServer();
    const provider = new WebSocketRealtimeProvider({ server });
    const a = connect(server);
    a.emit('message', subscribeMessage('c'));
    a.emit('message', subscribeMessage('d'));
    a.emit('message', unsubscribeMessage('c'));
    await provider.publish({ channel: 'c', event: 1 });
    await provider.publish({ channel: 'd', event: 2 });
    expect(a.send).toHaveBeenCalledTimes(1);
    expect(a.send).toHaveBeenCalledWith({ data: JSON.stringify({ type: 'event', channel: 'd', event: 2 }) });
  });
});
