import { expect, it, vi } from 'vitest';
import type { LoginProvider } from '@jini-ai/core/contracts/site/user-management-server';
import { loadLoginProviders } from '../providers.js';

const provider: LoginProvider = { id: 'oidc', pluginId: 'bundled', configurationVersion: 'full-preset', label: 'OIDC',
  issuer: 'https://issuer.example', authorizationEndpoint: 'https://issuer.example/auth', tokenEndpoint: 'https://issuer.example/token',
  jwksUri: 'https://issuer.example/jwks', scopes: ['openid'], signingAlgorithm: 'RS256', clientAuthentication: 'client_secret_post',
  credentialLabel: 'OIDC', credentialCardTarget: 'oidc', pkce: 'S256' };

it('same ID and a different full preset is not admitted', async () => {
  const loadCandidates = vi.fn(async ({ trustedPluginIds }: { trustedPluginIds: ReadonlySet<string> }) => {
    expect([...trustedPluginIds]).toEqual(['bundled']);
    return [{ ...provider, tokenEndpoint: 'https://other.example/token', configurationVersion: 'different-full-preset' }];
  });
  expect(await loadLoginProviders({ workspaceId: 'site', bundledProviders: [provider], loadCandidates })).toEqual([]);
});

it('duplicate admitted IDs disappear', async () => {
  expect(await loadLoginProviders({ workspaceId: 'site', bundledProviders: [provider], loadCandidates: async () => [provider, provider] })).toEqual([]);
});
