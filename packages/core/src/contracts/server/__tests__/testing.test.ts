import { describe, expect, it } from 'vitest';
import { createInMemoryServer, fakeTimingSafeEqual } from '../testing.js';

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

describe('createInMemoryServer({ lenientPaths })', () => {
  it('matches the way Express does and answers a malformed :name segment 400', async () => {
    const { server, fetch } = createInMemoryServer({}, { lenientPaths: true });
    server.route({ method: 'GET', path: '/api/items/:id', handler: ({ params }) => new Response(params.id) });
    expect(await (await fetch(new Request('http://local/API/Items/Ab/'))).text()).toBe('Ab');
    const bad = await fetch(new Request('http://local/api/items/%E0%A4%A'));
    expect([bad.status, (await bad.json() as { error: { code: string } }).error.code]).toEqual([400, 'BAD_REQUEST']);
    expect((await fetch(new Request('http://local/api/other'))).status).toBe(404);
  });
});

describe('fakeTimingSafeEqual', () => {
  const bytes = (...values: number[]) => new Uint8Array(values);
  it('compares byte by byte and records each pair it was asked about', () => {
    const compare = fakeTimingSafeEqual();
    expect([compare({ left: bytes(1, 2), right: bytes(1, 2) }), compare({ left: bytes(1, 2), right: bytes(1, 3) })]).toEqual([true, false]);
    expect(compare.calls).toHaveLength(2);
  });
  it('refuses unequal lengths the way node:crypto does, so a caller must check length first', () => {
    expect(() => fakeTimingSafeEqual()({ left: bytes(1), right: bytes(1, 2) })).toThrow(RangeError);
  });
});

it('forwards request-scoped context without carrying it into a later request', async () => {
  const app = createInMemoryServer();
  app.server.route({
    method: 'GET', path: '/record/:id',
    handler: ({ client, locals, params }) => Response.json({ address: client?.address, tag: locals?.tag, params }),
  });
  const url = 'http://local/record/9';
  const annotated = await app.fetch(new Request(url), { client: { address: '192.0.2.20' }, locals: { tag: 'first' } });
  expect([annotated.status, await annotated.json()]).toEqual([200, { address: '192.0.2.20', tag: 'first', params: { id: '9' } }]);
  const clean = await app.fetch(new Request(url));
  expect([clean.status, await clean.json()]).toEqual([200, { params: { id: '9' } }]);
});

it('preserves status and headers when HEAD drops an already bodyless GET response', async () => {
  const app = createInMemoryServer();
  app.server.route({ method: 'GET', path: '/empty', handler: () => new Response(null, { status: 204, headers: { etag: '"v2"' } }) });
  const response = await app.fetch(new Request('http://local/empty', { method: 'HEAD' }));
  expect([response.status, response.headers.get('etag'), response.body]).toEqual([204, '"v2"', null]);
});
