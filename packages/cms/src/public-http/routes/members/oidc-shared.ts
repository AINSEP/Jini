import type { RouteReply } from "@jini-ai/core/contracts/server";
import type { MemberRequestLimiter } from "./shared.js";

/**
 * @file What the PUBLIC member OIDC start and callback specs share. Both are top-level browser pages, not
 * fetches: every failure is the host's fixed sign-in error redirect (never upstream text, which may carry OAuth
 * credentials), answered as a 303 the host mount replays through its framework's redirect writer
 * (`bufferedReply: "redirect"`). The cookie names, their scope and attributes, the error location and every
 * analytics event are the host's, injected.
 */

/** The OIDC flow cookies: `callback` holds the browser binding for the callback leg, `proof` the binding for
 *  the email-proof leg. */
export type MemberOidcFlowCookieKind = "callback" | "proof";

/** The deps both OIDC specs read. */
export interface MemberOidcRedirectDeps {
  /** The shared, app-boot-scoped per-IP counter. */
  ipLimiter: MemberRequestLimiter;
  /** The `Set-Cookie` value for the flow cookie of `kind`, scoped by `callbackUrl`; with no `binding`, the cookie
   *  that clears it. Throws the host's refusal for a malformed binding. */
  flowCookie: (required: { callbackUrl: string; kind: MemberOidcFlowCookieKind; binding?: string }) => string;
  /** The host's fixed sign-in error location for ANY error (its own login codes, a fixed invalid one otherwise). */
  errorLocation: (required: { error: unknown }) => string;
  /** Records the failed sign-in (bound by the host to this request). */
  onFailed: () => void;
}

/** A 303 to `location` carrying `cookies` in order, each on its own `Set-Cookie` line. O(c) cookies. */
export function memberOidcRedirect({ location, cookies }: { location: string; cookies: readonly string[] }, _optional: Record<string, never> = {}): Response {
  const headers = new Headers({ location });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/** A limiter refusal as Express's `res.json` wrote it after the cookies set so far: the same content type,
 *  serialized bytes and `Retry-After`. O(n) body. */
export function memberOidcLimitResponse({ limited, cookies }: { limited: RouteReply; cookies: readonly string[] }, _optional: Record<string, never> = {}): Response {
  const headers = new Headers({ ...(limited.headers ?? {}), "content-type": "application/json; charset=utf-8" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(limited.body), { status: limited.status, headers });
}

/** The fixed error redirect, keeping every cookie already set (the callback's binding clear above all). O(c). */
export function memberOidcFailure({ deps, error, cookies }: { deps: MemberOidcRedirectDeps; error: unknown; cookies: readonly string[] }, _optional: Record<string, never> = {}): Response {
  deps.onFailed();
  return memberOidcRedirect({ location: deps.errorLocation({ error }), cookies });
}
