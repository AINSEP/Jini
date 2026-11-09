/** @agent-note Types only. The runtime parts come from the host; this area usually from `@jini-ai/mcp/federation/hosted` (values) and `@jini-ai/integrations/api-connections/hosted-mcp` (sign-in). */
/** @agent-note Saved as plain text in the row's `transport`; the record keeps `string` so an unknown saved value still loads. Runtime tuple: `SUPPORTED_EXTERNAL_MCP_TRANSPORTS` (`@jini-ai/mcp/federation/hosted`). Never rename a literal: saved rows and admission revisions carry it. */
export type ExternalMcpTransport = "stdio" | "streamable_http";

/** @agent-note Saved in `oauthGrant` as plain text (RFC 6749/8628 grant names). Runtime tuple: `EXTERNAL_MCP_OAUTH_GRANTS`. Never rename a literal. */
export type ExternalMcpOAuthGrant = "authorization_code" | "device_code";

/** @agent-note Saved in `authMode`; readers default an absent/unknown value to `static_env` via `resolveExternalMcpAuthMode` (host-wired from `@jini-ai/mcp/federation/hosted`). Part of the admission-revision hash input, so never rename a literal. */
export type ExternalMcpAuthMode = "none" | "static_env" | "oauth";

/** @agent-note Saved in `oauthStatus`; readers default an absent/unknown value to `disconnected` via `resolveExternalMcpOAuthStatus`. Never rename a literal. */
export type ExternalMcpOAuthStatus = "disconnected" | "pending" | "connected" | "needs_reauth";

/** Why an admitted federated tool is refused on THIS call. Every value pairs with one D3 message in
 *  {@link revocationMessage} — see that lookup for the exact, test-pinned wording. */
/** @agent-note Each value keys exactly one host-supplied refusal message; the host owns the wording and its tests pin it. Adding a value requires every host message table to add one. */
export type ExternalMcpRevocationReason =
  | "removed"
  | "turned-off"
  | "disconnected"
  | "changed"
  | "tool-not-allowed"
  | "write-not-allowed"
  | "unverifiable";
