import { EventEmitter } from 'node:events';
import { spawn, type Serializable } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { expect, test, vi } from 'vitest';
import {
  createNodeDaemonProcessAdapter, createNodeIpcChannel, provideNodeStartupSecrets, receiveNodeStartupSecrets,
  splitNodeStartupSecrets, STARTUP_SECRETS_ENV,
} from '../supervisor-node.js';

class Peer extends EventEmitter {
  connected = true;
  other?: Peer;
  send(message: Serializable, callback: (error: Error | null) => void) {
    queueMicrotask(() => this.other?.emit('message', message));
    callback(null);
    return true;
  }
}

test('startup credentials leave no environment key, including Windows spellings', () => {
  const source = { PATH: '/bin', HOST_SECRET: 'one', host_secret: 'one', EMPTY_SECRET: undefined };
  expect(splitNodeStartupSecrets({ env: source, keys: ['HOST_SECRET', 'EMPTY_SECRET'] })).toEqual({
    env: { PATH: '/bin' }, secrets: { HOST_SECRET: 'one' },
  });
  expect(source.HOST_SECRET).toBe('one');
});

test('a child reads startup credentials once without disrupting the existing control channel', async () => {
  const parent = new Peer(); const child = new Peer(); parent.other = child; child.other = parent;
  const delivery = provideNodeStartupSecrets({ peer: parent, secrets: { HOST_SECRET: 'private' } });
  const control = createNodeIpcChannel({ peer: parent });
  const handler = createNodeIpcChannel({ peer: child }, { handle: async () => 'control-ready' });
  try {
    expect(await receiveNodeStartupSecrets({ peer: child })).toEqual({ HOST_SECRET: 'private' });
    expect(await control.request({ payload: 'ready' })).toBe('control-ready');
    await expect(receiveNodeStartupSecrets({ peer: child })).rejects.toThrow('IPC request refused');
    expect(child.listenerCount('message'), 'only the existing control listener remains').toBe(1);
  } finally { delivery.dispose({}); control.dispose({}); handler.dispose({}); }
  expect(parent.listenerCount('message')).toBe(0);
});

test('unavailable startup IPC times out without leaking values or retaining a listener', async () => {
  vi.useFakeTimers();
  const child = new Peer();
  try {
    const rejected = expect(receiveNodeStartupSecrets({ peer: child }, { timeoutMs: 25 })).rejects.toThrow('IPC request timed out');
    await vi.advanceTimersByTimeAsync(25); await rejected;
    expect(child.listenerCount('message')).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('malformed or oversized startup credentials fail closed', async () => {
  const parent = new Peer(); const child = new Peer(); parent.other = child; child.other = parent;
  const delivery = createNodeIpcChannel({ peer: parent }, { channel: 'startup-secrets', handle: async () => ({ HOST_SECRET: 1 }) });
  try { await expect(receiveNodeStartupSecrets({ peer: child })).rejects.toThrow('Invalid startup credentials'); }
  finally { delivery.dispose({}); }
  expect(() => provideNodeStartupSecrets({ peer: parent, secrets: { HOST_SECRET: 'x'.repeat(65536) } })).toThrow('Startup credentials exceed limit');
});

test('oversized startup credentials are refused before a child is spawned', () => {
  const spawnChild = vi.fn();
  expect(() => createNodeDaemonProcessAdapter({ command: 'node', args: [], cwd: '.', env: {},
    registry: { readLive: async () => null, write: async () => {}, removeIfCurrent: async () => {} },
  }, { startupSecrets: { HOST_SECRET: 'x'.repeat(65536) }, spawn: spawnChild }).spawnDaemonProcess()).toThrow('Startup credentials exceed limit');
  expect(spawnChild).not.toHaveBeenCalled();
});

test('Windows startup IPC keeps stdin open for the existing graceful EOF shutdown', () => {
  const child = Object.assign(new Peer(), { stdin: new PassThrough(), stdout: null, stderr: null, kill: () => true });
  const ports = createNodeDaemonProcessAdapter({ command: 'node', args: [], cwd: '.', env: { HOST_SECRET: 'private' },
    registry: { readLive: async () => null, write: async () => {}, removeIfCurrent: async () => {} },
  }, { platform: 'win32', startupSecrets: { HOST_SECRET: 'private' }, spawn(input) {
    expect(input.options.stdio).toEqual(['pipe', 'pipe', 'pipe', 'ipc']);
    expect(input.options.env?.HOST_SECRET).toBeUndefined();
    return child as unknown as ReturnType<typeof spawn>;
  } });
  try {
    const port = ports.spawnDaemonProcess();
    expect(child.stdin.writableEnded).toBe(false);
    port.closeStdin?.({});
    expect(child.stdin.writableEnded).toBe(true);
  } finally { child.emit('exit', 0, null); child.stdin.destroy(); }
});

test('startup fails closed on disconnect and removes its receiver', async () => {
  const child = new Peer();
  const result = receiveNodeStartupSecrets({ peer: child });
  const rejected = expect(result).rejects.toThrow('IPC disconnected');
  child.connected = false; child.emit('disconnect');
  await rejected;
  expect(child.listenerCount('message')).toBe(0);
});

test('a spawned child authenticates from IPC while its environment and grandchild contain no token key', async () => {
  const token = 'private-startup-capability';
  const server = createServer((request, response) => {
    response.writeHead(request.headers.authorization === `Bearer ${token}` ? 200 : 401).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test listener');
  const stdout = new PassThrough();
  let output = ''; stdout.on('data', chunk => { output += String(chunk); });
  let native: ReturnType<typeof spawn> | undefined;
  const deadline = setTimeout(() => native?.kill(), 5000);
  const script = `
    const { spawnSync } = require('node:child_process');
    process.on('message', async message => {
      if (message.channel !== 'startup-secrets' || message.kind !== 'reply') return;
      const response = await fetch(process.env.AUTH_URL, { headers: { authorization: 'Bearer ' + message.payload.HOST_SECRET } });
      const grandchild = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(Object.keys(process.env).filter(k => k.toUpperCase() === "HOST_SECRET")))'], { encoding: 'utf8' });
      process.stdout.write(JSON.stringify({ status: response.status, keys: Object.keys(process.env).filter(k => k.toUpperCase() === 'HOST_SECRET'), grandchild: JSON.parse(grandchild.stdout) }));
      process.disconnect();
    });
    process.send({ jiniIpc: 1, channel: 'startup-secrets', kind: 'request', id: 'startup', payload: 'read' });
  `;
  try {
    const ports = createNodeDaemonProcessAdapter({ command: process.execPath, args: ['-e', script], cwd: process.cwd(),
      env: { ...process.env, HOST_SECRET: token, host_secret: token, AUTH_URL: `http://127.0.0.1:${address.port}` },
      registry: { readLive: async () => null, write: async () => {}, removeIfCurrent: async () => {} },
    }, { startupSecrets: { HOST_SECRET: token }, stdout, spawn(input) {
      expect(input.options.env?.HOST_SECRET).toBeUndefined();
      expect(input.options.env?.host_secret).toBeUndefined();
      expect(input.options.env?.[STARTUP_SECRETS_ENV]).toBe('1');
      native = spawn(input.command, input.args, input.options); return native;
    } });
    ports.spawnDaemonProcess();
    if (!native) throw new Error('missing child');
    const [code] = await once(native, 'close');
    expect(code).toBe(0);
    expect(JSON.parse(output)).toEqual({ status: 200, keys: [], grandchild: [] });
  } finally {
    clearTimeout(deadline);
    native?.kill(); stdout.destroy(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 10_000);
