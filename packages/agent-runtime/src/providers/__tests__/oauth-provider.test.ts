import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  XAI_OAUTH_PROVIDER_CONFIG,
  XAI_OAUTH_PROVIDER_ID,
  XAI_OAUTH_REDIRECT_HOST,
  XAI_OAUTH_REDIRECT_PATH,
  XAI_OAUTH_REDIRECT_PORT,
  beginOAuthPkce,
  completeOAuthPkce,
  refreshOAuthPkceToken,
  xaiOAuthRedirectUri,
  type OAuthPkceProviderConfig,
} from '../oauth-provider.js';
import { PendingAuthCache } from '../pkce.js';

afterEach(() => vi.unstubAllGlobals());

const testConfig: OAuthPkceProviderConfig = {
  providerId: 'test-provider',
  issuer: 'https://auth.example.com',
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  clientId: 'client-1',
  scope: 'openid profile',
};

describe('beginOAuthPkce', () => {
  it('mints a state/verifier pair, stashes it in pending, and returns an authorize url', () => {
    const pending = new PendingAuthCache();
    const result = beginOAuthPkce({
      config: testConfig,
      pending,
      redirectUri: 'http://127.0.0.1:5555/callback',
    });
    expect(result.authorizeUrl).toContain('https://auth.example.com/authorize');
    expect(result.state.length).toBeGreaterThan(0);
    const stashed = pending.consume({ state: result.state });
    expect(stashed?.serverId).toBe('test-provider');
    expect(stashed?.clientId).toBe('client-1');
    expect(stashed?.redirectUri).toBe('http://127.0.0.1:5555/callback');
    pending.stop();
  });
});

describe('completeOAuthPkce', () => {
  it('exchanges the code for a token when state matches', async () => {
    const pending = new PendingAuthCache();
    const { state } = beginOAuthPkce({ config: testConfig, pending, redirectUri: 'http://127.0.0.1:5555/callback' });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'at-1' })));
    const token = await completeOAuthPkce({ config: testConfig, pending, state, code: 'code-1' }, { fetchImpl });
    expect(token.access_token).toBe('at-1');
    pending.stop();
  });

  it('throws when state is unknown or already consumed', async () => {
    const pending = new PendingAuthCache();
    await expect(
      completeOAuthPkce({ config: testConfig, pending, state: 'nope', code: 'x' }),
    ).rejects.toThrow(/state not found or expired/);
    pending.stop();
  });

  it('throws on a provider/state mismatch', async () => {
    const pendingA = new PendingAuthCache();
    const otherConfig: OAuthPkceProviderConfig = { ...testConfig, providerId: 'other-provider' };
    const { state } = beginOAuthPkce({ config: otherConfig, pending: pendingA, redirectUri: 'http://127.0.0.1:5555/callback' });
    await expect(
      completeOAuthPkce({ config: testConfig, pending: pendingA, state, code: 'x' }),
    ).rejects.toThrow(/state mismatch/);
    pendingA.stop();
  });

  it('defaults fetchImpl to the global fetch', async () => {
    const pending = new PendingAuthCache();
    const { state } = beginOAuthPkce({ config: testConfig, pending, redirectUri: 'http://127.0.0.1:5555/callback' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'at-2' })));
    vi.stubGlobal('fetch', fetchMock);
    await completeOAuthPkce({ config: testConfig, pending, state, code: 'code-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    pending.stop();
  });
});

describe('refreshOAuthPkceToken', () => {
  it('posts a refresh_token grant to the token endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'at-3' })));
    const token = await refreshOAuthPkceToken({ config: testConfig, refreshToken: 'rt-1' }, { fetchImpl });
    expect(token.access_token).toBe('at-3');
    const [, init] = fetchImpl.mock.calls[0]!;
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-1');
  });

  it('defaults fetchImpl to the global fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'at-4' })));
    vi.stubGlobal('fetch', fetchMock);
    await refreshOAuthPkceToken({ config: testConfig, refreshToken: 'rt-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

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
