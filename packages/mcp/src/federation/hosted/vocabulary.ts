/** @agent-note Node entry: values for hosted MCP connections. Types come from `@jini-ai/core/contracts/hosted-mcp`; the host wires these values into its store, plugin and sign-in seams. No other Jini package is imported. */
/**
 * Both transports are federated. `stdio` is served by `mcp-federation/adapter.stdio.ts` (a local
 * child process); `streamable_http` by `mcp-federation/adapter.http.ts` (a hosted endpoint, with a
 * bearer header when the row is OAuth- or access-token-authenticated — see `resolveHttpTarget`).
 * {@link readEnabledExternalMcpConfigs} resolves a hosted row to a `streamable_http` target,
 * `toFederatedLaunchSpec` maps it to a `{ url, headers }` launch spec, and
 * `mcp-federation/bootstrap.ts`'s `defaultConnect` picks the HTTP adapter from that spec's shape.
 * A hosted row is reported unusable only when it has no URL or its token cannot be resolved.
 */
/** @agent-note Literal tuple of the saved `transport` values; must equal core `ExternalMcpTransport` both ways (pinned by test). Order is not semantic. */
export const SUPPORTED_EXTERNAL_MCP_TRANSPORTS = ["stdio", "streamable_http"] as const;

/** Which OAuth grant an operator chose. Mirrors `src/platform/oauth/`'s `OAuthGrantKind`; restated rather
 *  than imported so the stored row shape does not depend on the flow module. */
/** @agent-note Literal tuple of the saved `oauthGrant` values; must equal core `ExternalMcpOAuthGrant` both ways. */
export const EXTERNAL_MCP_OAUTH_GRANTS = ["authorization_code", "device_code"] as const;
