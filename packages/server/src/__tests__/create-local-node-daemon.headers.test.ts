import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { expect, it, vi } from 'vitest';
import { composeJiniKernel } from '../compose-jini-kernel.js';
import { createLocalNodeDaemon } from '../create-local-node-daemon.js';

vi.mock('../compose-jini-kernel.js', () => ({ composeJiniKernel: vi.fn() }));

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
