/**
 * @module providers/oauth-provider
 *
 * Generic OAuth Authorization Code + PKCE provider dance (begin / complete /
 * refresh), parameterized over any fixed-issuer OAuth server — no Dynamic
 * Client Registration or MCP-resource discovery involved (that's
 * `mcp-oauth.ts`'s separate, unported concern; see `pkce.ts`'s doc comment).
 *
 * Ported from OD's `integrations/xai-oauth.ts`, generalized: the origin
 * hardcoded xAI's issuer/endpoints/client_id/scope/redirect port directly
 * into module-level constants and function names (`beginXAIAuth`,
 * `XAI_OAUTH_CLIENT_ID`, ...) because it only ever needed to talk to one
 * OAuth server. That shape doesn't generalize to "any BYOK provider that
 * happens to use OAuth+PKCE instead of a bare API key" — the actual
 * generic-provider-material classification this task asked for — so the
 * dance is now a config-driven `beginOAuthPkce`/`completeOAuthPkce`/
 * `refreshOAuthPkceToken` triad taking an {@link OAuthPkceProviderConfig},
 * with `XAI_OAUTH_PROVIDER_CONFIG` kept as the one concrete preset the
 * origin actually shipped (same pattern this package already uses for
 * `RuntimeAgentDef` — a generic contract type plus concrete `defs/*`
 * instances).
 */
import {
  buildAuthorizeUrl,
  deriveCodeChallenge,
  exchangeCodeForToken,
  generateCodeVerifier,
  generateState,
  refreshAccessToken,
  type AuthorizationServerMetadata,
  type OAuthTokenResponse,
  type PendingAuthCache,
  type PendingAuthState,
} from './pkce.js';

export interface OAuthPkceProviderConfig {
  /** Stable id used to key the token in any per-provider cache and to guard against state/provider mismatch. */
  providerId: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scope: string;
}

export interface BeginOAuthPkceInput {
  config: OAuthPkceProviderConfig;
  pending: PendingAuthCache;
  redirectUri: string;
}

export interface BeginOAuthPkceResult {
  authorizeUrl: string;
  state: string;
}

function authServerMetadata(config: OAuthPkceProviderConfig): AuthorizationServerMetadata {
  return {
    issuer: config.issuer,
    authorization_endpoint: config.authorizationEndpoint,
    token_endpoint: config.tokenEndpoint,
  };
}

/**
 * Pre-redirect half of the OAuth dance. Mints a PKCE verifier/challenge,
 * builds the authorize URL, and stashes the pending state in `pending`.
 *
 * The caller is responsible for sending the user's browser to
 * `authorizeUrl` and receiving the callback at `redirectUri`. When the
 * callback arrives, pass `state` and `code` to {@link completeOAuthPkce}.
 */
export function beginOAuthPkce(input: BeginOAuthPkceInput): BeginOAuthPkceResult {
  const { config, pending, redirectUri } = input;
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = deriveCodeChallenge({ verifier: codeVerifier });
  const state = generateState();

  const authorizeUrl = buildAuthorizeUrl({ authServer: authServerMetadata(config), clientId: config.clientId, redirectUri, state, codeChallenge }, { scope: config.scope });

  const pendingState: PendingAuthState = {
    serverId: config.providerId,
    authServerIssuer: config.issuer,
    tokenEndpoint: config.tokenEndpoint,
    clientId: config.clientId,
    redirectUri,
    codeVerifier,
    scope: config.scope,
    createdAt: Date.now(),
  };

  pending.put({ state: state, value: pendingState });
  return { authorizeUrl, state };
}

export interface CompleteOAuthPkceInput {
  config: OAuthPkceProviderConfig;
  pending: PendingAuthCache;
  state: string;
  code: string;
  fetchImpl?: typeof fetch;
}

/**
 * Post-callback half of the OAuth dance. Looks up `state` in `pending`,
 * validates it (one-shot, TTL-checked by {@link PendingAuthCache}), and
 * exchanges `code` for tokens. Throws if `state` is unknown, expired,
 * already consumed, or was issued for a different provider.
 */
export async function completeOAuthPkce(requiredArgs: Pick<CompleteOAuthPkceInput, "config" | "pending" | "state" | "code">, optionalArgs: Omit<CompleteOAuthPkceInput, "config" | "pending" | "state" | "code"> = {}
): Promise<OAuthTokenResponse> {
  const input: CompleteOAuthPkceInput = { ...optionalArgs, ...requiredArgs };
  const consumed = input.pending.consume({ state: input.state });
  if (!consumed) {
    throw new Error(`${input.config.providerId} OAuth state not found or expired`);
  }
  if (consumed.serverId !== input.config.providerId) {
    throw new Error(
      `${input.config.providerId} OAuth state mismatch: expected serverId=${input.config.providerId}, got ${consumed.serverId}`,
    );
  }
  return exchangeCodeForToken({ input: {
      tokenEndpoint: consumed.tokenEndpoint,
      clientId: consumed.clientId,
      redirectUri: consumed.redirectUri,
      code: input.code,
      codeVerifier: consumed.codeVerifier,
    } }, { fetchImpl: input.fetchImpl ?? fetch }
  );
}

export interface RefreshOAuthPkceInput {
  config: OAuthPkceProviderConfig;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}

/**
 * Refreshes an existing access token. The refresh_token is bound to the
 * client_id that originally received it (RFC 6749 §6); since the same fixed
 * client_id is always used, it doesn't need to be persisted per-token.
 */
export async function refreshOAuthPkceToken(requiredArgs: Pick<RefreshOAuthPkceInput, "config" | "refreshToken">, optionalArgs: Omit<RefreshOAuthPkceInput, "config" | "refreshToken"> = {}
): Promise<OAuthTokenResponse> {
  const input: RefreshOAuthPkceInput = { ...optionalArgs, ...requiredArgs };
  return refreshAccessToken({ input: {
      tokenEndpoint: input.config.tokenEndpoint,
      clientId: input.config.clientId,
      refreshToken: input.refreshToken,
    } }, { fetchImpl: input.fetchImpl ?? fetch }
  );
}

// ---------------------------------------------------------------------------
// Concrete preset: the one OAuth+PKCE provider the origin actually shipped.
// ---------------------------------------------------------------------------

/** Stable provider id used to key an xAI token in any per-provider cache. */
export const XAI_OAUTH_PROVIDER_ID = 'xai';

export const XAI_OAUTH_REDIRECT_HOST = '127.0.0.1';
export const XAI_OAUTH_REDIRECT_PORT = 56121;
export const XAI_OAUTH_REDIRECT_PATH = '/callback';

/**
 * xAI Grok OAuth 2.0 + PKCE provider config. xAI doesn't speak MCP and
 * doesn't expose Dynamic Client Registration, so the issuer / endpoints /
 * client_id / scope are hardcoded rather than discovered — same as the
 * origin.
 *
 * `clientId` is a proof-of-concept id reused from NousResearch/hermes-agent
 * (xAI does not publish a public application-registration flow); a
 * consumer that provisions its own client_id with xAI should override this
 * field rather than edit the constant.
 */
export const XAI_OAUTH_PROVIDER_CONFIG: OAuthPkceProviderConfig = {
  providerId: XAI_OAUTH_PROVIDER_ID,
  issuer: 'https://auth.x.ai',
  authorizationEndpoint: 'https://auth.x.ai/oauth2/authorize',
  tokenEndpoint: 'https://auth.x.ai/oauth2/token',
  clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
  scope: 'openid profile email offline_access grok-cli:access api:access',
};

/** The fixed loopback redirect URI xAI's client_id is registered against. */
export function xaiOAuthRedirectUri(): string {
  return `http://${XAI_OAUTH_REDIRECT_HOST}:${XAI_OAUTH_REDIRECT_PORT}${XAI_OAUTH_REDIRECT_PATH}`;
}
