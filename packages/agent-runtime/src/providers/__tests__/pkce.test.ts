import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PendingAuthCache,
  buildAuthorizeUrl,
  deriveCodeChallenge,
  exchangeCodeForToken,
  generateCodeVerifier,
  generateState,
  refreshAccessToken,
  type PendingAuthState,
} from '../pkce.js';

describe('generateCodeVerifier / deriveCodeChallenge / generateState', () => {
  it('generates a base64url verifier of the expected length with no padding', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBeGreaterThan(40);
  });

  it('derives a deterministic S256 challenge for a given verifier', () => {
    const challenge1 = deriveCodeChallenge({ verifier: 'a'.repeat(43) });
    const challenge2 = deriveCodeChallenge({ verifier: 'a'.repeat(43) });
    expect(challenge1).toBe(challenge2);
    expect(challenge1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates a base64url state value', () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates distinct verifiers/states across calls', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
    expect(generateState()).not.toBe(generateState());
  });
});

describe('buildAuthorizeUrl', () => {
  const authServer = {
    issuer: 'https://auth.example.com',
    authorization_endpoint: 'https://auth.example.com/authorize',
    token_endpoint: 'https://auth.example.com/token',
  };

  it('builds a url with the required PKCE params', () => {
    const url = buildAuthorizeUrl({ authServer, clientId: 'client-1', redirectUri: 'http://127.0.0.1:5555/callback', state: 'state-1', codeChallenge: 'challenge-1' });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://auth.example.com/authorize');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('client-1');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5555/callback');
    expect(parsed.searchParams.get('state')).toBe('state-1');
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.has('scope')).toBe(false);
    expect(parsed.searchParams.has('resource')).toBe(false);
  });

  it('includes scope and resource when supplied', () => {
    const url = buildAuthorizeUrl({ authServer, clientId: 'client-1', redirectUri: 'http://127.0.0.1:5555/callback', state: 'state-1', codeChallenge: 'challenge-1' }, { scope: 'a b', resource: 'https://api.example.com' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('scope')).toBe('a b');
    expect(parsed.searchParams.get('resource')).toBe('https://api.example.com');
  });
});

describe('exchangeCodeForToken / refreshAccessToken', () => {
  it('exchanges a code for a token via the correct grant_type and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ access_token: 'at-1', token_type: 'Bearer', expires_in: 3600 }));
    const result = await exchangeCodeForToken({ input: {
        tokenEndpoint: 'https://auth.example.com/token',
        clientId: 'client-1',
        redirectUri: 'http://127.0.0.1:5555/callback',
        code: 'code-1',
        codeVerifier: 'verifier-1',
      } }, { fetchImpl: fetchMock }
    );
    expect(result.access_token).toBe('at-1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://auth.example.com/token');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-1');
    expect(body.get('code_verifier')).toBe('verifier-1');
    expect(init.headers['authorization']).toBeUndefined();
  });

  it('includes a resource indicator and confidential-client basic auth when supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ access_token: 'at-2' }));
    await exchangeCodeForToken({ input: {
        tokenEndpoint: 'https://auth.example.com/token',
        clientId: 'client-1',
        clientSecret: 'secret-1',
        redirectUri: 'http://127.0.0.1:5555/callback',
        code: 'code-1',
        codeVerifier: 'verifier-1',
        resource: 'https://api.example.com',
      } }, { fetchImpl: fetchMock }
    );
    const [, init] = fetchMock.mock.calls[0]!;
    const body = new URLSearchParams(init.body as string);
    expect(body.get('resource')).toBe('https://api.example.com');
    expect(init.headers['authorization']).toBe(`Basic ${Buffer.from('client-1:secret-1').toString('base64')}`);
  });

  it('refreshes an access token via grant_type=refresh_token, including optional scope/resource', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ access_token: 'at-3' }));
    await refreshAccessToken({ input: {
        tokenEndpoint: 'https://auth.example.com/token',
        clientId: 'client-1',
        refreshToken: 'rt-1',
        scope: 'a b',
        resource: 'https://api.example.com',
      } }, { fetchImpl: fetchMock }
    );
    const [, init] = fetchMock.mock.calls[0]!;
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-1');
    expect(body.get('scope')).toBe('a b');
    expect(body.get('resource')).toBe('https://api.example.com');
  });

  it('defaults fetchImpl to the global fetch when not supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ access_token: 'at-4' }));
    vi.stubGlobal('fetch', fetchMock);
    await exchangeCodeForToken({ input: {
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'client-1',
      redirectUri: 'http://127.0.0.1:5555/callback',
      code: 'code-1',
      codeVerifier: 'verifier-1',
    } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('throws with the response status/text on a non-ok token response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    await expect(
      exchangeCodeForToken({ input: {
          tokenEndpoint: 'https://auth.example.com/token',
          clientId: 'client-1',
          redirectUri: 'http://127.0.0.1:5555/callback',
          code: 'bad-code',
          codeVerifier: 'verifier-1',
        } }, { fetchImpl: fetchMock }
      ),
    ).rejects.toMatchObject({ code: 'OAUTH_INVALID_GRANT', message: 'the authorization server refused the request (HTTP 400, invalid_grant)' });
  });

  it('propagates a failed body read without exposing an upstream response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.error(new Error('stream closed')); } }), { status: 500 }));
    await expect(
      exchangeCodeForToken({ input: {
          tokenEndpoint: 'https://auth.example.com/token',
          clientId: 'client-1',
          redirectUri: 'http://127.0.0.1:5555/callback',
          code: 'x',
          codeVerifier: 'y',
        } }, { fetchImpl: fetchMock }
      ),
    ).rejects.toThrow('stream closed');
  });

  it('throws when the token endpoint response has no access_token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ token_type: 'Bearer' }));
    await expect(
      exchangeCodeForToken({ input: {
          tokenEndpoint: 'https://auth.example.com/token',
          clientId: 'client-1',
          redirectUri: 'http://127.0.0.1:5555/callback',
          code: 'x',
          codeVerifier: 'y',
        } }, { fetchImpl: fetchMock }
      ),
    ).rejects.toMatchObject({ code: 'OAUTH_MALFORMED_RESPONSE', message: "the authorization server's response contained no access token" });
  });
});

describe('PendingAuthCache', () => {
  const state = (overrides: Partial<PendingAuthState> = {}): PendingAuthState => ({
    serverId: 'p1',
    authServerIssuer: 'https://auth.example.com',
    tokenEndpoint: 'https://auth.example.com/token',
    clientId: 'client-1',
    redirectUri: 'http://127.0.0.1:5555/callback',
    codeVerifier: 'verifier-1',
    createdAt: Date.now(),
    ...overrides,
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and one-shot consumes a pending state', () => {
    const cache = new PendingAuthCache();
    cache.put({ state: 'state-1', value: state() });
    expect(cache.size()).toBe(1);
    expect(cache.consume({ state: 'state-1' })?.clientId).toBe('client-1');
    expect(cache.consume({ state: 'state-1' })).toBeNull();
    cache.stop();
  });

  it('returns null for an unknown state', () => {
    const cache = new PendingAuthCache();
    expect(cache.consume({ state: 'nope' })).toBeNull();
    cache.stop();
  });

  it('treats an entry older than the ttl as expired even if still present in the store', () => {
    // Jump the system clock without advancing timers, so the sweeper's own
    // interval never fires and doesn't delete the entry first — this
    // isolates consume()'s own TTL check (as opposed to the sweeper's).
    const start = Date.now();
    const cache = new PendingAuthCache({}, { ttlMs: 1000 });
    cache.put({ state: 'state-1', value: state({ createdAt: start }) });
    vi.setSystemTime(start + 1001);
    expect(cache.consume({ state: 'state-1' })).toBeNull();
    cache.stop();
  });

  it('sweeps expired entries on its own timer and stops the sweeper once empty', () => {
    const cache = new PendingAuthCache({}, { ttlMs: 100 });
    cache.put({ state: 'state-1', value: state() });
    expect(cache.size()).toBe(1);
    vi.advanceTimersByTime(60_000 + 1);
    expect(cache.size()).toBe(0);
  });

  it('does not restart an already-running sweeper on a second put', () => {
    const cache = new PendingAuthCache({}, { ttlMs: 10_000 });
    cache.put({ state: 'state-1', value: state() });
    cache.put({ state: 'state-2', value: state() });
    expect(cache.size()).toBe(2);
    cache.stop();
  });

  it('stop() is idempotent and safe when never started', () => {
    const cache = new PendingAuthCache();
    expect(() => cache.stop()).not.toThrow();
    expect(() => cache.stop()).not.toThrow();
  });
});

// REGRESSION: fails if the runtime returns to the unguarded fixed-issuer token request.
it('refuses plaintext remote token endpoints before invoking fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ access_token: 'must-not-be-used' }));
    await expect(refreshAccessToken({ input: { tokenEndpoint: 'http://auth.example.com/token',
        clientId: 'client', refreshToken: 'rt' } }, { fetchImpl }))
        .rejects.toMatchObject({ code: 'OAUTH_UNSAFE_ENDPOINT' });
    expect(fetchImpl).not.toHaveBeenCalled();
});
// PARITY: provider entropy stays at 64 bytes even though the main OAuth API defaults to 32.
it('retains an 86-character provider verifier', () => {
    expect(generateCodeVerifier()).toHaveLength(86);
});

// REGRESSION: fails if runtime deriveCodeChallenge returns to the arbitrary-string hash helper.
it('rejects non-RFC verifier strings rather than silently hashing them', () => {
    expect(() => deriveCodeChallenge({ verifier: 'short' })).toThrow('PKCE code verifier must be');
});
// PARITY: normalize and adapt expiry without rounding the provider's fractional seconds.
it('keeps fractional token lifetime in the persisted wire DTO', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ access_token: 'at', expires_in: 1.5 }));
    const tokens = await refreshAccessToken({ input: { tokenEndpoint: 'https://auth.example.com/token',
        clientId: 'client', refreshToken: 'rt' } }, { fetchImpl });
    expect(tokens.expires_in).toBe(1.5);
    expect(tokens.refresh_token).toBe('rt');
    expect(tokens.token_type).toBe('Bearer');
});

// REGRESSION: fails if runtime refresh delegates to the unbounded raw-wire JSON reader.
it('rejects an oversized provider token response through the main OAuth byte cap', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ access_token: 'a'.repeat(65537) }));
    await expect(refreshAccessToken({ input: { tokenEndpoint: 'https://auth.example.com/token',
        clientId: 'client', refreshToken: 'rt' } }, { fetchImpl }))
        .rejects.toMatchObject({ code: 'OAUTH_MALFORMED_RESPONSE' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![1]?.redirect).toBe('error');
    expect(fetchImpl.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
});
