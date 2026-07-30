/**
 * @module daemon-url
 *
 * Generic daemon-URL resolution, generalized from OD's
 * `apps/daemon/src/daemon-url.ts` (see `source-map.md`). The *order* —
 * explicit flag, then an env var, then an injected discovery probe, then a
 * caller-supplied default — is the reusable part. OD's own implementation
 * hardcodes its sidecar IPC protocol and a `pnpm exec tools-dev status`
 * fallback; neither belongs in a product-neutral package, so both are
 * replaced with an injected `discover` callback the caller (e.g. a future
 * `@jini-ai/sidecar`-backed adapter) supplies.
 */

export interface ResolveDaemonUrlOptions {
  /** Value passed via a `--daemon-url`-shaped flag. Empty string is treated as unset. */
  flagUrl?: string | null;
  /** Defaults to `process.env`; inject for tests. */
  env?: NodeJS.ProcessEnv;
  /**
   * Name of the environment variable to check (e.g. `'JINI_DAEMON_URL'`).
   * Omit to skip the env step entirely — this package has no baked-in
   * product env var name.
   */
  envVarName?: string;
  /**
   * Optional discovery probe (e.g. a sidecar IPC status roundtrip). Return
   * `null` when nothing was discovered so resolution falls through to
   * `defaultUrl`.
   */
  discover?: (env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<string | null>;
  /** Discovery timeout in ms. Defaults to 800ms so an absent daemon doesn't stall CLI startup. */
  timeoutMs?: number;
  /** Returned when the flag, env, and discovery steps all come up empty. */
  defaultUrl?: string;
  /**
   * Non-fatal sink for {@link daemonUrlPolicyWarning}, called once resolution
   * succeeds. Defaults to a no-op. A user's own daemon may legitimately run
   * on a remote, non-HTTPS host, so this only warns — it never rejects.
   */
  warn?: (message: string) => void;
}

/**
 * Resolve a daemon HTTP base URL for a CLI client command.
 *
 * Resolution order: `flagUrl`, then `env[envVarName]` (when `envVarName` is
 * given), then `discover()` (when given), then `defaultUrl`. Throws when
 * every step is exhausted and no `defaultUrl` was supplied — a silent
 * `http://127.0.0.1:0`-style fallback would be worse than a clear error,
 * and this package has no locked default port to fall back to on its own.
 */
export async function resolveDaemonUrl(options: ResolveDaemonUrlOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const warn = options.warn ?? ((): void => {});

  const report = (url: string): string => {
    const warning = daemonUrlPolicyWarning(url);
    if (warning !== null) warn(warning);
    return url;
  };

  const flagUrl = options.flagUrl ?? null;
  if (flagUrl !== null && flagUrl.length > 0) return report(flagUrl);

  if (options.envVarName !== undefined) {
    const envUrl = env[options.envVarName];
    if (envUrl !== undefined && envUrl.length > 0) return report(envUrl);
  }

  if (options.discover !== undefined) {
    const discovered = await options.discover(env, options.timeoutMs ?? 800);
    if (discovered !== null && discovered.length > 0) return report(discovered);
  }

  if (options.defaultUrl !== undefined) return report(options.defaultUrl);

  throw new Error(
    'no daemon URL resolved: pass flagUrl, set envVarName on a populated env var, ' +
      'supply a discover() probe, or provide defaultUrl.',
  );
}

// Matches a scheme + userinfo prefix (`scheme://user:pass@`) on a URL string that failed to
// parse via the `URL` constructor, so userinfo can still be stripped from a malformed value
// before it's ever printed.
const USERINFO_PREFIX_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@]*@/;

/**
 * Return `url` with any embedded userinfo (`user:pass@host`) stripped, safe to include in a
 * printed error message, log line, or structured-error envelope. Per SEC-RB-009
 * (`ADS-memory/reports/security/SEC-remaining-backend-audit-2026-07-21.md`), a daemon URL a
 * caller configures themselves can legitimately carry basic-auth credentials; those must never
 * reach stderr/stdout verbatim. Returns `url` unchanged when it has no userinfo, so normal URLs
 * are never reformatted/normalized as a side effect of display-sanitizing them.
 */
export function sanitizeDaemonUrlForDisplay(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url.replace(USERINFO_PREFIX_RE, '$1');
  }
  if (parsed.username.length === 0 && parsed.password.length === 0) return url;
  parsed.username = '';
  parsed.password = '';
  return parsed.toString();
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/**
 * Non-fatal policy check for a resolved daemon URL: warn (never throw or reject) when it is
 * neither loopback nor HTTPS, since that combination sends CLI traffic — including whatever
 * headers/body a command sends — over an unencrypted connection to a non-local host. Returns
 * `null` when the URL looks safe or doesn't parse (a parse failure is reported elsewhere, by
 * whatever code actually tries to use the URL).
 */
export function daemonUrlPolicyWarning(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol === 'https:' || isLoopbackHostname(parsed.hostname)) return null;
  return (
    `daemon URL ${sanitizeDaemonUrlForDisplay(url)} is neither loopback nor HTTPS; ` +
    'traffic to a remote, non-HTTPS daemon is not encrypted.'
  );
}
