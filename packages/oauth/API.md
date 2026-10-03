# OAuth API

All entries use the Node runtime. Public operations take a required argument object and, when needed, a second object containing optional settings. Operations with no inputs take `{}`. Dependencies are explicit ports. Native Node DNS lookup callbacks and scheduler callbacks keep their host callback ABI.

| Import | Contents |
|---|---|
| `@jini-ai/oauth` | All protocol operations, factories, constants and port/value types below; memory stores are excluded |
| `@jini-ai/oauth/testing` | Three independent memory store factories |
| `@jini-ai/oauth/discovery-policy` | `createIssuerBoundDiscoveryPolicy`, `OAuthDiscoveryPolicy` |
| `@jini-ai/oauth/dns-pinned-transport` | `createDnsPinnedOAuthTransport`, `DnsPinnedOAuthTransport`, `DnsPinnedOAuthTransportDeps` and DNS/address/dispatcher port types |

The direct entries and root export the same implementations. The package depends on the kernel `@jini-ai/core`; hosts supply network policy, identity and persistence.

`OAuthDispatcherPort.dispatcher` is required and uses `NonNullable<RequestInit['dispatcher']>`, matching Node's native fetch contract. Dispatcher construction and shutdown remain host-owned ports.

## Protocol operations

The names in the argument columns are fields of their respective objects. `http` means required `fetchFn` and `guard` fields; it is shorthand in this table rather than a nested argument. `options` is the required `OAuthAppOptions` record: `clientDisplayName`, `redirectUris`, `softwareId`.

| Operation | Required args | Optional args |
|---|---|---|
| `new OAuthError` | `code, message, operatorAction` | `cause, providerErrorCode, retryAfterSeconds` |
| `isOAuthError` | `value` | — |
| `mapProviderErrorCode` | `providerErrorCode` | — |
| `createPkcePair` | `randomBytesFn` | `verifierBytes` (default 32) |
| `deriveCodeChallenge`, `assertValidCodeVerifier` | `codeVerifier` | — |
| `invalidPendingAuthorizationState` | `{}` | — |
| `secureEqualsForOwnerBinding` | `a, b` | — |
| `createOAuthUrlGuard` | `assertAllowed` | `allowLoopbackHttp` |
| `assertSafeUserFacingUrl` | `raw, guard` | — |
| `discoverAuthorizationServer` | `http, resourceUrl` | `wwwAuthenticate, timeoutMs, metadataPolicy` |
| `discoverProtectedResourceMetadata` | `http, resourceUrl` | `wwwAuthenticate, timeoutMs` |
| `fetchAuthorizationServerMetadata` | `http, issuer` | `timeoutMs, metadataPolicy` |
| `parseResourceMetadataUrl`, `parseWwwAuthenticateScopes` | `wwwAuthenticate` | — |
| `registerOAuthClientDynamically` | `http, options, registrationEndpoint, scopes` | `grantTypes, responseTypes, tokenEndpointAuthMethod, authMethodsSupported, initialAccessToken, timeoutMs` |
| `createOAuthClientRegistrar` | `http, options, cache, clock` | — |
| `createFileClientRegistrationCache` | `filePath, fileIO` | — |
| `createNodeRegistrationCacheFileIO` | `randomBytesFn` | — |
| `requestOAuthToken` | `http, clock, tokenEndpoint, client, params` | `resource, timeoutMs` |
| `beginAuthorizationCode` | `provider, pending, randomBytesFn, guard, options, ownerKey, client, redirectUri` | `resource, scopes, extraAuthorizationParams` |
| `completeAuthorizationCode` | `http, clock, provider, pending, ownerKey, client, params` | `timeoutMs` |
| `beginDeviceAuthorization` | `http, provider, clock, client` | `resource, scopes, timeoutMs` |
| `pollDeviceAuthorizationOnce` | `http, provider, clock, client, deviceCode, expiresAt` | `resource, timeoutMs` |
| `createTokenRefresher` | `clock, port, sleep` | `refreshSkewMs, leaseWaitMs, leasePollMs` |
| `isTokenDueForRefresh` | `tokens, nowIso, skewMs` | — |
| `refreshAccessToken` | `http, clock, tokenEndpoint, client, refreshToken` | `scopes, resource, timeoutMs` |
| `createOAuthProviderRegistry` | `guard` | — |
| `buildOperatorOAuthProvider` | `providerId, label, tokenEndpoint, guard` | `authorizationEndpoint, deviceAuthorizationEndpoint, scopes, clientAuth` |
| `assertValidOAuthProvider` | `descriptor, guard` | — |

`OAuthRequiredArgs<T>` and `OAuthOptionalArgs<T>` partition exported dependency/input records at callable boundaries. Optional values inside domain records such as `client`, callback `params` and provider descriptors remain part of those records. Under `exactOptionalPropertyTypes`, omit absent optional fields.

## Effect ports and returned methods

| Contract | Operations |
|---|---|
| `OAuthFetch` | `fetchFn({ url }, requestInit?)`; `url` accepts a string, URL or Request |
| `OAuthRandomBytes`, `Clock` from `@jini-ai/core/primitives`, `OAuthSleep` | `randomBytesFn({ byteLength })`, `nowMs()`, `sleep({ ms })` |
| `OAuthUrlGuard` | `assertSafeUrl({ raw, label })`; guard factory policy is `assertAllowed({ url, label })` |
| `PendingAuthorizationStore` | `put({ ownerKey, providerId, codeVerifier, redirectUri, scopes }, { resource? })`, `take({ state, ownerKey })`, `size({})` |
| `ClientRegistrationCache` | `get({ key })`, `set({ key, client })`, `delete({ key })` |
| `OAuthClientRegistrar` | `getOrRegister({ issuer, registrationEndpoint, scopes }, registrationOptions?)`, `invalidate` with the same arguments |
| `RegistrationCacheFilePort` | `read({ filePath })`, `writeAtomic({ filePath, content })` |
| `OAuthTokenStore` | `load({ key })`, `persist({ key, tokens })`, `markNeedsReauth({ key, reason })`, optional `tryAcquireRefreshLease({ key })` and `releaseRefreshLease({ key })` |
| `TokenRefreshPort` | Token store methods plus `refresh({ key, refreshToken })` |
| `TokenRefresher` | `getAccessToken({ key })`, `inFlightCount({})` |
| `OAuthProviderRegistry` | `register({ descriptor })`, `get({ providerId })`, `list({})` |

`OAuthTokenSet` contains normalized camelCase fields, absolute expiry and normalized scopes. `OAuthError` provides typed recovery guidance; only pending/slow-down polling codes are retryable. Grant operations make one request, with bounded responses, redirect refusal and explicit timeout options. A durable pending store must retain resource binding and consume state atomically before checking ownership.

## Discovery policy and pinned transport

`createIssuerBoundDiscoveryPolicy({})` returns `assertMetadata({ issuer, document })` and is the default discovery policy. Only explicit `metadataPolicy: "none"` disables binding; an alternate policy port may replace it. When the document supplies `issuer`, equality is exact; an omitted issuer retains the requested issuer fallback. Supplied authorization, token, registration and device endpoints must be absolute HTTPS URLs sharing the requested issuer's origin and containing no credentials. Missing endpoints retain discovery's existing handling. Policy rejection is terminal across fallback documents and advertised issuers.

Pass the policy in discovery's **second** object. It is opt-in, so prior discovery behavior remains until the host supplies it:

```ts
import { fetchAuthorizationServerMetadata } from '@jini-ai/oauth';
import { createIssuerBoundDiscoveryPolicy } from '@jini-ai/oauth/discovery-policy';
const server = await fetchAuthorizationServerMetadata(
  { fetchFn: transport.fetchFn, guard: transport.guard, issuer },
  { metadataPolicy: createIssuerBoundDiscoveryPolicy({}) },
);
```

`createDnsPinnedOAuthTransport({ fetchFn, guard, dns, addressPolicy, dispatcherFactory })` returns `DnsPinnedOAuthTransport`: `{ fetchFn, guard, close }`.

| Port | Operation |
|---|---|
| `OAuthDnsPort` | `resolve({ hostname }, { family? })` returns addresses with `address` and `family` |
| `OAuthAddressPolicyPort` | `assertAllowed({ hostname, address, family })` validates each connection-time answer |
| `OAuthDispatcherFactoryPort` | `create({ lookup })` constructs a host dispatcher using the supplied Node lookup callback |
| `OAuthDispatcherPort` | `dispatcher` value and `close({})` |

The lookup copies and validates every resolved address before returning any address to the socket. Mixed allowed/disallowed answers fail together. The injected HTTP implementation must honor the dispatcher extension; a host may bind Undici, which remains its own dependency. The host URL and address policies decide allowed destinations. Fetch preserves Request method, headers, body and signal, and applies explicit init overrides. It always supplies its own dispatcher and `redirect: 'error'`, and rejects redirect responses even from a nonconforming HTTP adapter. Call `await transport.close({})` during host shutdown.

## Main fixed-issuer operations

`createPkcePair({ randomBytesFn }, { verifierBytes = 32 })` returns a PKCE pair; runtime providers explicitly pass 64. `deriveCodeChallenge({ codeVerifier })` validates RFC 7636 before hashing. `generateOAuthState({ randomBytesFn }, { stateBytes = 32 })` supplies state entropy; owner-bound pending requests pass 24 bytes.

`buildOAuthAuthorizationUrl({ authorizationEndpoint, clientId, redirectUri, state, codeChallenge }, { scope?, resource? })` formats a fixed-issuer authorization URL. `exchangeOAuthAuthorizationCode({ fetchFn, guard, clock, tokenEndpoint, client, redirectUri, code, codeVerifier }, { resource? })` uses the same guarded, bounded token parser as `refreshAccessToken`; both return `OAuthTokenSet`, never raw token JSON. Confidential clients use the main API's RFC 6749 percent-encoded Basic credentials, and provider errors are typed without echoing body secrets.

`createPendingAuthorizationStore({ clock, randomBytesFn }, { ttlMs?, maxEntries?, scheduler? })` returns the async owner-bound contract and is available at the root and `/testing`. Its synchronous payload option is `createPendingAuthorizationStore<T>({ clock }, { expiry: ({ value, ttlMs }) => epochMs, scheduler?, ttlMs?, maxEntries?, exclusiveExpiry? })`. Payload methods are `put({ state, value })`, `consume({ state })`, `size({})`, `stop({})`. Both modes share a bounded map (256 by default), single-use consumption, a ten-minute default TTL, and timer cancellation when empty. `scheduler.every({ intervalMs, run })` returns a cancellation closure. `exclusiveExpiry: true` keeps legacy callback expiry at age > TTL; owner-bound state expires at the deadline.

`redactOAuthUrls({ text, pattern, replacement })` preserves all unmatched bytes. Hosts own its pattern and replacement.

`defaultOAuthMessages` supplies neutral reserved-parameter and registration-recovery copy. Pass `messages` in argument two of browser authorization or registration (including cached `getOrRegister`). Protocol identity is `clientDisplayName` (`client_name`), `softwareId`, and `redirectUris`; the obsolete prose-only `productName` option is removed.

## Memory adapters

Import these only from `@jini-ai/oauth/testing`:

- `createPendingAuthorizationStore({ clock, randomBytesFn }, { ttlMs?, maxEntries? })`
- `createMemoryClientRegistrationCache({})`
- `createMemoryTokenStore({})`

Every instance owns its state. Memory refresh leases coordinate one process; hosts implement durable leases with ownership/expiry. File caches require an explicit path and a file I/O port. See the README for composition and persistence details.
