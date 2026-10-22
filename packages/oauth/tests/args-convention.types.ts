/** Compile-only contract coverage; execution is unnecessary. */
import {
  OAuthError, beginAuthorizationCode, completeAuthorizationCode, beginDeviceAuthorization,
  pollDeviceAuthorizationOnce, discoverAuthorizationServer, fetchAuthorizationServerMetadata,
  discoverProtectedResourceMetadata, registerOAuthClientDynamically, requestOAuthToken,
  refreshAccessToken, buildOperatorOAuthProvider, createOAuthUrlGuard, createTokenRefresher,
} from '../src/index.js';
import { createPendingAuthorizationStore } from '../src/testing/index.js';
import type { ClientRegistrationCache, OAuthFetch, OAuthRandomBytes, OAuthSleep, OAuthTokenStore, OAuthProviderRegistry, RegistrationCacheFilePort } from '../src/index.js';

type Assert<T extends true> = T;
type Absent<T, K extends PropertyKey> = Extract<keyof T, K> extends never ? true : false;
type OptionalFirst<F extends (...args: never[]) => unknown, K extends PropertyKey> = Absent<Parameters<F>[0], K>;
export type ConventionAssertions = [
  Assert<OptionalFirst<typeof beginAuthorizationCode, 'resource' | 'scopes' | 'extraAuthorizationParams'>>,
  Assert<OptionalFirst<typeof completeAuthorizationCode, 'timeoutMs'>>,
  Assert<OptionalFirst<typeof beginDeviceAuthorization, 'resource' | 'scopes' | 'timeoutMs'>>,
  Assert<OptionalFirst<typeof pollDeviceAuthorizationOnce, 'resource' | 'timeoutMs'>>,
  Assert<OptionalFirst<typeof discoverAuthorizationServer, 'wwwAuthenticate' | 'timeoutMs'>>,
  Assert<OptionalFirst<typeof fetchAuthorizationServerMetadata, 'timeoutMs'>>,
  Assert<OptionalFirst<typeof discoverProtectedResourceMetadata, 'wwwAuthenticate' | 'timeoutMs'>>,
  Assert<OptionalFirst<typeof registerOAuthClientDynamically, 'grantTypes' | 'responseTypes' | 'tokenEndpointAuthMethod' | 'authMethodsSupported' | 'initialAccessToken' | 'timeoutMs'>>,
  Assert<OptionalFirst<typeof requestOAuthToken, 'resource' | 'timeoutMs'>>,
  Assert<OptionalFirst<typeof refreshAccessToken, 'resource' | 'scopes' | 'timeoutMs'>>,
  Assert<OptionalFirst<typeof buildOperatorOAuthProvider, 'authorizationEndpoint' | 'deviceAuthorizationEndpoint' | 'scopes' | 'clientAuth'>>,
  Assert<OptionalFirst<typeof createOAuthUrlGuard, 'allowLoopbackHttp'>>,
  Assert<OptionalFirst<typeof createTokenRefresher, 'refreshSkewMs' | 'leaseWaitMs' | 'leasePollMs'>>,
  Assert<OptionalFirst<typeof createPendingAuthorizationStore, 'ttlMs' | 'maxEntries'>>,
  Assert<Absent<ConstructorParameters<typeof OAuthError>[0], 'cause' | 'retryAfterSeconds' | 'providerErrorCode'>>,
];

/** These legacy scalar contracts must be compile errors, independent of runtime coverage. */
export function rejectedShapes(
  store: OAuthTokenStore, cache: ClientRegistrationCache, registry: OAuthProviderRegistry,
  fileIO: RegistrationCacheFilePort, fetchFn: OAuthFetch, random: OAuthRandomBytes, sleep: OAuthSleep,
): void {
  // @ts-expect-error keys are named required arguments
  void store.load('key');
  // @ts-expect-error keys are named required arguments
  void cache.get('key');
  // @ts-expect-error provider identity is named
  void registry.get('provider');
  // @ts-expect-error paths are named
  void fileIO.read('/clients.json');
  // @ts-expect-error URLs are named
  void fetchFn('https://auth.example.com/token');
  // @ts-expect-error entropy length is named
  random(32);
  // @ts-expect-error wait duration is named
  void sleep(250);
  // @ts-expect-error optional error metadata belongs to argument two
  new OAuthError({ code: 'OAUTH_INVALID_GRANT', message: 'refused', operatorAction: 'reconnect', providerErrorCode: 'invalid_grant' });
}
