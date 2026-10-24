# @jini-ai/oauth

## 0.6.11

### Patch Changes

- OAuth accepts a parent protected-resource identifier and forwards the refresh resource; settings definitions are filtered; scope selectors are never id shorthand; secret-named URL parameters are masked by default in redaction.
- Updated dependencies
- Updated dependencies
  - @jini-ai/core@0.6.11

## 0.6.10

### Patch Changes

- Updated dependencies [22f0619]
- Updated dependencies [82ed2d3]
- Updated dependencies [5a3de86]
  - @jini-ai/core@0.6.10

## 0.2.3 — 2026-10-22

- 2026-10-22: Protocol handling rebased on openid-client/oauth4webapi behind the facade; device-flow and build fixes, coverage.

## 0.2.1

### Patch Changes

- Tovu clean-up release (2026-10-08): code Tovu moved into Jini, plus the Jini clean-up (see the commit log since 0.2.0).

## 0.2.0 — 2026-10-02

### BREAKING

- Provider primitives were consolidated into the main OAuth API; messages and clock contracts use neutral defaults and core ports.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

### Changed — OAuth adapter trim

- Delete local token/device validators, discovery JSON-object parsing, registration response projections and repeated transport-error wrappers; call the pinned upstream processors directly.
- Retain one facade response adapter for nonstandard error statuses, successful device/registration status normalization, provider token-type casing and opaque ID-token retention; upstream decodes protocol errors and validates fields.
- Adopt upstream required/optional field validation: no local repair of missing token types, empty token fields, malformed device timing or incomplete secret-bearing registrations. Discovery requires an issuer and RFC 9728 resource binding.
- Normalize Google's legacy string `verification_url` to `verification_uri` only when the standard field is absent, before upstream device-response validation and host display-URL safety checks.
- Retain synchronous PKCE hashing with Node crypto because upstream hashing is asynchronous. Transport safety, state/cache lifecycle and refresh coordination remain host-owned.

### Changed — OAuth protocol library migration

- Use pinned `openid-client` 6.8.8 for authorization URLs, token grants/client authentication, refresh, device initiation, authorization-server discovery and revocation, behind the unchanged `@jini-ai/oauth` facade. Use `oauth4webapi` 3.8.8 only for protected-resource discovery, endpoint-only registration and standalone validation of already received ID tokens, where the high-level API does not fit the facade's contract.
- Route every upstream HTTP request, including discovery, registration, revocation and JWKS, through guarded `customFetch`. Preserve host endpoint/DNS policy, string-only form/JSON bodies, redirect refusal, byte caps and operation deadlines through response-body consumption.
- Retain synchronous PKCE/state/URL/redaction helpers, required/optional argument objects, `OAuthError` codes and existing recovery copy, normalized OAuth fields, pending/sealed state, issuer policy, resource indicators, registration caching and host-owned one-shot device polling. Refresh single-flight, leases, rotation preservation and persist-before-return remain in Jini.

### Intentional behavior changes

- Refuse successful-looking token responses with a non-200 status, a missing token type or an unsupported token type as `OAUTH_MALFORMED_RESPONSE`. Preserve valid JSON responses with non-JSON media types and provider token-type casing; device/registration compatibility still accepts successful 2xx JSON objects.
- Require HTTP 200 for authorization-server and protected-resource discovery documents; other successful statuses are malformed responses.
- Send the HTTP Basic authorization header during device initiation when the client uses `client_secret_basic`.
- Omit the authorization header for an explicitly empty dynamic-registration initial access token.
- Refuse empty client ids, missing/empty confidential-client secrets, missing/empty grant types and empty refresh tokens as `OAUTH_INVALID_REQUEST` before dispatch. Synchronous authorization-URL formatting also refuses empty client ids and non-HTTP(S) authorization endpoints.
- Encode HTTP Basic client credentials using RFC 6749 form encoding before Base64 (`+` for spaces replaces the old `%20` encoding).
- Reject returned redirects even when an injected fetch port ignores redirect refusal; discovery treats these safety failures as terminal.
- Map invalid dynamic-registration initial-access-token headers to `OAUTH_INVALID_REQUEST` before dispatch, without exposing their values.
- Retain nonempty `id_token` as the optional, sensitive, unvalidated `OAuthTokenSet.idToken`. OAuth-only grants perform no implicit discovery, JWKS retrieval or identity validation; results without an ID token keep their existing shape.

### Added — revocation and explicit OIDC

- Add root `revokeOAuthToken` with `RevokeOAuthTokenInput` and `OAuthTokenTypeHint`: one RFC 7009 request using existing client authentication, optional hint/deadline, and HTTP 200 confirmation including unknown-token success. Other statuses are not confirmation; local disablement, credential deletion and retries remain host-owned.
- Add root `validateOidcIdToken`, `ValidateOidcIdTokenInput`, `OidcTrustConfiguration`, `OidcIdTokenClaims` and `OidcSigningAlgorithm`. Require explicit trusted issuer/JWKS/client identity, clock, token set and nonce expectation; validate claims and the application signature before returning claims. Default to RS256 and zero time tolerance; support explicit max authentication age and configured digital signature algorithms. Never derive trust from token headers or redeem a grant twice.
- Add migration characterization and guarded-transport contracts plus local HTTP/JWKS revocation/OIDC fixtures, covering wrong issuer/audience/nonce/signature/algorithm, time checks, redirects, bounds, deadlines, string-only host bodies, retained ID tokens and rotating-refresh persistence.

### Fixed

- Replace provider `error` strings outside the 1–64 character ASCII letter/digit/underscore format with `invalid_provider_error` before upstream processing, preventing arbitrary text from reaching facade error messages or `providerErrorCode`.
- Match the DNS-pinned transport's required dispatcher to Node's native `RequestInit` dispatcher type and forward standard request options without an opaque dispatcher intersection. Update dispatcher test doubles to satisfy the native contract.

### BREAKING — canonical OAuth API and core kernel

- Remove `./provider-primitives`, verifier/hash/raw-wire-refresh/cache exports and their public wire/cache types. Main PKCE accepts `{ verifierBytes }` (32 by default); state lives in PKCE, pending storage/expiry/scheduling in the main pending module, and URL redaction in `redact.ts` (root export).
- Fixed-issuer exchange and refresh now use main guarded/bounded requests, typed errors and normalized `OAuthTokenSet`. Basic credentials follow the main encoded format; refresh preserves a non-rotated refresh token. Core `Clock.nowMs()` and `ISODateTime` replace package-local clock/timestamp declarations.
- Remove prose-only `productName`; host-replaceable `defaultOAuthMessages` supplies neutral prose. Wire registration identity remains unchanged. Registration cache identity no longer includes the unused prose name.
- Path discovery root fallbacks are opt-in (`allowOriginFallback`); explicit loopback HTTP accepts the full loopback range and mapped IPv6. No-refresh skew-window status says refresh due rather than expired; inclusive expiry is separately tested.
- Callback caches share the main bounded 256-entry default and preserve the exclusive TTL boundary when explicitly requested. New tests remain under `tests/` until the package test configuration is migrated.

- Security defaults: issuer-bound discovery is enabled unless the host explicitly selects `metadataPolicy: "none"`. DNS-pinned transport checks IPv4/IPv6 literal destinations before fetch, since Node bypasses DNS lookup for literals.

### Added

- Add Node subpaths `./discovery-policy`, `./dns-pinned-transport` and `./provider-primitives`, retaining every root export and the existing `./testing` adapter entry.
- Expose issuer-bound discovery policy, connection-time DNS/address validation and dispatcher lifecycle ports, fixed-issuer wire token operations, injected pending-state cache and host-owned URL redaction. Discovery accepts `metadataPolicy` in its optional argument object.
- Publish the combined API reference and add export/runtime, Request forwarding and compile-only integration contracts. The pinned transport now preserves Request method, headers, body and cancellation.

### Breaking Changes

- Move existing OAuth flow, factory, constructor and port contracts to `(requiredArgs, optionalArgs)`. Optional request fields, URL policy exceptions, pending-store limits, refresh timing and error metadata now belong in argument two.
- Change HTTP, entropy, sleep, URL policy, token/cache/file I/O and registry operations to named argument objects; operations with no inputs require `{}`. Consumers must adapt native `fetch` and `randomBytes` explicitly.
- Remove the positional protocol facade and legacy test-call adapters. Existing export names, protocol behavior and defaults remain; there are no compatibility wrappers.

## 0.1.0

### Minor Changes

- Initial independent OAuth 2.x client: metadata discovery, dynamic registration, authorization code with PKCE, device authorization, refresh and typed errors.
- Add required application identity, injected HTTP/clock/entropy/outbound-policy/store ports, RFC 8707 resource indicators and instance provider registries.
- Add memory adapters on `./testing` and an optional file registration cache with owner-only atomic Node file writes.
