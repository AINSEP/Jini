/**
 * Same-origin / allow-listed-origin validation primitives for a locally-bound HTTP server:
 * loopback + private-LAN host/IP classification, an explicit origin allow-list read from env,
 * and the top-level `isLocalSameOrigin` decision `origin-guard.ts` wraps in the module's
 * `Result` pipeline. Framework-independent — operates on plain header values, not an Express
 * `Request`.
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

/**
 * Splits and trims the raw `JINI_ALLOWED_ORIGINS` value into individual candidate entries.
 * Shared by {@link configuredAllowedOrigins} (lenient, per-request) and
 * {@link assertValidAllowedOrigins} (strict, boot-time) so the two can never drift on what counts
 * as "one entry."
 */
function splitAllowedOriginsEnv(env: NodeJS.ProcessEnv): string[] {
  const raw = env.JINI_ALLOWED_ORIGINS || '';
  if (!raw.trim()) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** Normalizes one `JINI_ALLOWED_ORIGINS` entry into a `protocol://host` origin, or `undefined` if it isn't a valid http(s) origin. */
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
 * Extra allow-listed origins, comma-separated, read from `JINI_ALLOWED_ORIGINS`.
 *
 * Deliberately never throws. This runs inside {@link isLocalSameOrigin}, which every same-origin
 * check across the whole HTTP surface calls fresh on every incoming request — a config typo here
 * used to throw a `TypeError` synchronously, and depending on which route it happened to hit, that
 * either 500'd every request for the process's life or, worse, became an unhandled promise
 * rejection with nothing to catch it (`attachments.ts`'s hand-mounted routes, `model-proxy.ts`'s
 * `:provider` catch-all — see each file's own regression test). A malformed entry is dropped from
 * the allow-list and logged instead, so the daemon degrades to "one fewer trusted origin," never
 * "every request breaks." Call {@link assertValidAllowedOrigins} once at host startup to catch a
 * misconfiguration loudly before any request-serving traffic exists at all — that is where a typo
 * should actually be caught, not on the hot path.
 */
export function configuredAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const origins: string[] = [];
  for (const entry of splitAllowedOriginsEnv(env)) {
    const origin = parseAllowedOrigin(entry);
    if (origin === undefined) {
      console.warn(
        `[@jini-ai/http-kit] ignoring malformed JINI_ALLOWED_ORIGINS entry (must be an http:// or https:// origin): ${entry}`,
      );
      continue;
    }
    origins.push(origin);
  }
  return origins;
}

/**
 * Boot-time companion to {@link configuredAllowedOrigins}: throws, naming every malformed entry,
 * instead of silently dropping them. Meant to be called exactly once, early in host startup
 * (before the HTTP server accepts connections), so a misconfigured `JINI_ALLOWED_ORIGINS` fails
 * the boot loudly rather than quietly serving with a smaller-than-intended allow-list — or, before
 * this function existed, throwing on the first request that happened to reach the same-origin
 * guard instead of at boot.
 */
export function assertValidAllowedOrigins(env: NodeJS.ProcessEnv = process.env): void {
  const invalid = splitAllowedOriginsEnv(env).filter((entry) => parseAllowedOrigin(entry) === undefined);
  if (invalid.length === 0) return;
  throw new Error(
    `JINI_ALLOWED_ORIGINS has ${invalid.length} invalid entr${invalid.length === 1 ? 'y' : 'ies'} ` +
      `(must be http:// or https:// origins): ${invalid.join(', ')}`,
  );
}

export function configuredAllowedHosts(origins = configuredAllowedOrigins()): string[] {
  return origins.map((origin) => new URL(origin).host);
}

/** The primary bound port plus an optional secondary web port from `JINI_WEB_PORT`. */
export function allowedBrowserPorts(
  port: number | string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number[] {
  const ports = [];
  const primary = Number(port);
  if (primary) ports.push(primary);
  const webPort = Number(env.JINI_WEB_PORT);
  if (webPort && webPort !== primary) ports.push(webPort);
  return ports;
}

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

export function isPrivateIpv4(hostname: unknown): boolean {
  const parts = String(hostname || '').split('.');
  if (parts.length !== 4) return false;
  if (!parts.every((part) => /^\d+$/.test(part))) return false;
  const octets = parts.map((part) => Number(part));
  if (!octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

export function isIpLiteralHostname(hostname: unknown): boolean {
  const host = String(hostname || '').trim();
  if (!host) return false;
  if (host.startsWith('[') && host.endsWith(']')) return true;
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  if (!parts.every((part) => /^\d+$/.test(part))) return false;
  return parts.map(Number).every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
}

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

export function isAllowedBrowserHost(
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

export function isAllowedBrowserOrigin(
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
 * Top-level same-origin decision for a locally-bound HTTP server: same-origin GETs (which
 * browsers may send with no `Origin` header per the Fetch spec) are accepted via the `Host`
 * header + `Sec-Fetch-Site: same-origin` signal (a header set by the user agent, unforgeable
 * from JavaScript); cross-origin requests must present an `Origin` that resolves to a loopback,
 * private-LAN, or explicitly allow-listed (`JINI_ALLOWED_ORIGINS`) origin. Reverse-proxy
 * deployments are supported by trusting an `Origin` that exactly matches an allow-listed entry,
 * since the `Host` header a proxied daemon sees is the proxy's upstream address, not the
 * browser-visible origin.
 */
export function isLocalSameOrigin(
  req: RequestWithOriginHeaders,
  port: number | string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const host = String(headerValue(req.headers?.host) || '');
  const origin = headerValue(req.headers?.origin);
  const ports = allowedBrowserPorts(port, env);
  const bindHost = env.JINI_BIND_HOST || '127.0.0.1';
  const extraAllowedOrigins = configuredAllowedOrigins(env);
  const ipOnlyExtraOrigins = extraAllowedOrigins.filter((o) =>
    isIpLiteralHostname(new URL(o).hostname),
  );

  const localHostAllowed = isAllowedBrowserHost(host, ports, bindHost, ipOnlyExtraOrigins);
  if (origin == null || origin === '') {
    if (localHostAllowed) return true;
    const fetchSite = headerValue(req.headers?.['sec-fetch-site']);
    if (fetchSite === 'same-origin') {
      return isAllowedBrowserHost(host, ports, bindHost, extraAllowedOrigins);
    }
    return false;
  }
  if (extraAllowedOrigins.includes(origin)) return true;
  if (!isAllowedBrowserHost(host, ports, bindHost, extraAllowedOrigins)) return false;
  return isAllowedBrowserOrigin(origin, host, ports, bindHost, extraAllowedOrigins);
}

function headerValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const first = value[0];
    return first == null ? undefined : String(first);
  }
  return value == null ? undefined : String(value);
}
