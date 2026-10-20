import { isLoopbackHostname } from '@jini-ai/platform/net';
/**
 * @module daemon-url
 *
 * Generic daemon-URL resolution, generalized from OD's
 * `apps/daemon/src/daemon-url.ts` (see `archived provenance ledger`). The *order* —
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
  discover?: (requiredArgs: { env: NodeJS.ProcessEnv }, optionalArgs: { timeoutMs: number }) => Promise<string | null>;
  /** Discovery timeout in ms. Defaults to 800ms so an absent daemon doesn't stall CLI startup. */
  timeoutMs?: number;
  /** Returned when the flag, env, and discovery steps all come up empty. */
  defaultUrl?: string;
  /**
   * Non-fatal sink for {@link daemonUrlPolicyWarning}, called once resolution
   * succeeds. Defaults to a no-op. A user's own daemon may legitimately run
   * on a remote, non-HTTPS host, so this only warns — it never rejects.
   */
  warn?: (requiredArgs: { message: string }) => void;
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
export async function resolveDaemonUrl(_requiredArgs: Record<string, never>, options: ResolveDaemonUrlOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  // `??` short-circuits, so discover() is only probed when flag and env both came up empty.
  // defaultUrl is taken as-is (even `''`): only `undefined` skips it.
  const url =
    nonEmpty(options.flagUrl ?? null) ??
    envCandidate({ env }, options) ??
    (await discoverCandidate({ env }, options)) ??
    options.defaultUrl;
  if (url === undefined) {
    throw new Error(
      'no daemon URL resolved: pass flagUrl, set envVarName on a populated env var, ' +
        'supply a discover() probe, or provide defaultUrl.',
    );
  }
  const warning = daemonUrlPolicyWarning({ url });
  if (warning !== null) options.warn?.({ message: warning });
  return url;
}

/** `value` when it is a non-empty string, else `undefined` (`null` and `''` both mean "unset"). */
function nonEmpty(value: string | null): string | undefined {
  return value !== null && value.length > 0 ? value : undefined;
}

/** The env step: `env[envVarName]`, skipped entirely when no `envVarName` was given. */
function envCandidate({ env }: { env: NodeJS.ProcessEnv }, { envVarName }: ResolveDaemonUrlOptions): string | undefined {
  return envVarName === undefined ? undefined : nonEmpty(env[envVarName] ?? null);
}

/** The discovery step: one `discover()` probe with the caller timeout (default 800ms), when a probe was given. */
async function discoverCandidate(
  { env }: { env: NodeJS.ProcessEnv },
  { discover, timeoutMs }: ResolveDaemonUrlOptions,
): Promise<string | undefined> {
  return discover === undefined ? undefined : nonEmpty(await discover({ env }, { timeoutMs: timeoutMs ?? 800 }));
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
export function sanitizeDaemonUrlForDisplay({ url }: { url: string }): string {
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

/**
 * Non-fatal policy check for a resolved daemon URL: warn (never throw or reject) when it is
 * neither loopback nor HTTPS, since that combination sends CLI traffic — including whatever
 * headers/body a command sends — over an unencrypted connection to a non-local host. Returns
 * `null` when the URL looks safe or doesn't parse (a parse failure is reported elsewhere, by
 * whatever code actually tries to use the URL).
 */
export function daemonUrlPolicyWarning({ url }: { url: string }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol === 'https:' || isLoopbackHostname({ hostname: parsed.hostname })) return null;
  return (
    `daemon URL ${sanitizeDaemonUrlForDisplay({ url: url })} is neither loopback nor HTTPS; ` +
    'traffic to a remote, non-HTTPS daemon is not encrypted.'
  );
}
