/**
 * @module providers/connection-guard
 *
 * Minimal, self-contained SSRF-guard + secret-redaction utilities needed by
 * this package's own `model-catalog.ts`. Vendored from the small generic
 * subset of OD's `packages/contracts/src/api/connectionTest.ts` (the
 * `isLoopbackApiHost`/`isBlockedExternalApiHostname`/`validateBaseUrl` triad)
 * and `apps/daemon/src/connectionTest.ts` (`validateBaseUrlResolved`'s
 * DNS-aware follow-up check, `redactSecrets`) — not the surrounding
 * 2,600-line file, which is almost entirely OD's own agent-CLI
 * connection-test orchestration (proxy dispatchers, product-specific
 * executable-fallback copy and env-var names) and out of this task's
 * scope; see `source-map.md` for the exact origin details. These four
 * functions are pure security/text utilities with
 * no product coupling in the origin — reject requests to loopback-disguised
 * or RFC1918/link-local/CGNAT/metadata-service addresses, and strip bearer
 * tokens / API-key headers / `?key=` query values out of free-form text
 * before it is logged or surfaced to a caller.
 *
 * ## Paired with `@jini-ai/ui`'s `utils/endpoint-policy.ts`
 *
 * That module carries a browser-safe copy of the SYNCHRONOUS half below —
 * `isLoopbackApiHost`/`isBlockedExternalApiHostname`/`validateBaseUrl` — so the
 * settings tabs can reject a bad endpoint as the operator types it. It is a
 * copy rather than an import because `endpoint-policy.ts` itself has zero
 * imports by design and this package is Node-only (`validateBaseUrlResolved`
 * needs `node:dns`); see that file's header for the full reasoning.
 *
 * **If the block-list here changes, change it there too.** A divergence means
 * the UI accepts an endpoint this guard then refuses — or, in the direction
 * that actually matters, the UI accepts one this guard would have refused.
 */

export interface BaseUrlValidationResult {
  parsed?: URL;
  error?: string;
  forbidden?: boolean;
}

function normalizeBracketedIpv6(hostname: string): string {
  const stripped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  // FQDN trailing-dot form (RFC 1034) resolves identically to the dotless
  // form, so `localhost.` must normalize to `localhost` before the equality
  // check below — and `0.0.0.0.`, `10.0.0.1.`, etc. must normalize before
  // isBlockedIpv4 parses them. Strips one or more trailing dots.
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

function isBlockedIpv4(hostname: string): boolean {
  const parts = parseIpv4(hostname);
  if (!parts) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    a >= 224
  );
}

function ipv4MappedToDotted(hostname: string): string | null {
  const host = normalizeBracketedIpv6(hostname);
  const mapped = /^::ffff:(.+)$/i.exec(host)?.[1];
  if (!mapped) return null;
  if (parseIpv4(mapped.toLowerCase())) return mapped.toLowerCase();
  const hexParts = mapped.split(':');
  if (
    hexParts.length !== 2 ||
    !hexParts.every((part) => /^[0-9a-f]{1,4}$/i.test(part))
  ) {
    return null;
  }
  // Non-null assertions, not a runtime guard: the length/regex checks above
  // already guarantee exactly two non-empty hex segments here.
  const hi = hexParts[0]!;
  const lo = hexParts[1]!;
  const value = (Number.parseInt(hi, 16) << 16) | Number.parseInt(lo, 16);
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

/** True for `localhost`, `::1`, `127.0.0.0/8`, and their IPv4-mapped-IPv6 forms. */
export function isLoopbackApiHost(hostname: string): boolean {
  const host = normalizeBracketedIpv6(hostname);
  if (host === 'localhost' || host === '::1') return true;
  if (isLoopbackIpv4(host)) return true;
  const mapped = ipv4MappedToDotted(host);
  return Boolean(mapped && isLoopbackIpv4(mapped));
}

/** True for RFC1918/link-local/CGNAT/multicast/unspecified/unique-local-IPv6 addresses — private network space a public caller should never be steered into. */
export function isBlockedExternalApiHostname(hostname: string): boolean {
  const host = normalizeBracketedIpv6(hostname);
  if (host === '::') return true;
  if (isBlockedIpv4(host)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
  const mapped = ipv4MappedToDotted(host);
  return Boolean(mapped && isBlockedIpv4(mapped));
}

/**
 * Synchronous base-URL check: scheme allow-list + literal-hostname block-list.
 * Does not resolve DNS — see {@link validateBaseUrlResolved}.
 *
 * **Trims before parsing, and must keep doing so.** `@jini-ai/ui`'s
 * `isAllowedEndpointUrl` is a deliberate browser-safe copy of this function and
 * trims its input; this one did not. WHATWG URL parsing strips leading/trailing
 * ASCII space itself, so the two agreed on `" https://x "` and diverged only on
 * whitespace `String.prototype.trim` removes but the URL parser does not — NBSP,
 * BOM, thin space and friends. A URL pasted from a rich-text source therefore
 * passed the UI and was refused at connection time.
 * `endpoint-policy.parity.test.ts` now holds the two in agreement mechanically.
 *
 * Trimming cannot weaken the block-list. Checked across every whitespace
 * character `trim` strips, against blocked/loopback/public hosts in all three
 * padding positions: an untrimmed parse either fails outright or yields a
 * hostname IDENTICAL to the trimmed one. It never yields a DIFFERENT host, which
 * is the only shape that would let the block-list inspect one string while the
 * network used another.
 */
export function validateBaseUrl(baseUrl: string): BaseUrlValidationResult {
  let parsed: URL;
  try {
    // Trim BEFORE stripping trailing slashes: in `"https://x/ "` the trailing
    // character is the space, so the slash strip alone would never reach it.
    parsed = new URL(String(baseUrl).trim().replace(/\/+$/, ''));
  } catch {
    return { error: 'Invalid baseUrl' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { error: 'Only http/https allowed' };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!isLoopbackApiHost(hostname) && isBlockedExternalApiHostname(hostname)) {
    return { error: 'Internal IPs blocked', forbidden: true };
  }
  return { parsed };
}

export type DnsLookupAddress = { address: string; family: number };
export type DnsLookupFn = (hostname: string) => Promise<DnsLookupAddress[]>;

function looksLikeIpLiteral(hostname: string): boolean {
  const host = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(':');
}

/**
 * DNS-aware companion to {@link validateBaseUrl}. The synchronous check only
 * inspects the literal hostname string, so a public DNS name pointing at
 * internal infrastructure (`internal.example.com -> 10.0.0.5`) slips through
 * and a caller ends up issuing a request to a private address on behalf of
 * whoever supplied the base URL. Resolves the hostname and re-runs the
 * block-list against every address the system would actually connect to.
 *
 * Loopback is intentionally allowed (for local LLM servers like Ollama); any
 * hostname that resolves to a loopback address (including `*.localhost` per
 * RFC 6761 and IPv4-mapped IPv6 loopback) follows the same carve-out.
 *
 * ## What this does NOT close, stated so nobody reads it as a complete defence
 *
 * This resolves the hostname; `fetch` then resolves it AGAIN, independently, when it dials. Between
 * those two resolutions the answer can change — a DNS rebinding attacker returns a public address
 * to this check and a private one to the connection. No preflight validator can close that gap; it
 * needs the request to dial the exact address that was approved, via an IP-pinning dispatcher
 * (undici `Agent` with a custom `connect`, or `node:https` with a `lookup` option). Neither is
 * reachable from this package today: it carries no external runtime dependencies by design, so
 * adopting one is a deliberate architecture decision rather than a patch to this file.
 *
 * That gap is defence-in-depth rather than the primary trust boundary — `baseUrl` here is
 * operator-configured provider config, not attacker-supplied input — but callers must not treat a
 * pass from this function as proof that the socket went where it said it would. Callers should
 * additionally refuse redirects (`redirect: 'error'`), which closes the OTHER way a validated
 * origin reaches an unvalidated address; `model-catalog.ts` and `openai-chat.ts` both do.
 *
 * DNS lookup failures are not treated as a security signal — the caller is
 * going to surface a connection error from `fetch` anyway, and turning a
 * transient resolver hiccup into a rejection would just confuse callers. The
 * synchronous hostname check still rejects the obvious literal-IP cases
 * before DNS is ever consulted. `lookup` defaults to `node:dns`'s promise
 * `lookup(hostname, { all: true, family: 0 })`, injectable for tests and for
 * hosts that already own a resolver.
 */
export async function validateBaseUrlResolved(
  baseUrl: string,
  lookup: DnsLookupFn,
): Promise<BaseUrlValidationResult> {
  const sync = validateBaseUrl(baseUrl);
  if (sync.error || !sync.parsed) return sync;

  const hostname = sync.parsed.hostname.toLowerCase();
  if (isLoopbackApiHost(hostname)) return sync;
  if (looksLikeIpLiteral(hostname)) return sync;

  let addresses: DnsLookupAddress[];
  try {
    addresses = await lookup(hostname);
  } catch {
    return sync;
  }

  for (const addr of addresses) {
    const ip = String(addr.address).toLowerCase();
    if (isLoopbackApiHost(ip)) continue;
    if (isBlockedExternalApiHostname(ip)) {
      return { error: 'Internal IPs blocked', forbidden: true };
    }
  }

  return sync;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Redacts bearer tokens, `x-api-key`/`api-key`/`x-goog-api-key` headers,
 * `?key=` query values, and any exact secret strings supplied via
 * `exactSecrets` out of free-form text — for logging or surfacing an
 * upstream error message to a caller without leaking credentials embedded in
 * it (some providers echo the key back in a 401 body).
 */
export function redactSecrets(
  text: string,
  exactSecrets: ReadonlyArray<string | undefined | null> = [],
): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  let redacted = text
    .replace(/Bearer\s+[A-Za-z0-9_\-.+/=]+/gi, 'Bearer [REDACTED]')
    .replace(/(x-api-key|api-key|x-goog-api-key)\s*[:=]\s*[^\s,;"']+/gi, '$1: [REDACTED]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]');
  for (const secret of exactSecrets) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    redacted = redacted.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]');
  }
  return redacted;
}

/** Default DNS lookup for {@link validateBaseUrlResolved} — `node:dns/promises`' `lookup(hostname, { all: true, family: 0 })`. */
export async function defaultDnsLookup(hostname: string): Promise<DnsLookupAddress[]> {
  const { promises: dnsPromises } = await import('node:dns');
  const result = await dnsPromises.lookup(hostname, { all: true, family: 0 });
  return result.map(({ address, family }) => ({ address, family }));
}
