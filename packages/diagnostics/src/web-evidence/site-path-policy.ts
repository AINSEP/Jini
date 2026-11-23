import { checkSitePathname, type SitePathCheck } from "@jini-ai/core/contracts/server/verified-origin";
import { resolveSameOriginPath, type PathnameVerdict } from "./path-guard.js";

/**
 * @file This site's pathname policy for the published-page path guard.
 *
 * The generic guard (`resolveSameOriginPath`) knows nothing about which surfaces a host reserves.
 * This site's answer is `platform/routing`'s shared reserved-path rule: the site app, the admin SPA
 * and the admin API share one Express app (`admin-static.ts`'s `app.use("/admin", ...)`, `core.ts`'s
 * `app.use("/api/admin", ...)`). Both are session-gated, so an unauthenticated in-process request
 * already fails, but "a published page" is a claim about the public site and the page-fetching tools
 * must not become a second, unaudited door to the admin surface. Defense in depth, stated as a rule
 * rather than relied on as a side effect. The comparison is per SEGMENT and post-decode
 * (`platform/routing/reserved-paths.ts`), so `/%61dmin` is refused while `/administer-survey` —
 * ordinary site content that merely starts with the same letters — is not.
 *
 * The host injects that rule's reserved first segments as `reservedSegments`; the per-segment,
 * post-decode comparison itself is `checkSitePathname` in `@jini-ai/core/contracts/server/verified-origin`.
 */

/**
 * Maps `platform/routing`'s verdict onto the generic guard's verdict. Only `reserved` needs
 * translating: it becomes this site's own refusal sentence, which names the surface.
 *
 * @param required.check - The verdict from `checkSitePathname`.
 * @returns The verdict the generic guard understands.
 * @complexity O(1).
 */
function toPathnameVerdict({ check }: { check: SitePathCheck }, _optional = {}): PathnameVerdict {
  if (check.kind === "reserved") {
    return { kind: "refused", reason: `path must not target '/${check.surface}' — that is the authenticated admin/API surface, not a published page.` };
  }
  return check;
}

/**
 * Validates and canonicalizes a caller-supplied site path against `base` under this site's
 * reserved-surface policy. Every caller that takes a path from a model or a request goes through
 * here, never through the generic guard directly, so the policy cannot be forgotten.
 *
 * @param required.raw - The caller's path, untrusted.
 * @param required.base - The origin the path is resolved against, e.g. `http://127.0.0.1:53142`.
 * @returns The canonical `pathname + search` to request.
 * @throws {SameOriginPathError} With a message naming the rule that rejected the path.
 * @complexity O(L) in the path length.
 * @example resolveSitePath({ raw: "/blog/hello", base: "http://127.0.0.1:53142" }); // => "/blog/hello"
 * @param required.reservedSegments - The host's reserved first path segments, case-folded
 *   (e.g. `admin`, `api`). Injected so the host stays the one owner of its URL-space policy.
 */
export function resolveSitePath(
  { raw, base, reservedSegments }: { raw: unknown; base: string; reservedSegments: ReadonlySet<string> },
  _optional = {},
): string {
  return resolveSameOriginPath({
    raw,
    base,
    checkPathname: ({ url }) => toPathnameVerdict({ check: checkSitePathname({ url, reservedSegments }, {}) }),
  });
}
