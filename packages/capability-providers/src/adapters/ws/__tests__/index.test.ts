import { EventEmitter } from 'node:events';
import { WebSocket as RealWebSocket } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import {
  WebSocketRealtimeProvider,
  createWebSocketRealtimeProvider,
  type RealtimeWebSocketLike,
  type RealtimeWebSocketServerLike,
} from '../index.js';

/**
 * `EventEmitter`-backed fakes satisfying `RealtimeWebSocketServerLike`/`RealtimeWebSocketLike` —
 * no real socket or port, matching this package's "no real network I/O in tests by default"
 * convention. A real `ws.WebSocket`/`ws.WebSocketServer` satisfies the same narrow structural
 * shape (proven separately below by the one real end-to-end smoke test).
 */
class FakeServer extends EventEmitter implements RealtimeWebSocketServerLike {}

class FakeSocket extends EventEmitter implements RealtimeWebSocketLike {
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

describe('WebSocketRealtimeProvider — in-process subscribe/publish (no sockets involved)', () => {
  it('delivers a published event to an in-process subscriber on the same channel', async () => {
    const provider = new WebSocketRealtimeProvider({ server: new FakeServer() });
    const handler = vi.fn();
    provider.subscribe('room:1', handler);
    await provider.publish('room:1', { text: 'hi' });
    expect(handler).toHaveBeenCalledWith({ text: 'hi' });
  });

  it('does not deliver to a subscriber on a different channel', async () => {
    const provider = new WebSocketRealtimeProvider({ server: new FakeServer() });
    const handler = vi.fn();
    provider.subscribe('room:1', handler);
    await provider.publish('room:2', 'event');
    expect(handler).not.toHaveBeenCalled();
  });

  it('publish on a channel with no subscribers resolves without error', async () => {
    const provider = new WebSocketRealtimeProvider({ server: new FakeServer() });
    await expect(provider.publish('empty', 'event')).resolves.toBeUndefined();
  });

  it('unsubscribe stops further delivery and is idempotent', async () => {
    const provider = new WebSocketRealtimeProvider({ server: new FakeServer() });
    const handler = vi.fn();
    const unsubscribe = provider.subscribe('room:1', handler);
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
    await provider.publish('room:1', 'event');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('WebSocketRealtimeProvider — remote WebSocket subscribers (fake transport)', () => {
  it('sends an event to a socket that subscribed to the channel', async () => {
    const server = new FakeServer();
    const provider = new WebSocketRealtimeProvider({ server });
    const socket = connect(server);

    socket.emit('message', subscribeMessage('chat'));
    await provider.publish('chat', { hello: 'world' });

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'event', channel: 'chat', event: { hello: 'world' } }));
  });

  it('does not send to a socket that never subscribed', async () => {
    const server = new FakeServer();
    const provider = new WebSocketRealtimeProvider({ server });
    const socket = connect(server);

    await provider.publish('chat', { hello: 'world' });
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('unsubscribe (via message) stops further delivery to that socket', async () => {
    const server = new FakeServer();
    const provider = new WebSocketRealtimeProvider({ server });
    const socket = connect(server);

    socket.emit('message', subscribeMessage('chat'));
    socket.emit('message', unsubscribeMessage('chat'));
    await provider.publish('chat', 'event');

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('a closed socket is cleaned out of its channels and stops receiving publishes', async () => {
    const server = new FakeServer();
    const provider = new WebSocketRealtimeProvider({ server });
    const socket = connect(server);

    socket.emit('message', subscribeMessage('chat'));
    socket.emit('close');
    await provider.publish('chat', 'event');

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('an errored socket does not throw and does not crash delivery to other sockets', async () => {
    const server = new FakeServer();
    const provider = new WebSocketRealtimeProvider({ server });
    const socketA = connect(server);
    const socketB = connect(server);

    socketA.emit('message', subscribeMessage('chat'));
    socketB.emit('message', subscribeMessage('chat'));
    expect(() => socketA.emit('error', new Error('boom'))).not.toThrow();

    await provider.publish('chat', 'event');
    expect(socketB.send).toHaveBeenCalled();
  });

  it('skips a subscribed socket whose readyState is not OPEN', async () => {
    const server = new FakeServer();
    const provider = new WebSocketRealtimeProvider({ server });
    const socket = connect(server);
    socket.readyState = 3; // CLOSED

    socket.emit('message', subscribeMessage('chat'));
    await provider.publish('chat', 'event');

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('delivers to both in-process handlers and subscribed sockets on the same publish', async () => {
    const server = new FakeServer();
    const provider = new WebSocketRealtimeProvider({ server });
    const socket = connect(server);
    const handler = vi.fn();

    provider.subscribe('chat', handler);
    socket.emit('message', subscribeMessage('chat'));
    await provider.publish('chat', 'event');

    expect(handler).toHaveBeenCalledWith('event');
    expect(socket.send).toHaveBeenCalled();
  });

  it('publishing to a channel every subscriber has since unsubscribed from (empty-but-present socket set) does not throw', async () => {
    const server = new FakeServer();
    const provider = new WebSocketRealtimeProvider({ server });
    const socket = connect(server);

    socket.emit('message', subscribeMessage('chat'));
    socket.emit('message', unsubscribeMessage('chat'));
    await expect(provider.publish('chat', 'event')).resolves.toBeUndefined();
  });

  it.each([
    ['a Buffer', Buffer.from(subscribeMessage('chat'))],
    ['an ArrayBuffer', Uint8Array.from(Buffer.from(subscribeMessage('chat'))).buffer],
  ])('accepts a subscribe message delivered as %s', async (_label, raw) => {
    const server = new FakeServer();
    const provider = new WebSocketRealtimeProvider({ server });
    const socket = connect(server);

    socket.emit('message', raw);
    await provider.publish('chat', 'event');
    expect(socket.send).toHaveBeenCalled();
  });

  it.each([
    ['a number (not string/Buffer/ArrayBuffer)', 42],
    ['invalid JSON text', 'not json {{'],
    ['JSON null', 'null'],
    ['a JSON array (not an object)', '[1,2,3]'],
    ['an unrecognized type field', JSON.stringify({ type: 'ping', channel: 'chat' })],
    ['a non-string channel field', JSON.stringify({ type: 'subscribe', channel: 123 })],
  ])('ignores a malformed client message: %s', async (_label, raw) => {
    const server = new FakeServer();
    const provider = new WebSocketRealtimeProvider({ server });
    const socket = connect(server);

    expect(() => socket.emit('message', raw)).not.toThrow();
    await provider.publish('chat', 'event');
    expect(socket.send).not.toHaveBeenCalled();
  });
});

describe('createWebSocketRealtimeProvider — real ws.WebSocketServer end-to-end', () => {
  it('a real WebSocket client that subscribes receives a published event', async () => {
    const { provider, server } = createWebSocketRealtimeProvider({ wsOptions: { host: '127.0.0.1', port: 0 } });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const client = new RealWebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve());
      client.once('error', reject);
    });

    const nextMessage = new Promise<unknown>((resolve) => {
      client.once('message', (data: Buffer) => resolve(JSON.parse(data.toString('utf8'))));
    });
    client.send(subscribeMessage('chat'));
    // Give the server a moment to process the subscribe message before publishing.
    await new Promise((resolve) => setTimeout(resolve, 50));

    await provider.publish('chat', { hello: 'world' });
    await expect(nextMessage).resolves.toEqual({ type: 'event', channel: 'chat', event: { hello: 'world' } });

    client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
