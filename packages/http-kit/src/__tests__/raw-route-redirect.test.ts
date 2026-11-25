// A raw spec that opts into `bufferedReply: 'redirect'` answers a 3xx `Response` exactly as an Express
// handler's `res.redirect(status, location)` did: the Accept-negotiated body (HTML, plain text or none),
// `Vary: Accept`, `Content-Length`, and the route's own headers and every `Set-Cookie` alongside. Any
// other answer takes the plain `bufferedReply` write. Mutation `redirect-not-replayed` (the opt-in
// falls through to the buffered write) leaves the body empty and drops `Vary: Accept`: these go red.
import { request } from 'node:http';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { defineRawRoute, mountRawRoute } from '../raw-route.js';
import { listen } from './route-test-host.js';

interface Wire { readonly status: number; readonly headers: Record<string, string | string[] | undefined>; readonly body: string }

/** A plain `node:http` request, so nothing adds request headers the test did not name. */
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

const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/members/oidc/callback' };

/** One app: the same redirect from the opted-in spec and from a hand-written Express handler. */
async function host({ status, location }: { status: number; location: string }): Promise<string> {
  const app = express();
  const handle = async () => {
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', Location: location });
    headers.append('Set-Cookie', 'binding=abc; Max-Age=600; Path=/members/oidc/callback; HttpOnly; Secure; SameSite=Lax');
    headers.append('Set-Cookie', 'proof=; Path=/members/oidc/verify-email; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax');
    return new Response(null, { status, headers });
  };
  mountRawRoute({ app, spec: defineRawRoute<object>({ method: 'get', path: '/spec', handle }, { bufferedReply: 'redirect' }), deps: {} });
  app.get('/express', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.cookie('binding', 'abc', { ...COOKIE_OPTIONS, maxAge: 600000 });
    res.clearCookie('proof', { ...COOKIE_OPTIONS, path: '/members/oidc/verify-email' });
    res.redirect(status, location);
  });
  return listen({ app });
}

const REQUESTS = [{}, { headers: { accept: 'text/html' } }, { headers: { accept: 'application/json' } }, { headers: { accept: 'text/plain' } }, { method: 'HEAD' }];

describe("mountRawRoute bufferedReply: 'redirect'", () => {
  it('answers a 303 with the negotiated redirect body, Vary: Accept and the route headers', async () => {
    const base = await host({ status: 303, location: '/signin#oidcError=LOGIN_INVALID' });
    const html = await send(`${base}/spec`, { headers: { accept: 'text/html' } });
    expect(html.status).toBe(303);
    expect(html.headers.location).toBe('/signin#oidcError=LOGIN_INVALID');
    expect(html.headers.vary).toBe('Accept');
    expect(html.body).toBe('<p>See Other. Redirecting to /signin#oidcError=LOGIN_INVALID</p>');
    expect(html.headers['cache-control']).toBe('no-store');
    expect(html.headers['referrer-policy']).toBe('no-referrer');
    expect(html.headers['set-cookie']).toHaveLength(2);
    expect((await send(`${base}/spec`)).body).toBe('See Other. Redirecting to /signin#oidcError=LOGIN_INVALID');
  });

  it('is what a hand-written res.redirect(status, location) answers, for every Accept and HEAD', async () => {
    for (const target of [{ status: 303, location: '/account' }, { status: 302, location: 'https://accounts.example.test/o/authorize?state=a%20b&x=<y>' }]) {
      const base = await host(target);
      for (const options of REQUESTS) {
        const spec = await send(`${base}/spec`, options);
        const hand = await send(`${base}/express`, options);
        // Express's `Max-Age` cookie carries a clock-derived `Expires`: compare cookie names, everything else byte for byte.
        const cookieNames = (wire: Wire) => (wire.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]);
        expect(cookieNames(spec)).toEqual(cookieNames(hand));
        const { 'set-cookie': _a, ...specRest } = spec.headers;
        const { 'set-cookie': _b, ...handRest } = hand.headers;
        expect({ ...spec, headers: specRest }).toEqual({ ...hand, headers: handRest });
      }
    }
  });

  it('answers a non-redirect Response as the plain buffered write', async () => {
    const app = express();
    const handle = async () => new Response('nope', { status: 401, headers: { 'Content-Type': 'text/plain' } });
    mountRawRoute({ app, spec: defineRawRoute<object>({ method: 'get', path: '/spec', handle }, { bufferedReply: 'redirect' }), deps: {} });
    const wire = await send(`${await listen({ app })}/spec`);
    expect(wire.status).toBe(401);
    expect(wire.body).toBe('nope');
    expect(wire.headers['content-length']).toBe('4');
    expect(wire.headers.vary).toBeUndefined();
  });
});
