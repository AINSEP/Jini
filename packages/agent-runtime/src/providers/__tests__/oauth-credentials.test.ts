import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveOAuthBearer } from '../oauth-credentials.js';
import { getStoredOAuthToken, setStoredOAuthToken } from '../oauth-tokens.js';
import type { OAuthPkceProviderConfig } from '../oauth-provider.js';

const FILE_NAME = 'creds-test-tokens.json';
const config: OAuthPkceProviderConfig = {
  providerId: 'test-provider',
  issuer: 'https://auth.example.com',
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  clientId: 'client-1',
  scope: 'openid',
};

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'oauth-creds-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dataDir, { recursive: true, force: true });
});

describe('resolveOAuthBearer', () => {
  it('returns null when nothing is stored', async () => {
    await expect(resolveOAuthBearer({ config: config, tokenFileName: FILE_NAME, dataDir: dataDir })).resolves.toBeNull();
  });

  it('returns the stored token unchanged when not expired', async () => {
    await setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: {
      accessToken: 'at-1',
      tokenType: 'Bearer',
      savedAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000,
    } });
    const result = await resolveOAuthBearer({ config: config, tokenFileName: FILE_NAME, dataDir: dataDir });
    expect(result).toEqual({ accessToken: 'at-1', source: 'stored' });
  });

  it('returns the stored token unchanged when it never expires (no expiresAt)', async () => {
    await setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: { accessToken: 'at-1', tokenType: 'Bearer', savedAt: Date.now() } });
    const result = await resolveOAuthBearer({ config: config, tokenFileName: FILE_NAME, dataDir: dataDir });
    expect(result).toEqual({ accessToken: 'at-1', source: 'stored' });
  });

  it('returns null when expired with no refresh token', async () => {
    await setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: {
      accessToken: 'at-1',
      tokenType: 'Bearer',
      savedAt: Date.now(),
      expiresAt: Date.now() - 1,
    } });
    await expect(resolveOAuthBearer({ config: config, tokenFileName: FILE_NAME, dataDir: dataDir })).resolves.toBeNull();
  });

  it('refreshes in place when expired with a refresh token, persisting the new token', async () => {
    await setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: {
      accessToken: 'stale',
      tokenType: 'Bearer',
      savedAt: Date.now(),
      expiresAt: Date.now() - 1,
      refreshToken: 'rt-1',
      scope: 'openid',
    } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ access_token: 'fresh', token_type: 'Bearer', expires_in: 3600, scope: 'openid email' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const result = await resolveOAuthBearer({ config: config, tokenFileName: FILE_NAME, dataDir: dataDir }, { fetchImpl: fetchMock });
    expect(result).toEqual({ accessToken: 'fresh', source: 'refreshed' });

    const secondCall = await resolveOAuthBearer({ config: config, tokenFileName: FILE_NAME, dataDir: dataDir });
    expect(secondCall).toEqual({ accessToken: 'fresh', source: 'stored' });
  });

  it('carries the old refresh_token forward when the refresh response omits one', async () => {
    await setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: {
      accessToken: 'stale',
      tokenType: 'Bearer',
      savedAt: Date.now(),
      expiresAt: Date.now() - 1,
      refreshToken: 'rt-original',
    } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'fresh2' })));
    await resolveOAuthBearer({ config: config, tokenFileName: FILE_NAME, dataDir: dataDir }, { fetchImpl: fetchMock });

    // Force a second refresh to prove the carried-forward refresh token still works.
    const persisted = await getStoredOAuthToken({ dataDir, fileName: FILE_NAME });
    expect(persisted?.refreshToken).toBe('rt-original');
    expect(persisted?.accessToken).toBe('fresh2');
    await setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: {
      ...persisted!,
      expiresAt: Date.now() - 1,
    } });
    const secondFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = new URLSearchParams(init.body as string);
      expect(body.get('refresh_token')).toBe('rt-original');
      return new Response(JSON.stringify({ access_token: 'fresh3' }));
    });
    await resolveOAuthBearer({ config: config, tokenFileName: FILE_NAME, dataDir: dataDir }, { fetchImpl: secondFetch });
    expect(secondFetch).toHaveBeenCalledTimes(1);
  });

  it('drops expiresAt when the refresh response omits expires_in', async () => {
    await setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: {
      accessToken: 'stale',
      tokenType: 'Bearer',
      savedAt: Date.now(),
      expiresAt: Date.now() - 1,
      refreshToken: 'rt-1',
    } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'fresh' })));
    const result = await resolveOAuthBearer({ config: config, tokenFileName: FILE_NAME, dataDir: dataDir }, { fetchImpl: fetchMock });
    expect(result).toEqual({ accessToken: 'fresh', source: 'refreshed' });
    // Not expired (isOAuthTokenExpired returns false with no expiresAt) — proves it round-trips as non-expiring.
    const secondCall = await resolveOAuthBearer({ config: config, tokenFileName: FILE_NAME, dataDir: dataDir });
    expect(secondCall).toEqual({ accessToken: 'fresh', source: 'stored' });
  });

  it('returns null when the refresh call itself fails', async () => {
    await setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: {
      accessToken: 'stale',
      tokenType: 'Bearer',
      savedAt: Date.now(),
      expiresAt: Date.now() - 1,
      refreshToken: 'rt-1',
    } });
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(resolveOAuthBearer({ config: config, tokenFileName: FILE_NAME, dataDir: dataDir }, { fetchImpl: fetchMock })).resolves.toBeNull();
  });

  it('defaults fetchImpl to the global fetch when not supplied', async () => {
    await setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: {
      accessToken: 'stale',
      tokenType: 'Bearer',
      savedAt: Date.now(),
      expiresAt: Date.now() - 1,
      refreshToken: 'rt-1',
    } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'fresh' })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await resolveOAuthBearer({ config: config, tokenFileName: FILE_NAME, dataDir: dataDir });
    expect(result).toEqual({ accessToken: 'fresh', source: 'refreshed' });
    vi.unstubAllGlobals();
  });
});
