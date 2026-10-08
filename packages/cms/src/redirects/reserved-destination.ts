/**
 * @file The one "same-origin destination lands on the admin surface" verdict, shared by the
 * redirect READ gate (`phase-handler.ts`) and WRITE gate (`redirects.ts`) (t91 B1, 2026-09-16).
 *
 * Purpose:
 * Before this file existed, `phase-handler.ts` decided "is this candidate on the workspace's own
 * origin" by comparing `URL.origin` strings, and `redirects.ts` never asked the question for an
 * absolute target at all — it only ever ran the reserved-path rule for a site-relative target. Both
 * gaps let an absolute same-origin target land a visitor on `/admin` or `/api/...` while the
 * oracle that approved the candidate had already normalized past the exact spelling the string
 * comparison needed (`https://site./admin` and `https://site%2E/admin` both decode to the same
 * host the oracle allows, but have a DIFFERENT `URL.origin` string from `https://site`). "Same
 * origin" is decided here by `origin`'s own `normalizeOriginCandidate` + `isSameOrigin` — never a
 * raw `URL.origin` string equality — because that is what the oracle that approved the candidate
 * already normalizes against.
 *
 * A `{ kind: "ok" }` verdict for a CROSS-origin candidate means "not this rule's business", not
 * "allowed" — callers must already have run the origin oracle (`isAllowedRedirectTarget`) first;
 * this function only ever narrows what the oracle already approved.
 *
 * Interpolation happens on the READ path (a stored template like `/go/*` -> `/$1` becomes
 * `Location: /admin` only once a request path fills it in), so the read gate calls this AFTER
 * interpolation. The write gate can only ever see the template, so it calls this on an absolute
 * target once the oracle allows it — a stored relative template is out of scope here, same as
 * before this file existed.
 *
 * Architectural role:
 * Feature logic, pure, no I/O. Imports only through `features/origin` and `platform/routing`'s own
 * barrels (both are `no-deep-imports` promoted in `.dependency-cruiser.mjs`).
 */
import { isSameOrigin, normalizeOriginCandidate, type VerifiedOrigin } from "@jini-ai/http-kit/verified-origin";
import { checkSitePathname, type SitePathCheck } from "@jini-ai/http-kit/verified-origin";

/** {@link checkSameOriginDestination}'s verdict — every arm but `ok` is a refusal. */
export type SameOriginDestinationCheck = SitePathCheck | { kind: "unparseable" };

/**
 * Whether `candidate` is both same-origin with `canonical` AND lands on the admin application's
 * own URL space. A cross-origin candidate (by construction, out of this rule's business) and an
 * ordinary same-origin path both answer `{ kind: "ok" }` — the distinction does not matter to a
 * caller that only wants to know "must this be refused".
 *
 * @param required.candidate - The candidate URL string to classify (already oracle-approved by the caller).
 * @param required.canonical - The workspace's verified canonical origin.
 * @returns `{ kind: "unparseable" }` if `candidate` fails the oracle's own normalizer (including a
 * non-empty userinfo component — fail closed rather than guessing which host it means); otherwise
 * `{ kind: "ok" }` for a cross-origin candidate or ordinary same-origin content, or the
 * `checkSitePathname` refusal arm naming why a same-origin candidate is reserved.
 * @param required.reservedSegments - Host-owned, case-folded first path segments.
 * @complexity O(n) in the candidate length.
 * @example checkSameOriginDestination({ candidate: "https://site.example/blog", canonical, reservedSegments }, {});
 */
export function checkSameOriginDestination(
  { candidate, canonical, reservedSegments }: { candidate: string; canonical: VerifiedOrigin; reservedSegments: ReadonlySet<string> },
  _optional: Record<string, never> = {},
): SameOriginDestinationCheck {
  const target = normalizeOriginCandidate({ rawUrl: candidate });
  if (target === null) return { kind: "unparseable" };
  if (!isSameOrigin({ target: target, canonical: canonical })) return { kind: "ok" };
  // Cannot throw: normalizeOriginCandidate just parsed this exact string with the same no-base
  // `new URL()`, so re-parsing it here to hand checkSitePathname a real URL cannot fail differently.
  return checkSitePathname({ url: new URL(candidate), reservedSegments }, {});
}
