import { createServer, request as httpRequest, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('answers a Host header that makes no valid URL with a 400 and never rejects', async () => {
    const dispatcher = createNodeDispatcher({}, { onUnhandledError: () => undefined });
    routes(dispatcher);
    const rejections: unknown[] = [];
    const base = await listen(createServer((incoming, out) => { dispatcher.handle({ incoming, out }).catch((e: unknown) => { rejections.push(e); out.destroy(); }); }));
    const status = await rawStatus({ base, path: '/echo/1', headers: { host: '[' } });
    expect([status, rejections]).toEqual([400, []]);
  });

  it('matches the request path exactly as received; a leading double slash is not an authority', async () => {
    const dispatcher = createNodeDispatcher();
    routes(dispatcher);
    const base = await listen(createServer((incoming, out) => { void dispatcher.handle({ incoming, out }); }));
    expect(await rawStatus({ base, path: '//elsewhere/cookies' })).toBe(404);
    // Dot segments are not resolved either: the host framework's own path checks never resolve them.
    expect(await rawStatus({ base, path: '/x/../cookies' })).toBe(404);
    expect(await rawStatus({ base, path: '/cookies?x=1' })).toBe(200);
  });

  it('stops reading a stream while the client is not reading, and cancels it when the client leaves', async () => {
    const chunk = new Uint8Array(256 * 1024);
    let pulled = 0;
    let cancelled!: () => void;
    const sawCancel = new Promise<void>((resolve) => { cancelled = resolve; });
    const dispatcher = createNodeDispatcher();
    dispatcher.server.route({ method: 'GET', path: '/flood', handler: () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { pulled += 1; if (pulled > 256) controller.close(); else controller.enqueue(chunk); },
      cancel() { cancelled(); },
    }), { headers: { 'content-type': 'text/event-stream' } }) });
    const base = await listen(createServer((incoming, out) => { void dispatcher.handle({ incoming, out }); }));
    const req = httpRequest(`${base}/flood`);
    req.on('error', () => undefined);
    // A stalled client: it takes the response head and never reads the body.
    const res = await new Promise<import('node:http').IncomingMessage>((resolve) => { req.on('response', resolve); req.end(); });
    res.pause();
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Without backpressure all 256 chunks (64 MiB) land in Node's buffers; socket buffers hold far fewer.
    expect(pulled).toBeLessThan(128);
    req.destroy();
    await sawCancel;
  });

  it('cuts the connection and reports once when a stream fails mid-way', async () => {
    const errors: unknown[] = [];
    const dispatcher = createNodeDispatcher({}, { onUnhandledError: (e) => errors.push(e) });
    dispatcher.server.route({ method: 'GET', path: '/broken', handler: () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: one\n\n')); },
      pull(controller) { controller.error(new Error('producer failed')); },
    })) });
    const base = await listen(createServer((incoming, out) => { void dispatcher.handle({ incoming, out }); }));
    const response = await fetch(`${base}/broken`);
    await expect(response.text()).rejects.toThrow();
    expect(errors).toHaveLength(1);
  });

  it('masks a host-injected key shape in the default error log (Jini knows no host key formats)', async () => {
    // Tovu's key shape, `tovu_ak_<12 hex>.<43 base64url>`; the host supplies the pattern, Jini only applies it.
    const secret = 'Qm9vZ2llV29vZ2llQm9vZ2llV29vZ2llQm9vZ2llV29';
    const key = `tovu_ak_9f2c1b04d7e5.${secret}`;
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((text: string | Uint8Array) => { writes.push(String(text)); return true; });
    try {
      const dispatcher = createNodeDispatcher({}, { redactionPatterns: [{ name: 'host_api_key', regex: /tovu_ak_[0-9a-f]{12}\.[A-Za-z0-9_-]+/g }] });
      dispatcher.server.route({ method: 'GET', path: '/leak', handler: () => { throw new Error(`rejected ${key}`); } });
      const base = await listen(createServer((incoming, out) => { void dispatcher.handle({ incoming, out }); }));
      expect((await fetch(`${base}/leak`)).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(writes.join('')).toContain('route handler failed');
    expect(writes.join('')).not.toContain(secret);
  });
});

/** Sends a request with a raw path and headers (fetch would normalize both) and returns the status. */
function rawStatus({ base, path, headers = {} }: { base: string; path: string; headers?: Record<string, string> }): Promise<number> {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path, headers, setHost: !('host' in headers) }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end();
  });
}

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

  it('gives handlers the trusted values the host already set (res.locals), seeded per request', async () => {
    const app = express();
    app.use((_req, res, next) => { res.locals.principal = { userId: 'u1' }; next(); });
    const dispatcher = createNodeDispatcher();
    app.use((req, res, next) => { void dispatcher.handle({ incoming: req, out: res }, { next, locals: res.locals }); });
    dispatcher.server.route({ method: 'GET', path: '/whoami', handler: ({ locals }) => jsonResponse({ status: 200, body: { principal: locals?.principal ?? null } }) });
    const base = await listen(createServer(app));
    expect(await (await fetch(`${base}/whoami`)).json()).toEqual({ principal: { userId: 'u1' } });
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
