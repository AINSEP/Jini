import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const network = vi.hoisted(() => ({ accept: undefined as ((socket: Socket) => void) | undefined }));
vi.mock('node:net', async () => {
  const { EventEmitter } = await import('node:events');
  return { createServer: (accept: (socket: Socket) => void) => {
    network.accept = accept;
    return Object.assign(new EventEmitter(), {
      listen: (_path: string, ready: () => void) => { ready(); },
      close: (closed: () => void) => { closed(); },
    });
  } };
});
import { MAX_CLIENT_FRAME_BYTES, PgliteSocketServer } from '../socket-server.js';

class TestSocket extends EventEmitter {
  writable = true;
  setNoDelay = vi.fn();
  pause = vi.fn();
  resume = vi.fn();
  write = vi.fn();
  end = vi.fn();
  destroy = vi.fn();
}
let server: PgliteSocketServer;
let socket: TestSocket;
const execute = vi.fn(async (_bytes: Uint8Array, _options: unknown) => {});
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

beforeEach(async () => {
  execute.mockClear();
  const db = { waitReady: Promise.resolve(), isInTransaction: () => false,
    exec: async () => {}, execProtocolRawStream: execute,
    runExclusive: async (run: () => Promise<void>) => run(),
  } as unknown as PGlite;
  server = new PgliteSocketServer({ db, path: '/unused' });
  await server.start();
  socket = new TestSocket();
  network.accept!(socket as unknown as Socket);
});
afterEach(async () => { await server.stop(); });

it.each([-1, 0, 4, 7, MAX_CLIENT_FRAME_BYTES + 1])('refuses startup length %s from its four-byte header', async size => {
  const header = Buffer.alloc(4);
  header.writeInt32BE(size);
  socket.emit('data', header);
  await flush();
  expect(socket.end).toHaveBeenCalledTimes(1);
  expect(execute).not.toHaveBeenCalled();
  expect(server.stats().connections).toBe(0);
});

it.each([-1, 0, 3, MAX_CLIENT_FRAME_BYTES])('refuses typed frame length %s before buffering its body', async size => {
  const start = Buffer.alloc(8);
  start.writeInt32BE(8);
  start.writeInt32BE(196608, 4);
  socket.emit('data', start);
  await flush();
  const header = Buffer.alloc(5);
  header[0] = 81;
  header.writeInt32BE(size, 1);
  socket.emit('data', header);
  await flush();
  expect(socket.end).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledTimes(1);
});

it('pauses incoming reads while protocol work is pending', async () => {
  let release!: () => void;
  execute.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const start = Buffer.alloc(8);
  start.writeInt32BE(8);
  start.writeInt32BE(196608, 4);
  socket.emit('data', start);
  expect(socket.pause).toHaveBeenCalledTimes(1);
  await flush();
  expect(socket.resume).not.toHaveBeenCalled();
  release();
  await flush();
  expect(socket.resume).toHaveBeenCalledTimes(1);
});

it('accepts a split minimum typed frame and forwards it exactly once', async () => {
  const start = Buffer.alloc(8);
  start.writeInt32BE(8);
  start.writeInt32BE(196608, 4);
  socket.emit('data', start);
  await flush();
  const message = Buffer.alloc(5);
  message[0] = 83;
  message.writeInt32BE(4, 1);
  socket.emit('data', message.subarray(0, 3));
  await flush();
  expect(execute).toHaveBeenCalledTimes(1);
  socket.emit('data', message.subarray(3));
  await flush();
  expect(execute).toHaveBeenCalledTimes(2);
  expect(Buffer.from(execute.mock.calls[1]![0])).toEqual(message);
  expect(socket.end).not.toHaveBeenCalled();
});

it('refuses input larger than the pending-byte ceiling before protocol execution', async () => {
  socket.emit('data', Buffer.alloc(MAX_CLIENT_FRAME_BYTES + 1));
  await flush();
  expect(socket.end).toHaveBeenCalledTimes(1);
  expect(execute).not.toHaveBeenCalled();
});
