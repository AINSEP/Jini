import { createServer, request as httpRequest, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { jsonResponse } from '@jini-ai/core/contracts/server';
import { createNodeDispatcher, sendWebResponse } from '../node-bridge.js';

/**
 * The bridge facts the daemon's route lane depends on, each pinned through a real socket:
 * what a route sees as its body when an upstream parser already read it, which address it
 * is told the caller has, how HEAD and OPTIONS are answered, and the exported response writer.
 */
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

/** What a route saw of its request body: null, or the bytes as hex (so a byte >= 0x80 shows up). */
async function bodySeen(request: Request): Promise<string> {
  if (request.body === null) return 'null';
  return Buffer.from(await request.arrayBuffer()).toString('hex');
}

function bodyEchoRoute(dispatcher: ReturnType<typeof createNodeDispatcher>) {
  dispatcher.server.route({ method: 'POST', path: '/body', handler: async ({ request }) => jsonResponse({ status: 200, body: { seen: await bodySeen(request) } }) });
}

describe('body provenance', () => {
  it('hands the route the untouched stream when nothing upstream read it: bytes >= 0x80 arrive intact', async () => {
    const dispatcher = createNodeDispatcher();
    bodyEchoRoute(dispatcher);
    const base = await listen(createServer((incoming, out) => { void dispatcher.handle({ incoming, out }); }));
    const sent = new Uint8Array([0x00, 0x7f, 0x80, 0xc3, 0xff]);
    const res = await fetch(`${base}/body`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: sent });
    expect(await res.json()).toEqual({ seen: '007f80c3ff' });
  });

  it('gives the route null, not an empty body, when an upstream parser drained the request and no parsedBody was passed', async () => {
    const dispatcher = createNodeDispatcher();
    bodyEchoRoute(dispatcher);
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { void dispatcher.handle({ incoming: req, out: res }, { next }); });
    const base = await listen(createServer(app));
    const res = await fetch(`${base}/body`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
    expect(await res.json()).toEqual({ seen: 'null' });
  });

  it('rebuilds the body from parsedBody when the parser drained the request: bytes byte for byte, objects as JSON', async () => {
    const dispatcher = createNodeDispatcher();
    bodyEchoRoute(dispatcher);
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { void dispatcher.handle({ incoming: req, out: res }, { next, parsedBody: req.body }); });
    const base = await listen(createServer(app));
    const res = await fetch(`${base}/body`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
    expect(await res.json()).toEqual({ seen: Buffer.from('{"a":1}').toString('hex') });
  });
});

describe('client address', () => {
  it('is the socket peer, never a forwarded-for header the caller chose', async () => {
    const dispatcher = createNodeDispatcher();
    dispatcher.server.route({ method: 'GET', path: '/who', handler: ({ client }) => jsonResponse({ status: 200, body: { address: client?.address ?? null } }) });
    const base = await listen(createServer((incoming, out) => { void dispatcher.handle({ incoming, out }); }));
    const res = await fetch(`${base}/who`, { headers: { 'x-forwarded-for': '10.9.8.7', forwarded: 'for=10.9.8.7', 'x-real-ip': '10.9.8.7' } });
    expect(await res.json()).toEqual({ address: '127.0.0.1' });
  });
});

describe('HEAD and OPTIONS', () => {
  function withRoute() {
    const dispatcher = createNodeDispatcher();
    dispatcher.server.route({ method: 'GET', path: '/thing', handler: () => new Response('the body', { headers: { 'x-kind': 'thing', 'content-type': 'text/plain' } }) });
    return dispatcher;
  }
  function rawRequest({ base, method, path }: { base: string; method: string; path: string }): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(`${base}${path}`, { method }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('answers HEAD on a GET route from that route: its status and headers, no body', async () => {
    const dispatcher = withRoute();
    const base = await listen(createServer((incoming, out) => { void dispatcher.handle({ incoming, out }); }));
    const head = await rawRequest({ base, method: 'HEAD', path: '/thing' });
    expect([head.status, head.headers['x-kind'], head.body]).toEqual([200, 'thing', '']);
  });

  it('answers OPTIONS on a routed path with 405 and the methods it does take when it has no host to hand the request to', async () => {
    const dispatcher = withRoute();
    const base = await listen(createServer((incoming, out) => { void dispatcher.handle({ incoming, out }); }));
    const options = await rawRequest({ base, method: 'OPTIONS', path: '/thing' });
    expect([options.status, options.headers.allow]).toEqual([405, 'GET, HEAD']);
  });

  it('hands OPTIONS to the host when one is mounted (so a CORS layer or Express itself answers it), and never answers it itself', async () => {
    const dispatcher = withRoute();
    const app = express();
    app.use((req, res, next) => { void dispatcher.handle({ incoming: req, out: res }, { next }); });
    app.options('/thing', (_req, res) => { res.setHeader('allow', 'GET, HEAD, OPTIONS').status(200).end('host answered'); });
    const base = await listen(createServer(app));
    const options = await rawRequest({ base, method: 'OPTIONS', path: '/thing' });
    expect([options.status, options.body]).toEqual([200, 'host answered']);
  });
});

describe('sendWebResponse', () => {
  it('writes status, headers, every Set-Cookie on its own line, and the body to a plain Node response', async () => {
    const base = await listen(createServer((_incoming, out) => {
      const headers = new Headers({ 'x-kind': 'built', 'content-type': 'text/plain' });
      headers.append('set-cookie', 'a=1; Expires=Wed, 21 Oct 2035 07:28:00 GMT');
      headers.append('set-cookie', 'b=2');
      void sendWebResponse({ response: new Response('hello', { status: 201, headers }), res: out });
    }));
    const res = await fetch(`${base}/`);
    expect([res.status, res.headers.get('x-kind'), res.headers.getSetCookie(), await res.text()]).toEqual([201, 'built', ['a=1; Expires=Wed, 21 Oct 2035 07:28:00 GMT', 'b=2'], 'hello']);
  });

  it('with headOnly writes the head and drops the body, cancelling its producer', async () => {
    let cancelled = 0;
    const base = await listen(createServer((_incoming, out) => {
      const body = new ReadableStream<Uint8Array>({ cancel: () => { cancelled += 1; } });
      void sendWebResponse({ response: new Response(body, { status: 200, headers: { 'x-kind': 'streamed' } }), res: out }, { headOnly: true });
    }));
    const res = await fetch(`${base}/`);
    expect([res.status, res.headers.get('x-kind'), await res.text(), cancelled]).toEqual([200, 'streamed', '', 1]);
  });
});
