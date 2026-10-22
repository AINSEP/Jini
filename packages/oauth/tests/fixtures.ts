/** Explicit application ports for the generalized characterization suites. */
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createOAuthProviderRegistry, createOAuthUrlGuard, OAuthError } from '../src/index.js';
import type { OAuthFetch, OAuthRandomBytes, OAuthSleep } from '../src/index.js';

export const fixtureEntropy: OAuthRandomBytes = ({ byteLength }) => randomBytes(byteLength);
export const fixtureSleep: OAuthSleep = async ({ ms }) => { await delay(ms); };
export const fixtureFetch: OAuthFetch = ({ url }, init) => fetch(url, init);
export const fixtureGuard = createOAuthUrlGuard({
  assertAllowed({ url, label }) {
    if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)|^\[f[cd]/i.test(url.hostname)) {
      throw new OAuthError({
        code: 'OAUTH_UNSAFE_ENDPOINT',
        message: `${label === 'provider-supplied link' ? label : `${label}: provider endpoint`} resolves to an internal address, which is not allowed`,
        operatorAction: 'Point this provider at a publicly reachable authorization server.',
      });
    }
  },
}, { allowLoopbackHttp: true });
export const fixturePorts = {
  guard: fixtureGuard, fetchFn: fixtureFetch,
  clock: { nowMs: () => Date.now() },
  randomBytesFn: fixtureEntropy,
  options: { clientDisplayName: 'example', softwareId: 'example.client', redirectUris: [] as string[] },
};
export const fixtureRegistry = createOAuthProviderRegistry({ guard: fixtureGuard });
fixtureRegistry.register({ descriptor: {
  providerId: 'example-oidc', label: 'Example OIDC-shaped provider', supportedGrants: ['authorization_code', 'device_code'],
  authorizationEndpoint: 'https://oauth.example.com/authorize', tokenEndpoint: 'https://oauth.example.com/oauth/token',
  deviceAuthorizationEndpoint: 'https://oauth.example.com/oauth/device/code', defaultScopes: [], usesPkce: true, clientAuth: 'none',
} });
