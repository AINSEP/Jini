import { createServer, request as httpRequest, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createNodeDispatcher, type NodeDispatcher } from '../node-bridge.js';
import { jsonResponse, readJsonBody } from '../server-port.js';

let open: HttpServer | undefined;
afterEach(async () => {
  const server = open;
  open = undefined;
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function listen(server: HttpServer): Promise<string> {
  open = server;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function routes(dispatcher: NodeDispatcher) {
  dispatcher.server.route({ method: 'POST', path: '/echo/:id', handler: async ({ request, params, client }) => {
    const body = await readJsonBody({ request });
    return jsonResponse({ status: 200, body: { id: params.id, body: body.ok ? body.value : body.error.code, peer: client?.address, proto: new URL(request.url).protocol } });
  } });
  dispatcher.server.route({ method: 'GET', path: '/cookies', handler: () => {
    const headers = new Headers();
    headers.append('set-cookie', 'a=1; Expires=Wed, 21 Oct 2035 07:28:00 GMT');
    headers.append('set-cookie', 'b=2');
    return new Response('ok', { headers });
  } });
  dispatcher.server.route({ method: 'GET', path: '/boom', handler: () => { throw new Error('secret db path /var/x'); } });
  dispatcher.server.route({ method: 'GET', path: '/stream', handler: ({ request }) => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: one\n\n'));
      request.signal.addEventListener('abort', () => controller.close());
      controller.enqueue(new TextEncoder().encode('data: two\n\n'));
      controller.close();
    } });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  } });
}

describe('createNodeDispatcher on plain node:http', () => {
  it('serves JSON, keeps every Set-Cookie line, streams, and answers 404/405 itself', async () => {
    const errors: unknown[] = [];
    const dispatcher = createNodeDispatcher({}, { onUnhandledError: (e) => errors.push(e) });
    routes(dispatcher);
    const base = await listen(createServer((incoming, out) => { void dispatcher.handle({ incoming, out }); }));
    const echo = await fetch(`${base}/echo/a%20b`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"x":1}' });
    expect(await echo.json()).toEqual({ id: 'a b', body: { x: 1 }, peer: '127.0.0.1', proto: 'http:' });
    const cookies = await fetch(`${base}/cookies`);
    expect(cookies.headers.getSetCookie()).toEqual(['a=1; Expires=Wed, 21 Oct 2035 07:28:00 GMT', 'b=2']);
    const stream = await fetch(`${base}/stream`);
    expect(stream.headers.get('content-type')).toBe('text/event-stream');
    expect(await stream.text()).toBe('data: one\n\ndata: two\n\n');
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    const wrong = await fetch(`${base}/cookies`, { method: 'DELETE' });
    expect([wrong.status, wrong.headers.get('allow')]).toEqual([405, 'GET, HEAD']);
    const head = await fetch(`${base}/cookies`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    const boom = await fetch(`${base}/boom`);
    expect([boom.status, await boom.text()]).toEqual([500, 'The server could not finish this request.']);
    expect(errors).toHaveLength(1);
  });

  it('aborts request.signal when the client hangs up', async () => {
    const dispatcher = createNodeDispatcher();
    let aborted!: () => void;
    const sawAbort = new Promise<void>((resolve) => { aborted = resolve; });
    dispatcher.server.route({ method: 'GET', path: '/wait', handler: ({ request }) => new Promise<Response>((resolve) => {
      request.signal.addEventListener('abort', () => { aborted(); resolve(new Response('late')); });
    }) });
    const base = await listen(createServer((incoming, out) => { void dispatcher.handle({ incoming, out }); }));
    const req = httpRequest(`${base}/wait`);
    req.on('error', () => undefined);
    req.end();
    await new Promise((resolve) => setTimeout(resolve, 50));
    req.destroy();
    await sawAbort;
  });
});

// The Tovu Express adapter is exactly this wiring (development/refactor-patterns/server-port.md):
// one middleware, `next` for fall-through and errors, Express's own origin, and `req.body` for a
// stream a blanket `express.json()` already drained. Express is a devDependency only.
describe('createNodeDispatcher mounted in Express (the host adapter shape)', () => {
  function expressHost({ withBlanketJson }: { withBlanketJson: boolean }) {
    const app = express();
    if (withBlanketJson) app.use(express.json());
    const dispatcher = createNodeDispatcher();
    app.use((req, res, next) => { void dispatcher.handle({ incoming: req, out: res }, { next, origin: `${req.protocol}://${req.get('host') ?? 'localhost'}`, parsedBody: req.body }); });
    routes(dispatcher);
    app.get('/host-route', (_req, res) => { res.json({ host: true }); });
    const hostErrors: unknown[] = [];
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { hostErrors.push(error); res.status(500).json({ error: 'host handler' }); });
    return { app, hostErrors };
  }

  it.each([true, false])('reads the JSON body with blanket express.json=%s', async (withBlanketJson) => {
    const { app } = expressHost({ withBlanketJson });
    const base = await listen(createServer(app));
    const echo = await fetch(`${base}/echo/1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"x":2}' });
    expect(await echo.json()).toMatchObject({ id: '1', body: { x: 2 }, proto: 'http:' });
  });

  it('falls through to host routes on no match and to the host error handler on a throw', async () => {
    const { app, hostErrors } = expressHost({ withBlanketJson: true });
    const base = await listen(createServer(app));
    expect(await (await fetch(`${base}/host-route`)).json()).toEqual({ host: true });
    const boom = await fetch(`${base}/boom`);
    expect([boom.status, await boom.json()]).toEqual([500, { error: 'host handler' }]);
    expect(hostErrors).toHaveLength(1);
    expect((await fetch(`${base}/cookies`)).headers.getSetCookie()).toHaveLength(2);
  });
});
