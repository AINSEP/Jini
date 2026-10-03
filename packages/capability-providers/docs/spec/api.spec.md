Spec ID: SPEC-JINI-CAPABILITY-PROVIDERS-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:843a4a9db6915ebfb75038a4e9f5386c44747103ec34dfa07dfd36c57cc54952
spec_mode: reverse_spec


# Capability providers API contract

## Public entry points

| Import from `@jini-ai/capability-providers` | Surface |
| --- | --- |
| Root | Provider interfaces, record/session types and five provider tokens; no implementation factory |
| `/visitor-auth` | Provider metadata, registry, authorization planning, callback/claims evaluation, ports and seven visitor-auth tokens |
| `/unsafe-reference` | Five in-memory reference factories |
| `/adapters/ws` | `WebSocketRealtimeProvider`, `createWebSocketRealtimeProvider`, structural socket/server types |
| `/adapters/sqlite` | `SqliteDbProvider` |
| `/adapters/blob-storage` | `BlobStorageProvider` |
| `/adapters/jwt-auth` | `JwtAuthProvider` |
| `/adapters/stripe` | `StripePaymentsProvider`, `StripePaymentsProviderError` |

Signatures below describe current source. Empty optional objects are shown only when accepted. The database interface and its implementations still use positional arguments; consumers must not wrap them in invented objects. Constructors generally have one required object; the SQLite constructor is positional.

## Root ports

All operations return promises, except realtime subscription, which returns an unsubscribe function.

| Interface | Current methods | Result |
| --- | --- | --- |
| `AuthProvider` | `signUp({ email, password })`; `signIn({ email, password })`; `signOut({ token })`; `verifySession({ token })` | `AuthUser`; `AuthSession`; `void`; `AuthUser \\| null` |
| `StorageProvider` | `put({ key, data }, { contentType? } = {})`; `get({ key })`; `delete({ key })`; `list({}, { prefix? } = {})` | `StorageObjectMeta`; `Uint8Array \\| null`; `void`; `StorageObjectMeta[]` |
| `PaymentsProvider` | `charge({ amountCents, currency, customerRef }, { description? } = {})`; `getCharge({ id })`; `refund({ id })` | `Charge`; `Charge \\| null`; `Charge` |
| `DbProvider` | `insert(collection, record)`; `get(collection, id)`; `update(collection, id, patch)`; `delete(collection, id)`; `query(collection, query?)` | `DbRecord`; `DbRecord \\| null`; `DbRecord \\| null`; `void`; `DbRecord[]` |
| `RealtimeProvider` | `publish({ channel, event })`; `subscribe({ channel, handler })` | `void`; `() => void` |

`AuthUser` contains `id`, `email`, `createdAt` (epoch milliseconds). `AuthSession` contains `token`, `userId`, `expiresAt` (milliseconds). Storage metadata is `{ key, size, contentType?, updatedAt }`; bytes are `Uint8Array`. `Charge` has `id`, `amountCents`, `currency`, `customerRef`, `createdAt`, and status `pending | succeeded | failed | refunded`. `DbRecord` has string `id` plus arbitrary fields. Database query is `{ where?: Record<string, unknown> }`. Realtime handlers receive `{ event }` synchronously.

`AuthProviderToken`, `StorageProviderToken`, `PaymentsProviderToken`, `DbProviderToken`, `RealtimeProviderToken` are typed DI tokens whose keys are `jini.capabilityProviders.auth`, `.storage`, `.payments`, `.db`, `.realtime` respectively. The consumer chooses and binds implementations; the package does not resolve dependencies automatically.

## Adapter construction and dependencies

| Entry point | Current signature | Consumer supplies / return |
| --- | --- | --- |
| Blob storage | `new BlobStorageProvider({ blobStorage, namespace })` | `@jini-ai/platform` `BlobStorage` with `writeFile(namespace, key, Buffer)`, `readFile`, `deleteFile`, `listFiles`; nonempty namespace; implements `StorageProvider` |
| SQLite | `new SqliteDbProvider(db)` | Open `better-sqlite3` database; implements `DbProvider`; consumer owns connection lifetime |
| JWT | `new JwtAuthProvider({ secret }, { sessionTtlMs?, now? } = {})` | HMAC secret; optional millisecond clock; implements `AuthProvider`; uses Node crypto and local user state |
| Stripe | `new StripePaymentsProvider({ secretKey }, { now?, fetchFn?, apiBase? } = {})` | Secret API key; native fetch or injected fetch; optional millisecond clock/base URL; implements `PaymentsProvider` |
| WebSocket | `new WebSocketRealtimeProvider({ server })` | Structural server supporting `on({ event: 'connection', listener })`; implements `RealtimeProvider` |
| WebSocket factory | `createWebSocketRealtimeProvider({ wsOptions }, { createServer? } = {})` | `ws` server options; optional `createServer({ wsOptions })`; returns `{ provider, server }` |

Structural sockets support `send({ data })`, `on({ event, listener })`, and `readyState`. `ws` is an optional peer but the adapter module imports it at load time. Node-specific adapters require a Node host; browser consumers should import appropriate subpaths rather than all adapters.

```ts
import { StripePaymentsProvider } from '@jini-ai/capability-providers/adapters/stripe';
const payments = new StripePaymentsProvider(
  { secretKey: paymentApiKey },
  { fetchFn: fetch, now: () => Date.now() },
);
const charge = await payments.charge(
  { amountCents: 1200, currency: 'usd', customerRef: customerId },
  { description: 'Account credit' },
);
```

```ts
import type { StorageProvider } from '@jini-ai/capability-providers';
import { BlobStorageProvider } from '@jini-ai/capability-providers/adapters/blob-storage';
import { SqliteDbProvider } from '@jini-ai/capability-providers/adapters/sqlite';
import { JwtAuthProvider } from '@jini-ai/capability-providers/adapters/jwt-auth';
import { createWebSocketRealtimeProvider } from '@jini-ai/capability-providers/adapters/ws';
const storage: StorageProvider = new BlobStorageProvider({ blobStorage, namespace: 'uploads' });
const records = new SqliteDbProvider(openDatabase);
const auth = new JwtAuthProvider({ secret: sessionSecret });
const { provider: realtime, server } = createWebSocketRealtimeProvider({ wsOptions: { noServer: true } });
const unsubscribe = realtime.subscribe({ channel: 'updates', handler: ({ event }) => onUpdate(event) });
// The host supplies blobStorage/openDatabase and owns WebSocket upgrades and server closure.
```

## Reference factories

These factories have no external ports and keep state in the returned closure. They are explicit development/reference implementations.

| Factory from `/unsafe-reference` | Return |
| --- | --- |
| `createInMemoryAuthProvider({}, { sessionTtlMs?, now? } = {})` | `AuthProvider` |
| `createInMemoryStorageProvider({}, { now? } = {})` | `StorageProvider` |
| `createInMemoryPaymentsProvider({}, { now? } = {})` | `PaymentsProvider` |
| `createInMemoryDbProvider()` | `DbProvider` |
| `createInMemoryRealtimeProvider({})` | `RealtimeProvider` |

```ts
import { createInMemoryStorageProvider } from '@jini-ai/capability-providers/unsafe-reference';
const storage = createInMemoryStorageProvider({}, { now: () => 1000 });
await storage.put({ key: 'example.txt', data: new TextEncoder().encode('example') });
const objects = await storage.list({}, { prefix: 'example' });
```

## Visitor-auth metadata and registry

`GOOGLE_VISITOR_AUTH_PROVIDER`, `FACEBOOK_VISITOR_AUTH_PROVIDER`, `LINKEDIN_VISITOR_AUTH_PROVIDER` and `BUILT_IN_VISITOR_AUTH_PROVIDERS` are metadata-only definitions. A `VisitorAuthProviderDefinition` has `id`, `label`, `protocol: 'oauth2' | 'oidc'`, `implementation: 'metadata-only'`, credential fields (`key`, `label`, `kind`, `required`), `defaultScopes` and optional `discoveryUrl`. They perform no OAuth requests.

`createVisitorAuthProviderRegistry({}, { seed? } = {})` returns `VisitorAuthProviderRegistry`: `register({ definition }): void`, `get({ providerId }): definition | undefined`, `has({ providerId }): boolean`, `list(): readonly definition[]`. The optional seed is an array of definitions. Returned definitions are frozen normalized copies.

## Visitor-auth lifecycle functions

| Function | Current signature / result |
| --- | --- |
| Authorization plan | `planVisitorAuthAuthorization({ provider, server, registration, redirectUri, flowBinding, security, nowMs }, { ttlMs?, extraParameters? } = {})` → `{ authorizationUrl, transaction }` |
| Callback decision | `evaluateVisitorAuthCallback({ transaction, callback, tenantId, flowBinding, nowMs })` → exchange decision containing an exchange request, or rejection with a reason |
| Verified claims decision | `validateVisitorAuthIdentityClaims({ transaction, claims, nowSeconds }, { clockSkewSeconds? } = {})` → accepted `{ providerId, subject, email?, emailVerified? }` identity, or rejection with a reason |

`server` contains `providerId`, `authorizationEndpoint`, `tokenEndpoint`, optional `issuer`, `supportsPkceS256`, optional `requiresAuthorizationResponseIssuer`. `registration` contains `tenantId`, `providerId`, `clientId`, optional `clientSecretRef: { id }`. `security` contains fresh `state`, optional `nonce`, `codeVerifier`, `codeChallenge`. `callback` contains optional `state`, `code`, `issuer`, `error`, `errorDescription`. `transaction` retains the tenant, provider, browser binding, protocol, PKCE verifier, client/secret reference, redirect/token endpoints, issuer expectations and creation/expiry times.

`claims` must already have been cryptographically verified: `issuer`, `subject`, `audience: string | readonly string[]`, optional `authorizedParty`, `expiresAtSeconds`, optional `nonce`, `email`, `emailVerified`. The evaluator checks binding and expiry; it does not verify JWT signatures.

`VisitorAuthRegistryError` and `VisitorAuthConfigurationError` are also exported from `/visitor-auth`; their constructors, codes and handling are in `errors.spec.md`.

## Visitor-auth ports and wiring

| Port | Required method signatures |
| --- | --- |
| `VisitorAuthClientRegistrationPort` | `resolve({ tenantId, providerId }): Promise<registration \\| undefined>` |
| `VisitorAuthAuthorizationServerPort` | `resolve({ provider }): Promise<server>` |
| `VisitorAuthSecurityPort` | `createAuthorizationArtifacts({ protocol }): Promise<security>` |
| `VisitorAuthTransactionStorePort` | `save({ transaction }): Promise<void>`; `consume({ tenantId, state }): Promise<transaction \\| undefined>` |
| `VisitorAuthTokenExchangePort` | `exchange(request): Promise<tokens>`; `refresh({ tenantId, providerId, clientId, clientSecretRef?, refreshToken }): Promise<tokens>`; `revoke({ tenantId, providerId, token }): Promise<void>` |
| `VisitorAuthIdTokenVerifierPort` | `verify({ providerId, idToken, expectedIssuer }): Promise<claims>` |

`tokens` contains `accessToken`, `tokenType`, optional `expiresInSeconds`, `refreshToken`, `idToken`, `grantedScopes`. Exchange requests come from successful callback decisions and include the bound client, redirect, authorization code and verifier. The consumer supplies all port implementations, trusted discovery, CSPRNG/PKCE generation, secret lookup and atomic one-time transaction consumption.

Visitor-auth DI tokens are `VisitorAuthProviderRegistryToken`, `VisitorAuthClientRegistrationToken`, `VisitorAuthAuthorizationServerToken`, `VisitorAuthSecurityToken`, `VisitorAuthTransactionStoreToken`, `VisitorAuthTokenExchangeToken`, `VisitorAuthIdTokenVerifierToken`. Their key prefix is `jini.capabilityProviders.visitorAuth.` and suffixes are `providerRegistry`, `clientRegistration`, `authorizationServer`, `security`, `transactionStore`, `tokenExchange`, `idTokenVerifier`.

```ts
import { GOOGLE_VISITOR_AUTH_PROVIDER, planVisitorAuthAuthorization }
  from '@jini-ai/capability-providers/visitor-auth';
const provider = GOOGLE_VISITOR_AUTH_PROVIDER;
const plan = planVisitorAuthAuthorization({
  provider,
  server: await authorizationServers.resolve({ provider }),
  registration, redirectUri, flowBinding,
  security: await securityPort.createAuthorizationArtifacts({ protocol: provider.protocol }),
  nowMs: clock.nowMs(),
});
await transactionStore.save({ transaction: plan.transaction });
// Redirect to plan.authorizationUrl. Consume the saved transaction before evaluating a callback.
```

The example assumes a trusted server port, validated registration, browser-bound flow identifier and host clock. No HTTP router, account linking, user session or DI container implementation is supplied.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `AuthCredentials` | interface; [auth.ts](../../src/auth.ts) |
| `BlobStorageProviderOptions` | interface; [index.ts](../../src/adapters/blob-storage/index.ts) |
| `ChargeInput` | interface; [payments.ts](../../src/payments.ts) |
| `ChargeStatus` | type; [payments.ts](../../src/payments.ts) |
| `CreateWebSocketRealtimeProviderOptions`, `RealtimeWebSocketLike`, `RealtimeWebSocketServerLike`, `WebSocketRealtimeProviderOptions` | interface; [index.ts](../../src/adapters/ws/index.ts) |
| `DbQuery` | interface; [db.ts](../../src/db.ts) |
| `InMemoryAuthProviderOptions` | interface; [auth.ts](../../src/unsafe-reference/auth.ts) |
| `JwtAuthProviderOptionalArgs`, `JwtAuthProviderOptions` | interface; [index.ts](../../src/adapters/jwt-auth/index.ts) |
| `RealtimeHandler`, `RealtimeUnsubscribe` | type; [realtime.ts](../../src/realtime.ts) |
| `StoragePutOptions` | interface; [storage.ts](../../src/storage.ts) |
| `StripePaymentsProviderOptionalArgs`, `StripePaymentsProviderOptions` | interface; [index.ts](../../src/adapters/stripe/index.ts) |
| `VisitorAuthAuthorizationPlan`, `VisitorAuthCallbackParameters` | interface; [lifecycle.ts](../../src/visitor-auth/lifecycle.ts) |
| `VisitorAuthAuthorizationServer`, `VisitorAuthClientRegistration`, `VisitorAuthClientSecretRef`, `VisitorAuthSecurityArtifacts`, `VisitorAuthTokenExchangeRequest`, `VisitorAuthTokenSet`, `VisitorAuthTransaction`, `VisitorAuthVerifiedIdTokenClaims` | interface; [ports.ts](../../src/visitor-auth/ports.ts) |
| `VisitorAuthCallbackDecision`, `VisitorAuthCallbackRejectionReason`, `VisitorAuthConfigurationErrorCode`, `VisitorAuthIdentityClaimsDecision`, `VisitorAuthIdentityClaimsRejectionReason` | type; [lifecycle.ts](../../src/visitor-auth/lifecycle.ts) |
| `VisitorAuthCredentialFieldDefinition` | interface; [definitions.ts](../../src/visitor-auth/definitions.ts) |
| `VisitorAuthCredentialFieldKind`, `VisitorAuthProtocol` | type; [definitions.ts](../../src/visitor-auth/definitions.ts) |
| `VisitorAuthRegistryErrorCode` | type; [registry.ts](../../src/visitor-auth/registry.ts) |

## Current manifest boundary

The current `package.json` exposes `.`, `./visitor-auth`, `./unsafe-reference`, `./adapters/ws`, `./adapters/sqlite`, `./adapters/blob-storage`, `./adapters/jwt-auth`, `./adapters/stripe`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
