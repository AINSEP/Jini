/**
 * @file The public mount point and absolute URL for the external-MCP OAuth callback.
 *
 * Mirrors the connector callback URL builder exactly, including WHY it exists as its own
 * module: the connect route and the callback route must never drift apart, and a mismatch would
 * send the authorization server to a URL nothing serves — a failure that looks like a provider
 * problem and is not.
 *
 * The path lives OUTSIDE `/api/admin` because the host's session cookie is `SameSite=Strict`, so a
 * top-level redirect arriving from the provider's origin carries no cookie and would be rejected by
 * the admin session gate before any handler ran. What authenticates the request instead is sealed,
 * expiring, connection-bound `state` plus the provider's single-use code, with a per-IP rate limiter
 * in front as defence in depth. This same URL is reconstructed on the callback to check the exact
 * redirect URI before exchanging the code.
 */

/** Public, non-admin mount point. */
export const EXTERNAL_MCP_OAUTH_CALLBACK_PATH = "/api/mcp-servers/oauth/callback";

/**
 * The absolute callback URL for one external MCP connection, under the host's public `origin`.
 *
 * The server id travels in the PATH rather than a query parameter because an authorization server
 * appends its own `state`/`code`/`error` parameters to whatever it is given; keeping the host's own
 * routing information in the path keeps the two namespaces from colliding.
 *
 * @complexity O(1).
 */
export function externalMcpOAuthCallbackUrl({ origin, serverId }: { origin: string; serverId: string }, _optional = {}): string {
  return `${origin}${EXTERNAL_MCP_OAUTH_CALLBACK_PATH}/${encodeURIComponent(serverId)}`;
}
