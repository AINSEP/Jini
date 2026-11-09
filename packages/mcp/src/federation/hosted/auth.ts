import type { SealedSecret } from "@jini-ai/core/contracts/vault";
import type { ExternalMcpAuthMode, ExternalMcpOAuthStatus } from "@jini-ai/core/contracts/hosted-mcp";

/**
 * @file The external-MCP domain's auth-mode readers, moved here from `features/external-mcp/external-mcp-store.ts`
 * (2026-10-03, owner decision C) so `features/agent-plugins/{connect-tool,federate-mcp}.ts` can read a
 * row's credential mode without value-importing from `src/assistant/` — the edge
 * `assistant/__tests__/domain-no-direct-tool-registration.boundary.test.ts` forbids. The store
 * and its consumers import this shared leaf directly, preserving a single vocabulary owner.
 *
 * Parameters are declared STRUCTURALLY (the two fields each reader touches) rather than as
 * `Pick<ExternalMcpServerRecord, ...>`: the record type lives in the store, which imports THIS file,
 * so naming it here would close an import cycle. `ExternalMcpServerRecord` satisfies both shapes.
 */

/**
 * How a server's credentials are obtained — independent of `ExternalMcpTransport`.
 *
 * - `none` — no credentials at all. Common for local developer tooling.
 * - `static_env` — the operator pasted a `KEY=VALUE` block. What this store has always done, and
 *   the default for every row that predates this field.
 * - `oauth` — the host holds a token it obtained itself and must keep alive. See
 *   `features/external-mcp/external-mcp-oauth.ts`.
 */
/** @agent-note Saved `authMode` literals; equals core `ExternalMcpAuthMode` both ways (pinned by test). */
export const EXTERNAL_MCP_AUTH_MODES = ["none", "static_env", "oauth"] as const;

/**
 * Reads a row's auth mode, defaulting a row written before the column existed.
 *
 * `static_env` is the correct default rather than `none`: every pre-existing row was written by a
 * form whose only credential mechanism was the env block, and a row with an empty block behaves
 * identically under either mode. Defaulting to `none` would silently relabel rows that DO carry a
 * sealed block as credential-free.
 *
 * @complexity O(1).
 */
/** @agent-note Pure, no I/O; the `static_env` default is the saved-format compatibility rule for rows older than the column. Hosts bind this exact function. */
export function resolveExternalMcpAuthMode(record: { authMode: string }): ExternalMcpAuthMode {
  const mode = record.authMode;
  return EXTERNAL_MCP_AUTH_MODES.includes(mode as ExternalMcpAuthMode) ? (mode as ExternalMcpAuthMode) : "static_env";
}

/**
 * Whether a row holds a `static_env` access token — answered from plaintext columns, never by unsealing.
 *
 * Truthful because a `static_env` row's sealed OAuth blob only ever holds that token: leaving `oauth`
 * clears the client secret and token set (`features/external-mcp/external-mcp-store.ts`'s `resolveSealedOAuthBlob`),
 * and entering `oauth` never carries this token forward (`openExternalMcpOAuthPayload`'s callers
 * rebuild the payload from `clientSecret`/`tokens` alone).
 *
 * @complexity O(1).
 */
/** @agent-note Pure, plain-text columns only; never unseals. One of the six `hostedMcpProjections`. */
export function externalMcpRecordHasStaticAccessToken(record: { authMode: string; sealedOAuth: SealedSecret | null }): boolean {
  return resolveExternalMcpAuthMode(record) === "static_env" && Boolean(record.sealedOAuth);
}

/**
 * The runtime lifecycle of an OAuth-backed connection.
 *
 * `needs_reauth` is the state that earns its place here. It is deliberately NOT the boot-time "skip
 * this row and report why" path {@link readEnabledExternalMcpConfigs} already uses for a sealed blob
 * that will not decrypt: that is a STORAGE failure, nothing the operator types can fix it, and it is
 * discovered while the daemon starts. `needs_reauth` is an expected RUNTIME lifecycle state — a
 * token expired or was revoked while everything was working — it is exactly operator-actionable, and
 * it must be visible in the admin tab rather than buried in a boot log nobody is reading at the time.
 */
/** @agent-note Saved `oauthStatus` literals; equals core `ExternalMcpOAuthStatus` both ways. */
export const EXTERNAL_MCP_OAUTH_STATUSES = ["disconnected", "pending", "connected", "needs_reauth"] as const;


/** A row's OAuth status, defaulting an absent or unrecognized value to `disconnected` — the safe
 *  direction, since it is the state in which no token is used and the operator is prompted. */
/** @agent-note Pure, no I/O; unknown defaults to `disconnected`. One of the six `hostedMcpProjections`. */
export function resolveExternalMcpOAuthStatus(record: { oauthStatus: string | null }): ExternalMcpOAuthStatus {
  const status = record.oauthStatus;
  return status !== null && EXTERNAL_MCP_OAUTH_STATUSES.includes(status as ExternalMcpOAuthStatus)
    ? (status as ExternalMcpOAuthStatus)
    : "disconnected";
}
