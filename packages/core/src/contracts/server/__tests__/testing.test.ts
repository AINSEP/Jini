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
