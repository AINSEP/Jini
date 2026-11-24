/**
 * @file Whether a partition's cookie jar carries a session the SERVER still honours — asked of the
 * server, not inferred from the jar.
 *
 * A cookie present in the jar is not proof the session is valid server-side: its row may be gone
 * (a rollback, a stale-session cleanup, any revoke this shell did not perform itself). Treating
 * presence as validity skips the redeem and strands the operator at a login form. So presence is
 * only the CHEAP NEGATIVE: a brand-new partition has no cookie, and a request that could only ever
 * answer 401 is a round trip on the critical path of every first open.
 *
 * The cookie is matched by NAME only, never by URL/port: Chromium keys a cookie by host, not port,
 * and a host that allocates a fresh port per launch would never match a port-scoped lookup.
 *
 * `useSessionCookies: true` is load-bearing exactly as in the exchange — without it the probe asks
 * as an anonymous caller and reports 401 for a healthy session, which would redeem a fresh session
 * on every open. Fails to `false`, never rejects, for any transport outcome: "cannot confirm" and
 * "not authenticated" both mean "redeem and try".
 */
import type { CookieJarSession, SessionNet, SessionResponse } from './types.js';

/**
 * Whether `required.session`'s jar holds at least one cookie named `required.cookieName`.
 * @complexity O(1) — one cookie-store lookup.
 */
export async function hasSessionCookie(required: {
  session: CookieJarSession;
  cookieName: string;
}, _optional: Record<string, never> = {}): Promise<boolean> {
  const cookies = await required.session.cookies.get({ name: required.cookieName });
  return cookies.length > 0;
}

/**
 * Cookie check first, then a `GET` of the host's own "who am I" route, which must answer `200`
 * for a live session and non-`200` (401) otherwise.
 * @param required.url the probe route; the host guards it before calling.
 * @complexity O(1) — one cookie lookup plus at most one request.
 */
export async function probeSession<TSession>(required: {
  net: SessionNet<TSession>;
  session: TSession & CookieJarSession;
  url: string;
  cookieName: string;
}, _optional: Record<string, never> = {}): Promise<boolean> {
  if (!(await hasSessionCookie({ session: required.session, cookieName: required.cookieName }))) return false;

  return new Promise((resolve) => {
    const request = required.net.request({ method: 'GET', url: required.url, session: required.session, useSessionCookies: true });
    request.on('response', (response: SessionResponse) => {
      // Drained rather than parsed. Only the STATUS is the answer; the principal is not ours.
      response.on('data', () => {});
      response.on('end', () => resolve(response.statusCode === 200));
    });
    request.on('error', () => resolve(false));
    request.end();
  });
}
