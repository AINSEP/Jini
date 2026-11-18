import { createServer, request as httpRequest, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { jsonResponse } from '@jini-ai/core/contracts/server';
import { createNodeDispatcher, type NodeDispatcher } from '../node-bridge.js';

/**
 * What a host gets from `createNodeDispatcher({}, { expressCompatible: true })` when it replaces
 * Express routes with route lists and must keep answering what Express answered: the spellings of a
 * path, a bad percent-escape, OPTIONS, and the length of a finished body. Each runs on a real socket.
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

interface Raw { readonly status: number; readonly headers: Record<string, string | string[] | undefined>; readonly body: string }

function raw({ base, method, path }: { base: string; method: string; path: string }): Promise<Raw> {
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

function routed(options: { expressCompatible?: boolean } = {}): NodeDispatcher {
  const dispatcher = createNodeDispatcher({}, options);
  dispatcher.server.route({ method: 'GET', path: '/api/items', handler: () => jsonResponse({ status: 200, body: { list: true } }) });
  dispatcher.server.route({ method: 'GET', path: '/api/items/:id', handler: ({ params }) => jsonResponse({ status: 200, body: { id: params.id } }) });
  dispatcher.server.route({ method: 'POST', path: '/api/items', handler: () => jsonResponse({ status: 201, body: {} }) });
  return dispatcher;
}

const standalone = (dispatcher: NodeDispatcher) => createServer((incoming, out) => { void dispatcher.handle({ incoming, out }); });

/** Express in front, as a host mounts the dispatcher: an unmatched request reaches the host's own 404 and error page. */
function underExpress(dispatcher: NodeDispatcher): HttpServer {
  const app = express();
  app.use((req, res, next) => { void dispatcher.handle({ incoming: req, out: res }, { next }); });
  return createServer(app);
}

describe('path spellings (expressCompatible)', () => {
  it('accepts a trailing slash and another letter case, keeping the case of the id', async () => {
    const base = await listen(standalone(routed({ expressCompatible: true })));
    expect(JSON.parse((await raw({ base, method: 'GET', path: '/api/items/' })).body)).toEqual({ list: true });
    expect(JSON.parse((await raw({ base, method: 'GET', path: '/API/Items/AbC/' })).body)).toEqual({ id: 'AbC' });
  });

  it('is off unless asked for: the exact answers stay (404 for a slash or another case)', async () => {
    const base = await listen(standalone(routed()));
    expect((await raw({ base, method: 'GET', path: '/api/items/' })).status).toBe(404);
    expect((await raw({ base, method: 'GET', path: '/API/items' })).status).toBe(404);
  });
});

describe('a bad percent-escape in an id (expressCompatible)', () => {
  it('answers 400 in plain words on its own', async () => {
    const base = await listen(standalone(routed({ expressCompatible: true })));
    const answer = await raw({ base, method: 'GET', path: '/api/items/%E0%A4%A' });
    expect([answer.status, answer.headers['content-type']]).toEqual([400, 'text/plain; charset=utf-8']);
    expect(answer.body).toBe('The request address is not valid. A part of it is not valid percent-encoding.');
  });

  it('hands the host a 400 error, so the host answers with the error page it always used (Express: its own 400 page)', async () => {
    const base = await listen(underExpress(routed({ expressCompatible: true })));
    const answer = await raw({ base, method: 'GET', path: '/api/items/%E0%A4%A' });
    expect([answer.status, answer.headers['content-type']]).toEqual([400, 'text/html; charset=utf-8']);
  });

  it('is a 404 from the host when not asked for (a bad escape matches no route)', async () => {
    const base = await listen(underExpress(routed()));
    expect((await raw({ base, method: 'GET', path: '/api/items/%E0%A4%A' })).status).toBe(404);
  });
});

describe('OPTIONS on a routed path (expressCompatible)', () => {
  it('answers 200 with Allow and the methods as the body, whether or not a host is mounted', async () => {
    for (const server of [standalone(routed({ expressCompatible: true })), underExpress(routed({ expressCompatible: true }))]) {
      const base = await listen(server);
      const answer = await raw({ base, method: 'OPTIONS', path: '/api/items' });
      expect([answer.status, answer.headers.allow, answer.body, answer.headers['content-length']]).toEqual([200, 'GET,POST,HEAD', 'GET,POST,HEAD', '13']);
      await new Promise((resolve) => server.close(resolve));
      open = undefined;
    }
  });

  it('on a path no route owns still goes to the host (its 404), and a plain GET is untouched', async () => {
    const base = await listen(underExpress(routed({ expressCompatible: true })));
    expect((await raw({ base, method: 'OPTIONS', path: '/elsewhere' })).status).toBe(404);
    expect((await raw({ base, method: 'GET', path: '/api/items' })).status).toBe(200);
  });
});

describe('Content-Length on a finished body', () => {
  it('a JSON answer, a HEAD of it, and the dispatcher\'s own 404, 405 and 500 all state their length', async () => {
    const dispatcher = routed();
    dispatcher.server.route({ method: 'GET', path: '/boom', handler: () => { throw new Error('inside'); } });
    const base = await listen(createServer((incoming, out) => { void dispatcher.handle({ incoming, out }, {}); }));
    const length = async (method: string, path: string) => (await raw({ base, method, path })).headers['content-length'];
    expect(await length('GET', '/api/items')).toBe(String('{"list":true}'.length));
    expect(await length('HEAD', '/api/items')).toBe(String('{"list":true}'.length));
    expect(await length('GET', '/nothing')).toBe(String('Not Found'.length));
    expect(await length('PUT', '/api/items')).toBe(String('Method Not Allowed'.length));
    const boom = await raw({ base, method: 'GET', path: '/boom' });
    expect(boom.headers['content-length']).toBe(String(Buffer.byteLength(boom.body)));
  });

  it('a stream is not given one, and no validator or 304 is made: the same request twice is 200 twice', async () => {
    const dispatcher = routed();
    dispatcher.server.route({ method: 'GET', path: '/stream', handler: () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('a')); c.close(); } })) });
    const base = await listen(standalone(dispatcher));
    expect((await raw({ base, method: 'GET', path: '/stream' })).headers['content-length']).toBeUndefined();
    const first = await raw({ base, method: 'GET', path: '/api/items' });
    expect(first.headers.etag).toBeUndefined();
    const again = await fetch(`${base}/api/items`, { headers: { 'if-none-match': 'W/"anything"' } });
    expect(again.status).toBe(200);
  });
});
