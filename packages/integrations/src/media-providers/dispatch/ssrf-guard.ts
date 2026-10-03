/**
 * SSRF guard for asset URLs returned *inside* a provider's successful
 * response body (e.g. SenseAudio image's `url`, AIHubMix image's
 * `data[].url` fallback) — these are attacker-controllable whenever the
 * upstream gateway is compromised or misconfigured, unlike a caller-
 * configured `baseUrl`, which a host operator chose deliberately. Ported
 * near-verbatim from Open Design's `apps/daemon/src/connectionTest.ts`
 * (`assertAndFetchExternalAsset`/`assertExternalAssetUrl`/
 * `validateBaseUrlResolved`) plus the canonical platform/net hostname classifiers originally from
 * `packages/contracts/src/api/connectionTest.ts` (`isLoopbackApiHost`/
 * `isBlockedExternalApiHostname`/`validateBaseUrl`) — see `archived provenance ledger`.
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
 * path and is not ported. The default asset-download path is strict. Only an explicit
 * `allowPrivateNetwork: true` development capability or a host-supplied
 * policy-enforcing client can change the network policy; a host
 * that wants an operator-configurable internal-host allowlist for its own
 * *user-supplied* base URLs (a different feature, not exercised by any
 * vendor ported into this package) would need to build that separately.
 * Shared hostname policy strips IPv6 brackets, case and trailing FQDN dots, recognizes
 * dotted/hex IPv4-mapped forms, and blocks loopback as well as
 * RFC1918/CGNAT/link-local/multicast addresses. Platform's parser validates both hex groups
 * before its non-null assertions; this module no longer maintains another parser copy.
 */
import { isLoopbackApiHost, isBlockedExternalApiHostname } from '@jini-ai/platform/net';
import { promises as dnsPromises } from 'node:dns';
import { FETCH_TIMEOUT_MS } from '@jini-ai/platform/fetch-with-timeout';
import { defaultMediaOutboundMessages, fetchMediaOutbound } from './outbound.js';
import type { MediaOutboundOptions } from './outbound.js';

export interface DnsLookupAddress {
  readonly address: string;
  readonly family: number;
}

export type DnsLookupFn = (required: { hostname: string }) => Promise<readonly DnsLookupAddress[]>;

const defaultDnsLookup: DnsLookupFn = async ({ hostname }) => {
  const result = await dnsPromises.lookup(hostname, { all: true, family: 0 });
  return result.map(({ address, family }) => ({ address, family }));
};

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
  if (parsed.username || parsed.password) {
    return { ok: false, error: defaultMediaOutboundMessages.urlCredentialsBlocked, forbidden: true };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http/https allowed', forbidden: false };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (isLoopbackApiHost({ hostname }) || isBlockedExternalApiHostname({ hostname })) {
    return { ok: false, error: 'Internal IPs blocked', forbidden: true };
  }
  return { ok: true, parsed };
}

/**
 * DNS-aware companion to the sync hostname check: resolves the hostname and
 * re-runs the block-list against every address it actually resolves to, so
 * a public DNS name pointing at internal infrastructure
 * (`internal.example.com` -> `10.0.0.5`) can't slip through a hostname-only
 * check. DNS failures and empty answers fail closed: proceeding would leave
 * the peer unverified. This precheck alone does not pin a connection;
 * `assertAndFetchExternalAsset` uses the canonical guarded client for that.
 */
export async function validateBaseUrlResolved({ baseUrl }: { baseUrl: string }, { lookup = defaultDnsLookup }: { lookup?: DnsLookupFn | undefined } = {}): Promise<{ ok: true } | { ok: false; error: string; forbidden: boolean }> {
  const sync = validateBaseUrlSync(baseUrl);
  if (!sync.ok) return sync;

  const hostname = sync.parsed.hostname.toLowerCase();
  if (looksLikeIpLiteral(hostname)) {
    return { ok: true };
  }

  let addresses: readonly DnsLookupAddress[];
  try {
    addresses = await lookup({ hostname });
  } catch {
    return { ok: false, error: defaultMediaOutboundMessages.dnsResolutionFailed, forbidden: true };
  }
  if (addresses.length === 0) return { ok: false, error: defaultMediaOutboundMessages.dnsResolutionFailed, forbidden: true };

  for (const addr of addresses) {
    const ip = String(addr.address).toLowerCase();
    if (isLoopbackApiHost({ hostname: ip }) || isBlockedExternalApiHostname({ hostname: ip })) {
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
export async function assertExternalAssetUrl({ rawUrl }: { rawUrl: string }, { lookup = defaultDnsLookup }: { lookup?: DnsLookupFn | undefined } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof rawUrl !== 'string' || !rawUrl) {
    return { ok: false, error: 'empty download url' };
  }
  const validated = await validateBaseUrlResolved({ baseUrl: rawUrl }, { lookup: lookup });
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
 * guard pinned through redirects: vets and pins the resolved peer with the
 * canonical HTTP client, then forces `redirect: 'error'` so a validated public URL
 * that 302s into loopback/RFC1918/metadata space is rejected before any
 * bytes are read. Throws on a blocked host (so the redirect-bypass can't be
 * forgotten at a call site); the forced `redirect` is spread last so it
 * overrides any value the caller passed in `init`. Callers keep their own
 * `!resp.ok` HTTP-status handling.
 * @throws URL/policy refusals and DNS/transport failures, before unsafe I/O.
 * @complexity O(a + b) for a DNS answers and b bounded decoded asset bytes.
 */
export async function assertAndFetchExternalAsset({ url }: { url: string }, { init = {}, lookup, ...outbound }: MediaOutboundOptions & { init?: RequestInit | undefined; lookup?: DnsLookupFn | undefined } = {}): Promise<Response> {
  // Preserve the early URL diagnostic. DNS vetting belongs to the client that pins the socket,
  // not an independent lookup followed by a fetch that resolves the hostname a second time.
  if (outbound.allowPrivateNetwork !== true && outbound.httpClient === undefined) {
    const check = validateBaseUrlSync(url);
    if (!check.ok) throw new Error(`blocked download url (${check.error})`);
  }
  // Downloading an already-generated asset, not waiting on generation — UPLOAD-class (2min).
  return fetchMediaOutbound({ url, timeoutMs: FETCH_TIMEOUT_MS.UPLOAD }, {
    ...outbound,
    init: { ...init, redirect: 'error' },
    ...(lookup === undefined ? {} : { dns: { resolve: async ({ hostname }: { hostname: string }) => (await lookup({ hostname })).map(entry => entry.address) } }),
  });
}
