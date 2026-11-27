import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { postDaemonJson } from '../daemon-client.js';
import { createLoopbackFetch } from '../loopback-fetch.js';

/** Real local servers, no fake fetch: the adapter is judged against a wall it must not have. */

interface UndiciSubset {
  Agent: new (options: { headersTimeout: number }) => object;
  fetch: (url: string, init: Omit<RequestInit, 'dispatcher'> & { dispatcher: object }) => Promise<Response>;
}

/** A fetch with a 200 ms response-header wait: the shape of the wall in global fetch, small enough to test. */
function fetchWithHeaderWall(): typeof fetch {
  const { Agent, fetch: undiciFetch } = createRequire(createRequire(import.meta.url).resolve('@jini-ai/platform'))('undici') as UndiciSubset;
  const dispatcher = new Agent({ headersTimeout: 200 });
  return ((url: string, init: RequestInit) => undiciFetch(url, { ...init, dispatcher })) as typeof fetch;
}

let server: Server | undefined;
afterEach(async () => {
  if (server === undefined) return;
  server.closeAllConnections();
  await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
});

async function listen({ onRequest }: { onRequest: (request: IncomingMessage, response: ServerResponse) => void }): Promise<string> {
  server = createServer(onRequest);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

describe('createLoopbackFetch', () => {
  it('waits for response headers past a wall that fails the same call through the fallback', async () => {
    const baseUrl = await listen({ onRequest: (_request, response) => { setTimeout(() => json(response, 200, { ok: true }), 1_500).unref(); } });
    const wall = fetchWithHeaderWall();
    await expect(postDaemonJson({ baseUrl, route: '/slow', body: {} }, { timeoutMs: null, fetchImpl: wall })).rejects.toEqual(new Error('fetch failed'));
    const body = await postDaemonJson({ baseUrl, route: '/slow', body: {} }, { timeoutMs: null, fetchImpl: createLoopbackFetch({}, { fallback: wall }) });
    expect(body).toEqual({ ok: true });
  });

  it('sends the method, headers and JSON body verbatim and returns status and JSON', async () => {
    const seen: { method?: string | undefined; auth?: string | undefined; type?: string | undefined; length?: string | undefined; body: string } = { body: '' };
    const baseUrl = await listen({ onRequest: (request, response) => {
      request.on('data', chunk => { seen.body += String(chunk); });
      request.on('end', () => {
        Object.assign(seen, { method: request.method, auth: request.headers.authorization, type: request.headers['content-type'], length: request.headers['content-length'] });
        json(response, 201, { echoed: true });
      });
    } });
    const body = await postDaemonJson({ baseUrl, route: '/echo', body: { a: 1 } }, { headers: { Authorization: 'Bearer run-secret' }, fetchImpl: createLoopbackFetch() });
    expect(body).toEqual({ echoed: true });
    expect(seen).toEqual({ method: 'POST', auth: 'Bearer run-secret', type: 'application/json', length: '7', body: '{"a":1}' });
  });

  it('keeps the daemon error envelope readable on a non-2xx status', async () => {
    const baseUrl = await listen({ onRequest: (_request, response) => json(response, 404, { error: { code: 'NOT_FOUND', message: 'no such tool' } }) });
    await expect(postDaemonJson({ baseUrl, route: '/x', body: {} }, { fetchImpl: createLoopbackFetch() })).rejects.toThrow('HTTP 404: NOT_FOUND: no such tool');
  });

  it('answers a refused connection with the same daemon-unreachable words a refused fetch gets', async () => {
    const baseUrl = await listen({ onRequest: () => {} });
    server!.closeAllConnections();
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
    await expect(postDaemonJson({ baseUrl, route: '/x', body: {} }, { fetchImpl: createLoopbackFetch() })).rejects.toThrow('cannot reach the daemon at [redacted URL] Is it running?');
  });

  it('ends at the caller deadline with the deadline words, not a socket error', async () => {
    const baseUrl = await listen({ onRequest: () => {} });
    await expect(postDaemonJson({ baseUrl, route: '/hang', body: {} }, { timeoutMs: 100, fetchImpl: createLoopbackFetch() })).rejects.toThrow('request to /hang timed out after 100ms');
  });

  it('ends at the caller signal with its reason, and rejects an already-aborted signal without connecting', async () => {
    let connections = 0;
    const baseUrl = await listen({ onRequest: () => { connections += 1; } });
    const controller = new AbortController();
    const pending = createLoopbackFetch()(`${baseUrl}/hang`, { method: 'POST', body: '{}', signal: controller.signal });
    setTimeout(() => controller.abort(new Error('run cancelled')), 50);
    await expect(pending).rejects.toEqual(new Error('run cancelled'));
    const before = connections;
    await expect(createLoopbackFetch()(`${baseUrl}/never`, { signal: AbortSignal.abort(new Error('already cancelled')) })).rejects.toEqual(new Error('already cancelled'));
    expect(connections).toBe(before);
  });

  it('gives a 204 an empty body', async () => {
    const baseUrl = await listen({ onRequest: (_request, response) => { response.writeHead(204); response.end(); } });
    const response = await createLoopbackFetch()(`${baseUrl}/none`);
    expect([response.status, response.ok, await response.text()]).toEqual([204, true, '']);
  });

  it('refuses a body it cannot send as a string, in plain words', () => {
    expect(() => createLoopbackFetch()('http://127.0.0.1:1/x', { method: 'POST', body: new Uint8Array(1) })).toThrow(new TypeError('loopback fetch sends only string bodies'));
  });

  it('hands a non-loopback or https URL to the fallback untouched', async () => {
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const fallback: typeof fetch = async (input, init) => { calls.push({ url: String(input), method: init?.method }); return new Response('{}'); };
    const viaFetch = createLoopbackFetch({}, { fallback });
    await viaFetch('http://daemon.example/api', { method: 'POST' });
    await viaFetch('https://127.0.0.1/api');
    expect(calls).toEqual([{ url: 'http://daemon.example/api', method: 'POST' }, { url: 'https://127.0.0.1/api', method: undefined }]);
  });
});

it('resolves Request input, defaults to GET and preserves repeated raw response headers', async () => {
  const seen: Array<{ method: string | undefined; url: string | undefined }> = [];
  const baseUrl = await listen({ onRequest: (request, response) => {
    seen.push({ method: request.method, url: request.url });
    response.writeHead(205, { 'set-cookie': ['first=1', 'second=2'] });
    response.end();
  } });
  const response = await createLoopbackFetch()(new Request(`${baseUrl}/reset?source=client`));
  expect(seen).toEqual([{ method: 'GET', url: '/reset?source=client' }]);
  expect(response.status).toBe(205);
  expect(response.body).toBeNull();
  expect(response.headers.getSetCookie()).toEqual(['first=1', 'second=2']);
});
