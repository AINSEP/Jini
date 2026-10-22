Spec ID: SPEC-JINI-OAUTH-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:4c7db781e669141118c238643e69b56f6e1d237eb41844d941ef03b9da87c37d
spec_mode: reverse_spec


# OAuth consumer API

## Scope and notation

The contract describes current `src/` exports. Runtime is Node with Web Fetch classes and `AbortSignal.timeout`. Entry points are `@jini-ai/oauth`, `/testing`, `/discovery-policy`, `/dns-pinned-transport`; no other deep imports are public.

Signatures below use `(required, optional = {})` where implemented. A signature with one object really has one parameter today; do not assume a second options object is consumed. `OAuthRequiredArgs<T>` selects non-optional properties; `OAuthOptionalArgs<T>` selects optional properties; `OAuthEmptyArgs` is an empty object. The argument utility types are package-local; ISODateTime and Clock come from `@jini-ai/core/primitives`.

## Required dependencies and values

| Contract | Consumer supplies |
|---|---|
| `OAuthFetch` | `({url: string \| URL \| Request}, init?: RequestInit) => Promise<Response>`. Adapt native fetch; honor abort, redirect refusal and egress policy. |
| `OAuthUrlGuard` | `assertSafeUrl({raw, label}) => URL`; reject unsafe destinations synchronously. |
| `OAuthHttpPorts` | `{fetchFn: OAuthFetch, guard: OAuthUrlGuard}`. |
| `Clock` from `@jini-ai/core/primitives` | `nowMs() => number`, a valid UTC-compatible instant. |
| `OAuthRandomBytes` | `({byteLength}) => Uint8Array`, exactly that many cryptographically random bytes. |
| `OAuthSleep` | `({ms}) => Promise<void>`; advance injected time consistently in deterministic compositions. |
| `OAuthAppOptions` | Required `clientDisplayName`, `softwareId` (nonblank strings), `redirectUris: readonly string[]` (absolute URLs without a nonempty fragment). There are no identity defaults. |
| `OAuthClient` | `{clientId, authMethod: 'none' \| 'client_secret_post' \| 'client_secret_basic', clientSecret?: string}`. |
| `OAuthProviderDescriptor` | `{providerId, label, supportedGrants: ('authorization_code' \| 'device_code')[], tokenEndpoint, defaultScopes, usesPkce, clientAuth, authorizationEndpoint?, deviceAuthorizationEndpoint?}`. Secrets live outside descriptors. |
| `OAuthResource` | Absolute fragment-free URI string or array of strings; identifiers are not fetched. |
| `OAuthTokenSet` | `{accessToken: string, refreshToken: string \| null, tokenType: string, scopes: readonly string[], expiresAt: ISODateTime \| null}`. |
| `PendingAuthorizationStore` | `put({ownerKey, providerId, codeVerifier, redirectUri, scopes}, {resource?}) => Promise<PendingAuthorization>`; `take({state, ownerKey}) => Promise<PendingAuthorization>`; `size({}) => Promise<number>`. Durable adapters must atomically consume before ownership checking. |
| `PendingAuthorization` | Issuance fields plus `state`, `createdAt`, `expiresAt`; preserve verifier and resource binding privately. |
| `ClientRegistrationCache` | Async `get({key}) => RegisteredOAuthClient \| null`, `set({key, client}) => void`, `delete({key}) => void`. |
| `OAuthTokenStore` | Async `load({key}) => OAuthTokenSet \| null`, `persist({key, tokens}) => void`, `markNeedsReauth({key, reason}) => void`; optional `tryAcquireRefreshLease({key}) => boolean`, `releaseRefreshLease({key}) => void`. |
| `TokenRefreshPort` | Token-store methods plus `refresh({key, refreshToken}) => Promise<OAuthTokenSet>`; all operations use the same connection key. |
| `RegistrationCacheFilePort` | Async `read({filePath}) => string \| null`, `writeAtomic({filePath, content}) => void`; writes must protect secrets. |

## Root operations

These are also the operations re-exported internally by `src/api.ts`; that file is not an import subpath.

| Export | Current signature and result |
|---|---|
| `OAuthError` | `new OAuthError({code, message, operatorAction}, {providerErrorCode?, retryAfterSeconds?, cause?} = {})`; see error contract. |
| `isOAuthError` | `({value: unknown}) => boolean`, type predicate narrowing the argument's `value` to `OAuthError`. |
| `mapProviderErrorCode` | `({providerErrorCode: string}) => OAuthErrorCode`. |
| `createOAuthUrlGuard` | `({assertAllowed: ({url, label}) => void}, {allowLoopbackHttp?: boolean} = {}) => OAuthUrlGuard`. |
| `assertSafeUserFacingUrl` | `({raw: string, guard}) => URL`. |
| `createPkcePair` | `({randomBytesFn}, {verifierBytes = 32} = {}) => PkcePair`, `{codeVerifier, codeChallenge, codeChallengeMethod: 'S256'}`. |
| `deriveCodeChallenge` | `({codeVerifier: string}) => string`; validates before hashing. |
| `assertValidCodeVerifier` | `({codeVerifier: string}) => void`. |
| `secureEqualsForOwnerBinding` | `({a: string, b: string}) => boolean`. |
| `invalidPendingAuthorizationState` | `({}) => OAuthError`; constructs, does not throw. |
| `parseResourceMetadataUrl` | `({wwwAuthenticate: string}) => string \| null`. |
| `parseWwwAuthenticateScopes` | `({wwwAuthenticate: string}) => readonly string[]`. |
| `fetchAuthorizationServerMetadata` | `({fetchFn, guard, issuer}, {timeoutMs?, metadataPolicy?, allowOriginFallback?} = {}) => Promise<DiscoveredAuthorizationServer>`. |
| `discoverProtectedResourceMetadata` | `({fetchFn, guard, resourceUrl}, {wwwAuthenticate?, timeoutMs?} = {}) => Promise<DiscoveredProtectedResource \| null>`. |
| `discoverAuthorizationServer` | `({fetchFn, guard, resourceUrl}, {wwwAuthenticate?, timeoutMs?, metadataPolicy?, allowOriginFallback?} = {}) => Promise<{server: DiscoveredAuthorizationServer, resourceScopes: readonly string[]}>`. |
| `registerOAuthClientDynamically` | `({fetchFn, guard, options, registrationEndpoint, scopes}, {grantTypes?, responseTypes?, tokenEndpointAuthMethod?, authMethodsSupported?, initialAccessToken?, timeoutMs?, messages?} = {}) => Promise<RegisteredOAuthClient>`. |
| `createOAuthClientRegistrar` | `({fetchFn, guard, options, cache, clock}) => OAuthClientRegistrar`. Methods `getOrRegister({issuer, registrationEndpoint, scopes}, registrationOptions = {}) => Promise<RegisteredOAuthClient>` and `invalidate(sameRequired, sameOptions = {}) => Promise<void>`. Options are the dynamic-registration options above. |
| `createFileClientRegistrationCache` | `({filePath: string, fileIO}) => ClientRegistrationCache`. |
| `createNodeRegistrationCacheFileIO` | `({randomBytesFn}) => RegistrationCacheFilePort`; Node filesystem adapter. |
| `requestOAuthToken` | `({fetchFn, guard, clock, tokenEndpoint, client, params: Readonly<Record<string, string>>}, {resource?, timeoutMs?} = {}) => Promise<OAuthTokenSet>`. |
| `beginAuthorizationCode` | `({provider, pending, randomBytesFn, guard, options, ownerKey, client, redirectUri}, {resource?, scopes?, messages?, extraAuthorizationParams?: Readonly<Record<string, string>>} = {}) => Promise<{authorizationUrl, state, expiresAt}>`. No fetch dependency. |
| `completeAuthorizationCode` | `({fetchFn, guard, clock, provider, pending, ownerKey, client, params: {state, code?, error?}}, {timeoutMs?} = {}) => Promise<OAuthTokenSet>`. |
| `beginDeviceAuthorization` | `({fetchFn, guard, provider, clock, client}, {resource?, scopes?, timeoutMs?} = {}) => Promise<DeviceAuthorization>`. |
| `pollDeviceAuthorizationOnce` | `({fetchFn, guard, provider, clock, client, deviceCode, expiresAt}, {resource?, timeoutMs?} = {}) => Promise<OAuthTokenSet>`. |
| `refreshAccessToken` | `({fetchFn, guard, clock, tokenEndpoint, client, refreshToken}, {scopes?, resource?, timeoutMs?} = {}) => Promise<OAuthTokenSet>`. |
| `isTokenDueForRefresh` | `({tokens, nowIso: string, skewMs: number}) => boolean`. |
| `createTokenRefresher` | `({clock, port, sleep}, {refreshSkewMs?, leaseWaitMs?, leasePollMs?} = {}) => TokenRefresher`; `getAccessToken({key}) => Promise<string>`, `inFlightCount({}) => number`. |
| `assertValidOAuthProvider` | `({descriptor, guard}) => void`. |
| `buildOperatorOAuthProvider` | `({providerId, label, tokenEndpoint, guard}, {authorizationEndpoint?, deviceAuthorizationEndpoint?, scopes?, clientAuth?} = {}) => OAuthProviderDescriptor`. |
| `createOAuthProviderRegistry` | `({guard}) => OAuthProviderRegistry`; `register({descriptor}) => void`, `list({}) => readonly OAuthProviderDescriptor[]`, `get({providerId}) => OAuthProviderDescriptor`. |

Public constants: `DEFAULT_TOKEN_REQUEST_TIMEOUT_MS = 15000`, `PENDING_AUTHORIZATION_DEFAULT_MAX_ENTRIES = 256`, `PENDING_AUTHORIZATION_DEFAULT_TTL_MS = 600000`, `PENDING_AUTHORIZATION_STATE_BYTES = 24`.

Discovery returns `issuer`, required `tokenEndpoint`, nullable `authorizationEndpoint`, `deviceAuthorizationEndpoint`, `registrationEndpoint`, and arrays `scopesSupported`, `grantTypesSupported`, `codeChallengeMethodsSupported`, `tokenEndpointAuthMethodsSupported`. Protected metadata returns nullable `resource`, arrays `authorizationServers`, `scopesSupported`.

`RegisteredOAuthClient` contains `clientId`, nullable `clientSecret`, `tokenEndpointAuthMethod`, nullable `registrationClientUri`, and nullable epoch-second numbers `clientIdIssuedAt`, `clientSecretExpiresAt`. `DeviceAuthorization` contains secret `deviceCode`, displayable `userCode`, `verificationUri`, nullable `verificationUriComplete`, absolute `expiresAt`, and numeric `intervalSeconds`.

The root also exports every runtime symbol and corresponding port/value type in the following subpaths. Public dependency/input/result interfaces listed in `src/index.ts` describe the same fields above; optional properties move to argument two only on operations explicitly shown with argument two.

## `/testing`

| Export | Current signature and result |
|---|---|
| `createPendingAuthorizationStore` | `({clock, randomBytesFn}, {ttlMs?, maxEntries?, scheduler?} = {}) => PendingAuthorizationStore`. |
| `createMemoryClientRegistrationCache` | `({}) => ClientRegistrationCache`. |
| `createMemoryTokenStore` | `({}) => OAuthTokenStore`, including compare-and-set leases. |

These stores are independent process-local instances; no durable or encrypted storage is supplied.

## `/discovery-policy`

`createIssuerBoundDiscoveryPolicy({}) => OAuthDiscoveryPolicy`. The port has `assertMetadata({issuer: string, document: Readonly<Record<string, unknown>>}) => void`. Authorization-server discovery enables this policy by default; pass an alternate policy in `metadataPolicy` or explicitly select `metadataPolicy: "none"` to disable issuer binding.

```ts
import { fetchAuthorizationServerMetadata } from '@jini-ai/oauth';
import { createIssuerBoundDiscoveryPolicy } from '@jini-ai/oauth/discovery-policy';
const server = await fetchAuthorizationServerMetadata(
  { fetchFn, guard, issuer: 'https://auth.example.com' },
  { metadataPolicy: createIssuerBoundDiscoveryPolicy({}) },
);
```

## `/dns-pinned-transport`

`createDnsPinnedOAuthTransport({fetchFn, guard, dns, addressPolicy, dispatcherFactory}) => DnsPinnedOAuthTransport`. Returned `{fetchFn, guard, close({}): Promise<void>}` owns one dispatcher.

Ports: `OAuthDnsPort.resolve({hostname}, {family?}) => Promise<readonly {address: string, family: number}[]>`; `OAuthAddressPolicyPort.assertAllowed({hostname, address, family}) => void`; `OAuthDispatcherFactoryPort.create({lookup: node:net.LookupFunction}) => OAuthDispatcherPort`; dispatcher port exposes opaque `dispatcher` and `close({}) => Promise<void>`. The injected fetch must honor the dispatcher extension.

```ts
import { createDnsPinnedOAuthTransport } from '@jini-ai/oauth/dns-pinned-transport';
const http = createDnsPinnedOAuthTransport({ fetchFn, guard, dns, addressPolicy, dispatcherFactory });
try { await fetchAuthorizationServerMetadata({ ...http, issuer: 'https://auth.example.com' }); }
finally { await http.close({}); }
```

## Main OAuth primitives

PKCE, state, fixed-issuer URL building, code exchange, refresh, redaction and pending storage now live at the root. `createPkcePair` supports `{ verifierBytes = 32 }`; runtime providers pass 64. `generateOAuthState` defaults to 32 bytes; owner-bound storage passes 24. `exchangeOAuthAuthorizationCode` accepts the named main HTTP/clock/guard/client fields and returns `OAuthTokenSet`; raw snake_case response parsing stays internal. All grant requests use the bounded parser and typed errors.

`createPendingAuthorizationStore` also supports host payloads with `{ expiry, scheduler?, ttlMs?, maxEntries?, exclusiveExpiry? }` in argument two and `{ clock }` in argument one. The injected scheduler returns a cancellation closure. The default capacity is 256; owner-bound expiration is inclusive, with an explicit exclusive payload deadline for legacy adapters. Root and `/testing` expose the same implementation. See API.md for every current signature.

## Minimal browser wiring

```ts
import { randomBytes } from 'node:crypto';
import { beginAuthorizationCode, completeAuthorizationCode, createOAuthUrlGuard } from '@jini-ai/oauth';
import { createPendingAuthorizationStore } from '@jini-ai/oauth/testing';
const randomBytesFn = ({ byteLength }: { byteLength: number }) => randomBytes(byteLength);
const clock = { nowMs: () => Date.now() };
const guard = createOAuthUrlGuard({ assertAllowed: ({ url }) => egressPolicy.assertAllowed(url) });
const fetchFn = ({ url }: { url: string | URL | Request }, init?: RequestInit) => policyFetch(url, init);
const pending = createPendingAuthorizationStore({ clock, randomBytesFn });
const options = { clientDisplayName: 'Example Client', softwareId: 'example.client', redirectUris: ['https://app.example.com/callback'] };
const started = await beginAuthorizationCode(
  { provider, client, pending, randomBytesFn, guard, options, ownerKey, redirectUri: options.redirectUris[0]! },
  { scopes: ['read'], resource: 'https://api.example.com' },
);
// Send started.authorizationUrl to the browser; obtain callbackParams and the trusted ownerKey.
const tokens = await completeAuthorizationCode({ provider, client, pending, clock, fetchFn, guard, ownerKey, params: callbackParams });
await tokenStore.persist({ key: ownerKey, tokens });
```

The consumer supplies the named provider, client, policy, owner identity and callback adapter; replace the testing store with durable atomic storage when callbacks cross processes. Evidence: `src/index.ts`, protocol modules and `tests/args-convention.test.ts`, `tests/ports-and-options.test.ts`; tests were read, not executed.

## Consolidated helpers and defaults

`generateOAuthState({ randomBytesFn }, { stateBytes = 32 } = {}): string` uses supplied entropy; this state helper does not validate the requested byte count. `buildOAuthAuthorizationUrl({ authorizationEndpoint, clientId, redirectUri, state, codeChallenge }, { scope?: string, resource?: string } = {}): string` builds fixed-issuer S256 authorization parameters. `exchangeOAuthAuthorizationCode({ fetchFn, guard, clock, tokenEndpoint, client, redirectUri, code, codeVerifier }, { resource?, timeoutMs? } = {}): Promise<OAuthTokenSet>` uses the main guarded bounded parser. `redactOAuthUrls({ text }): string` is a root export. No provider-primitives entry, raw wire-token response type or standalone pending-cache factory remains.

Root `defaultOAuthMessages`/`OAuthMessages` supply replaceable prose for browser and dynamic-registration flows through optional messages. `clientDisplayName`/`softwareId`/redirectUris remain required wire identity; productName is removed. Authorization-server metadata defaults to issuer binding and path candidates only; `allowOriginFallback: true` permits origin-wide discovery explicitly. Clock samples are epoch milliseconds; ISO token lifetimes are formatted through core.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `AuthorizationCallbackParams`, `BeginAuthorizationCodeDeps`, `BeginAuthorizationCodeInput`, `BeginAuthorizationCodeResult`, `CompleteAuthorizationCodeDeps`, `CompleteAuthorizationCodeInput`, `OAuthCodeExchangeInput` | type; [authorization-code.ts](../../src/authorization-code.ts) |
| `BeginDeviceAuthorizationInput`, `DeviceAuthorizationDeps`, `PollDeviceAuthorizationInput` | type; [device-code.ts](../../src/device-code.ts) |
| `CachedRegistrationInput`, `OAuthClientRegistrarDeps` | type; [registration-cache.ts](../../src/registration-cache.ts) |
| `DiscoverAuthorizationServerInput`, `DiscoveredOAuthConfiguration`, `OAuthDiscoveryDeps` | type; [discovery.ts](../../src/discovery.ts) |
| `DnsPinnedOAuthTransportDeps`, `OAuthDnsAddress` | interface; [dns-pinned-transport.ts](../../src/dns-pinned-transport.ts) |
| `DynamicClientRegistrationDeps`, `DynamicClientRegistrationInput` | type; [registration.ts](../../src/registration.ts) |
| `FileClientRegistrationCacheOptions` | type; [file-registration-cache.ts](../../src/file-registration-cache.ts) |
| `OAuthClientAuthMethod`, `OAuthGrantKind` | type; [ports.ts](../../src/ports.ts) |
| `OAuthErrorOptions` | type; [errors.ts](../../src/errors.ts) |
| `OAuthUrlGuardOptions` | type; [endpoint-safety.ts](../../src/endpoint-safety.ts) |
| `OperatorOAuthProviderInput` | type; [registry.ts](../../src/registry.ts) |
| `PendingAuthorizationCache`, `PendingAuthorizationCacheOptions`, `PendingAuthorizationScheduler`, `PendingAuthorizationStoreDeps` | type; [pending-authorizations.ts](../../src/pending-authorizations.ts) |
| `RefreshAccessTokenInput`, `TokenRefresherDeps` | type; [refresh.ts](../../src/refresh.ts) |
| `TokenRequestDeps`, `TokenRequestInput` | type; [token-endpoint.ts](../../src/token-endpoint.ts) |

## Current manifest boundary

The current `package.json` exposes `.`, `./testing`, `./discovery-policy`, `./dns-pinned-transport`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
