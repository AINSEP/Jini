import { createSocket } from 'node:dgram';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, test } from 'vitest';
import { createUdpDnsExchange } from '../udp.js';

const sockets: Array<{ close: () => void }> = [];
afterEach(() => { for (const socket of sockets.splice(0)) socket.close(); });

/** A loopback UDP server that echoes each datagram with its first byte flipped. */
async function echoServer(): Promise<number> {
  const server = createSocket('udp4');
  sockets.push(server);
  server.on('message', (message, remote) => server.send(Uint8Array.from([message[0] as number ^ 0xff, ...message.subarray(1)]), remote.port, remote.address));
  await new Promise<void>(resolve => server.bind(0, '127.0.0.1', resolve));
  return server.address().port;
}

class FakeSocket extends EventEmitter {
  closed = 0;
  constructor(private readonly sendError?: Error) { super(); }
  send(_message: Uint8Array, _port: number, _address: string, callback: (error: Error | null) => void): void { callback(this.sendError ?? null); }
  close(): void { this.closed += 1; }
}

describe('createUdpDnsExchange', () => {
  test('sends one datagram over the real socket and resolves with the reply', async () => {
    const port = await echoServer();
    const reply = await createUdpDnsExchange({}, { port })({ address: '127.0.0.1', message: Uint8Array.from([1, 2, 3]), timeoutMs: 2000 });
    expect([...reply]).toEqual([0xfe, 2, 3]);
  });

  test('times out with ETIMEOUT, closes once, and ignores a late reply', async () => {
    const socket = new FakeSocket();
    let fire: () => void = () => undefined;
    const cleared: unknown[] = [];
    const exchange = createUdpDnsExchange({}, { createSocket: () => socket as never, setTimer: callback => { fire = callback; return 'timer'; }, clearTimer: handle => cleared.push(handle) });
    const pending = exchange({ address: '2001:db8::53', message: Uint8Array.from([1]), timeoutMs: 5 });
    fire();
    socket.emit('message', Buffer.from([9]));
    await expect(pending).rejects.toMatchObject({ code: 'ETIMEOUT' });
    expect(socket.closed).toBe(1);
    expect(cleared).toEqual(['timer']);
  });

  test('a socket error or a failed send rejects', async () => {
    const erroring = new FakeSocket();
    const pending = createUdpDnsExchange({}, { createSocket: () => erroring as never })({ address: '192.0.2.1', message: Uint8Array.from([1]), timeoutMs: 1000 });
    erroring.emit('error', new Error('EHOSTUNREACH'));
    await expect(pending).rejects.toThrow('EHOSTUNREACH');
    const failedSend = createUdpDnsExchange({}, { createSocket: () => new FakeSocket(new Error('EPERM')) as never });
    await expect(failedSend({ address: '192.0.2.1', message: Uint8Array.from([1]), timeoutMs: 1000 })).rejects.toThrow('EPERM');
  });

  test('picks udp6 for an IPv6 server and udp4 otherwise', async () => {
    const types: string[] = [];
    const exchange = createUdpDnsExchange({}, { createSocket: type => { types.push(type); return new FakeSocket(new Error('stop')) as never; } });
    await expect(exchange({ address: '2001:db8::1', message: Uint8Array.from([1]), timeoutMs: 1 })).rejects.toThrow();
    await expect(exchange({ address: '192.0.2.1', message: Uint8Array.from([1]), timeoutMs: 1 })).rejects.toThrow();
    expect(types).toEqual(['udp6', 'udp4']);
  });
});
