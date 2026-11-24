// A raw spec that opts into `bufferedReply` answers exactly as an Express handler's `res.send(Buffer)` did:
// `Content-Length`, the host app's ETag (Express's default weak one), and a bodiless 304 when the GET/HEAD
// is fresh. Without the opt-in the reply keeps streaming chunked, with no ETag and no 304.
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { defineRawRoute, mountRawRoute } from '../raw-route.js';
import { listen } from './route-test-host.js';

const BODY = Buffer.from('export const ready = "✓";\n', 'utf8');
const HEADERS = { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
const LAST_MODIFIED = 'Tue, 01 Sep 2026 00:00:00 GMT';

/** The `etag@1.8.1` weak tag Express's default `etag` setting puts on a non-empty buffered body. */
function weakTag(body: Buffer): string {
  return `W/"${body.length.toString(16)}-${createHash('sha1').update(body).digest('base64').substring(0, 27)}"`;
}

interface Wire { readonly status: number; readonly headers: Record<string, string | string[] | undefined>; readonly body: string }

/** A plain `node:http` request: `fetch` adds `Cache-Control: no-cache` to conditional requests, which Express never calls fresh. */
function send(url: string, { method = 'GET', headers = {} }: { method?: string; headers?: Record<string, string> } = {}): Promise<Wire> {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, { method, headers }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        const { date: _date, connection: _connection, 'keep-alive': _keepAlive, ...rest } = incoming.headers;
        resolve({ status: incoming.statusCode ?? 0, headers: rest, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

/** One app: the same answer from a buffered raw spec, a streaming raw spec, and a hand-written `res.send(Buffer)`. */
async function host({ status = 200, extra = {} }: { status?: number; extra?: Record<string, string> } = {}): Promise<string> {
  const app = express();
  const handle = async () => new Response(new Uint8Array(BODY), { status, headers: { ...HEADERS, ...extra } });
  mountRawRoute({ app, spec: defineRawRoute<object>({ method: 'get', path: '/buffered', handle }, { bufferedReply: true }), deps: {} });
  mountRawRoute({ app, spec: defineRawRoute<object>({ method: 'get', path: '/streamed', handle }), deps: {} });
  app.get('/express', (_req, res) => { res.status(status).set({ ...HEADERS, ...extra }).send(BODY); });
  return listen({ app });
}

describe('mountRawRoute bufferedReply', () => {
  it('answers 200 with Content-Length and the weak ETag, not chunked', async () => {
    const wire = await send(`${await host()}/buffered`);
    expect(wire.status).toBe(200);
    expect(wire.headers['content-length']).toBe(String(BODY.length));
    expect(wire.headers.etag).toBe(weakTag(BODY));
    expect(wire.headers['transfer-encoding']).toBeUndefined();
    expect(wire.body).toBe(BODY.toString('utf8'));
  });

  it('answers 304 with no body when If-None-Match matches, and 200 when it does not', async () => {
    const base = await host();
    const fresh = await send(`${base}/buffered`, { headers: { 'if-none-match': weakTag(BODY) } });
    expect(fresh.status).toBe(304);
    expect(fresh.body).toBe('');
    expect(fresh.headers['content-type']).toBeUndefined();
    expect(fresh.headers['content-length']).toBeUndefined();
    expect(fresh.headers.etag).toBe(weakTag(BODY));
    expect((await send(`${base}/buffered`, { headers: { 'if-none-match': 'W/"stale"' } })).status).toBe(200);
  });

  it('answers 304 when If-Modified-Since is not older than the route Last-Modified', async () => {
    const base = await host({ extra: { 'Last-Modified': LAST_MODIFIED } });
    expect((await send(`${base}/buffered`, { headers: { 'if-modified-since': LAST_MODIFIED } })).status).toBe(304);
    expect((await send(`${base}/buffered`, { headers: { 'if-modified-since': 'Mon, 31 Aug 2026 00:00:00 GMT' } })).status).toBe(200);
  });

  it('answers HEAD with the full head and no body', async () => {
    const wire = await send(`${await host()}/buffered`, { method: 'HEAD' });
    expect(wire.status).toBe(200);
    expect(wire.headers['content-length']).toBe(String(BODY.length));
    expect(wire.headers.etag).toBe(weakTag(BODY));
    expect(wire.body).toBe('');
  });

  it('never makes a non-2xx answer fresh', async () => {
    const wire = await send(`${await host({ status: 404 })}/buffered`, { headers: { 'if-none-match': weakTag(BODY) } });
    expect(wire.status).toBe(404);
    expect(wire.body).toBe(BODY.toString('utf8'));
  });

  it('is byte-for-byte what a hand-written res.send(Buffer) answers', async () => {
    for (const options of [{}, { status: 404 }, { extra: { 'Last-Modified': LAST_MODIFIED } }]) {
      const base = await host(options);
      for (const request of [{}, { method: 'HEAD' }, { headers: { 'if-none-match': weakTag(BODY) } }, { headers: { 'if-modified-since': LAST_MODIFIED } }]) {
        expect(await send(`${base}/buffered`, request)).toEqual(await send(`${base}/express`, request));
      }
    }
  });

  it('leaves a route without the opt-in streaming: chunked, no ETag, no 304', async () => {
    const wire = await send(`${await host()}/streamed`, { headers: { 'if-none-match': weakTag(BODY) } });
    expect(wire.status).toBe(200);
    expect(wire.headers['transfer-encoding']).toBe('chunked');
    expect(wire.headers.etag).toBeUndefined();
    expect(wire.headers['content-length']).toBeUndefined();
    expect(wire.body).toBe(BODY.toString('utf8'));
  });
});
