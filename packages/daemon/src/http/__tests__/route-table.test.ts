import { describe, expect, it } from 'vitest';
import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import { createInMemoryServer, denyAllOrigins } from '@jini-ai/core/contracts/server/testing';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { describeRoutes, gatedJsonRoute } from '../route-table.js';

const open = defineJsonRoute<{ n: number }, { n: number }, { base: number }>({
  method: 'post', path: '/api/open', parse: ({ body }) => ok({ value: { n: Number((body as { n?: unknown }).n) } }), handle: ({ input, deps }) => ok({ value: { n: input.n + deps.base } }),
});
const sameOrigin = { ...open, path: '/api/strict', requireSameOrigin: true };

describe('gatedJsonRoute', () => {
  it('names the same-origin gate only on a spec that asks for it', () => {
    const host = fakeDaemonRouteHost();
    const routes = [gatedJsonRoute({ spec: open, deps: { base: 1 }, host }), gatedJsonRoute({ spec: sameOrigin, deps: { base: 1 }, host })];
    expect(describeRoutes({ routes })).toEqual([
      { method: 'POST', path: '/api/open', gates: [] },
      { method: 'POST', path: '/api/strict', gates: ['same-origin'] },
    ]);
  });

  it('answers through the route with the given deps', async () => {
    const { server, fetch } = createInMemoryServer();
    server.route(gatedJsonRoute({ spec: open, deps: { base: 10 }, host: fakeDaemonRouteHost() }));
    const response = await fetch(new Request('http://local/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"n":5}' }));
    expect([response.status, await response.json()]).toEqual([200, { n: 15 }]);
  });

  it("refuses a request the host's origin policy denies, before the handler runs", async () => {
    const { server, fetch } = createInMemoryServer();
    server.route(gatedJsonRoute({ spec: sameOrigin, deps: { base: 0 }, host: fakeDaemonRouteHost({}, { originPolicy: denyAllOrigins }) }));
    const response = await fetch(new Request('http://local/api/strict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"n":1}' }));
    expect(response.status).toBe(403);
  });

  it("limits the body to the host's limit, not the spec's", async () => {
    const { server, fetch } = createInMemoryServer();
    server.route(gatedJsonRoute({ spec: { ...open, maxBodyBytes: 1_000_000 }, deps: { base: 0 }, host: fakeDaemonRouteHost({}, { jsonBodyMaxBytes: 8 }) }));
    const response = await fetch(new Request('http://local/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"n":123456789}' }));
    expect(response.status).toBe(413);
  });
});
