import { DeployError } from './types.js';

/**
 * Shared redirect guard for deploy targets whose `fetch()` calls carry a live
 * `Authorization: Bearer <token>` header. Without a `redirect` option, a 3xx response from a
 * target's hardcoded, trusted API origin would be followed transparently by `fetch()`, replaying
 * that Authorization header at whatever `Location` the response named. Under normal operation no
 * such origin redirects these endpoints, but a redirect is exactly the mechanism a compromised edge,
 * misconfigured origin, or MITM would use to exfiltrate the token to an attacker-controlled host —
 * flagged 2026-08-15 (a downstream product's deploy-publishing dispatch) and fixed here, in the shared helper every target uses,
 * rather than only papering over it from a caller.
 *
 * `redirectGuardInit` is the one place every call site adds `redirect: 'manual'`.
 * `assertNotRedirected` is the one place that turns the resulting response into an honest, typed
 * failure. Per the WHATWG Fetch spec (undici implements this identically for Node, not just
 * browsers), `redirect: 'manual'` makes `fetch()` resolve to an "opaque-redirect filtered
 * response" for ANY 3xx — `status` 0, `type: 'opaqueredirect'`, no readable headers/body — so this
 * guard checks `type` first and `status` second (a `PROVIDER_ERROR`-shaped 3xx can never reach
 * this function with `status` in the 300s once `redirect: 'manual'` is set, but checking both
 * keeps this correct even if a future runtime implements manual mode differently).
 */

/** Adds `redirect: 'manual'` to `init` without mutating the caller's object. */
export function redirectGuardInit({ init }: { init: RequestInit }): RequestInit {
  return { ...init, redirect: 'manual' };
}

/**
 * @throws {DeployError} `resp` is an opaque-redirect filtered response (the server tried to
 *   redirect this authenticated request elsewhere). Call immediately after every guarded
 *   `fetch()`, before reading `resp.status`/`resp.json()` for any other reason — a caller that
 *   checks `resp.status === 404` (a real, expected branch in some targets) before this guard
 *   would never see that check misfire, since an opaque-redirect response's `status` is `0`, not
 *   `404` — but call ordering here still matters for every OTHER status-sensitive branch in
 *   a target.
 */
export function assertNotRedirected({ resp, providerLabel }: { resp: Response; providerLabel: string }): void {
  if (resp.type === 'opaqueredirect' || (resp.status >= 300 && resp.status < 400)) {
    throw new DeployError(
      { message: `${providerLabel} attempted to redirect an authenticated request — refused to follow it (possible credential-leak vector).` },
      { status: 502 }
    );
  }
}
