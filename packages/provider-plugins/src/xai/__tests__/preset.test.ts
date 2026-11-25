import { describe, expect, it } from 'vitest';
import { beginOAuthPkce, PendingAuthCache } from '@jini-ai/agent-runtime';
import {
  XAI_OAUTH_PROVIDER_CONFIG,
  XAI_OAUTH_PROVIDER_ID,
  XAI_OAUTH_REDIRECT_HOST,
  XAI_OAUTH_REDIRECT_PATH,
  XAI_OAUTH_REDIRECT_PORT,
  xaiOAuthRedirectUri,
} from '../preset.js';

describe('XAI_OAUTH_PROVIDER_CONFIG preset', () => {
  it('has the expected fixed issuer/endpoints/client id/scope', () => {
    expect(XAI_OAUTH_PROVIDER_CONFIG.providerId).toBe(XAI_OAUTH_PROVIDER_ID);
    expect(XAI_OAUTH_PROVIDER_CONFIG.issuer).toBe('https://auth.x.ai');
    expect(XAI_OAUTH_PROVIDER_CONFIG.authorizationEndpoint).toBe('https://auth.x.ai/oauth2/authorize');
    expect(XAI_OAUTH_PROVIDER_CONFIG.tokenEndpoint).toBe('https://auth.x.ai/oauth2/token');
    expect(XAI_OAUTH_PROVIDER_CONFIG.clientId.length).toBeGreaterThan(0);
    expect(XAI_OAUTH_PROVIDER_CONFIG.scope).toContain('grok-cli:access');
  });

  it('xaiOAuthRedirectUri() builds the fixed loopback redirect uri', () => {
    expect(xaiOAuthRedirectUri()).toBe(
      `http://${XAI_OAUTH_REDIRECT_HOST}:${XAI_OAUTH_REDIRECT_PORT}${XAI_OAUTH_REDIRECT_PATH}`,
    );
    expect(xaiOAuthRedirectUri()).toBe('http://127.0.0.1:56121/callback');
  });

  it('can begin a real authorize-url dance against the xAI preset', () => {
    const pending = new PendingAuthCache();
    const result = beginOAuthPkce({
      config: XAI_OAUTH_PROVIDER_CONFIG,
      pending,
      redirectUri: xaiOAuthRedirectUri(),
    });
    expect(result.authorizeUrl).toContain('https://auth.x.ai/oauth2/authorize');
    pending.stop();
  });
});
