import { isIP } from "node:net";
import type { VerifiedOrigin } from "@jini-ai/core/contracts/server/verified-origin";

/**
 * @file The decisions behind the public site's canonical-host redirect: which requests are eligible,
 * and where an eligible request on the configured origin's www counterpart goes. Server-neutral; the
 * host's middleware reads the request facts, calls these, and answers `308` or passes the request on.
 */

/** The host's absolute-URL join for a verified origin (`@jini-ai/cms/seo`'s `toAbsoluteUrl`). */
export type ToAbsoluteUrl = (required: { origin: VerifiedOrigin; path: string }, optional: {}) => string;

/** Select only the configured origin's www counterpart; local hosts and dev seeds are not aliases.
 * Returns no destination for any other Host. No I/O; O(h) time/space for host text of length h. */
function aliasDestination({ host, origin, toAbsoluteUrl }: { host: string | undefined; origin: VerifiedOrigin | undefined; toAbsoluteUrl: ToAbsoluteUrl }, _options = {}): string | undefined {
  if (!origin || origin.source === "dev-capability") return undefined;
  const canonical = new URL(toAbsoluteUrl({ origin, path: "/" }, {}));
  const bareHostname = canonical.hostname.replace(/^www\./, "");
  if (bareHostname === "localhost" || bareHostname.endsWith(".localhost") || isIP(bareHostname.replace(/^\[|\]$/g, ""))) return undefined;
  const alias = canonical.hostname.startsWith("www.") ? canonical.host.slice(4) : `www.${canonical.host}`;
  return host?.toLowerCase() === alias ? canonical.origin : undefined;
}

/**
 * Whether a request may be redirected at all. Admin/API/health traffic is excluded before lookup.
 * @complexity O(p) for path length p; no I/O.
 */
export function isCanonicalSiteHostCandidate(
  { method, path, originalUrl }: { method: string; path: string; originalUrl: string },
  _optional: Record<string, never> = {},
): boolean {
  // Health probes stay dependency-free (no origin lookup). An absolute-form request target
  // (`GET http://x/...`) is not a page path, so it is never appended onto the canonical origin.
  return ["GET", "HEAD"].includes(method) && !/^\/(?:admin|api|health|healthz|readyz)(?:\/|$)/i.test(path) && originalUrl.startsWith("/");
}

/** Keep public pages on the same origin as their canonical links and consent saves.
 * The host resolves `origin` with SEO's stored-origin lookup (missing configuration is `undefined`,
 * which leaves the request alone; registry errors stay the host's to forward). No I/O; O(h + u) for
 * host text h and URL u.
 * @returns The absolute `308` destination, or `undefined` when this Host is not the alias.
 */
export function canonicalSiteHostRedirectLocation(
  { host, originalUrl, origin, toAbsoluteUrl }: { host: string | undefined; originalUrl: string; origin: VerifiedOrigin | undefined; toAbsoluteUrl: ToAbsoluteUrl },
  _optional: Record<string, never> = {},
): string | undefined {
  // Only Host participates: forwarded hosts must never widen the accepted alias.
  const destination = aliasDestination({ host, origin, toAbsoluteUrl });
  // Concatenate onto the trusted origin so even a //-prefixed path cannot replace its host.
  return destination ? `${destination}${originalUrl}` : undefined;
}
