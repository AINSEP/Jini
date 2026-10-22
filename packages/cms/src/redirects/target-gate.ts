/** The shared INV-03 read gate used by runtime resolution and host export. */
import type { OriginRegistryPort, RedirectTargetContext, VerifiedOrigin } from "@jini-ai/http-kit/verified-origin";
import { isReferrerAliasLocation } from "./referrer-alias.js";
import { checkSameOriginDestination, type SameOriginDestinationCheck } from "./reserved-destination.js";

/** Only the verified-origin owner's two redirect reads; no egress dependency. */
export type RedirectTargetOracle = Pick<OriginRegistryPort, "canonicalOrigin" | "isAllowedRedirectTarget">;
export type RedirectLocationRefusalReason = "referrer-alias" | "origin-unavailable" | "target-not-allowed" | "reserved-destination";
export type RedirectLocationCheck =
  | { kind: "allowed"; candidate: string }
  | { kind: "refused"; reason: RedirectLocationRefusalReason; destinationCheck?: SameOriginDestinationCheck };

/** A candidate `location` that already carries (or claims to carry) its own scheme/authority. */
function isPotentiallyCrossOrigin(location: string): boolean {
  return location.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(location);
}

function isDefaultPort(scheme: "https" | "http", port: number | undefined): boolean {
  if (port === undefined) return true;
  return (scheme === "https" && port === 443) || (scheme === "http" && port === 80);
}

function composeOriginUrl(origin: VerifiedOrigin): string {
  const authority = isDefaultPort(origin.scheme === "https" ? "https" : "http", origin.port)
    ? origin.host
    : `${origin.host}:${origin.port}`;
  return `${origin.scheme}://${authority}`;
}

/**
 * Resolve `location` to a candidate suitable for `isAllowedRedirectTarget`:
 * pass an already-absolute/protocol-relative location through unchanged;
 * resolve a relative location against the workspace's verified canonical
 * origin. Returns `null` if no verified origin exists and `location` is
 * relative (cannot even form a candidate to check — fails closed), and for
 * Express's `back` alias, which is served as the request's `Referer` rather than
 * as a path, so no candidate describes where it goes (see `./referrer-alias.ts`).
 */
async function toOracleCandidate(
  ctx: RedirectTargetContext,
  location: string,
  originRegistry: RedirectTargetOracle
): Promise<string | null> {
  if (isReferrerAliasLocation({ location: location }, {})) return null;
  if (isPotentiallyCrossOrigin(location)) return location;
  try {
    const canonical = await originRegistry.canonicalOrigin(ctx);
    const path = location.startsWith("/") ? location : `/${location}`;
    return `${composeOriginUrl(canonical)}${path}`;
  } catch {
    return null;
  }
}

/**
 * Check a FULLY-INTERPOLATED Location with the required verified-origin oracle, then host path policy.
 * Never checks a stored wildcard template in place of the Location a visitor would receive (INV-03).
 * @param required Context, finished location, oracle and host-owned reserved first segments.
 * @returns An explicit refusal or the absolute oracle candidate. No allow-all default exists.
 * @throws Oracle infrastructure errors propagate, preserving the original resolver contract.
 * @complexity O(location length), plus the origin reads. Constant additional state.
 * @example checkRedirectLocation({ context, location: "/new", oracle, reservedSegments }, {});
 */
export async function checkRedirectLocation(
  { context, location, oracle, reservedSegments }: {
    context: RedirectTargetContext;
    location: string;
    oracle: RedirectTargetOracle;
    reservedSegments: ReadonlySet<string>;
  },
  _optional: Record<string, never> = {},
): Promise<RedirectLocationCheck> {
  const candidate = await toOracleCandidate(context, location, oracle);
  if (candidate === null) {
    return { kind: "refused", reason: isReferrerAliasLocation({ location }, {}) ? "referrer-alias" : "origin-unavailable" };
  }
  const allowed = await oracle.isAllowedRedirectTarget({ context, url: candidate });
  if (!allowed) {
    // T050 (Polish) adds a warn-level log line here (normalized host only,
    // never the full raw candidate) — named but not yet implemented.
    return { kind: "refused", reason: "target-not-allowed" };
  }
  // The oracle answers "is that HOST allowed", which a same-origin destination passes by
  // construction — including `/admin` and `/api`. See `checkSameOriginDestination`.
  return checkReservedDestination({ context, candidate, oracle, reservedSegments }, {});
}

/**
   * Second half of the read-path target gate: the oracle's host verdict, then this pathname
   * verdict for a destination that is same-origin with the workspace's verified origin.
   *
   * @returns An explicit refusal when the redirect must not be served. Fails closed when no verified origin
   * exists — the same posture `toOracleCandidate` already takes for a relative location.
   * @complexity One `canonicalOrigin` lookup plus O(n) in the candidate length.
   */
async function checkReservedDestination(
  { context, candidate, oracle, reservedSegments }: {
    context: RedirectTargetContext; candidate: string; oracle: RedirectTargetOracle; reservedSegments: ReadonlySet<string>;
  },
  _optional: Record<string, never> = {},
): Promise<RedirectLocationCheck> {
  try {
    const canonical = await oracle.canonicalOrigin(context);
    const destinationCheck = checkSameOriginDestination({ candidate, canonical, reservedSegments }, {});
    if (destinationCheck.kind !== "ok") return { kind: "refused", reason: "reserved-destination", destinationCheck };
    return { kind: "allowed", candidate };
  } catch {
    return { kind: "refused", reason: "origin-unavailable" };
  }
}
