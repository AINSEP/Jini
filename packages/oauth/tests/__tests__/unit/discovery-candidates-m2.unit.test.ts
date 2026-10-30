import { expect, test, vi } from 'vitest';
import { fetchAuthorizationServerMetadata } from '../../../src/discovery.js';
import { fixtureGuard } from '../../fixtures.js';

test('disabling issuer binding still refuses a document without the required issuer', async () => {
  const fetchFn = vi.fn(async () => Response.json({ token_endpoint: 'https://issuer.example/token' }));
  await expect(fetchAuthorizationServerMetadata({ issuer: 'https://issuer.example/tenant', guard: fixtureGuard, fetchFn },
    { metadataPolicy: 'none' })).rejects.toMatchObject({ name: 'OAuthError', code: 'OAUTH_MALFORMED_RESPONSE',
    message: 'the OAuth metadata endpoint did not return a JSON object' });
  expect(fetchFn).toHaveBeenCalledOnce();
});

test('tenant discovery exhausts all tenant locations before an explicitly enabled origin fallback', async () => {
  const seen: string[] = [];
  const result = await fetchAuthorizationServerMetadata({ issuer: 'https://issuer.example/tenant', guard: fixtureGuard,
    fetchFn: async ({ url }) => {
      seen.push(String(url));
      if (seen.length < 4) return new Response('', { status: 404 });
      return Response.json({ issuer: 'https://issuer.example/tenant', token_endpoint: 'https://issuer.example/token' });
    } }, { allowOriginFallback: true });
  expect(seen).toEqual([
    'https://issuer.example/.well-known/oauth-authorization-server/tenant',
    'https://issuer.example/.well-known/openid-configuration/tenant',
    'https://issuer.example/tenant/.well-known/openid-configuration',
    'https://issuer.example/.well-known/oauth-authorization-server',
  ]);
  expect(result.tokenEndpoint).toBe('https://issuer.example/token');
});
