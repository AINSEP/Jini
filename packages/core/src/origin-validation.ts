/**
 * @module origin-validation
 *
 * Same-origin / allow-listed-origin validation for a locally-bound HTTP
 * daemon: is this browser request actually coming from a page the daemon
 * itself served (or an operator-configured allow-listed origin), as
 * opposed to an arbitrary third-party site making a cross-site request to
 * the daemon's loopback/private-LAN port.
 *
 * Generalized from an upstream flat daemon module: the origin hardcoded its
 * host product's env-var names, now fields on
 * {@link OriginValidationEnvConfig} — see `archived provenance ledger` for the exact
 * mapping. One function, a bypass for a specific product's own
 * browser-extension-driven ingest route, was deliberately **not** ported —
 * it names a specific product route and product feature with no generic
 * equivalent; see `archived provenance ledger`.
 */

import type { Logger } from "./primitives/index.js";

export interface ParsedHostHeader {
  hostname: string;
  host: string;
  port: string;
}

export interface RequestWithOriginHeaders {
  headers?: {
    host?: unknown;
    origin?: unknown;
    'sec-fetch-site'?: unknown;
  };
}

/** Names the env vars this port reads. */
export interface OriginValidationEnvConfig {
  /** Env var carrying a comma-separated list of extra allow-listed origins. */
  allowedOriginsEnvVar: string;
  /** Env var carrying an additional browser-facing port to treat as local (e.g. a separate web dev server). */
  webPortEnvVar: string;
  /** Env var carrying the host the daemon itself is bound to (default `'127.0.0.1'`). */
  bindHostEnvVar: string;
}

/** Host-supplied environment snapshot, shared by origin validation helpers. */
export interface OriginValidationArgs {
  config: OriginValidationEnvConfig;
  env: Readonly<Record<string, string | undefined>>;
}

/** Optional diagnostic sink; validation never reads an ambient logger. */
export type OriginValidationLoggerPort = Pick<Logger, "warn">;

/** Splits and trims the configured allow-list into entries. Both lenient request parsing and
 * strict boot validation share this splitter so their definition of one entry cannot drift. */
function splitAllowedOriginsEnv(config: OriginValidationEnvConfig, env: Readonly<Record<string, string | undefined>>): string[] {
  const raw = env[config.allowedOriginsEnvVar] || '';
  if (!raw.trim()) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** Parses `value` as a URL, or `undefined` when it is unparseable or not HTTP(S). Shared by
 * allow-list parsing and the Origin check so both agree on what counts as a web origin. */
function parseHttpUrl(value: string): URL | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  return parsed;
}

/** Normalizes one entry to a protocol://host origin; invalid or non-HTTP(S) entries are rejected. */
function parseAllowedOrigin(entry: string): string | undefined {
  return parseHttpUrl(entry)?.origin;
}

/**
 * Parses {@link OriginValidationEnvConfig.allowedOriginsEnvVar} into normalized origins.
 *
 * Deliberately never throws — this is on the hot path of {@link isLocalSameOrigin}, called fresh
 * on every same-origin decision a host makes. A malformed entry is dropped and logged instead of
 * aborting the whole parse. A request-time throw used to turn one config typo into
 * either a 500 on every request, or — on a route with no enclosing catch — an unhandled
 * rejection: hand-mounted attachment routes and provider catch-all routes had no common
 * enclosing catch. Dropping the malformed entry degrades to one fewer trusted origin,
 * never every request breaking. Call {@link assertValidAllowedOrigins} once at host startup instead, to fail loudly
 * before any request-serving traffic exists.
 */
export function configuredAllowedOrigins({ config, env }: OriginValidationArgs,
  { logger }: { logger?: OriginValidationLoggerPort | undefined } = {},
): string[] {
  const origins: string[] = [];
  for (const entry of splitAllowedOriginsEnv(config, env)) {
    const origin = parseAllowedOrigin(entry);
    if (origin === undefined) {
      logger?.warn({
        message: `[@jini-ai/core] ignoring malformed ${config.allowedOriginsEnvVar} entry (must be an http:// or https:// origin): ${entry}`,
      });
      continue;
    }
    origins.push(origin);
  }
  return origins;
}

/**
 * Boot-time companion to {@link configuredAllowedOrigins}: throws, naming every malformed entry,
 * instead of silently dropping them. Call once, early in host startup, before the HTTP server
 * accepts connections. A misconfiguration must fail boot loudly rather than quietly serving with
 * a smaller-than-intended allow-list, or throwing on whichever request first reaches the guard.
 */
export function assertValidAllowedOrigins({ config, env }: OriginValidationArgs): void {
  const invalid = splitAllowedOriginsEnv(config, env).filter((entry) => parseAllowedOrigin(entry) === undefined);
  if (invalid.length === 0) return;
  throw new Error(
    `${config.allowedOriginsEnvVar} has ${invalid.length} invalid entr${invalid.length === 1 ? 'y' : 'ies'} ` +
      `(must be http:// or https:// origins): ${invalid.join(', ')}`,
  );
}

/** The `host` (hostname:port) component of each configured allowed origin. */
export function configuredAllowedHosts({ origins }: { origins: string[] }): string[] {
  return origins.map((origin) => new URL(origin).host);
}

/** The set of browser-facing ports considered "local": the daemon's own port plus an optional configured web port. */
export function allowedBrowserPorts(
  { config, port, env }: OriginValidationArgs & { port: number | string | null | undefined },
): number[] {
  const ports = [];
  const primary = Number(port);
  if (primary) ports.push(primary);
  const webPort = Number(env[config.webPortEnvVar]);
  if (webPort && webPort !== primary) ports.push(webPort);
  return ports;
}

/** The loopback spellings a locally-served page's Host or Origin can carry. */
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

function headerValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const first = value[0];
    return first == null ? undefined : String(first);
  }
  return value == null ? undefined : String(value);
}

/** Parses a raw `Host` header value into hostname/host/port, or `null` when unparseable. */
export function parseHostHeader({ value }: { value: unknown }): ParsedHostHeader | null {
  const raw = String(headerValue(value) || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(`http://${raw}`);
    return { hostname: parsed.hostname, host: parsed.host, port: parsed.port || '80' };
  } catch {
    return null;
  }
}

type Octets = [number, number, number, number];

/** Parses an exact dotted-quad (four all-digit parts, each 0-255) into octets, else `undefined`.
 * Shared by the private-range and IP-literal checks so both agree on what an IPv4 literal is.
 * `/^\d+$/` admits only non-negative integers, so the octet range check needs only an upper bound. */
function parseDottedQuad(host: string): Octets | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  if (!parts.every((part) => /^\d+$/.test(part))) return undefined;
  const octets = parts.map(Number);
  return octets.every((n) => n <= 255) ? (octets as Octets) : undefined;
}

/** RFC 1918 (10/8, 172.16/12, 192.168/16) or link-local (169.254/16), from the first two octets. */
function isPrivateIpv4Prefix([a, b]: Octets): boolean {
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** Whether `hostname` is an RFC 1918 private IPv4 address (10/8, 172.16/12, 192.168/16) or link-local (169.254/16).
 * Implements the dev-browser LAN allow-list, not SSRF blocking. Use @jini-ai/platform/net
 * for SSRF address classification; private addresses are allowed here for local development. */
export function isPrivateIpv4({ hostname }: { hostname: unknown }): boolean {
  const octets = parseDottedQuad(String(hostname || ''));
  return octets !== undefined && isPrivateIpv4Prefix(octets);
}

/** Whether `hostname` is a literal IPv4 address or bracketed IPv6 literal (as opposed to a DNS name). */
export function isIpLiteralHostname({ hostname }: { hostname: unknown }): boolean {
  const host = String(hostname || '').trim();
  if (!host) return false;
  if (host.startsWith('[') && host.endsWith(']')) return true;
  return parseDottedQuad(host) !== undefined;
}

/** Whether `hostname` is loopback, unspecified, or a private-LAN address.
 * Implements the dev-browser LAN allow-list, not SSRF blocking (@jini-ai/platform/net). */
export function isLoopbackOrPrivateLanHost({ hostname }: { hostname: unknown }): boolean {
  const host = String(hostname || '').toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host === '0.0.0.0' ||
    host === '::' ||
    isPrivateIpv4({ hostname: host })
  );
}

/** Whether a request's `Host` header names a locally-served or explicitly allow-listed host. */
export function isAllowedBrowserHost(
  { hostHeader, ports, bindHost, extraAllowedOrigins }: {
    config: OriginValidationEnvConfig; hostHeader: unknown; ports: number[]; bindHost: string; extraAllowedOrigins: string[];
  },
): boolean {
  const requestHost = parseHostHeader({ value: hostHeader });
  if (!requestHost) return false;

  const explicitHosts = new Set([
    ...ports.flatMap((p) => [...LOOPBACK_HOSTS.map((h) => `${h}:${p}`), `${bindHost}:${p}`]),
    ...configuredAllowedHosts({ origins: extraAllowedOrigins }),
  ]);
  if (explicitHosts.has(requestHost.host)) return true;

  if (!ports.map(String).includes(requestHost.port)) return false;
  return isLoopbackOrPrivateLanHost({ hostname: requestHost.hostname });
}

/** Every `scheme://host:port` origin a locally-served page can have: loopback spellings and the bind host, over both schemes. */
function explicitLocalOrigins(ports: number[], bindHost: string): Set<string> {
  const hosts = [...LOOPBACK_HOSTS, bindHost];
  return new Set(ports.flatMap((p) => ['http', 'https'].flatMap((s) => hosts.map((h) => `${s}://${h}:${p}`))));
}

/** The URL's port, or its scheme's default when the URL omits it (only http/https reach here). */
function effectivePort(url: URL): string {
  return url.port || (url.protocol === 'https:' ? '443' : '80');
}

/** Whether an `Origin` header value names a locally-served or explicitly allow-listed origin. */
export function isAllowedBrowserOrigin(
  { origin, hostHeader, ports, bindHost, extraAllowedOrigins }: {
    config: OriginValidationEnvConfig; origin: unknown; hostHeader: unknown; ports: number[]; bindHost: string; extraAllowedOrigins: string[];
  },
): boolean {
  const originText = String(origin);
  if (extraAllowedOrigins.includes(originText)) return true;

  const parsedOrigin = parseHttpUrl(originText);
  if (!parsedOrigin) return false;

  const requestHost = parseHostHeader({ value: hostHeader });
  if (!requestHost) return false;

  if (explicitLocalOrigins(ports, bindHost).has(originText)) return true;

  if (!ports.map(String).includes(effectivePort(parsedOrigin))) return false;
  if (parsedOrigin.hostname !== requestHost.hostname) return false;
  return isLoopbackOrPrivateLanHost({ hostname: parsedOrigin.hostname });
}

type BrowserHostArgs = Omit<Parameters<typeof isAllowedBrowserHost>[0], 'extraAllowedOrigins'>;

/** The decision for a request carrying no `Origin` header (as a same-origin GET subresource does). */
function isAllowedWithoutOrigin(
  { req, hostArgs, extraAllowedOrigins }: { req: RequestWithOriginHeaders; hostArgs: BrowserHostArgs; extraAllowedOrigins: string[] },
): boolean {
  const ipOnlyExtraOrigins = extraAllowedOrigins.filter((o) => isIpLiteralHostname({ hostname: new URL(o).hostname }));
  if (isAllowedBrowserHost({ ...hostArgs, extraAllowedOrigins: ipOnlyExtraOrigins })) return true;
  // Browsers (Firefox, Chrome) omit Origin on same-origin GET subresource
  // requests per the Fetch spec, which makes hostname entries in the
  // allow-list unreachable for legitimate same-origin GETs through a
  // reverse proxy. Sec-Fetch-Site is set by the user agent and cannot be
  // modified by JavaScript, so a value of "same-origin" attests that the
  // request originated from the same origin as the target — a cross-site
  // `<img>`/`<script>` exploit would carry "cross-site" instead. Only
  // consult the broader allow-list once that signal is present.
  if (headerValue(req.headers?.['sec-fetch-site']) !== 'same-origin') return false;
  return isAllowedBrowserHost({ ...hostArgs, extraAllowedOrigins });
}

/**
 * The top-level same-origin gate: is `req` a request the daemon should treat
 * as coming from one of its own locally-served (or explicitly allow-listed)
 * pages.
 */
export function isLocalSameOrigin(
  { config, req, port, env }: OriginValidationArgs & {
    req: RequestWithOriginHeaders; port: number | string | null | undefined;
  },
  { logger }: { logger?: OriginValidationLoggerPort | undefined } = {},
): boolean {
  const host = String(headerValue(req.headers?.host) || '');
  const origin = headerValue(req.headers?.origin);
  const ports = allowedBrowserPorts({ config, port, env });
  const bindHost = env[config.bindHostEnvVar] || '127.0.0.1';
  const extraAllowedOrigins = configuredAllowedOrigins({ config, env }, { logger });

  if (origin == null || origin === '') {
    return isAllowedWithoutOrigin({ req, hostArgs: { config, hostHeader: host, ports, bindHost }, extraAllowedOrigins });
  }
  // Reverse-proxy deployments terminate the browser connection at the proxy
  // and open a fresh upstream connection to the daemon. The Host header the
  // daemon sees is the proxy upstream's address, not the browser-visible
  // origin, so the host check below fails even when the user explicitly
  // listed their proxy origin in the allow-list. Trust the Origin header in
  // that case: a client-supplied origin that exactly matches an explicitly
  // allow-listed entry is the documented escape hatch for these deployments.
  if (extraAllowedOrigins.includes(origin)) return true;
  if (!isAllowedBrowserHost({ config, hostHeader: host, ports, bindHost, extraAllowedOrigins })) return false;
  return isAllowedBrowserOrigin({ config, origin, hostHeader: host, ports, bindHost, extraAllowedOrigins });
}
