import { describe, expect, it } from 'vitest';
import { createInMemoryServer } from '../testing.js';

describe('createInMemoryServer', () => {
  it('cancels the GET body it drops when answering HEAD', async () => {
    const { server, fetch } = createInMemoryServer();
    let cancelled = 0;
    server.route({
      method: 'GET', path: '/events',
      handler: () => new Response(new ReadableStream({ cancel: () => { cancelled += 1; } }), { status: 200, headers: { 'x-kind': 'stream' } }),
    });
    const response = await fetch(new Request('http://local/events', { method: 'HEAD' }));
    expect([response.status, response.headers.get('x-kind'), response.body, cancelled]).toEqual([200, 'stream', null, 1]);
  });
});
