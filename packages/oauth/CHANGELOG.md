# @jini-ai/oauth

## 0.2.0 — 2026-10-02

### BREAKING

- Provider primitives were consolidated into the main OAuth API; messages and clock contracts use neutral defaults and core ports.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

### Fixed

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
