/** Opaque guest cookie plus independently minted document credential for public frontends. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { timingSafeTokenMatch } from '@jini-ai/core';
import type { FrontendSessionOwner } from '../frontend-session-registry.js';
import type { FrontendHookInput } from './frontend-hook-input.js';

/** Signs and reads the two credential kinds under one per-instance key: a payload and its HMAC, expiring by the instance's own clock. */
function createCredentialCodec({ now }: { now: () => number }, _optional: Record<string, never> = {}) {
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
  return { mint, read };
}

/** Per-instance keys isolate visitor control from every other frontend registry.
 * Tokens are bounded and expire; never put either credential in URLs or diagnostics.
 * O(1) bounded cookie/token parsing and signing, no persistent guest database. */
export function createFrontendGuestScope({ workspaceId, cookieName, cookiePath, allowsRequest, isSecureRequest }: {
  workspaceId: string; cookieName: string; cookiePath: string;
  allowsRequest: (required: FrontendHookInput) => Promise<boolean>;
  /** Whether the request arrived over HTTPS: host policy (proxy trust), so the host answers it, as it does for the quota address. */
  isSecureRequest: (required: FrontendHookInput) => boolean;
}, { now = Date.now, lifetimeMs = 30 * 60_000 }: { now?: () => number; lifetimeMs?: number } = {}) {
  const { mint, read } = createCredentialCodec({ now });
  function guest({ request }: FrontendHookInput): string | undefined {
    const cookie = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`));
    const value = read(cookie?.slice(cookieName.length + 1) ?? '');
    return value?.kind === 'guest' && typeof value.guest === 'string' ? value.guest : undefined;
  }
  /** The cookie text Express's `res.cookie` wrote for these options (cookie 0.7.2 attribute order). */
  const cookieText = ({ value, expires, secure }: { value: string; expires: number; secure: boolean }) =>
    `${cookieName}=${encodeURIComponent(value)}; Max-Age=${Math.floor(lifetimeMs / 1000)}; Path=${cookiePath}; Expires=${new Date(expires).toUTCString()}; HttpOnly${secure ? '; Secure' : ''}; SameSite=Strict`;
  return {
    /** Authenticate the cookie independently of a tab for credential-minting budgets. */
    async resolveGuest(input: FrontendHookInput, _options = {}): Promise<string | undefined> {
      return await allowsRequest(input) ? guest(input) : undefined;
    },
    /**
     * A tab credential and the guest cookie to set for it. The caller sets the `Set-Cookie` header and
     * `Cache-Control: no-store`, and sends `{ tabCredential }` only: the cookie text is HttpOnly for a reason.
     */
    async issue(input: FrontendHookInput, _options = {}): Promise<{ tabCredential: string; setCookie: string } | null> {
      if (!await allowsRequest(input)) return null;
      const principalId = guest(input) ?? randomBytes(24).toString('base64url');
      const expires = now() + lifetimeMs;
      // A JS-readable tab token must never authenticate as the HttpOnly guest cookie.
      const setCookie = cookieText({ value: mint({ kind: 'guest', guest: principalId, expires }), expires, secure: isSecureRequest(input) });
      return { setCookie, tabCredential: mint({ kind: 'tab', guest: principalId, tab: randomBytes(24).toString('base64url'), expires }) };
    },
    async resolveOwner(input: FrontendHookInput, _options = {}): Promise<FrontendSessionOwner | null> {
      if (!await allowsRequest(input)) return null;
      const principalId = guest(input);
      const tab = read(input.request.headers.get('x-frontend-tab') ?? '');
      if (!principalId || tab?.kind !== 'tab' || tab.guest !== principalId || typeof tab.tab !== 'string') return null;
      return { workspaceId, principalId, tabId: tab.tab };
    },
  };
}
