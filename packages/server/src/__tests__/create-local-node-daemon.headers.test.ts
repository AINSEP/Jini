import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { composeJiniKernel } from '../compose-jini-kernel.js';
import { createLocalNodeDaemon } from '../create-local-node-daemon.js';

vi.mock('../compose-jini-kernel.js', () => ({ composeJiniKernel: vi.fn() }));

afterEach(() => { vi.resetAllMocks(); });

it('serves a response without advertising the framework, before opening any listener', async () => {
  const stopBeforeStorage = new Error('stop before storage or listener setup');
  vi.mocked(composeJiniKernel).mockRejectedValueOnce(stopBeforeStorage);
  await expect(createLocalNodeDaemon({
    dataDir: '/unused-header-test', packs: [], env: {}, discoveryFile: false,
    open: () => { throw new Error('storage must not be opened'); },
  })).rejects.toBe(stopBeforeStorage);
  const app = vi.mocked(composeJiniKernel).mock.calls[0]![0].app;
  app.get('/probe', (_request, response) => response.end('ready'));
  const socket = new Socket();
  try {
    const request = new IncomingMessage(socket);
    request.method = 'GET';
    request.url = '/probe';
    const response = new ServerResponse(request);
    app(request, response);
    expect(response.writableEnded).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.getHeader('x-powered-by')).toBeUndefined();
  } finally {
    socket.destroy();
  }
});

it('C64: each daemon captures its bind host without mutating the caller environment', async () => {
  const env = { JINI_BIND_HOST: 'caller.example', JINI_ALLOWED_ORIGINS: 'https://trusted.example' };
  const originalEnv = { ...env };
  const stopBeforeStorage = new Error('stop before storage or listener setup');
  const config = {
    dataDir: '/unused-env-test', packs: [], env, discoveryFile: false as const,
    open: () => { throw new Error('storage must not be opened'); },
  };
  vi.mocked(composeJiniKernel).mockRejectedValueOnce(stopBeforeStorage);
  await expect(createLocalNodeDaemon({ ...config, host: '127.0.0.1' })).rejects.toBe(stopBeforeStorage);
  const first = vi.mocked(composeJiniKernel).mock.calls.at(-1)![0];

  vi.mocked(composeJiniKernel).mockRejectedValueOnce(stopBeforeStorage);
  await expect(createLocalNodeDaemon({ ...config, host: '0.0.0.0' })).rejects.toBe(stopBeforeStorage);

  expect.soft(env).toEqual(originalEnv);
  expect.soft(first.env).toEqual({ ...originalEnv, JINI_BIND_HOST: '127.0.0.1' });
  expect.soft(first.adapter.env).toEqual({ ...originalEnv, JINI_BIND_HOST: '127.0.0.1' });
});
