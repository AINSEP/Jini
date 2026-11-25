import { expect, it, vi } from 'vitest';
import type { LoginProvider } from '@jini-ai/core/contracts/site/user-management-server';
import { hasLoginCredentials, resolveLoginCredentials } from '../credentials.js';
import { createReadyLoginProviderList } from '../ready-providers.js';
import { MemberLoginError } from '../../server/login-types.js';

const provider: LoginProvider = { id: 'oidc', pluginId: 'bundled', configurationVersion: 'pin', label: 'OIDC',
  issuer: 'https://issuer.example', authorizationEndpoint: 'https://issuer.example/auth', tokenEndpoint: 'https://issuer.example/token',
  jwksUri: 'https://issuer.example/jwks', scopes: ['openid'], signingAlgorithm: 'RS256', clientAuthentication: 'client_secret_post',
  credentialLabel: 'OIDC', credentialCardTarget: 'oidc', pkce: 'S256' };

it('readiness never opens a secret and rechecks on the second call', async () => {
  const describe = vi.fn().mockResolvedValueOnce({ username: ' client ', baseUrl: provider.tokenEndpoint }).mockResolvedValueOnce(null);
  const resolve = vi.fn();
  const listAdmitted = vi.fn(async () => [provider]);
  const deps = { describe, resolve };
  const list = createReadyLoginProviderList({ listAdmitted, hasCredentials: input => hasLoginCredentials({ ...input, deps }) });
  expect(await list({ workspaceId: 'site' })).toEqual([provider]);
  expect(await list({ workspaceId: 'site' })).toEqual([]);
  expect(listAdmitted).toHaveBeenCalledTimes(2);
  expect(describe).toHaveBeenCalledTimes(2);
  expect(resolve).not.toHaveBeenCalled();
});

it('different token endpoint returns the fixed refusal', async () => {
  const deps = { resolve: vi.fn().mockResolvedValue({ baseUrl: provider.tokenEndpoint + '/', connection: { username: ' client ', token: 'secret' } }) };
  await expect(resolveLoginCredentials({ workspaceId: 'site', provider, deps })).rejects.toEqual(new MemberLoginError({ code: 'LOGIN_UNAVAILABLE' }));
  deps.resolve.mockRejectedValue(new Error('secret-shaped upstream failure'));
  await expect(resolveLoginCredentials({ workspaceId: 'site', provider, deps })).rejects.toEqual(new MemberLoginError({ code: 'LOGIN_UNAVAILABLE' }));
});
