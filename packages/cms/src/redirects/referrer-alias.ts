/**
 * @file The one redirect `Location` value the HTTP layer does not send as written (t91 review F1,
 * 2026-09-16).
 *
 * Purpose:
 * Express 4's `res.location()` — called by the `res.redirect(statusCode, location)` that
 * `server/inbound/public-http/routes/site/pages.ts` serves every matched rule with — replaces the
 * exact string `back` with the request's `Referer` header (or `/`). A rule whose finished location
 * is `back` therefore sends the visitor to whatever page linked to this site: an open redirect the
 * origin oracle never sees, because the oracle is asked about `<canonical origin>/back`. The value
 * can be stored literally or produced by interpolation (a wildcard `/go/*` -> `$1` plus a request
 * for `/go/back`), so the WRITE gate (`redirects.ts`) refuses the stored form and the READ gate
 * (`phase-handler.ts`) refuses the finished form.
 *
 * Architectural role:
 * Feature logic, pure, no I/O.
 */

/** The string Express 4's `res.location()` swaps for the request's `Referer`. Compared with `===` there. */
const EXPRESS_REFERRER_ALIAS = "back";

/**
 * Whether `location` is the value Express would replace with the request's `Referer` header.
 *
 * @param required.location - A redirect target or a fully interpolated `Location`, exactly as it would be
 * handed to `res.redirect`.
 * @returns `true` only for the exact string `back` — Express's own comparison is case-sensitive and
 * untrimmed, so `/back`, `BACK` and `backup` are sent as written.
 * @complexity O(1).
 * @example isReferrerAliasLocation({ location: "back" }, {}); // => true
 */
export function isReferrerAliasLocation({ location }: { location: string }, _optional: Record<string, never> = {}): boolean {
  return location === EXPRESS_REFERRER_ALIAS;
}
