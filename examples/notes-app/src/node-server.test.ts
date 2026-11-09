/**
 * @file The Node adapter against the `Server` contract, over a real socket. These cases moved here
 * from core when the contract became types only: matching and dispatch are the adapter's code.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from '@jini-ai/core/contracts/server';
import { createNodeServer, matchServerPath, type NodeServer } from './node-server.ts';

/** Route code in the shape packages use: it takes `{ app }`, never a concrete server. */
function registerNoteRoutes({ app }: { readonly app: Server }): void {
  app.route({
    method: 'GET',
    path: '/notes/:id',
    handler: ({ request, params }) =>
      Response.json({ id: params.id, view: new URL(request.url).searchParams.get('view') }),
  });
  app.route({
    method: 'POST',
    path: '/notes',
    handler: async ({ request }) => Response.json({ created: await request.json() }, { status: 201 }),
  });
  app.route({
    method: 'GET',
    path: '/whoami',
    handler: ({ client }) => Response.json({ address: client?.address ?? null }),
  });
  app.route({
    method: 'OPTIONS',
    path: '/notes',
    handler: () => new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'POST' } }),
  });
}

describe('node-server adapter', () => {
  let app: NodeServer;
  let base = '';
  before(async () => {
    app = createNodeServer();
    registerNoteRoutes({ app });
    base = `http://127.0.0.1:${(await app.listen({ port: 0 })).port}`;
  });
  after(() => app.close());

  it('dispatches a Request to the matching handler with decoded path params', async () => {
    const response = await fetch(`${base}/notes/a%20b?view=full`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: 'a b', view: 'full' });
  });

  it('lets an async handler read the request body', async () => {
    const response = await fetch(`${base}/notes`, { method: 'POST', body: JSON.stringify({ title: 'hi' }) });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { created: { title: 'hi' } });
  });

  it('answers unmatched paths with 404 and unmatched methods with 405', async () => {
    assert.equal((await fetch(`${base}/missing`)).status, 404);
    const wrongMethod = await fetch(`${base}/notes/1`, { method: 'DELETE' });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET, HEAD');
  });

  it('answers HEAD from the GET route with its status and headers but no body', async () => {
    const response = await fetch(`${base}/notes/7`, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(await response.text(), '');
  });

  it('routes OPTIONS like any other method, so a preflight can be answered', async () => {
    const response = await fetch(`${base}/notes`, { method: 'OPTIONS' });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-methods'), 'POST');
  });

  it('passes the socket peer address as client.address, ignoring forwarded headers', async () => {
    const response = await fetch(`${base}/whoami`, { headers: { 'x-forwarded-for': '203.0.113.9' } });
    assert.deepEqual(await response.json(), { address: '127.0.0.1' });
  });

  it('rejects a second registration of the same method and path', () => {
    assert.throws(() => app.route({ method: 'POST', path: '/notes', handler: () => new Response(null) }), /already registered/);
  });
});

describe('matchServerPath', () => {
  it('returns params for :name segments and an empty object for a literal match', () => {
    assert.deepEqual(matchServerPath({ pattern: '/a/:x/b/:y', pathname: '/a/1/b/two' }), { x: '1', y: 'two' });
    assert.deepEqual(matchServerPath({ pattern: '/health', pathname: '/health' }), {});
  });

  it('rejects differing literals, segment counts, trailing slashes and empty params', () => {
    assert.equal(matchServerPath({ pattern: '/notes/:id', pathname: '/posts/1' }), null);
    assert.equal(matchServerPath({ pattern: '/notes/:id', pathname: '/notes/1/extra' }), null);
    assert.equal(matchServerPath({ pattern: '/notes', pathname: '/notes/' }), null);
    assert.equal(matchServerPath({ pattern: '/notes/:id', pathname: '/notes/' }), null);
  });

  it('does not match a param whose percent-encoding is malformed', () => {
    assert.equal(matchServerPath({ pattern: '/notes/:id', pathname: '/notes/%E0%A4%A' }), null);
  });

  it('takes named required args, not positional ones', () => {
    // @ts-expect-error Pattern and pathname are named required args.
    assert.throws(() => matchServerPath('/notes/:id', '/notes/1'));
  });
});
