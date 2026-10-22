/**
 * @file Pins two receiver guarantees that the socket-level suite cannot see from the client:
 * the header bounds are set on the server explicitly (so a host's process-wide
 * `--max-http-header-size` cannot widen them), and the single callback slot is consumed before the
 * query is read, so a second request already in the pipeline is never parsed as a callback.
 * Both use pass-through spies around the real implementations.
 */
import { connect } from 'node:net';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('node:http', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:http')>();
  return { ...real, createServer: vi.fn(real.createServer) };
});
vi.mock('../src/loopback-callback.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/loopback-callback.js')>();
  return { ...real, readLoopbackCallback: vi.fn(real.readLoopbackCallback) };
});

import { createServer } from 'node:http';
import { readLoopbackCallback } from '../src/loopback-callback.js';
import { startLoopbackAuthorizationReceiver } from '../src/loopback-receiver.js';

const STATE = 's'.repeat(32);
const controllers: AbortController[] = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.abort(); vi.mocked(createServer).mockClear(); vi.mocked(readLoopbackCallback).mockClear(); });

async function start() {
  const controller = new AbortController();
  controllers.push(controller);
  return startLoopbackAuthorizationReceiver({}, { signal: controller.signal });
}

test('caps request headers at 16 KiB and 64 headers on the listener itself', async () => {
  await start();
  expect(createServer).toHaveBeenCalledWith({ maxHeaderSize: 16 * 1024 });
  const server = vi.mocked(createServer).mock.results[0]!.value as import('node:http').Server;
  expect(server.maxHeadersCount).toBe(64);
});

test('a second request pipelined behind the callback is never read as a callback', async () => {
  const receiver = await start();
  const result = receiver.receive({ expectedState: STATE });
  const { port } = new URL(receiver.redirectUri);
  const host = `127.0.0.1:${port}`;
  const get = (code: string) => `GET /callback?state=${STATE}&code=${code} HTTP/1.1\r\nHost: ${host}\r\n\r\n`;
  // One write carrying both requests: the parser hands both to the server in the same turn,
  // before the first reply has finished, which is exactly the window the slot guard covers.
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: Number(port) }, () => socket.end(get('first') + get('second')));
    socket.on('error', reject);
    socket.on('close', () => resolve());
    socket.resume();
  });
  await expect(result).resolves.toEqual({ code: 'first', fields: {} });
  expect(readLoopbackCallback).toHaveBeenCalledTimes(1);
});
