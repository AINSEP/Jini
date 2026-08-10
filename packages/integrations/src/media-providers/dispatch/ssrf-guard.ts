/**
 * SSRF guard for asset URLs returned *inside* a provider's successful
 * response body (e.g. SenseAudio image's `url`, AIHubMix image's
 * `data[].url` fallback) — these are attacker-controllable whenever the
 * upstream gateway is compromised or misconfigured, unlike a caller-
 * configured `baseUrl`, which a host operator chose deliberately. Ported
 * near-verbatim from Open Design's `apps/daemon/src/connectionTest.ts`
 * (`assertAndFetchExternalAsset`/`assertExternalAssetUrl`/
 * `validateBaseUrlResolved`) plus the sync hostname classifiers from
 * `packages/contracts/src/api/connectionTest.ts` (`isLoopbackApiHost`/
 * `isBlockedExternalApiHostname`/`validateBaseUrl`) — see `source-map.md`.
 *
 * Scope note: the origin's `validateBaseUrlResolved` also accepts an
 * operator-declared `allowedInternalHosts` allowlist
 * (`ValidateBaseUrlOptions`/`isAllowlistedInternalHost`, fed from an
 * `OD_ALLOWED_INTERNAL_HOSTS`-style env var) — but that allowlist is used
 * ONLY by a *different* exported function, `validateUserProviderBaseUrl`,
 * for base URLs a host operator deliberately configured. The origin's own
 * doc comment on `validateUserProviderBaseUrl` states the allowlist is for
 * "user-configured endpoints" and warns it must never reach "the
 * attacker-controllable asset-download SSRF guard" — i.e. never this
 * module's call path. Proof, not assumption: `assertExternalAssetUrl` calls
 * `validateBaseUrlResolved(rawUrl)` with no options argument, so
 * `allowedInternalHosts` is always `undefined` here, and
 * `isAllowlistedInternalHost` returns `false` unconditionally whenever its
 * `allowedInternalHosts` argument is empty/absent (its own first line is
 * `if (!allowedInternalHosts || allowedInternalHosts.length === 0) return
 * false;`) — so the allowlist branch is provably dead code on this call
 * path and is not ported. This module implements only the strict,
 * non-configurable variant the asset-download path actually uses; a host
 * that wants an operator-configurable internal-host allowlist for its own
 * *user-supplied* base URLs (a different feature, not exercised by any
 * vendor ported into this package) would need to build that separately.
 */
import { promises as dnsPromises } from 'node:dns';

export interface DnsLookupAddress {
  readonly address: string;
  readonly family: number;
}

export type DnsLookupFn = (hostname: string) => Promise<readonly DnsLookupAddress[]>;

const defaultDnsLookup: DnsLookupFn = async (hostname) => {
  const result = await dnsPromises.lookup(hostname, { all: true, family: 0 });
  return result.map(({ address, family }) => ({ address, family }));
};

/** Strips IPv6 brackets, lowercases, and drops a trailing-dot FQDN suffix (RFC 1034) so `Localhost.`/`[::1]` compare equal to their canonical forms. */
function normalizeBracketedIpv6(hostname: string): string {
  const stripped = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return stripped.toLowerCase().replace(/\.+$/, '');
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const parsed = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : null;
  });
  if (parsed.some((part) => part === null)) return null;
  return parsed as [number, number, number, number];
}

function isLoopbackIpv4(hostname: string): boolean {
  const parts = parseIpv4(hostname);
  return Boolean(parts && parts[0] === 127);
}

/** `0.0.0.0`, CGNAT (100.64/10), link-local (169.254/16), RFC1918 private ranges, and multicast/reserved (>= 224.0.0.0). */
function isBlockedIpv4(hostname: string): boolean {
  const parts = parseIpv4(hostname);
  if (!parts) return false;
  const [a, b] = parts;
  return a === 0 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || a >= 224;
}

/** Recovers the dotted-quad IPv4 address from an IPv4-mapped IPv6 literal (`::ffff:a.b.c.d` or `::ffff:HHHH:HHHH`), or `null` if `hostname` isn't one. */
function ipv4MappedToDotted(hostname: string): string | null {
  const host = normalizeBracketedIpv6(hostname);
  const mapped = /^::ffff:(.+)$/i.exec(host)?.[1];
  if (!mapped) return null;
  if (parseIpv4(mapped.toLowerCase())) return mapped.toLowerCase();
  const hexParts = mapped.split(':');
  if (hexParts.length !== 2 || !hexParts.every((part) => /^[0-9a-f]{1,4}$/i.test(part))) {
    return null;
  }
  // hexParts.length === 2 is already proven above, and the `.every(...)`
  // regex above already requires each element to be a non-empty 1-4-digit
  // hex string — so hexParts[0]/[1] can never be `undefined` here despite
  // noUncheckedIndexedAccess's static `string | undefined` type. Asserted
  // rather than re-guarded with a dead runtime check, matching this
  // package's established convention (see `engine.ts`'s `allowed[0]!`).
  const hi = hexParts[0]!;
  const lo = hexParts[1]!;
  const value = (Number.parseInt(hi, 16) << 16) | Number.parseInt(lo, 16);
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

/** `localhost`, `::1`, `127.0.0.0/8`, and their IPv4-mapped-IPv6 equivalents — the carve-out for local providers (e.g. Ollama), consulted before the blocklist so loopback is never rejected as "internal". */
export function isLoopbackApiHost(hostname: string): boolean {
  const host = normalizeBracketedIpv6(hostname);
  if (host === 'localhost' || host === '::1') return true;
  if (isLoopbackIpv4(host)) return true;
  const mapped = ipv4MappedToDotted(host);
  return Boolean(mapped && isLoopbackIpv4(mapped));
}

/** The unspecified address, RFC1918/CGNAT/link-local/multicast IPv4 (via `isBlockedIpv4`), unique-local (`fc00::/7`) and link-local (`fe80::/10`) IPv6, and their IPv4-mapped-IPv6 equivalents. */
export function isBlockedExternalApiHostname(hostname: string): boolean {
  const host = normalizeBracketedIpv6(hostname);
  if (host === '::') return true;
  if (isBlockedIpv4(host)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
  const mapped = ipv4MappedToDotted(host);
  return Boolean(mapped && isBlockedIpv4(mapped));
}

/** Whether `hostname` is already a literal IPv4/IPv6 address (as opposed to a DNS name) — skips the DNS-resolve step in `validateBaseUrlResolved` since there's nothing further to resolve. */
function looksLikeIpLiteral(hostname: string): boolean {
  const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(':');
}

type BaseUrlValidationResult = { readonly ok: true; readonly parsed: URL } | { readonly ok: false; readonly error: string; readonly forbidden: boolean };

function validateBaseUrlSync(baseUrl: string): BaseUrlValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(String(baseUrl).replace(/\/+$/, ''));
  } catch {
    return { ok: false, error: 'Invalid baseUrl', forbidden: false };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http/https allowed', forbidden: false };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!isLoopbackApiHost(hostname) && isBlockedExternalApiHostname(hostname)) {
    return { ok: false, error: 'Internal IPs blocked', forbidden: true };
  }
  return { ok: true, parsed };
}

/**
 * DNS-aware companion to the sync hostname check: resolves the hostname and
 * re-runs the block-list against every address it actually resolves to, so
 * a public DNS name pointing at internal infrastructure
 * (`internal.example.com` -> `10.0.0.5`) can't slip through a hostname-only
 * check. DNS lookup failures are not treated as a security signal — a
 * transient resolver hiccup shouldn't turn into a false "blocked" result
 * when `fetch` is about to surface its own connection error anyway; the
 * sync check above already rejected the obvious literal-IP cases.
 */
export async function validateBaseUrlResolved(baseUrl: string, lookup: DnsLookupFn = defaultDnsLookup): Promise<{ ok: true } | { ok: false; error: string; forbidden: boolean }> {
  const sync = validateBaseUrlSync(baseUrl);
  if (!sync.ok) return sync;

  const hostname = sync.parsed.hostname.toLowerCase();
  if (isLoopbackApiHost(hostname) || looksLikeIpLiteral(hostname)) {
    return { ok: true };
  }

  let addresses: readonly DnsLookupAddress[];
  try {
    addresses = await lookup(hostname);
  } catch {
    return { ok: true };
  }

  for (const addr of addresses) {
    const ip = String(addr.address).toLowerCase();
    if (isLoopbackApiHost(ip)) continue;
    if (isBlockedExternalApiHostname(ip)) {
      return { ok: false, error: 'Internal IPs blocked', forbidden: true };
    }
  }

  return { ok: true };
}

/**
 * SSRF guard for asset URLs handed back inside a successful API response —
 * typically a `data.url`/`data.video_url` pointing at the gateway's CDN,
 * attacker-controllable when the upstream gateway is compromised or
 * misconfigured. Returns a discriminated union so callers don't have to
 * repeat the resolved-validation plumbing.
 */
export async function assertExternalAssetUrl(rawUrl: string, lookup: DnsLookupFn = defaultDnsLookup): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof rawUrl !== 'string' || !rawUrl) {
    return { ok: false, error: 'empty download url' };
  }
  const validated = await validateBaseUrlResolved(rawUrl, lookup);
  if (!validated.ok) {
    return {
      ok: false,
      error: validated.forbidden ? `blocked download url (${validated.error})` : `invalid download url: ${validated.error}`,
    };
  }
  return { ok: true };
}

/**
 * Validates an upstream-controlled asset URL and fetches it with the SSRF
 * guard pinned through redirects: runs `assertExternalAssetUrl` on the
 * literal URL, then forces `redirect: 'error'` so a validated public URL
 * that 302s into loopback/RFC1918/metadata space is rejected before any
 * bytes are read. Throws on a blocked host (so the redirect-bypass can't be
 * forgotten at a call site); the forced `redirect` is spread last so it
 * overrides any value the caller passed in `init`. Callers keep their own
 * `!resp.ok` HTTP-status handling.
 */
export async function assertAndFetchExternalAsset(url: string, init: RequestInit = {}, lookup: DnsLookupFn = defaultDnsLookup): Promise<Response> {
  const check = await assertExternalAssetUrl(url, lookup);
  if (!check.ok) throw new Error(check.error);
  return fetch(url, { ...init, redirect: 'error' });
}
