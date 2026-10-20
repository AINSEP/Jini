# @jini-ai/oauth

A standalone OAuth 2.x client for Node 20 or later, backed by `openid-client` 6.8.8. It supports RFC 8414 authorization-server discovery (including OIDC fallback paths), RFC 9728 protected-resource metadata and challenges, RFC 7591 registration, authorization code with S256 PKCE, RFC 8628 device authorization, refresh, RFC 8707 resource indicators, RFC 7009 revocation, explicit OIDC ID-token validation, and typed errors. It shares clocks and timestamp types with `@jini-ai/core`.

## Protocol implementation and compatibility

The existing exports and `(requiredArgs, optionalArgs = {})` contracts remain source-compatible. Consumers continue to import Jini's facade; upstream configuration objects and error types are internal. PKCE, state generation, authorization-URL formatting and redaction stay synchronous. PKCE hashing uses Node's standard crypto implementation because upstream hashing is asynchronous; entropy remains an injected port.

| Operation | Protocol implementation | Jini and host responsibilities |
|---|---|---|
| Authorization URL, token grants, refresh, device initiation, revocation | `openid-client` | State/PKCE/resource binding, normalization, errors, one-attempt grants and host-owned device polling |
| Authorization-server discovery | `openid-client` direct-document discovery | Candidate order, explicit origin fallback, original-document issuer policy and endpoint safety |
| Protected-resource discovery | `oauth4webapi` 3.8.8 request builder; no high-level equivalent in `openid-client` | Candidate selection, facade normalization and resource-scope policy |
| Endpoint-only registration | `oauth4webapi` request/response operations; `openid-client` registration would add issuer discovery | Registration identity, auth-method selection and cache lifecycle |
| Already received ID-token validation | `oauth4webapi` claim processing and mandatory application signature verification; no standalone high-level equivalent in `openid-client` | Explicit issuer/JWKS/client/nonce trust, guarded retrieval and safe errors |

Every upstream HTTP operation uses a `customFetch` hook backed by the same guarded transport. It checks the actual request URL, serializes form bodies to strings for host adapters, refuses redirects, bounds response bytes (64 KiB, or 16 KiB for device initiation), and applies the operation deadline through body consumption. There is no library fallback to native fetch. The supplied host fetch port still owns connection-time DNS/address policy and must honor cancellation through the body read. Pending/sealed state, registration caching, refresh single-flight, leases, persist-before-return and redaction remain Jini/host responsibilities.

The migration intentionally tightens these previously permissive cases:

- Successful token responses require HTTP 200; another 2xx is `OAUTH_MALFORMED_RESPONSE`. Valid JSON objects with a non-JSON media type remain accepted. Device and registration compatibility still accepts successful 2xx JSON objects.
- Unsupported token types, such as `mac`, are `OAUTH_MALFORMED_RESPONSE`. Bearer and DPoP spellings are validated case-insensitively while the facade preserves provider casing. The generic token-exchange grant also permits upstream's `n_a` type. This does not add DPoP proof management to the facade.
- Empty client ids, absent/empty secrets for confidential-client methods, missing/empty grant types and empty refresh tokens are `OAUTH_INVALID_REQUEST` before HTTP. The synchronous authorization-URL builder also refuses empty client ids and non-HTTP(S) authorization endpoints.
- HTTP Basic client credentials now use RFC 6749 form encoding before Base64, including `+` for spaces, instead of `encodeURIComponent`'s `%20`.
- Returned redirects are refused even if an injected HTTP port ignores `redirect: 'error'`; this also makes such discovery failures terminal.
- Invalid dynamic-registration initial-access-token headers are `OAUTH_INVALID_REQUEST` before dispatch; their values are never exposed in facade errors.

Upstream validates required token types and optional token fields; missing/empty token types, empty refresh tokens and malformed lifetimes are no longer repaired locally. Provider errors, including device polling signals on HTTP 200, retain the facade error codes and recovery copy. ID-token retention does not enable identity validation implicitly. Device responses must use `verification_uri` and valid lifetimes/intervals; registration responses with secrets must declare a valid secret expiry. Discovery documents must identify their issuer, and protected-resource metadata must identify the requested resource.

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

`new OAuthError({ code, message, operatorAction }, { cause, providerErrorCode, retryAfterSeconds })` separates required recovery guidance from optional metadata. Omit absent optional fields under `exactOptionalPropertyTypes`. `isOAuthError({ value })` narrows the argument object's `value`. `OAuthError` carries `code`, `operatorAction`, `retryable`, optional `providerErrorCode`, and optional `retryAfterSeconds`. Only `OAUTH_AUTHORIZATION_PENDING` and `OAUTH_SLOW_DOWN` are retryable. `OAUTH_AUTHORIZATION_CANCELLED` and `OAUTH_AUTHORIZATION_EXPIRED` come only from the loopback receiver. Code exchange, registration and refresh each make one attempt. Provider `error_description` is never placed in operator-facing errors. Token responses use absolute expiry, `null` for absent refresh tokens/expiry, and normalized scopes.

`beginDeviceAuthorization` returns the secret device code separately from its display code/link and clamps expiry/interval values. `pollDeviceAuthorizationOnce` checks local expiry and makes at most one request. The app owns polling cadence, increasing the interval for `slow_down`, cancellation and UI.

## Revocation and OIDC validation

These are root exports; no additional subpath or upstream import is needed:

```ts
import { revokeOAuthToken, validateOidcIdToken } from '@jini-ai/oauth';

// Disable this connection locally before attempting remote revocation.
await appConnectionStore.disable({ key: connectionKey });
await revokeOAuthToken({
  ...http, revocationEndpoint: trustedProvider.revocationEndpoint, client,
  token: tokens.refreshToken ?? tokens.accessToken,
}, { tokenTypeHint: tokens.refreshToken === null ? 'access_token' : 'refresh_token' });

// Use the nonce recorded for this authorization attempt and trusted provider metadata.
const claims = await validateOidcIdToken({
  ...http, clock, tokens, issuer: trustedProvider.issuer,
  jwksUri: trustedProvider.jwksUri, clientId: client.clientId,
  expectedNonce: attempt.nonce,
}, { signingAlgorithm: 'RS256' });
```

`revokeOAuthToken` returns `Promise<void>` and sends exactly one request using the existing client-authentication owner. `tokenTypeHint` and `timeoutMs` are optional. HTTP 200 confirms the RFC 7009 request even for an already invalid token; its body is ignored after transport bounds. Other statuses (including 204/205) are not confirmation. The host owns local disablement, secret deletion, pending/confirmed status and any explicit retry. Local disconnect alone does not invoke remote revocation.

`OAuthTokenSet.idToken?: string` retains a nonempty `id_token` from token, refresh or device responses as sensitive, **unvalidated** data. OAuth-only exchange never fetches JWKS or trusts an issuer inferred from the token endpoint. Call `validateOidcIdToken` before using it for identity. Its required inputs are the HTTP ports, `clock`, `tokens`, trusted `issuer`, `jwksUri`, `clientId` and `expectedNonce`. Optional inputs are `signingAlgorithm`, `clockToleranceSeconds`, `maxAgeSeconds` and `timeoutMs`. It returns `Promise<OidcIdTokenClaims>` only after issuer, audience, time, nonce and signature checks succeed. Invalid tokens produce `OAUTH_MALFORMED_RESPONSE` without upstream causes containing tokens or claims; guarded endpoint/transport errors remain facade errors.

RS256 is the configured default and clock tolerance defaults to zero; the algorithm is never chosen from the token header. Only the configured JWKS URI is fetched, never a token's `jku`/`x5u`. A nonce expectation is mandatory: send a freshly generated nonce as `extraAuthorizationParams.nonce` and bind it to the attempt in host storage, then supply it here. Jini's existing pending/sealed-state contract does not store a nonce automatically. Pass `expectedNonce: null` only when no nonce was sent; a token containing one then fails. Set `maxAgeSeconds` when the authorization request used `max_age`. Validation processes an already received token set and does not redeem a grant again or install an account.

Supply trusted JWKS/revocation metadata separately: `DiscoveredAuthorizationServer` has no new endpoint fields. Existing discovery policies check their existing endpoint set; a custom host policy must explicitly validate any newly consumed metadata before adopting it. Token stores and provider-specific DTOs that select only existing fields remain compatible but omit `idToken`; preserving it across persistence requires an explicit host contract change. Treat retained ID tokens as credentials and exclude them from logs and UI. Additional root types are `RevokeOAuthTokenInput`, `OAuthTokenTypeHint`, `ValidateOidcIdTokenInput`, `OidcTrustConfiguration`, `OidcIdTokenClaims` and `OidcSigningAlgorithm`.

## Development and release

Build/typecheck with `tsc -p tsconfig.json` / `tsc -p tsconfig.json --noEmit`. Run individual files with `vitest run tests/<file>.test.ts`. Suites using loopback fixtures, including `discovery.port.test.ts`, `dynamic-registration.test.ts`, `dynamic-registration.port.test.ts` and `oidc-and-revocation.test.ts`, require an environment permitted to bind loopback ports. Migration contract suites also cover string-only transport bodies, redirect/size/deadline enforcement, facade normalization, one-shot grants and refresh persistence. `npm pack --dry-run` should include each compiled public entry, README, API and CHANGELOG, without tests. Public operations take `(requiredArgs, optionalArgs)`: ports and required request fields belong in argument one; optional settings belong in argument two. Operations without inputs take `{}`. See [API.md](https://github.com/AINSEP/Jini/blob/main/packages/oauth/API.md) for the existing signature, port and subpath reference; the additive revocation/OIDC contracts are described above.

## Additional entries

The root barrel retains all existing exports and shares implementations with these direct Node entries:

The DNS-pinned transport requires `OAuthDispatcherPort.dispatcher` to match Node's non-null `RequestInit['dispatcher']` type. Hosts supply a native Undici dispatcher; the transport forwards it through the existing `RequestInit` contract.

| Subpath | Exports |
|---|---|
| `./discovery-policy` | `createIssuerBoundDiscoveryPolicy` and its metadata-policy port |
| `./dns-pinned-transport` | `createDnsPinnedOAuthTransport`, transport result and DNS/address/dispatcher ports |

`startLoopbackAuthorizationReceiver`, its receiver/result/options/timer types and field limits are root exports.

Discovery defaults to `createIssuerBoundDiscoveryPolicy({})`: advertised issuers must match exactly and supplied endpoints must use HTTPS on that origin. An explicit `metadataPolicy: "none"` in the second object disables binding for a host that needs compatibility. Policy failures terminate discovery. Supply DNS, address policy, dispatcher construction, HTTP and URL guard ports to `createDnsPinnedOAuthTransport`, and call `close({})` at shutdown. Request inputs retain method/body/headers/cancellation; the adapter checks IP literals before fetch (Node skips DNS lookup for them) and forces its dispatcher and redirect refusal. Hosts own their native DNS and Undici dependencies.

The provider primitives preserve the existing fixed-issuer raw token and error contracts. Their HTTP, entropy, clock and scheduler dependencies are required ports. Their synchronous pending cache is distinct from the owner-bound async pending-authorization store. The complete contracts and those distinctions are in [API.md](https://github.com/AINSEP/Jini/blob/main/packages/oauth/API.md).

The main API now owns PKCE/state, fixed-issuer code exchange, refresh, URL redaction and pending storage. It depends on `@jini-ai/core`; clocks implement `nowMs()`. PKCE defaults to 32 bytes; `{ verifierBytes: 64 }` preserves provider verifier length. Grant results are normalized `OAuthTokenSet`; the redundant raw-wire API and subpath are removed. Hosts can replace reserved-parameter/registration prose with `defaultOAuthMessages` through the `messages` option. Registration wire identity remains `clientDisplayName`, `softwareId`, and `redirectUris`.

Path-scoped issuer discovery fails after its path candidates by default. Set `allowOriginFallback: true` explicitly to try origin-wide metadata; issuer binding remains enabled. The explicit `allowLoopbackHttp` exception includes all IPv4 loopback and mapped IPv6 loopback literals and still invokes the host policy. Synchronous callback storage is an expiry option of `createPendingAuthorizationStore`; see API.md for the scheduler and capacity contract.

## Installed-app loopback receiver

Desktop hosts cannot register a fixed HTTPS callback, so the installed-app flow (RFC 8252 §7.3) sends the system browser back to `http://127.0.0.1:<port>/callback`. `startLoopbackAuthorizationReceiver` opens that listener on an ephemeral port and hands back its redirect URI. Starting and arming are separate because `beginAuthorizationCode` needs the redirect URI before it mints the state:

```ts
import { startLoopbackAuthorizationReceiver } from '@jini-ai/oauth';

const abort = new AbortController();
const receiver = await startLoopbackAuthorizationReceiver({}, {
  path: '/callback', callbackFields: ['picked_ids'], signal: abort.signal, // timeoutMs defaults to 10 minutes
});
const started = await beginAuthorizationCode({ ...deps, redirectUri: receiver.redirectUri, options: { ...identity, redirectUris: [receiver.redirectUri] } });
const callback = receiver.receive({ expectedState: started.state }); // arm before opening the browser
await openSystemBrowser(started.authorizationUrl);
const { code, fields } = await callback;                             // fields: only declared names that were present
const tokens = await completeAuthorizationCode({ ...deps, params: { state: started.state, code } });
```

What it guarantees: it binds `127.0.0.1` only; it answers only requests whose `Host` is exactly that origin (DNS-rebinding defence); wrong paths, other methods, requests with a body, oversized headers (16 KiB, 64 headers) and requests before `receive` is armed are refused without consuming the slot. State is compared in constant time first. A request whose state does not match is answered with the static failure page and does not consume the slot, so a local process or a web page probing loopback ports cannot end the sign-in; the 16th such request ends it as `OAUTH_INVALID_STATE` (the timeout bounds the rest). The first request whose state matches consumes the slot whatever else it says: a provider `error` becomes a typed failure (`OAUTH_ACCESS_DENIED` for a declined consent, otherwise `OAUTH_PROVIDER_REJECTED`), then the code and declared fields are read. Repeated parameters, a missing or oversized code and declared fields over 4096 characters are `OAUTH_INVALID_REQUEST`. At most 16 fields may be declared and protocol names (`code`, `state`, `error`, `error_description`, `error_uri`, `iss`) cannot be. The browser always gets one of two static pages with `Content-Security-Policy: default-src 'none'` and `Cache-Control: no-store`; nothing from the request is echoed. The listener closes on the callback, on abort (`OAUTH_AUTHORIZATION_CANCELLED`) and on expiry (`OAUTH_AUTHORIZATION_EXPIRED`); the `receive` promise settles after the port is closed. Inject `timers: { after({ ms, run }) => cancel }` to drive expiry in tests.

Extension point: a provider plugin needs nothing provider-specific here. It declares any extra callback field names (for example a picked resource id), and checks those fields against its own API after the code exchange; a field is never trusted on its own. The redirect URI is plain-HTTP loopback, so the `guard` given to `beginAuthorizationCode` must accept it.
