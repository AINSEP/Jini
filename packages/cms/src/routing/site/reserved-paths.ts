/**
 * @file The ONE rule for "does this site path belong to the admin application rather than to the
 * public site".
 *
 * Purpose:
 * The site app and the admin application share a single Express app —
 * `admin-static.ts` mounts the admin SPA at `app.use("/admin", ...)` and `core.ts` mounts the
 * session gate at `app.use("/api/admin", ...)`, alongside `/api/runs`, `/api/tools` and friends.
 * So a "site path" a caller hands to a public-site feature can silently name the authenticated
 * surface instead. Several features need to refuse that, and each one refusing it slightly
 * differently is how a bypass gets built: `site-inspection`'s `published_page_fetch` (which claims
 * to fetch a PUBLISHED PAGE) and `redirects` (its write chokepoint, which stores a `Location`
 * target, and its read gate, which checks the interpolated `Location` a visitor's browser receives)
 * are the live consumers today.
 *
 * Generic decoding and origin-tracking rationale lives in @jini-ai/http-kit/verified-origin.
 *
 * Architectural role:
 * Platform library, no I/O. `routing` already owns the shared URL vocabulary Menus/SEO/Redirects
 * were deliberately stopped from each reinventing (see ../README.md), which is the same
 * reason this rule lives here rather than inside either consumer.
 */

import {
  checkSitePathname as sharedCheckSitePathname,
  checkSiteRelativeTarget as sharedCheckSiteRelativeTarget,
  type SitePathCheck as SharedSitePathCheck,
  type SiteRelativeTargetCheck as SharedSiteRelativeTargetCheck,
} from "@jini-ai/core/contracts/server/verified-origin";

/** A path that lands on the admin application instead of the public site. */
export type ReservedSurface = "admin" | "api";

/** {@link checkSitePathname}'s verdict: the shared verdict, its `reserved` arm narrowed to this app's
 *  surfaces. Every arm is a refusal except `ok`; each arm is documented on the shared type. */
export type SitePathCheck = Exclude<SharedSitePathCheck, { kind: "reserved" }> | { kind: "reserved"; surface: ReservedSurface };

/** {@link checkSiteRelativeTarget}'s verdict: the shared verdict, its `reserved` arm narrowed to this
 *  app's surfaces. */
export type SiteRelativeTargetCheck = Exclude<SharedSiteRelativeTargetCheck, { kind: "reserved" }> | { kind: "reserved"; surface: ReservedSurface };

/**
 * The segment names the admin application owns. Compared case-folded, one segment deep.
 * Content cannot claim these surfaces: explicit slugs are refused (BR-03), and derived slugs
 * skip them through the normal collision suffix search (BR-02).
 */
export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set<ReservedSurface>(["admin", "api"]);

/** Check an already-parsed URL against this app's reserved surfaces.
 * @param required.url a URL already established to be on this site's origin.
 * @returns The unchanged reserved-path verdict, narrowed to this app's two surfaces.
 * @complexity O(url.pathname.length).
 * @example checkSitePathname(new URL("http://site.invalid/admin")); // reserved: admin
 */
export function checkSitePathname({ url }: { url: URL }, _optional = {}): SitePathCheck {
  return sharedCheckSitePathname({ url, reservedSegments: RESERVED_SEGMENTS }, {}) as SitePathCheck;
}

/** Check an untrusted relative target against this app's reserved surfaces.
 * @param required.raw a raw site-relative reference; parsing and origin tracking belong to the shared owner.
 * @returns The unchanged relative-target verdict, narrowed to this app's two surfaces.
 * @complexity O(raw.length).
 * @example checkSiteRelativeTarget("/new"); // ok
 */
export function checkSiteRelativeTarget({ raw }: { raw: string }, _optional = {}): SiteRelativeTargetCheck {
  return sharedCheckSiteRelativeTarget({ raw, reservedSegments: RESERVED_SEGMENTS }, {}) as SiteRelativeTargetCheck;
}
