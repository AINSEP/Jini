// J5 (w3-rtfnd): non-JSON routes (HTML, streams, uploads, downloads, 302 + Set-Cookie) get the same
// gates and host ports as `mountJsonRoute`, answer with a web `Response`, and mount with
// `app[method](path, handler)` — never `app.use`, so the host's route-table pin stays exact.
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { defineRawRoute, mountRawRoute } from '../raw-route.js';
import type { JsonRoutePorts } from '../types.js';
import { listen } from './route-test-host.js';

const OCTETS = { 'content-type': 'application/octet-stream' };
/** A host origin policy that admits only requests without an `Origin` header (enough to exercise the gate). */
const ORIGIN = { originPolicy: { isSameOrigin: ({ req }: { readonly req: { readonly headers: Record<string, unknown> } }) => req.headers.origin === undefined } };

describe('mountRawRoute', () => {
  it('mounts with app[method](path), never app.use', () => {
    const calls: string[] = [];
    const app = { use: () => calls.push('use'), get: (path: string) => calls.push(`get ${path}`), post: () => calls.push('post') } as unknown as Express;
    mountRawRoute({ app, spec: defineRawRoute<object>({ method: 'get', path: '/page', handle: async () => new Response('x') }), deps: {} });
    expect(calls).toEqual(['get /page']);
  });

  it('runs the ports in mountJsonRoute order and writes status, every header and the body', async () => {
    const seen: string[] = [];
    const ports: JsonRoutePorts<{ n: number }, { id: string }> = {
      workspace: () => { seen.push('workspace'); },
      authenticate: () => { seen.push('authenticate'); return { id: 'u1' }; },
      authorize: ({ permission, context }) => { seen.push(`authorize ${permission} ${context?.id}`); },
      requestFacts: () => ({ clientAddress: '198.51.100.4' }),
    };
    const spec = defineRawRoute<{ n: number }, { id: string }>({
      method: 'post', path: '/login/:id',
      handle: async ({ raw, deps, context, authorize }) => {
        await authorize({ permission: 'session.create' });
        seen.push(`handle ${raw.params.id} ${deps.n} ${context?.id} ${raw.facts?.clientAddress} ${raw.headers?.['x-k']}`);
        const headers = new Headers({ location: '/home' });
        headers.append('set-cookie', 'a=1; Path=/');
        headers.append('set-cookie', 'b=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT');
        return new Response(null, { status: 302, headers });
      },
    }, { ports, readHeaders: ['X-K'], requestFacts: true, responseHeaders: { 'cache-control': 'no-store' } });
    const app = express();
    mountRawRoute({ app, spec, deps: { n: 7 } });
    const response = await fetch(`${await listen({ app })}/login/abc`, { method: 'POST', redirect: 'manual', headers: { 'x-k': 'v' } });
    expect(seen).toEqual(['workspace', 'authenticate', 'authorize session.create u1', 'handle abc 7 u1 198.51.100.4 v']);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/home');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT']);
  });

  it('hands an express.raw upload body through as bytes and enforces maxBodyBytes', async () => {
    const sizes: number[] = [];
    const spec = defineRawRoute<object>({
      method: 'post', path: '/upload',
      handle: async ({ raw }) => { sizes.push((raw.body as Buffer).byteLength); return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'application/octet-stream' } }); },
    }, { maxBodyBytes: 8 });
    const app = express();
    app.use(express.raw({ type: '*/*' }));
    mountRawRoute({ app, spec, deps: {} });
    const base = await listen({ app });
    const small = await fetch(`${base}/upload`, { method: 'POST', headers: OCTETS, body: new Uint8Array(8) });
    expect([small.status, [...new Uint8Array(await small.arrayBuffer())]]).toEqual([200, [1, 2, 3]]);
    const big = await fetch(`${base}/upload`, { method: 'POST', headers: OCTETS, body: new Uint8Array(9) });
    expect(big.status).toBe(413);
    expect(sizes).toEqual([8]);
  });

  it('streams a ReadableStream body and cancels it when the client leaves', async () => {
    const cancelled = vi.fn();
    let signal!: AbortSignal;
    const spec = defineRawRoute<object>({
      method: 'get', path: '/events',
      handle: async (_args, opts) => {
        signal = opts.signal;
        const body = new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(new TextEncoder().encode('data: 1\n\n')), cancel: cancelled });
        return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    const app = express();
    mountRawRoute({ app, spec, deps: {} });
    const controller = new AbortController();
    const response = await fetch(`${await listen({ app })}/events`, { signal: controller.signal });
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: 1\n\n');
    controller.abort();
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalled());
    expect(signal.aborted).toBe(true);
  });

  it('refuses cross-origin traffic and redacts a thrown error (SEC-005), or hands it to onError', async () => {
    const internal = vi.fn();
    const throwing = defineRawRoute<object>({ method: 'post', path: '/boom', handle: async () => { throw new Error('secret dsn'); } }, { requireSameOrigin: true });
    const app = express();
    mountRawRoute({ app, spec: throwing, deps: {}, adapter: { ...ORIGIN, onInternalError: internal } });
    const base = await listen({ app });
    const cross = await fetch(`${base}/boom`, { method: 'POST', headers: { origin: 'https://evil.example' } });
    expect(cross.status).toBe(403);
    const boom = await fetch(`${base}/boom`, { method: 'POST' });
    expect(boom.status).toBe(500);
    expect(await boom.text()).not.toContain('secret dsn');
    expect(internal).toHaveBeenCalledTimes(1);
    const handled = defineRawRoute<object>({ method: 'get', path: '/h', handle: async () => { throw new Error('x'); } }, { ports: { onError: ({ res }) => { res.status(418).send('teapot'); } } });
    const app2 = express();
    mountRawRoute({ app: app2, spec: handled, deps: {} });
    const teapot = await fetch(`${await listen({ app: app2 })}/h`);
    expect([teapot.status, await teapot.text()]).toEqual([418, 'teapot']);
  });

  it('throws at mount time when a spec opts into facts without the resolver port', () => {
    const spec = defineRawRoute<object>({ method: 'get', path: '/f', handle: async () => new Response(null) }, { requestFacts: true });
    expect(() => mountRawRoute({ app: express(), spec, deps: {} })).toThrow(/requestFacts/);
  });
  // Mutation `raw-route-vary-replaces`: writing the route's `Vary` with `setHeader` (replacement) drops the
  // middleware's and the spec's static values, so a shared cache serves one variant to every Origin/encoding.
  it('answers the union of middleware, static and route-provided Vary values, each once', async () => {
    const spec = defineRawRoute<object>({
      method: 'get', path: '/varied',
      handle: async () => new Response('x', { headers: { vary: 'Cookie, origin' } }),
    }, { responseHeaders: { vary: 'Origin' } });
    const app = express();
    app.use((_req, res, next) => { res.vary('Accept-Encoding'); next(); });
    mountRawRoute({ app, spec, deps: {} });
    const response = await fetch(`${await listen({ app })}/varied`);
    expect(response.headers.get('vary')).toBe('Accept-Encoding, Origin, Cookie');
  });
});
