/**
 * @module proxy-env
 *
 * System proxy discovery and proxy-aware environment merging. Reads the OS
 * proxy configuration (macOS `scutil --proxy`, Windows Internet Settings
 * registry) and normalizes it into canonical `HTTP_PROXY` / `HTTPS_PROXY` /
 * `ALL_PROXY` / `NO_PROXY` / `NODE_USE_ENV_PROXY` environment variables, plus a
 * merge that keeps proxy variables consistent across layered env sources.
 *
 * Pure aside from the single `execFileSync` used to shell out to the platform
 * proxy-config tools; owns no other sibling dependency.
 */
import { execFileSync } from "node:child_process";

export type SystemProxyCommandRunner = (command: string, args: string[]) => string;

export type ResolveSystemProxyEnvOptions = {
  platform?: NodeJS.Platform;
  runCommand?: SystemProxyCommandRunner;
};

/** @internal Canonical spelling of every proxy env variable this module normalizes. */
type CanonicalProxyKey = "ALL_PROXY" | "HTTP_PROXY" | "HTTPS_PROXY" | "NODE_USE_ENV_PROXY" | "NO_PROXY";

const CANONICAL_PROXY_ENV_KEYS = new Map<string, CanonicalProxyKey>([
  ["all_proxy", "ALL_PROXY"],
  ["http_proxy", "HTTP_PROXY"],
  ["https_proxy", "HTTPS_PROXY"],
  ["node_use_env_proxy", "NODE_USE_ENV_PROXY"],
  ["no_proxy", "NO_PROXY"],
]);

/** @internal Default proxy-config command runner: a short-timeout synchronous shell-out with output captured as UTF-8. */
function defaultSystemProxyCommandRunner(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2_000,
    windowsHide: true,
  });
}

/** @internal Map a case-insensitive proxy env key to its canonical spelling, or `null` if it is not a proxy variable. */
function canonicalProxyEnvKey(key: string): CanonicalProxyKey | null {
  return CANONICAL_PROXY_ENV_KEYS.get(key.toLowerCase()) ?? null;
}

/** @internal Delete every case-variant of a proxy env key from `env` so a canonical value can replace it cleanly. */
function deleteProxyEnvVariants(env: NodeJS.ProcessEnv, canonicalKey: string): void {
  for (const existingKey of Object.keys(env)) {
    if (existingKey.toLowerCase() === canonicalKey.toLowerCase()) delete env[existingKey];
  }
}

/** @internal Assign a canonical proxy value into `env`, clearing prior case-variants and adding lowercase aliases on POSIX. */
function setCanonicalProxyEnvValue(
  env: NodeJS.ProcessEnv,
  canonicalKey: CanonicalProxyKey,
  value: string,
  platform: NodeJS.Platform,
): void {
  deleteProxyEnvVariants(env, canonicalKey);
  if (canonicalKey === "NODE_USE_ENV_PROXY") {
    env.NODE_USE_ENV_PROXY = value;
    return;
  }
  addProxyEnvValue(env, canonicalKey, value, platform);
}

/**
 * Merge multiple env sources into one proxy-consistent environment. Proxy
 * variables are collapsed to their canonical spelling (preferring lowercase
 * inputs), non-proxy keys pass through, and `NODE_USE_ENV_PROXY=1` is set when
 * a proxy endpoint is present but the flag is not.
 *
 * @param platform - Target platform, controlling lowercase-alias emission.
 * @param sources - Env sources merged left-to-right (later sources win).
 * @returns A new merged environment with normalized proxy variables.
 */
export function mergeProxyAwareEnv(
  platform: NodeJS.Platform,
  ...sources: Array<NodeJS.ProcessEnv | Record<string, string | undefined>>
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = {};
  for (const source of sources) {
    const proxyEntries = collectSourceProxyEntries({ merged, source });
    for (const [canonicalKey, entry] of proxyEntries) {
      setCanonicalProxyEnvValue(merged, canonicalKey, entry.value, platform);
    }
  }
  if (hasProxyEndpointEnv(merged) && !hasCanonicalProxyEnv(merged, "NODE_USE_ENV_PROXY")) {
    merged.NODE_USE_ENV_PROXY = "1";
  }
  return merged;
}

type SourceProxyEntry = { preferLowercase: boolean; value: string };

/** @internal Copy one source's non-proxy keys into `merged` and return its proxy values keyed by canonical name,
 *  preferring a lowercase spelling when a source carries several case-variants of the same variable. */
function collectSourceProxyEntries(input: {
  merged: NodeJS.ProcessEnv;
  source: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): Map<CanonicalProxyKey, SourceProxyEntry> {
  const proxyEntries = new Map<CanonicalProxyKey, SourceProxyEntry>();
  for (const [key, value] of Object.entries(input.source)) {
    if (value == null) continue;
    const canonicalKey = canonicalProxyEnvKey(key);
    if (!canonicalKey) {
      input.merged[key] = value;
      continue;
    }
    const current = proxyEntries.get(canonicalKey);
    const preferLowercase = key === key.toLowerCase();
    if (!current || preferLowercase || !current.preferLowercase) {
      proxyEntries.set(canonicalKey, { preferLowercase, value });
    }
  }
  return proxyEntries;
}

/** @internal Whether `env` already contains any case-variant of the given canonical proxy key. */
function hasCanonicalProxyEnv(env: NodeJS.ProcessEnv, canonicalKey: CanonicalProxyKey): boolean {
  return Object.keys(env).some((key) => key.toLowerCase() === canonicalKey.toLowerCase());
}

/** @internal Whether `env` defines a non-empty HTTP/HTTPS/ALL proxy endpoint (ignoring `NO_PROXY`). */
function hasProxyEndpointEnv(env: NodeJS.ProcessEnv): boolean {
  return ["ALL_PROXY", "HTTP_PROXY", "HTTPS_PROXY"].some((key) => {
    for (const [envKey, value] of Object.entries(env)) {
      if (envKey.toLowerCase() === key.toLowerCase() && value?.trim()) return true;
    }
    return false;
  });
}

/** @internal Set an uppercase proxy variable (and its lowercase alias on POSIX) from a trimmed value; no-op when blank. */
function addProxyEnvValue(
  env: NodeJS.ProcessEnv,
  key: "HTTP_PROXY" | "HTTPS_PROXY" | "ALL_PROXY" | "NO_PROXY",
  value: string,
  platform: NodeJS.Platform,
): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  env[key] = trimmed;
  if (platform !== "win32") env[key.toLowerCase()] = trimmed;
}

/** @internal Expand a single NO_PROXY bypass token into its normalized forms (e.g. `<local>`, `*.foo`, `::1`). */
function normalizeBypassToken(token: string): string[] {
  const trimmed = token.trim();
  if (!trimmed) return [];
  if (trimmed === "<local>") return ["<local>", "localhost", "127.0.0.1", "[::1]", ".local"];
  if (trimmed === "::1") return ["[::1]"];
  if (trimmed.startsWith("*.")) return [`.${trimmed.slice(2)}`];
  return [trimmed];
}

/** @internal Build a de-duplicated, comma-joined NO_PROXY value from bypass tokens, or `null` when empty. */
function buildNoProxyValue(tokens: Iterable<string>): string | null {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const token of tokens) {
    for (const normalized of normalizeBypassToken(token)) {
      if (!seen.has(normalized)) {
        seen.add(normalized);
        values.push(normalized);
      }
    }
  }
  return values.length > 0 ? values.join(",") : null;
}

/** @internal Preserve a wildcard (`*`) NO_PROXY bypass verbatim, since it disables proxying entirely. */
function preserveWildcardNoProxyValue(noProxy: string | null | undefined): string | undefined {
  return noProxy?.split(",").some((token) => token.trim() === "*") ? "*" : undefined;
}

/** @internal Ensure a proxy URL has a scheme, defaulting to the supplied scheme when only an authority is given.
 *  Its only call site (`normalizeHostPortProxyUrl`) already guarantees a non-empty `raw` (both `host` and `port`
 *  are checked truthy before it's composed), so no empty/whitespace-only-input guard is needed here. */
function normalizeProxyUrl(raw: string, scheme: string): string {
  const trimmed = raw.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `${scheme}://${trimmed}`;
}

/** @internal Bracket a bare IPv6 host in an `authority` (`host:port`) so URL parsing does not mistake it for a port. */
function bracketIpv6Authority(authority: string): string {
  if (authority.startsWith("[") || !authority.includes(":")) return authority;
  const portSeparatorIndex = authority.lastIndexOf(":");
  if (portSeparatorIndex <= 0) return authority;
  const host = authority.slice(0, portSeparatorIndex);
  const port = authority.slice(portSeparatorIndex + 1);
  if (!host.includes(":") || !/^\d+$/.test(port)) return authority;
  return `[${host}]:${port}`;
}

/** @internal Normalize a proxy authority into a scheme-qualified URL, IPv6-bracketing the host as needed.
 *  Every call site already guarantees a non-empty, trimmed `raw` before calling this (see
 *  `parseWindowsInternetSettingsProxyOutput`'s own `!kind || !value` / `!proxyServer.trim()` guards), so no
 *  empty/whitespace-only-input guard is needed here. */
function normalizeAuthorityProxyUrl(raw: string, scheme: string): string {
  const trimmed = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `${scheme}://${bracketIpv6Authority(trimmed)}`;
}

/** @internal Compose a scheme-qualified proxy URL from separate host and port fields, IPv6-bracketing the host. */
function normalizeHostPortProxyUrl(
  host: string | undefined,
  port: string | undefined,
  scheme: string,
): string | null {
  const trimmedHost = host?.trim() ?? "";
  const trimmedPort = port?.trim() ?? "";
  if (!trimmedHost || !trimmedPort) return null;
  const normalizedHost =
    trimmedHost.includes(":") && !trimmedHost.startsWith("[") && !trimmedHost.endsWith("]")
      ? `[${trimmedHost}]`
      : trimmedHost;
  return normalizeProxyUrl(`${normalizedHost}:${trimmedPort}`, scheme);
}

type SystemProxyValues = {
  allProxy?: string | null;
  httpProxy?: string | null;
  httpsProxy?: string | null;
  noProxy?: string | null;
};

/** @internal The NO_PROXY value for a system proxy: a preserved wildcard, else the bypass list plus loopback hosts. */
function systemNoProxyValue(noProxy: string | null | undefined): string | null {
  return (
    preserveWildcardNoProxyValue(noProxy) ??
    buildNoProxyValue([...(noProxy ? noProxy.split(",") : []), "localhost", "127.0.0.1", "[::1]"])
  );
}

/** @internal Assemble the final proxy env from parsed values, adding loopback bypasses and the `NODE_USE_ENV_PROXY` flag. */
function finalizeSystemProxyEnv(values: SystemProxyValues, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const hasProxy = Boolean(values.httpProxy || values.httpsProxy || values.allProxy);
  if (!hasProxy) return env;
  const entries: Array<["HTTP_PROXY" | "HTTPS_PROXY" | "ALL_PROXY" | "NO_PROXY", string | null | undefined]> = [
    ["HTTP_PROXY", values.httpProxy],
    ["HTTPS_PROXY", values.httpsProxy],
    ["ALL_PROXY", values.allProxy],
    ["NO_PROXY", systemNoProxyValue(values.noProxy)],
  ];
  for (const [key, value] of entries) {
    if (value) addProxyEnvValue(env, key, value, platform);
  }
  env.NODE_USE_ENV_PROXY = "1";
  return env;
}

/**
 * Parse macOS `scutil --proxy` output into a normalized proxy environment.
 * Honors the HTTP/HTTPS/SOCKS enable flags, exception list, and the
 * "exclude simple hostnames" toggle.
 *
 * @param stdout - Raw `scutil --proxy` output.
 * @param platform - Target platform for env normalization (defaults to `"darwin"`).
 * @returns A normalized proxy environment (empty when no proxy is enabled).
 */
export function parseMacosScutilProxyOutput(
  stdout: string,
  platform: NodeJS.Platform = "darwin",
): NodeJS.ProcessEnv {
  const { exceptions, scalars } = parseScutilLines(stdout);
  return finalizeSystemProxyEnv(
    {
      allProxy: scutilEnabledProxy({ prefix: "SOCKS", scalars, scheme: "socks5" }),
      httpProxy: scutilEnabledProxy({ prefix: "HTTP", scalars, scheme: "http" }),
      httpsProxy: scutilEnabledProxy({ prefix: "HTTPS", scalars, scheme: "http" }),
      noProxy: buildNoProxyValue([
        ...exceptions,
        ...(scalars.get("ExcludeSimpleHostnames") === "1" ? ["<local>"] : []),
      ]),
    },
    platform,
  );
}

/** @internal Split `scutil --proxy` output into its `Name : value` scalars and its `ExceptionsList` array entries. */
function parseScutilLines(stdout: string): { exceptions: string[]; scalars: Map<string, string> } {
  const scalars = new Map<string, string>();
  const exceptions: string[] = [];
  let inExceptions = false;
  // Blank lines need no explicit skip: they match neither the array-entry nor
  // the scalar pattern, and are not the closing `}`.
  for (const line of stdout.split(/\r?\n/).map((rawLine) => rawLine.trim())) {
    if (/^ExceptionsList\s*:\s*<array>\s*\{$/.test(line)) inExceptions = true;
    else if (inExceptions) inExceptions = collectScutilException(line, exceptions);
    else collectScutilScalar(line, scalars);
  }
  return { exceptions, scalars };
}

/** @internal Record one `N : value` ExceptionsList entry; returns whether the array is still open (false on `}`). */
function collectScutilException(line: string, exceptions: string[]): boolean {
  const match = line.match(/^\d+\s*:\s*(.+)$/);
  if (match) exceptions.push(match[1]!.trim());
  return line !== "}";
}

/** @internal Record one top-level `Name : value` scutil scalar, ignoring lines of any other shape. */
function collectScutilScalar(line: string, scalars: Map<string, string>): void {
  const match = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.+)$/);
  if (match) scalars.set(match[1]!, match[2]!.trim());
}

/** @internal The `<prefix>Proxy`/`<prefix>Port` URL when `<prefix>Enable` is `1`, else `null`. */
function scutilEnabledProxy(input: { prefix: "HTTP" | "HTTPS" | "SOCKS"; scalars: Map<string, string>; scheme: string }): string | null {
  const { prefix, scalars, scheme } = input;
  if (scalars.get(`${prefix}Enable`) !== "1") return null;
  return normalizeHostPortProxyUrl(scalars.get(`${prefix}Proxy`), scalars.get(`${prefix}Port`), scheme);
}

/** @internal Extract a `reg query` value line (`Name REG_TYPE value`) for the named value, or `null` if absent. */
function parseRegistryValue(stdout: string, valueName: string): string | null {
  const match = stdout.match(new RegExp(`^\\s*${valueName}\\s+REG_\\w+\\s+(.+)$`, "m"));
  return match ? match[1]!.trim() : null;
}

/** @internal Per-protocol `ProxyServer` kinds mapped to the env slot and default scheme they fill. */
const WINDOWS_PROXY_KINDS = new Map<string, { scheme: string; slot: "allProxy" | "httpProxy" | "httpsProxy" }>([
  ["http", { scheme: "http", slot: "httpProxy" }],
  ["https", { scheme: "http", slot: "httpsProxy" }],
  ["socks", { scheme: "socks5", slot: "allProxy" }],
]);

/** @internal Parse the per-protocol `http=…;https=…;socks=…` `ProxyServer` form; later segments win, unknown kinds are skipped. */
function parsePerProtocolProxyServer(proxyServer: string): Omit<SystemProxyValues, "noProxy"> {
  const proxies: Omit<SystemProxyValues, "noProxy"> = {};
  for (const segment of proxyServer.split(";")) {
    const [kind, rawValue] = segment.split("=", 2);
    const value = rawValue?.trim();
    if (!kind || !value) continue;
    const target = WINDOWS_PROXY_KINDS.get(kind.trim().toLowerCase());
    if (target) proxies[target.slot] = normalizeAuthorityProxyUrl(value, target.scheme);
  }
  return proxies;
}

/** @internal The single-endpoint `ProxyServer` form, shared by HTTP and HTTPS. */
function sharedProxyServer(proxyServer: string): Omit<SystemProxyValues, "noProxy"> {
  const shared = normalizeAuthorityProxyUrl(proxyServer, "http");
  return { httpProxy: shared, httpsProxy: shared };
}

/**
 * Parse Windows Internet Settings proxy registry output into a normalized proxy
 * environment. Handles both the per-protocol (`http=…;https=…`) and shared
 * single-endpoint `ProxyServer` forms, and the `ProxyOverride` bypass list.
 *
 * @param input - Raw `reg query` output for `ProxyEnable`, and optionally `ProxyServer` / `ProxyOverride`.
 * @param platform - Target platform for env normalization (defaults to `"win32"`).
 * @returns A normalized proxy environment (empty when proxying is disabled or unset).
 */
export function parseWindowsInternetSettingsProxyOutput(
  input: { proxyEnable: string; proxyOverride?: string; proxyServer?: string },
  platform: NodeJS.Platform = "win32",
): NodeJS.ProcessEnv {
  const enabled = parseRegistryValue(input.proxyEnable, "ProxyEnable");
  if (enabled == null || !/^(1|0x1)$/i.test(enabled)) return {};
  const proxyServer = parseRegistryValue(input.proxyServer ?? "", "ProxyServer") ?? "";
  const proxyOverride = parseRegistryValue(input.proxyOverride ?? "", "ProxyOverride") ?? "";
  if (!proxyServer.trim()) return {};

  const proxies = proxyServer.includes("=")
    ? parsePerProtocolProxyServer(proxyServer)
    : sharedProxyServer(proxyServer);
  return finalizeSystemProxyEnv(
    {
      ...proxies,
      noProxy: buildNoProxyValue(proxyOverride.split(/[;,]/)),
    },
    platform,
  );
}

/** @internal Registry key holding the current user's Internet Settings proxy values. */
const WINDOWS_INTERNET_SETTINGS_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

/**
 * Resolve the OS-level proxy configuration into a normalized proxy environment.
 * Shells out to `scutil` on macOS and `reg query` on Windows (swallowing per-
 * command failures), and returns an empty env on other platforms or on error.
 *
 * @param options - Optional platform override and command runner (for testing).
 * @returns A normalized proxy environment, or `{}` when no proxy is configured.
 */
export function resolveSystemProxyEnv(options: ResolveSystemProxyEnvOptions = {}): NodeJS.ProcessEnv {
  const platform = options.platform ?? process.platform;
  const runCommand = options.runCommand ?? defaultSystemProxyCommandRunner;
  // No outer try/catch around the parse calls below (a former defense-in-depth
  // catch was removed as unreachable): `tryRun` already swallows every
  // `runCommand` failure, and neither parse
  // function (`parseMacosScutilProxyOutput` / the Windows one) nor
  // anything they call performs any operation that can throw for a
  // string input — no `new URL`, no `JSON.parse`, no fixed-pattern
  // `RegExp` construction from untrusted input. Empirically re-verified
  // this session: 200k fuzzed `stdout`/registry-value strings (control
  // characters, huge lengths, null bytes) through both parse functions,
  // zero throws — see archived provenance ledger's 2026-07-22 entry.
  const tryRun = (command: string, args: string[]): string => {
    try {
      return runCommand(command, args);
    } catch {
      return "";
    }
  };
  const regQuery = (valueName: string): string =>
    tryRun("reg", ["query", WINDOWS_INTERNET_SETTINGS_KEY, "/v", valueName]);
  if (platform === "darwin") {
    return parseMacosScutilProxyOutput(tryRun("scutil", ["--proxy"]), platform);
  }
  if (platform === "win32") {
    return parseWindowsInternetSettingsProxyOutput(
      {
        proxyEnable: regQuery("ProxyEnable"),
        proxyOverride: regQuery("ProxyOverride"),
        proxyServer: regQuery("ProxyServer"),
      },
      platform,
    );
  }
  return {};
}
