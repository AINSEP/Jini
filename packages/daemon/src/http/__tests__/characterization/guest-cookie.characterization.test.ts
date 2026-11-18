import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFrontendGuestScope } from '../../frontend-guest-scope.js';
import type { FrontendHookInput } from '../../frontend-hook-input.js';

/**
 * The guest cookie a visitor's browser is given, recorded from today's code as the bytes of the
 * `Set-Cookie` header on a real socket. The scope is not a route of its own (a host calls it from
 * its own route), so this file mounts the smallest host that does: one route that issues, one
 * that says which guest a request is.
 */

/** The host's side of the contract: the request's headers as web headers, and Express's answer to "is this HTTPS" in `locals`. */
function hookInput({ req }: { req: express.Request }): FrontendHookInput {
  return { request: { method: req.method, headers: new Headers(Object.entries(req.headers).flatMap(([name, value]) => (typeof value === 'string' ? [[name, value] as [string, string]] : []))) }, locals: { secure: req.secure } };
}

const LIFETIME_MS = 30 * 60_000;
let server: Server;
let origin: string;

beforeAll(async () => {
  const scope = createFrontendGuestScope({ workspaceId: 'workspace-1', cookieName: 'visitor', cookiePath: '/site/one', allowsRequest: async () => true, isSecureRequest: ({ locals }) => locals['secure'] === true }, { now: () => 1_700_000_000_000, lifetimeMs: LIFETIME_MS });
  const app = express();
  // "Is this HTTPS" is the host's answer; behind a proxy Express takes it from the forwarded protocol.
  app.set('trust proxy', true);
  app.post('/issue', async (req, res) => {
    const issued = await scope.issue(hookInput({ req }));
    if (!issued) { res.sendStatus(403); return; }
    res.setHeader('Set-Cookie', issued.setCookie);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ tabCredential: issued.tabCredential });
  });
  app.get('/guest', async (req, res) => { res.json({ guest: await scope.resolveGuest(hookInput({ req })) ?? null }); });
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }); });

async function issue(headers: Record<string, string> = {}): Promise<{ cookieValue: string; attributes: string[]; cacheControl: string | null; tabCredential: string }> {
  const response = await fetch(`${origin}/issue`, { method: 'POST', headers });
  const [pair = '', ...attributes] = (response.headers.get('set-cookie') ?? '').split('; ');
  return { cookieValue: pair.slice('visitor='.length), attributes, cacheControl: response.headers.get('cache-control'), tabCredential: (await response.json() as { tabCredential: string }).tabCredential };
}
const guestOf = async (cookie: string): Promise<string | null> => (await (await fetch(`${origin}/guest`, { headers: { cookie } })).json() as { guest: string | null }).guest;

describe('guest cookie', () => {
  it('is HttpOnly, SameSite=Strict, scoped to its path, expires with the credential, and its answer is not cacheable', async () => {
    const issued = await issue();
    expect(issued.attributes).toEqual(['Max-Age=1800', 'Path=/site/one', expect.stringMatching(/^Expires=/), 'HttpOnly', 'SameSite=Strict']);
    expect(issued.cacheControl).toBe('no-store');
  });

  it('is marked Secure only when the request arrived over HTTPS', async () => {
    expect((await issue({ 'x-forwarded-proto': 'https' })).attributes).toEqual(['Max-Age=1800', 'Path=/site/one', expect.stringMatching(/^Expires=/), 'HttpOnly', 'Secure', 'SameSite=Strict']);
    expect((await issue({ 'x-forwarded-proto': 'http' })).attributes).not.toContain('Secure');
  });

  it('names a guest that the same cookie resolves to, and a second issue for that cookie keeps the guest', async () => {
    const first = await issue();
    const guest = await guestOf(`visitor=${first.cookieValue}`);
    expect(guest).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const second = await issue({ cookie: `visitor=${first.cookieValue}` });
    expect(await guestOf(`visitor=${second.cookieValue}`)).toBe(guest);
  });

  it('a tab credential presented as the cookie is not a guest, although the same key signed it', async () => {
    const issued = await issue();
    expect(await guestOf(`visitor=${issued.cookieValue}`)).not.toBeNull();
    expect(await guestOf(`visitor=${issued.tabCredential}`)).toBeNull();
  });

  it('a cookie under another name, or with one changed character, is not a guest', async () => {
    const issued = await issue();
    expect(await guestOf(`other=${issued.cookieValue}`)).toBeNull();
    const last = issued.cookieValue.at(-1) === 'A' ? 'B' : 'A';
    expect(await guestOf(`visitor=${issued.cookieValue.slice(0, -1)}${last}`)).toBeNull();
  });
});
