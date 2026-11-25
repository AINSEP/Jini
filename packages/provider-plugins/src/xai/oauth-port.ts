/** @file The generic OAuth (PKCE) mechanics the xAI routes call, stated as one injected port. The host binds it (the OAuth
 * functions of `@jini-ai/agent-runtime`, which keeps owning them) and proves the match with `satisfies OAuthPkceFlowPort`.
 * The OAuth types are restated here from `@jini-ai/agent-runtime/providers/{oauth-provider,oauth-tokens,oauth-credentials,oauth-callback-server,pkce}`
 * so this plugin imports no agent-runtime implementation. The xAI preset itself lives in `./preset.ts`. */

/** A provider's OAuth+PKCE client config. */
export interface OAuthPkceProviderConfig {
  /** Stable id used to key the token in any per-provider cache and to guard against state/provider mismatch. */
  providerId: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scope: string;
}

/** RFC 6749 §5.1 token endpoint response (subset). */
export interface OAuthTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * Stored OAuth token. Mirrors the relevant subset of an OAuth 2.0 token-endpoint response (RFC 6749 §5.1).
 * `client_id`, `redirect_uri`, and `issuer` aren't persisted because they're constants in the provider's own config.
 */
export interface StoredOAuthToken {
  /** The bearer token to send as `Authorization: Bearer ...`. */
  accessToken: string;
  /** Refresh token (RFC 6749 §6) if the auth server issued one. */
  refreshToken?: string;
  /** Absolute epoch ms at which `accessToken` expires. Optional: some providers never expire. */
  expiresAt?: number;
  /** RFC 6749 §5.1 token_type. Almost always `Bearer`. */
  tokenType: string;
  /** Space-separated scopes granted (verbatim from the token response). */
  scope?: string;
  /** Wall-clock epoch ms when this record was first persisted. */
  savedAt: number;
}

export interface ResolvedOAuthCredential {
  accessToken: string;
  /** Whether this came back unchanged from disk or was refreshed inline. */
  source: 'stored' | 'refreshed';
}

export type OAuthCallbackOutcome =
  | { kind: 'ok'; code: string; state: string }
  | { kind: 'error'; error: string; state?: string };

export interface OAuthCallbackListener {
  /** Where the listener is actually bound (informational, esp. for tests). */
  readonly address: { host: string; port: number };
  /** Stops the listener early (e.g. the user cancelled OAuth in the UI). */
  stop(): Promise<void>;
}

/** The in-memory pending-authorization cache behind the begin/complete dance. The daemon only reads it; `begin` fills it. */
export interface OAuthPendingAuthorizations {
  /** One-shot: removes the state before returning it, so a callback replay cannot reuse it. */
  consume(required: { state: string }): unknown;
  size(): number;
  /** Stops the cache's background sweeper. */
  stop(): void;
}

/** `Pending` is the host's concrete cache: `begin` fills the cache that `createPendingCache` made, so a host states its own
 * class (`OAuthPkceFlowPort<PendingAuthCache>`) and the check against the real functions stays exact. The routes take the default. */
export interface OAuthPkceFlowPort<Pending extends OAuthPendingAuthorizations = OAuthPendingAuthorizations> {
  begin(required: { config: OAuthPkceProviderConfig; pending: Pending; redirectUri: string }): { authorizeUrl: string; state: string };
  /** Throws when `state` is unknown, expired, already consumed, or issued for a different provider. */
  complete(
    required: { config: OAuthPkceProviderConfig; pending: Pending; state: string; code: string },
    optional?: { fetchImpl?: typeof fetch },
  ): Promise<OAuthTokenResponse>;
  readonly tokens: {
    /** `null` when none is stored (or the persisted entry is malformed). */
    get(required: { dataDir: string; fileName: string }): Promise<StoredOAuthToken | null>;
    set(required: { dataDir: string; fileName: string; token: StoredOAuthToken }): Promise<void>;
    /** A no-op when absent. */
    clear(required: { dataDir: string; fileName: string }): Promise<void>;
  };
  /** A usable bearer, refreshed in place when near expiry; `null` when nothing is stored or the refresh fails. */
  resolveBearer(
    required: { config: OAuthPkceProviderConfig; tokenFileName: string; dataDir: string },
    optional?: { fetchImpl?: typeof fetch },
  ): Promise<ResolvedOAuthCredential | null>;
  /** Opens the one-shot loopback listener for the OAuth redirect; it self-closes after the first matching callback or the timeout. */
  startCallbackListener(
    required: { host: string; port: number; path: string; expectedState: string; onCallback: (outcome: OAuthCallbackOutcome) => Promise<void> | void },
    optional?: { timeoutMs?: number },
  ): Promise<OAuthCallbackListener>;
  createPendingCache(required?: Record<string, never>, optional?: { ttlMs?: number }): Pending;
}
