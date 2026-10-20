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

// --- Characterization pins (written on the pre-refactor code) ---

type ListenCall = { port: number; host?: string };
/** Deterministic listener double: `outcome` decides, per call, how the bind ends. */
function fakeServer(outcome: (call: ListenCall, index: number) => { emit: 'listening' } | { emit: 'error'; error: unknown } | { throws: unknown }, address: () => { port: number } | string | null = () => null) {
  const calls: ListenCall[] = [];
  const events = new EventEmitter();
  const server = Object.assign(events, {
    listen(input: ListenCall) {
      calls.push(input);
      const result = outcome(input, calls.length - 1);
      if ('throws' in result) throw result.throws;
      queueMicrotask(() => result.emit === 'error' ? events.emit('error', result.error) : events.emit('listening'));
      return events;
    },
    address,
  });
  return { server, calls };
}
const inUse = () => Object.assign(new Error('in use'), { code: 'EADDRINUSE' });

it.each([
  ['zero attempts', 3000, 0], ['fractional attempts', 3000, 1.5], ['negative port', -1, 1], ['fractional port', 1.5, 1],
  ['a range past 65535', 65535, 2], ['a port past 65535', 65536, 1],
])('refuses %s before any bind', async (_name, port, attempts) => {
  const { server, calls } = fakeServer(() => ({ emit: 'listening' }));
  await expect(listenServer({ server, port }, { attempts })).rejects.toThrow(new RangeError('Invalid listener port or attempt range'));
  expect(calls).toEqual([]);
});

it('accepts a range that ends exactly at 65535', async () => {
  const { server, calls } = fakeServer(call => call.port === 65534 ? { emit: 'error', error: inUse() } : { emit: 'listening' });
  expect(await listenServer({ server, port: 65534 }, { attempts: 2 })).toBe(65535);
  expect(calls).toEqual([{ port: 65534 }, { port: 65535 }]);
});

it('passes the host only when one is given', async () => {
  const { server, calls } = fakeServer(() => ({ emit: 'listening' }));
  await listenServer({ server, port: 4000 }, { host: '::1' });
  await listenServer({ server, port: 4000 });
  expect(calls).toEqual([{ port: 4000, host: '::1' }, { port: 4000 }]);
});

it('returns the bound address port, or the requested port when the address is a pipe name or null', async () => {
  expect(await listenServer({ server: fakeServer(() => ({ emit: 'listening' }), () => ({ port: 5555 })).server, port: 0 })).toBe(5555);
  expect(await listenServer({ server: fakeServer(() => ({ emit: 'listening' }), () => '/tmp/pipe').server, port: 4000 })).toBe(4000);
  expect(await listenServer({ server: fakeServer(() => ({ emit: 'listening' }), () => null).server, port: 4000 })).toBe(4000);
});

it('returns the retried port when the address is unavailable after a retry', async () => {
  const { server } = fakeServer((_call, index) => index === 0 ? { emit: 'error', error: inUse() } : { emit: 'listening' });
  expect(await listenServer({ server, port: 4000 }, { attempts: 3 })).toBe(4001);
});

it('a synchronous listen throw rejects with that error and removes both handlers', async () => {
  const error = new Error('bad options');
  const { server } = fakeServer(() => ({ throws: error }));
  await expect(listenServer({ server, port: 4000 }, { attempts: 3 })).rejects.toBe(error);
  expect(server.listenerCount('error') + server.listenerCount('listening')).toBe(0);
});

it('a synchronous EADDRINUSE throw is retried like an emitted one', async () => {
  const { server, calls } = fakeServer((_call, index) => index === 0 ? { throws: inUse() } : { emit: 'listening' });
  expect(await listenServer({ server, port: 4000 }, { attempts: 2 })).toBe(4001);
  expect(calls.map(call => call.port)).toEqual([4000, 4001]);
});

it('a null or code-less bind error is not retried', async () => {
  for (const error of [null, new Error('no code'), 'EADDRINUSE']) {
    const { server, calls } = fakeServer(() => ({ emit: 'error', error }));
    await expect(listenServer({ server, port: 4000 }, { attempts: 5 })).rejects.toBe(error);
    expect(calls.length).toBe(1);
  }
});

it('a different error after a retry stops the retries', async () => {
  const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
  const { server, calls } = fakeServer((_call, index) => index === 0 ? { emit: 'error', error: inUse() } : { emit: 'error', error: denied });
  await expect(listenServer({ server, port: 4000 }, { attempts: 5 })).rejects.toBe(denied);
  expect(calls.length).toBe(2);
});
