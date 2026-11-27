import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { jsonResponse, readJsonBody, type ServerRoute } from '@jini-ai/core/contracts/server';
import { createRecordingReporter } from '@jini-ai/core/errors/testing';
import { getRouteRegistrationInventory, installRouteRegistrationGuard } from '@jini-ai/http-kit';
import { mountRoutes } from '../mount-routes.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
});

async function listen(app: Express): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const says = (word: string): ServerRoute['handler'] => () => jsonResponse({ status: 200, body: { from: word } });
const from = async (response: Response): Promise<unknown> => (await response.json() as { from: unknown }).from;

describe('mountRoutes', () => {
  it('mounts the list at the position of the call: a layer above it wins, and it wins over a layer below', async () => {
    const app = express();
    app.get('/shared-above', (_req, res) => { res.json({ from: 'express-above' }); });
    mountRoutes({ app, routes: [{ method: 'GET', path: '/shared-above', handler: says('list') }, { method: 'GET', path: '/shared-below', handler: says('list') }] });
    app.get('/shared-below', (_req, res) => { res.json({ from: 'express-below' }); });
    const origin = await listen(app);
    expect(await from(await fetch(`${origin}/shared-above`))).toBe('express-above');
    expect(await from(await fetch(`${origin}/shared-below`))).toBe('list');
  });

  it('a gate mounted above the list runs first and can refuse; the route is then not reached', async () => {
    const app = express();
    let reached = 0;
    app.use((req, res, next) => { if (req.headers.authorization === 'Bearer yes') next(); else res.status(401).json({ from: 'gate' }); });
    mountRoutes({ app, routes: [{ method: 'GET', path: '/guarded', handler: () => { reached += 1; return jsonResponse({ status: 200, body: { from: 'list' } }); } }] });
    const origin = await listen(app);
    expect((await fetch(`${origin}/guarded`)).status).toBe(401);
    expect(reached).toBe(0);
    expect(await from(await fetch(`${origin}/guarded`, { headers: { authorization: 'Bearer yes' } }))).toBe('list');
  });

  it('a path the list does not own, and a method it does not have for a path it owns, fall through to the layers below', async () => {
    const app = express();
    mountRoutes({ app, routes: [{ method: 'GET', path: '/owned', handler: says('list') }] });
    app.post('/owned', (_req, res) => { res.json({ from: 'express-post' }); });
    app.get('/other', (_req, res) => { res.json({ from: 'express-other' }); });
    const origin = await listen(app);
    expect(await from(await fetch(`${origin}/owned`, { method: 'POST' }))).toBe('express-post');
    expect(await from(await fetch(`${origin}/other`))).toBe('express-other');
    expect((await fetch(`${origin}/nowhere`)).status).toBe(404);
  });

  it('two lists mounted one after the other each keep their own routes and position', async () => {
    const app = express();
    mountRoutes({ app, routes: [{ method: 'GET', path: '/first', handler: says('first') }, { method: 'GET', path: '/both', handler: says('first') }] });
    mountRoutes({ app, routes: [{ method: 'GET', path: '/second', handler: says('second') }, { method: 'GET', path: '/both', handler: says('second') }] });
    const origin = await listen(app);
    expect(await from(await fetch(`${origin}/first`))).toBe('first');
    expect(await from(await fetch(`${origin}/second`))).toBe('second');
    expect(await from(await fetch(`${origin}/both`))).toBe('first');
  });

  const echoJson: ServerRoute = { method: 'POST', path: '/echo', handler: async ({ request, params: _params, locals }) => {
    const body = await readJsonBody({ request }, { maxBytes: 1024 });
    return jsonResponse({ status: 200, body: { from: body.ok ? body.value : 'unreadable', locals: locals ?? null } });
  } };

  it('a body the JSON parser above already read reaches the route as the same JSON; without a parser the route reads the bytes itself', async () => {
    const parsed = express();
    parsed.use(express.json());
    parsed.use((_req, res, next) => { res.locals.principal = 'alice'; next(); });
    mountRoutes({ app: parsed, routes: [echoJson] });
    const send = (origin: string): Promise<Response> => fetch(`${origin}/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"n":1,"s":"é"}' });
    expect(await (await send(await listen(parsed))).json()).toEqual({ from: { n: 1, s: 'é' }, locals: { principal: 'alice' } });

    const bare = express();
    mountRoutes({ app: bare, routes: [echoJson] });
    expect(await from(await send(await listen(bare)))).toEqual({ n: 1, s: 'é' });
  });

  const bodyKind: ServerRoute = { method: 'POST', path: '/upload', handler: async ({ request }) => {
    if (request.body === null) return jsonResponse({ status: 200, body: { from: 'no-body' } });
    return jsonResponse({ status: 200, body: { from: [...new Uint8Array(await request.arrayBuffer())] } });
  } };

  it('a raw-body list is given the untouched bytes, or no body when a parser above consumed them, never a re-serialized one', async () => {
    const app = express();
    app.use(express.json());
    mountRoutes({ app, routes: [bodyKind] }, { rawBody: true });
    const origin = await listen(app);
    const bytes = await fetch(`${origin}/upload`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Uint8Array.from([0, 127, 128, 255]) });
    expect(await from(bytes)).toEqual([0, 127, 128, 255]);
    const consumed = await fetch(`${origin}/upload`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ "spaced" : 1 }' });
    expect(await from(consumed)).toBe('no-body');
  });

  it('without rawBody the same consumed request would be handed a re-serialized body (why uploads must say rawBody)', async () => {
    const app = express();
    app.use(express.json());
    mountRoutes({ app, routes: [bodyKind] });
    const response = await fetch(`${await listen(app)}/upload`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ "spaced" : 1 }' });
    expect(Buffer.from(await from(response) as number[]).toString('utf8')).toBe('{"spaced":1}');
  });

  it('answers the spellings Express answered: another case, a trailing slash, OPTIONS, and 400 for a bad escape in an id', async () => {
    const app = express();
    mountRoutes({ app, routes: [
      { method: 'GET', path: '/api/things', handler: says('list') },
      { method: 'GET', path: '/api/things/:id', handler: ({ params }) => jsonResponse({ status: 200, body: { from: params.id } }) },
    ] });
    const origin = await listen(app);
    expect(await from(await fetch(`${origin}/API/Things/`))).toBe('list');
    expect(await from(await fetch(`${origin}/api/things/Ab/`))).toBe('Ab');
    const options = await fetch(`${origin}/api/things`, { method: 'OPTIONS' });
    expect([options.status, options.headers.get('allow'), await options.text()]).toEqual([200, 'GET,HEAD', 'GET,HEAD']);
    const bad = await fetch(`${origin}/api/things/%E0%A4%A`);
    expect([bad.status, bad.headers.get('content-type')]).toEqual([400, 'text/html; charset=utf-8']);
  });

  it('records each listed route in the app\'s route inventory, so what the preset mounted can still be read back', () => {
    const app = express();
    installRouteRegistrationGuard({ app });
    app.get('/api/own', (_req, res) => { res.end(); });
    mountRoutes({ app, routes: [{ method: 'GET', path: '/api/things', handler: says('list') }, { method: 'POST', path: '/api/things/:id', handler: says('list') }] });
    expect(getRouteRegistrationInventory({ app }).filter((entry) => entry.path.startsWith('/')).map((entry) => `${entry.method} ${entry.path}`)).toEqual(['GET /api/own', 'GET /api/things', 'POST /api/things/:id']);
  });

  it('refuses an app it cannot add a handler to, saying what it needs', () => {
    expect(() => { mountRoutes({ app: {}, routes: [] }); }).toThrow(new TypeError('mountRoutes needs an app with a use(handler) method (the preset\'s Express app); it was given something else.'));
    expect(() => { mountRoutes({ app: null, routes: [] }); }).toThrow(TypeError);
  });

  it.each([42, { use: 'not callable' }])('rejects an incompatible layer target (%j)', app => {
    expect(() => mountRoutes({ app, routes: [] })).toThrow(
      new TypeError("mountRoutes needs an app with a use(handler) method (the preset's Express app); it was given something else."),
    );
  });

  it('serves a mounted route on a Node host that has no Express locals', async () => {
    type Layer = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: (error?: unknown) => void) => void;
    let layer: Layer = (_req, res) => { res.statusCode = 503; res.end('route not installed'); };
    mountRoutes({ app: { use(handler: Layer) { layer = handler; } }, routes: [{
      method: 'GET', path: '/plain', handler: ({ locals }) =>
        jsonResponse({ status: 200, body: { from: locals ?? 'without-locals' } }),
    }] });
    const server = createServer((req, res) => layer(req, res, () => { res.statusCode = 404; res.end(); }));
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/plain`);
    expect([response.status, await from(response)]).toEqual([200, {}]);
  });

  it('reports a mounted streaming route failure after the first bytes reach the client', async () => {
    const id = 'ERR-AAAA-BBBB-CCCC-0001';
    const { reporter, entries, reports } = createRecordingReporter({ ids: [id], iso: '2026-01-01T00:00:00.000Z' });
    const app = express();
    let producer!: ReadableStreamDefaultController<Uint8Array>;
    mountRoutes({ app, routes: [{
      method: 'GET', path: '/stream', handler: () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          producer = controller;
          controller.enqueue(new TextEncoder().encode('partial'));
        },
      })),
    }] }, { reporter });
    const response = await fetch(`${await listen(app)}/stream`);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('partial');
    producer.error(new Error('stream producer failed'));
    await expect(reader.read()).rejects.toThrow('terminated');
    expect(entries).toEqual([expect.objectContaining({ meta: expect.objectContaining({
      errorId: id, step: 'Write response', diagnostic: expect.stringContaining('stream producer failed'),
    }) })]);
    expect(reports.map(report => report.context.incidentId)).toEqual([id]);
  });
});
