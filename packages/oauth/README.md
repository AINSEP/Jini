# @jini-ai/oauth

A standalone OAuth 2.x client for Node. It supports RFC 8414 authorization-server discovery (including OIDC fallback paths), RFC 9728 protected-resource metadata and challenges, RFC 7591 registration, authorization code with S256 PKCE, RFC 8628 device authorization, refresh, RFC 8707 resource indicators, and typed errors. It shares clocks and timestamp types with `@jini-ai/core`.

## Composition

Supply the application's identity explicitly wherever a client is registered or a browser authorization is begun. There are no product or client-name defaults:

```ts
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createOAuthUrlGuard, createOAuthClientRegistrar, discoverAuthorizationServer,
  beginAuthorizationCode, completeAuthorizationCode, createTokenRefresher, refreshAccessToken,
} from '@jini-ai/oauth';

const options = {
  clientDisplayName: 'Example OAuth Client',
  redirectUris: ['https://app.example.com/oauth/callback'], softwareId: 'com.example.oauth-client',
};
const clock = { nowMs: () => Date.now() };
const randomBytesFn = ({ byteLength }: { byteLength: number }) => randomBytes(byteLength);
const guard = createOAuthUrlGuard({
  assertAllowed: ({ url, label }) => appOutboundPolicy.assertAllowed(url, label),
}, { allowLoopbackHttp: false });
const http = { guard, fetchFn: ({ url }, init) => appGuardedFetch(url, init) };
const registrar = createOAuthClientRegistrar({ ...http, clock, options, cache: appRegistrationCache });
const discovered = await discoverAuthorizationServer({
  ...http, resourceUrl: 'https://api.example.com/data',
}, { wwwAuthenticate: challengeHeader });
const registered = await registrar.getOrRegister({
  issuer: discovered.server.issuer, registrationEndpoint: discovered.server.registrationEndpoint!,
  scopes: discovered.resourceScopes,
}, { authMethodsSupported: discovered.server.tokenEndpointAuthMethodsSupported });
const client = {
  clientId: registered.clientId, authMethod: registered.tokenEndpointAuthMethod,
  ...(registered.clientSecret === null ? {} : { clientSecret: registered.clientSecret }),
};
const started = await beginAuthorizationCode({
  provider, pending: appPendingStore, randomBytesFn, guard, options,
  ownerKey: connectionKey, client, redirectUri: options.redirectUris[0]!,
}, { scopes: discovered.resourceScopes, resource: 'https://api.example.com/data' });
// In the app's callback handler:
const tokens = await completeAuthorizationCode({
  ...http, clock, provider, pending: appPendingStore, ownerKey: connectionKey, client, params: callbackParams,
});
await appTokenStore.persist({ key: connectionKey, tokens });
const refresher = createTokenRefresher({
  clock, sleep: async ({ ms }) => { await delay(ms); },
  port: {
    load: args => appTokenStore.load(args),
    persist: args => appTokenStore.persist(args),
    markNeedsReauth: args => appTokenStore.markNeedsReauth(args),
    tryAcquireRefreshLease: args => appTokenStore.tryAcquireRefreshLease(args),
    releaseRefreshLease: args => appTokenStore.releaseRefreshLease(args),
    refresh: ({ refreshToken }) => refreshAccessToken({
      ...http, clock, tokenEndpoint: provider.tokenEndpoint, client, refreshToken,
    }, { resource: 'https://api.example.com/data' }),
  },
}, { refreshSkewMs: 120_000 });
```

The example's `app*` values, provider descriptor, callback handler and connection identity belong to the consumer. A descriptor names endpoints, supported grants, default scopes, PKCE use and client authentication; it can come from discovery or `buildOperatorOAuthProvider({ providerId, label, tokenEndpoint, guard }, { authorizationEndpoint, scopes })`. Select the grant and verify a registration endpoint exists before using the example's registration branch. The registry does not discover or register clients automatically.

The URL guard wraps a **required application policy**; it is not a built-in SSRF classifier. Pair it with a fetch port that checks/pins DNS at connection time. For example, an app can adapt its platform SSRF guard and validating lookup into these two ports. Every remote or derived endpoint is checked; requests refuse redirects and carry deadlines. `allowLoopbackHttp: true` only permits literal localhost, 127.0.0.1 and ::1 through the scheme gate; the supplied policy still runs. Device verification links also reject embedded credentials.

`resource` accepts one absolute fragment-free URI or an array, emitted as repeated form fields. The authorization-code flow saves this value in the pending record and replays it on exchange. A durable pending adapter **must preserve that field**. The device poller and refresh helper require the app to pass the same resource binding explicitly. Resource identifiers are not fetched.

## Transport wiring contract

An app using an MCP HTTP transport connects these independent packages in its own composition code. The transport accepts a bearer-token supplier and an authentication-failure hook; it does not need to import OAuth itself:

```ts
// Consumer application code only. createAppHttpTransport is the app's transport adapter.
const transport = createAppHttpTransport({
  getBearerToken: () => refresher.getAccessToken({ key: connectionKey }),
  onAuthenticationFailure: async ({ status, wwwAuthenticate }) => {
    if (status !== 401) return;
    const configuration = await discoverAuthorizationServer({ ...http, resourceUrl: connectionUrl },
      { ...(wwwAuthenticate === undefined ? {} : { wwwAuthenticate }) });
    await appConnectionService.requireAuthorization(connectionKey, configuration);
  },
});
```

The hook follows `WWW-Authenticate`'s `resource_metadata` when present and lets the app record/offer reauthorization. It must not blindly replay a failed tool call. The app owns consent UI, callback routes, connection status, token sealing and transport lifecycle. Neither protocol package imports the other.

## Persistence adapters

Pending authorizations are async, owner-bound, single-use, ten-minute entries by default; memory capacity defaults to 256. A failed owner check consumes state. Exported width/TTL constants, `secureEqualsForOwnerBinding`, and `invalidPendingAuthorizationState` let durable adapters preserve the same security contract. PKCE generation and memory state issuance require an explicit cryptographic random source.

`@jini-ai/oauth/testing` exports `createPendingAuthorizationStore`, `createMemoryClientRegistrationCache`, and `createMemoryTokenStore`. Each creates an independent store; factories without dependencies take `{}`. Pending-store limits go in the second argument: `createPendingAuthorizationStore({ clock, randomBytesFn }, { ttlMs, maxEntries })`. Memory leases only coordinate one process; durable adapters need compare-and-set leases with expiry and ownership.

The optional file cache takes a required path and a typed file I/O port:

```ts
import { createFileClientRegistrationCache, createNodeRegistrationCacheFileIO } from '@jini-ai/oauth';
const cache = createFileClientRegistrationCache({
  filePath: appRegistrationCachePath,
  fileIO: createNodeRegistrationCacheFileIO({ randomBytesFn: ({ byteLength }) => randomBytes(byteLength) }),
});
```

The Node adapter creates a 0600 temporary file exclusively, syncs it, then renames it atomically. File cache updates are serialized per instance; use a single writer or externally coordinate multiple instances/processes. Files contain plaintext client secrets: apps needing encryption should supply another cache adapter. Corrupt files fail explicitly. Registrar cache identity includes issuer, endpoint, client identity, redirect URIs, scopes and requested authentication metadata; expired secrets are registered again. Registration failures are not cached or retried automatically. The app can call `registrar.invalidate(input)` after a provider refuses an old client, then explicitly start a new connection; other cache identities are retained.

Refreshes are single-flight per refresher instance. A lease loser waits through the injected clock/sleep ports and re-reads, rather than redeeming a rotating refresh token again. Persistence completes before a fresh access token is returned; terminal grant errors mark reauthorization best-effort, while transient failures remain transient. A refresh response omitting a refresh token retains the previous one.

## Error and grant contracts

`new OAuthError({ code, message, operatorAction }, { cause, providerErrorCode, retryAfterSeconds })` separates required recovery guidance from optional metadata. Omit absent optional fields under `exactOptionalPropertyTypes`. `isOAuthError({ value })` narrows the argument object's `value`. `OAuthError` carries `code`, `operatorAction`, `retryable`, optional `providerErrorCode`, and optional `retryAfterSeconds`. Only `OAUTH_AUTHORIZATION_PENDING` and `OAUTH_SLOW_DOWN` are retryable. Code exchange, registration and refresh each make one attempt. Provider `error_description` is never placed in operator-facing errors. Token responses use absolute expiry, `null` for absent refresh tokens/expiry, and normalized scopes.

`beginDeviceAuthorization` returns the secret device code separately from its display code/link and clamps expiry/interval values. `pollDeviceAuthorizationOnce` checks local expiry and makes at most one request. The app owns polling cadence, increasing the interval for `slow_down`, cancellation and UI.

## Development and release

Build/typecheck with `tsc -p tsconfig.json` / `tsc -p tsconfig.json --noEmit`. Run individual files with `vitest run tests/<file>.test.ts`. `discovery.port.test.ts` and `dynamic-registration.port.test.ts` require an environment permitted to bind loopback ports; all other suites use injected HTTP doubles. `npm pack --dry-run` should include each compiled public entry, README, API and CHANGELOG, without tests. Public operations take `(requiredArgs, optionalArgs)`: ports and required request fields belong in argument one; optional settings belong in argument two. Operations without inputs take `{}`. See [API.md](https://github.com/AINSEP/Jini/blob/main/packages/oauth/API.md) for every current signature, port method and subpath.

## Additional entries

The root barrel retains all existing exports and also shares implementations with three direct Node entries:

The DNS-pinned transport requires `OAuthDispatcherPort.dispatcher` to match Node's non-null `RequestInit['dispatcher']` type. Hosts supply a native Undici dispatcher; the transport forwards it through the existing `RequestInit` contract.

| Subpath | Exports |
|---|---|
| `./discovery-policy` | `createIssuerBoundDiscoveryPolicy` and its metadata-policy port |
| `./dns-pinned-transport` | `createDnsPinnedOAuthTransport`, transport result and DNS/address/dispatcher ports |

Discovery defaults to `createIssuerBoundDiscoveryPolicy({})`: advertised issuers must match exactly and supplied endpoints must use HTTPS on that origin. An explicit `metadataPolicy: "none"` in the second object disables binding for a host that needs compatibility. Policy failures terminate discovery. Supply DNS, address policy, dispatcher construction, HTTP and URL guard ports to `createDnsPinnedOAuthTransport`, and call `close({})` at shutdown. Request inputs retain method/body/headers/cancellation; the adapter checks IP literals before fetch (Node skips DNS lookup for them) and forces its dispatcher and redirect refusal. Hosts own their native DNS and Undici dependencies.

The provider primitives preserve the existing fixed-issuer raw token and error contracts. Their HTTP, entropy, clock and scheduler dependencies are required ports. Their synchronous pending cache is distinct from the owner-bound async pending-authorization store. The complete contracts and those distinctions are in [API.md](https://github.com/AINSEP/Jini/blob/main/packages/oauth/API.md).

The main API now owns PKCE/state, fixed-issuer code exchange, refresh, URL redaction and pending storage. It depends on `@jini-ai/core`; clocks implement `nowMs()`. PKCE defaults to 32 bytes; `{ verifierBytes: 64 }` preserves provider verifier length. Grant results are normalized `OAuthTokenSet`; the redundant raw-wire API and subpath are removed. Hosts can replace reserved-parameter/registration prose with `defaultOAuthMessages` through the `messages` option. Registration wire identity remains `clientDisplayName`, `softwareId`, and `redirectUris`.

Path-scoped issuer discovery fails after its path candidates by default. Set `allowOriginFallback: true` explicitly to try origin-wide metadata; issuer binding remains enabled. The explicit `allowLoopbackHttp` exception includes all IPv4 loopback and mapped IPv6 loopback literals and still invokes the host policy. Synchronous callback storage is an expiry option of `createPendingAuthorizationStore`; see API.md for the scheduler and capacity contract.
