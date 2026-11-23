// J3 (w3-rtfnd): a JSON spec's handler returns `routeReply(...)` to answer 429 + Retry-After,
// 304 + ETag, or a bare 204 `send()`; any other value keeps the old `successStatus` + JSON answer.
import express from 'express';
import { describe, expect, it } from 'vitest';
import { ok, routeReply } from '@jini-ai/core/contracts/server';
import { defineJsonRoute, mountJsonRoute } from '../adapter.js';
import { listen } from './route-test-host.js';

async function answer(value: unknown, { successStatus }: { readonly successStatus?: number } = {}): Promise<Response> {
  const route = defineJsonRoute<void, unknown, object>({ method: 'post', path: '/r', parse: () => ok({ value: undefined }), handle: () => ok({ value }) }, successStatus === undefined ? {} : { successStatus });
  const app = express();
  mountJsonRoute({ app, spec: route, deps: {} });
  return fetch(`${await listen({ app })}/r`, { method: 'POST' });
}

describe('mountJsonRoute answers a routeReply', () => {
  it('writes the reply status, headers and JSON body', async () => {
    const response = await answer(routeReply({ status: 429, body: { error: { code: 'RATE_LIMITED' } }, headers: { 'Retry-After': '30' } }), { successStatus: 201 });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ error: { code: 'RATE_LIMITED' } });
  });

  it('answers a body-less reply with a bare send(): no content type, no body', async () => {
    const response = await answer(routeReply({ status: 204 }));
    expect([response.status, response.headers.get('content-type'), await response.text()]).toEqual([204, null, '']);
    const notModified = await answer(routeReply({ status: 304, headers: { etag: '"v1"' } }));
    expect([notModified.status, notModified.headers.get('etag'), notModified.headers.get('content-type')]).toEqual([304, '"v1"', null]);
  });

  it('answers a body-less 200 reply with an empty body, not JSON null', async () => {
    const response = await answer(routeReply({ status: 200 }));
    expect([response.status, await response.text()]).toEqual([200, '']);
  });

  it('leaves an ordinary value (even reply-shaped) on the old successStatus + JSON path', async () => {
    const response = await answer({ status: 204, body: 'x' }, { successStatus: 201 });
    expect([response.status, await response.json()]).toEqual([201, { status: 204, body: 'x' }]);
  });
});
