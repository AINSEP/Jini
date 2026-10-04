import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { expect, it } from 'vitest';
import { listenServer } from '../index.js';

it('retries only real EADDRINUSE binds and keeps the successful listener open', async () => {
  const calls: number[] = [];
  const events = new EventEmitter();
  const server = Object.assign(events, {
    listen({ port }: { port: number }) { calls.push(port); queueMicrotask(() => events.emit(port === 3000 ? 'error' : 'listening', Object.assign(new Error('occupied'), { code: 'EADDRINUSE' }))); return events; },
    address() { return { port: calls.at(-1)! }; },
  });
  expect(await listenServer({ server, port: 3000 }, { host: '127.0.0.1', attempts: 20 })).toBe(3001);
  expect(calls).toEqual([3000, 3001]);
  expect(server.listenerCount('error')).toBe(0);
  expect(server.listenerCount('listening')).toBe(0);
});

it('explicit ports, permission errors and exhausted ranges propagate without an extra retry', async () => {
  for (const [code, attempts, expected] of [['EADDRINUSE', 1, 1], ['EACCES', 20, 1], ['EADDRINUSE', 3, 3]] as const) {
    let calls = 0;
    const error = Object.assign(new Error(code), { code });
    const events = new EventEmitter();
    const server = Object.assign(events, {
      listen() { calls++; queueMicrotask(() => events.emit('error', error)); return events; },
      address() { return null; },
    });
    await expect(listenServer({ server, port: 3000 }, { attempts })).rejects.toBe(error);
    expect(calls).toBe(expected);
    expect(server.listenerCount('error')).toBe(0);
  }
});

it('retains ownership of a real socket rather than releasing a probe', async () => {
  const server = createServer(), contender = createServer();
  try {
    const port = await listenServer({ server, port: 0 }, { host: '127.0.0.1' });
    expect(server.listening).toBe(true);
    await expect(listenServer({ server: contender, port }, { host: '127.0.0.1' })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(server.listening).toBe(true);
  } finally {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    if (contender.listening) await new Promise<void>(resolve => contender.close(() => resolve()));
  }
});
