/** Opaque guest cookie plus independently minted document credential for public frontends. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { timingSafeTokenMatch } from '@jini-ai/core';
import type { Request, Response } from 'express';
import type { FrontendSessionOwner } from '../frontend-session-registry.js';

/** Per-instance keys isolate visitor control from every other frontend registry.
 * Tokens are bounded and expire; never put either credential in URLs or diagnostics.
 * O(1) bounded cookie/token parsing and signing, no persistent guest database. */
export function createFrontendGuestScope({ workspaceId, cookieName, cookiePath, allowsRequest }: {
  workspaceId: string; cookieName: string; cookiePath: string;
  allowsRequest: (args: { req: Request }) => Promise<boolean>;
}, { now = Date.now, lifetimeMs = 30 * 60_000 }: { now?: () => number; lifetimeMs?: number } = {}) {
  const key = randomBytes(32);
  const sign = (text: string) => createHmac('sha256', key).update(text).digest('base64url');
  const mint = (value: Record<string, unknown>) => { const payload = Buffer.from(JSON.stringify(value)).toString('base64url'); return `${payload}.${sign(payload)}`; };
  function read(value: string): Record<string, unknown> | null {
    if (value.length > 1024) return null;
    const parts = value.split('.');
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    if (!payload || !signature) return null;
    const expected = sign(payload);
    // The shared matcher checks UTF-8 byte lengths before native comparison can throw.
    if (!timingSafeTokenMatch({ presented: signature, expected, timingSafeEqual: ({ left, right }) => timingSafeEqual(left, right) })) return null;
    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return typeof parsed.expires === 'number' && parsed.expires > now() ? parsed : null;
    } catch { return null; }
  }
  function guest(req: Request): string | undefined {
    const cookie = (req.get('cookie') ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`));
    const value = read(cookie?.slice(cookieName.length + 1) ?? '');
    return value?.kind === 'guest' && typeof value.guest === 'string' ? value.guest : undefined;
  }
  return {
    /** Authenticate the cookie independently of a tab for credential-minting budgets. */
    async resolveGuest({ req }: { req: Request }, _options = {}): Promise<string | undefined> {
      return await allowsRequest({ req }) ? guest(req) : undefined;
    },
    async issue({ req, res }: { req: Request; res: Response }, _options = {}): Promise<{ tabCredential: string } | null> {
      if (!await allowsRequest({ req })) return null;
      const principalId = guest(req) ?? randomBytes(24).toString('base64url');
      const expires = now() + lifetimeMs;
      // A JS-readable tab token must never authenticate as the HttpOnly guest cookie.
      res.cookie(cookieName, mint({ kind: 'guest', guest: principalId, expires }), { httpOnly: true, sameSite: 'strict', secure: req.secure, path: cookiePath, maxAge: lifetimeMs });
      res.setHeader('Cache-Control', 'no-store');
      return { tabCredential: mint({ kind: 'tab', guest: principalId, tab: randomBytes(24).toString('base64url'), expires }) };
    },
    async resolveOwner({ req }: { req: Request; res?: Response }, _options = {}): Promise<FrontendSessionOwner | null> {
      if (!await allowsRequest({ req })) return null;
      const principalId = guest(req);
      const tab = read(req.get('x-frontend-tab') ?? '');
      if (!principalId || tab?.kind !== 'tab' || tab.guest !== principalId || typeof tab.tab !== 'string') return null;
      return { workspaceId, principalId, tabId: tab.tab };
    },
  };
}
