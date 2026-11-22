import { hasForbiddenRawUrlCharacter } from "@jini-ai/core/contracts/server/verified-origin";

/**
 * @file Task 10 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §4 task 10.
 *
 * `baseUrl` validation for a `publish_content_peers` row — "a host instance at a URL", which is the whole of
 * a peer's identity (plan §0b: never a platform identifier such as an app name, project id or
 * region, because those are shaped by one host and this feature must work on all of them and
 * on a bare VPS).
 *
 * Deliberately modelled on `features/origin/configured-origin.ts`'s refusal pipeline, and reusing
 * its exported {@link hasForbiddenRawUrlCharacter} rather than re-deriving the raw-character class
 * (a backslash becomes a slash and whitespace is stripped once `new URL()` has run, so the check
 * has to happen on the raw string). Same refusals for the same reasons: non-https, userinfo,
 * query/fragment, control characters, empty host.
 *
 * ONE DELIBERATE DIFFERENCE, and it is load-bearing: `configured-origin.ts` refuses a LOOPBACK host,
 * because a loopback address can never be this deployment's own PUBLIC origin. A peer is the
 * opposite kind of thing — it is a host this process dials OUT to, and a legitimate peer may well
 * sit on a private network: Railway and Render both give services internal DNS names, AWS puts them
 * in a VPC, and a bare VPS may run two host instances behind one firewall. Refusing private addresses here
 * would make this feature host-shaped (public-internet-only) in exactly the way plan §0b forbids.
 *
 * The private-address decision therefore belongs to the ONE place that already owns it — ADR-038's
 * `EgressPolicy.denyPrivateAddresses` plus its named `devHostAllowlist` capability, enforced in
 * `platform/http/client.ts` against the RESOLVED address, not against a hostname pattern. A peer at
 * a private address is accepted here and refused at send time with a diagnosis that names
 * `devHostAllowlist` (`peer-transport.ts`'s `describePeerEgressRefusal`).
 *
 * `https` stays HARD required, on every host including loopback: the peer credential travels as a
 * bearer `Authorization` header on every request, and the peer egress policy's `allowedSchemes` is
 * `["https"]` so this is a structural property, not just this validator's opinion.
 */

/** Refusal shape — a single operator-facing sentence fragment, ready to be embedded in a 400 body.
 *  Never carries the raw value back (the caller already has it; echoing it into an error body is how
 *  a reflected-value bug starts). */
export interface PeerBaseUrlRefusal {
  readonly error: string;
}

/** Accepted shape — the NORMALIZED value to store, never the caller's raw string, so two peers that
 *  differ only in host case or a trailing slash cannot both exist. */
export interface PeerBaseUrlAccepted {
  readonly baseUrl: string;
}

/**
 * Lower-cases and strips a single trailing dot, matching `Jini packages/http-kit/src/verified-origin/origin.ts`'s own host
 * normalization so "same host" can never mean two different things across this codebase.
 * @complexity O(n) in the host length.
 */
function normalizeHost({ hostname }: { hostname: string }, _optional = {}): string {
  const lowered = hostname.toLowerCase();
  return lowered.endsWith(".") ? lowered.slice(0, -1) : lowered;
}

/**
 * The refusal pipeline, as one decision function — one readable branch per refusal, mirroring
 * `configured-origin.ts`'s `refusalReason`.
 *
 * @returns The operator-facing refusal reason, or `null` when `url` names a usable peer base URL.
 * @complexity O(n) in the host length.
 */
function refusalReason({ url }: { url: URL }, _optional = {}): string | null {
  if (url.protocol !== "https:") return "its scheme must be https";
  if (url.username !== "" || url.password !== "") return "it carries a userinfo component";
  if (url.search !== "" || url.hash !== "") return "it carries a query string or fragment";
  if (normalizeHost({ hostname: url.hostname }) === "") return "its host is empty";
  return null;
}

/**
 * Validates and normalizes an operator-supplied peer base URL.
 *
 * Accepts an optional path prefix (a peer behind a reverse proxy mounted under `/site` is a real
 * deployment shape on Render and on a bare VPS) and normalizes it by stripping trailing slashes, so
 * `peerUrl()` can join route paths without producing a double slash.
 *
 * @param raw - The untrusted operator-supplied string, exactly as received.
 * @returns `{baseUrl}` with the normalized origin plus base path, or `{error}` with the single
 * reason it was refused. NEVER throws.
 * @complexity O(n) in the length of `raw` (parser-bound).
 * @example normalizePeerBaseUrl("https://Site.example.com/"); // => { baseUrl: "https://site.example.com" }
 */
export function normalizePeerBaseUrl({ raw }: { raw: string }, _optional = {}): PeerBaseUrlAccepted | PeerBaseUrlRefusal {
  const trimmed = raw.trim();
  if (trimmed === "") return { error: "baseUrl is required" };
  if (hasForbiddenRawUrlCharacter({ raw: trimmed })) {
    return { error: "baseUrl carries a backslash, whitespace or control character" };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: "baseUrl is not a parseable URL" };
  }

  const reason = refusalReason({ url });
  if (reason) return { error: `baseUrl was refused because ${reason}` };

  const host = normalizeHost({ hostname: url.hostname });
  const authority = url.port === "" ? host : `${host}:${url.port}`;
  let end = url.pathname.length;
  while (end > 0 && url.pathname[end - 1] === "/") end -= 1;
  const basePath = url.pathname.slice(0, end);
  return { baseUrl: `https://${authority}${basePath}` };
}

/**
 * Joins a normalized {@link normalizePeerBaseUrl} result with an absolute route path.
 *
 * @param path - An absolute route path beginning with `/` (e.g. `/api/admin/v1/...`).
 * @complexity O(1).
 */
export function peerUrl({ baseUrl, path }: { baseUrl: string; path: string }, _optional = {}): string {
  return `${baseUrl}${path}`;
}

/**
 * The bracket-stripped hostname of a normalized peer base URL — the exact form
 * `EgressPolicy.devHostAllowlist` is matched against (`platform/http/client.ts` strips IPv6 brackets
 * before the lookup, so an allowlist entry is written without them, as a human would type it).
 * Exported so the egress diagnosis can tell an operator the literal string to add.
 *
 * @returns The hostname, or the raw `baseUrl` unchanged if it somehow fails to parse (this function
 * is only ever called on an already-normalized value, so that fallback is unreachable in practice
 * and exists only so a diagnosis path can never itself throw).
 * @complexity O(n) in the length of `baseUrl`.
 */
export function peerHostname({ baseUrl }: { baseUrl: string }, _optional = {}): string {
  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  } catch {
    return baseUrl;
  }
}
