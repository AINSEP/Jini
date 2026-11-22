import { isLoopbackHostname } from '@jini-ai/core/net';
import type { McpAuthMode, McpServerConfig } from './config.js';

export function isPlainObject(required: { v: unknown }, _optional: Record<string, never> = {}): required is { v: Record<string, unknown> } {
  const { v } = required;
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

// The shared classifier receives the URL parser's canonical hostname; IPv4-mapped
// IPv6 is deliberately not a loopback exception for default authentication.
/**
 * Infer the appropriate `McpAuthMode` for a given server URL.
 * Returns `'none'` for loopback targets (localhost, 127.x.x.x, ::1)
 * and `'oauth'` for everything else, including when `rawUrl` is absent or unparseable.
 * @param rawUrl The server URL string to inspect, if any.
 * @returns The inferred `McpAuthMode`.
 */
export function inferMcpAuthModeForUrl({ rawUrl }: { rawUrl: string | undefined }): McpAuthMode {
  if (!rawUrl) return 'oauth';
  try {
    return isLoopbackHostname({ hostname: new URL(rawUrl).hostname }) ? 'none' : 'oauth';
  } catch {
    return 'oauth';
  }
}

// Only ever invoked for http/sse servers (the callers gate on transport), so
// there is no stdio short-circuit here — the token merge just needs the
// effective auth mode for a remote server.
function effectiveMcpAuthMode(server: McpServerConfig): McpAuthMode {
  return server.authMode ?? inferMcpAuthModeForUrl({ rawUrl: server.url });
}

/** `{ [key]: value }` when `value` has at least one element/key, else `{}` — for spreading optional fields. */
export function nonEmptyField({ key, value }: { key: string; value: object | undefined }): Record<string, unknown> {
  return value && Object.keys(value).length > 0 ? { [key]: value } : {};
}

/** `{ headers }` for a remote server (user headers + its own stored OAuth bearer), or `{}` when empty. */
export function remoteHeadersField({ server, tokens }: { server: McpServerConfig; tokens: Record<string, string> }, _options = {}): Record<string, unknown> {
  const bearer = effectiveMcpAuthMode(server) === 'oauth' && Object.hasOwn(tokens, server.id) ? tokens[server.id] : undefined;
  return nonEmptyField({ key: 'headers', value: mergeAuthHeader(server.headers, bearer) });
}

/** Build a headers object that includes the daemon-issued bearer token when
 * the user hasn't already supplied a NON-EMPTY Authorization header. A
 * blank Authorization (empty string / whitespace only) is treated as
 * "not pinned" — historically the template UI persisted empty values from
 * unfilled fields, and we never want a blank Authorization to suppress a
 * valid OAuth Bearer (the upstream MCP would refuse the connection and
 * fall back to its in-tool re-auth dance). Real user-pinned values still
 * win so manually-set PATs aren't silently overwritten. */
function mergeAuthHeader(
  existing: Record<string, string> | undefined,
  bearer: string | undefined,
): Record<string, string> | undefined {
  const merged: Record<string, string> = {};
  let userAuth = false;
  for (const [k, v] of Object.entries(existing ?? {})) {
    const isAuth = k.toLowerCase() === 'authorization';
    // empty / whitespace authorization is ignored, NOT carried through
    if (isAuth && (typeof v !== 'string' || v.trim() === '')) continue;
    userAuth ||= isAuth;
    merged[k] = v;
  }
  if (bearer && !userAuth) {
    merged['Authorization'] = `Bearer ${bearer}`;
  }
  return merged;
}

