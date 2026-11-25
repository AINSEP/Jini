/** @file The concrete xAI OAuth (PKCE) preset: provider config, fixed loopback redirect and redirect-URI helper. Moved here from
 * `@jini-ai/agent-runtime`'s generic `providers/oauth-provider.ts`, which keeps the config-driven mechanics. */
import type { OAuthPkceProviderConfig } from './oauth-port.js';

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
