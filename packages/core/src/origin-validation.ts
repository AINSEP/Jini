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
 * {@link OriginValidationEnvConfig} — see `source-map.md` for the exact
 * mapping. One function, a bypass for a specific product's own
 * browser-extension-driven ingest route, was deliberately **not** ported —
 * it names a specific product route and product feature with no generic
 * equivalent; see `source-map.md`.
 */

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

function splitAllowedOriginsEnv(config: OriginValidationEnvConfig, env: NodeJS.ProcessEnv): string[] {
  const raw = env[config.allowedOriginsEnvVar] || '';
  if (!raw.trim()) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function parseAllowedOrigin(entry: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(entry);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  return parsed.origin;
}

/**
 * Parses {@link OriginValidationEnvConfig.allowedOriginsEnvVar} into normalized origins.
 *
 * Deliberately never throws — this is on the hot path of {@link isLocalSameOrigin}, called fresh
 * on every same-origin decision a host makes. A malformed entry is dropped and logged instead of
 * aborting the whole parse (see the twin `@jini-ai/http-kit` copy of this module for the fuller
 * incident history this mirrors: a request-time throw here used to turn one config typo into
 * either a 500 on every request, or — on a route with no enclosing catch — an unhandled
 * rejection). Call {@link assertValidAllowedOrigins} once at host startup instead, to fail loudly
 * before any request-serving traffic exists.
 */
export function configuredAllowedOrigins(
  config: OriginValidationEnvConfig,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const origins: string[] = [];
  for (const entry of splitAllowedOriginsEnv(config, env)) {
    const origin = parseAllowedOrigin(entry);
    if (origin === undefined) {
      console.warn(
        `[@jini-ai/core] ignoring malformed ${config.allowedOriginsEnvVar} entry (must be an http:// or https:// origin): ${entry}`,
      );
      continue;
    }
    origins.push(origin);
  }
  return origins;
}

/**
 * Boot-time companion to {@link configuredAllowedOrigins}: throws, naming every malformed entry,
 * instead of silently dropping them. Call once, early in host startup, before the HTTP server
 * accepts connections.
 */
export function assertValidAllowedOrigins(config: OriginValidationEnvConfig, env: NodeJS.ProcessEnv = process.env): void {
  const invalid = splitAllowedOriginsEnv(config, env).filter((entry) => parseAllowedOrigin(entry) === undefined);
  if (invalid.length === 0) return;
  throw new Error(
    `${config.allowedOriginsEnvVar} has ${invalid.length} invalid entr${invalid.length === 1 ? 'y' : 'ies'} ` +
      `(must be http:// or https:// origins): ${invalid.join(', ')}`,
  );
}

/** The `host` (hostname:port) component of each configured allowed origin. */
export function configuredAllowedHosts(origins: string[]): string[] {
  return origins.map((origin) => new URL(origin).host);
}

/** The set of browser-facing ports considered "local": the daemon's own port plus an optional configured web port. */
export function allowedBrowserPorts(
  config: OriginValidationEnvConfig,
  port: number | string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number[] {
  const ports = [];
  const primary = Number(port);
  if (primary) ports.push(primary);
  const webPort = Number(env[config.webPortEnvVar]);
  if (webPort && webPort !== primary) ports.push(webPort);
  return ports;
}

function headerValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const first = value[0];
    return first == null ? undefined : String(first);
  }
  return value == null ? undefined : String(value);
}

/** Parses a raw `Host` header value into hostname/host/port, or `null` when unparseable. */
export function parseHostHeader(value: unknown): ParsedHostHeader | null {
  const raw = String(headerValue(value) || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(`http://${raw}`);
    return { hostname: parsed.hostname, host: parsed.host, port: parsed.port || '80' };
  } catch {
    return null;
  }
}

/** Whether `hostname` is an RFC 1918 private IPv4 address (10/8, 172.16/12, 192.168/16) or link-local (169.254/16). */
export function isPrivateIpv4(hostname: unknown): boolean {
  const parts = String(hostname || '').split('.');
  if (parts.length !== 4) return false;
  if (!parts.every((part) => /^\d+$/.test(part))) return false;
  const octets = parts.map((part) => Number(part));
  if (!octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** Whether `hostname` is a literal IPv4 address or bracketed IPv6 literal (as opposed to a DNS name). */
export function isIpLiteralHostname(hostname: unknown): boolean {
  const host = String(hostname || '').trim();
  if (!host) return false;
  if (host.startsWith('[') && host.endsWith(']')) return true;
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  if (!parts.every((part) => /^\d+$/.test(part))) return false;
  return parts.map(Number).every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
}

/** Whether `hostname` is loopback, unspecified, or a private-LAN address. */
export function isLoopbackOrPrivateLanHost(hostname: unknown): boolean {
  const host = String(hostname || '').toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host === '0.0.0.0' ||
    host === '::' ||
    isPrivateIpv4(host)
  );
}

/** Whether a request's `Host` header names a locally-served or explicitly allow-listed host. */
export function isAllowedBrowserHost(
  config: OriginValidationEnvConfig,
  hostHeader: unknown,
  ports: number[],
  bindHost: string,
  extraAllowedOrigins: string[],
): boolean {
  const requestHost = parseHostHeader(hostHeader);
  if (!requestHost) return false;

  const loopbackHosts = ['127.0.0.1', 'localhost', '[::1]'];
  const explicitHosts = new Set([
    ...ports.flatMap((p) => [...loopbackHosts.map((h) => `${h}:${p}`), `${bindHost}:${p}`]),
    ...configuredAllowedHosts(extraAllowedOrigins),
  ]);
  if (explicitHosts.has(requestHost.host)) return true;

  if (!ports.map(String).includes(requestHost.port)) return false;
  return isLoopbackOrPrivateLanHost(requestHost.hostname);
}

/** Whether an `Origin` header value names a locally-served or explicitly allow-listed origin. */
export function isAllowedBrowserOrigin(
  config: OriginValidationEnvConfig,
  origin: unknown,
  hostHeader: unknown,
  ports: number[],
  bindHost: string,
  extraAllowedOrigins: string[],
): boolean {
  if (extraAllowedOrigins.includes(String(origin))) return true;

  let parsedOrigin;
  try {
    parsedOrigin = new URL(String(origin));
  } catch {
    return false;
  }
  if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') return false;

  const requestHost = parseHostHeader(hostHeader);
  if (!requestHost) return false;

  const schemes = ['http', 'https'];
  const loopbackHosts = ['127.0.0.1', 'localhost', '[::1]'];
  const explicitOrigins = new Set(
    ports.flatMap((p) => [
      ...schemes.flatMap((s) => loopbackHosts.map((h) => `${s}://${h}:${p}`)),
      ...schemes.map((s) => `${s}://${bindHost}:${p}`),
    ]),
  );
  if (explicitOrigins.has(String(origin))) return true;

  const originPort = parsedOrigin.port || (parsedOrigin.protocol === 'https:' ? '443' : '80');
  if (!ports.map(String).includes(originPort)) return false;
  if (parsedOrigin.hostname !== requestHost.hostname) return false;
  return isLoopbackOrPrivateLanHost(parsedOrigin.hostname);
}

/**
 * The top-level same-origin gate: is `req` a request the daemon should treat
 * as coming from one of its own locally-served (or explicitly allow-listed)
 * pages.
 */
export function isLocalSameOrigin(
  config: OriginValidationEnvConfig,
  req: RequestWithOriginHeaders,
  port: number | string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const host = String(headerValue(req.headers?.host) || '');
  const origin = headerValue(req.headers?.origin);
  const ports = allowedBrowserPorts(config, port, env);
  const bindHost = env[config.bindHostEnvVar] || '127.0.0.1';
  const extraAllowedOrigins = configuredAllowedOrigins(config, env);
  const ipOnlyExtraOrigins = extraAllowedOrigins.filter((o) => isIpLiteralHostname(new URL(o).hostname));

  const localHostAllowed = isAllowedBrowserHost(config, host, ports, bindHost, ipOnlyExtraOrigins);
  if (origin == null || origin === '') {
    if (localHostAllowed) return true;
    // Browsers (Firefox, Chrome) omit Origin on same-origin GET subresource
    // requests per the Fetch spec, which makes hostname entries in the
    // allow-list unreachable for legitimate same-origin GETs through a
    // reverse proxy. Sec-Fetch-Site is set by the user agent and cannot be
    // modified by JavaScript, so a value of "same-origin" attests that the
    // request originated from the same origin as the target — a cross-site
    // `<img>`/`<script>` exploit would carry "cross-site" instead. Only
    // consult the broader allow-list once that signal is present.
    const fetchSite = headerValue(req.headers?.['sec-fetch-site']);
    if (fetchSite === 'same-origin') {
      return isAllowedBrowserHost(config, host, ports, bindHost, extraAllowedOrigins);
    }
    return false;
  }
  // Reverse-proxy deployments terminate the browser connection at the proxy
  // and open a fresh upstream connection to the daemon. The Host header the
  // daemon sees is the proxy upstream's address, not the browser-visible
  // origin, so the host check below fails even when the user explicitly
  // listed their proxy origin in the allow-list. Trust the Origin header in
  // that case: a client-supplied origin that exactly matches an explicitly
  // allow-listed entry is the documented escape hatch for these deployments.
  if (extraAllowedOrigins.includes(origin)) return true;
  if (!isAllowedBrowserHost(config, host, ports, bindHost, extraAllowedOrigins)) return false;
  return isAllowedBrowserOrigin(config, origin, host, ports, bindHost, extraAllowedOrigins);
}
