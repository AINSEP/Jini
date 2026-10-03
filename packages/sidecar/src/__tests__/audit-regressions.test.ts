import { createConnection, createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { allocatePort, createJsonIpcServer } from '../index.js';

it('returns the actual parse diagnostic for a malformed IPC frame', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sidecar-parse-'));
  const socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\sidecar-parse-${process.pid}-${Date.now()}`
    : join(root, 'ipc.sock');
  const server = await createJsonIpcServer({ socketPath, handler: async () => { throw new Error('must not dispatch'); } });
  const frame = '{invalid';
  let expectedMessage = '';
  try { JSON.parse(frame); } catch (error) { expectedMessage = (error as SyntaxError).message; }
  try {
    const response = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(socketPath);
      let received = '';
      socket.setEncoding('utf8');
      socket.setTimeout(2000, () => socket.destroy(new Error('IPC response timeout')));
      socket.on('error', reject);
      socket.on('data', chunk => { received += chunk; });
      socket.on('end', () => resolve(received));
      socket.on('connect', () => socket.write(`${frame}\n`));
    });
    expect(JSON.parse(response)).toEqual({ ok: false, error: { message: expectedMessage } });
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('probes the requested occupied port and retains the host reservation set', async () => {
  const occupied = createServer();
  await new Promise<void>((resolve, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, '127.0.0.1', resolve);
  });
  const address = occupied.address();
  if (address === null || typeof address === 'string') throw new Error('expected TCP address');
  const reserved = new Set<number>();
  try {
    await expect(allocatePort({}, { port: address.port, host: '127.0.0.1', reserved })).rejects.toThrow(/not available/);
    expect(reserved.size).toBe(0);
  } finally {
    await new Promise<void>((resolve, reject) => occupied.close(error => error ? reject(error) : resolve()));
  }
  const allocation = await allocatePort({}, { port: address.port, host: '127.0.0.1', reserved });
  expect(allocation).toEqual({ port: address.port, source: 'forced' });
  expect(reserved.has(address.port)).toBe(true);
  await expect(allocatePort({}, { port: address.port, reserved })).rejects.toThrow(/conflicts with another managed port/);
});
