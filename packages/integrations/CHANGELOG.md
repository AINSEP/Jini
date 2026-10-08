# Changelog

## 0.4.1

### Patch Changes

- Tovu clean-up release (2026-10-08): code Tovu moved into Jini, plus the Jini clean-up (see the commit log since 0.4.0).

## Unreleased — compilation repairs

### BREAKING

- `CredentialedRequestDeps.clock` now takes core `Clock.nowMs()`. Verification and request audit timestamps use `nowIso({ clock })` at the existing sampling points; request, audit and response behavior are unchanged.

### Fixed

- Media-provider DI tokens and browser catalog tests use the current object argument contracts.
- Policy/generation test fixtures retain literal types; SVG tests supply the full render context.
- Async video tests inject the existing HTTP client fixture instead of the removed raw fetch option.
- Restore native WAV header writes at offsets 0, 8, 12 and 36; preserve the original PCM bytes and add header regression assertions.

## 0.4.0 — 2026-10-02

### BREAKING

- HTTP, clocks, IDs and JSON types use core contracts; filesystem locks and SSRF classifiers use platform. Composio error protection and host messages no longer couple domain packages.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased — integration removal

### BREAKING

- Composio integration removed: delete the connector source/tests, the public subpath,
  legacy type resolution and associated catalog/persistence messages. Future support
  belongs in an Agent Plugin bundle with a manifest and hosted MCP endpoint.

## Unreleased — canonical contracts

### BREAKING

- Remove `./http-ports`, the credentialed-http/webhooks HTTP type re-exports and the local DTO declarations; import core primitives directly and use `HttpClientPort.send({ request }, { redirect? })`, with body inside request.
- Webhook clock/ID/JSON/time types and Composio JSON types come from core; webhook clocks expose `nowMs()`.
- Composio prose takes optional `messages`, exported as `defaultIntegrationsMessages`, instead of required `productName`.
- Remove local Composio lock and media hostname classifiers; import shared platform locks/network classifiers.

### Changed

- Composio retains 2000ms timeout, 10ms polling and no age/dead-owner stealing. Shared locking adds owned-create cleanup and inode/device snapshot checks.
- Native fetch ABIs and media egress paths remain unchanged; provider-host policy retains existing loopback allowance.


## Unreleased

- Add `./credentialed-http`: resolver, HTTP, scheme-registry and audit ports; origin binding,
  Basic/Bearer/self-describing schemes, redacted responses and injectable auth diagnostics.
- Add `./webhooks`: subscription lifecycle, envelope/repository ports, delivery retries and
  HMAC signing with required wire vocabulary and caller-supplied time.
- Existing subpaths and versions are unchanged. No default plugin loading or new dependencies.

### Integration merge and API convention

- New independent subpaths: `./credentialed-http` and `./webhooks`; transport contracts
  come from core primitives. Retain Composio and media-provider/catalog entries.
- Export structural `ComposioConnectorProviderPort`, `ConnectorStatusServicePort`
  and `ConnectorObjectOutputProtectionResult` through the Composio barrel.
- **BREAKING:** Composio public functions, provider/service constructors, service
  methods, configuration/credential stores and errors use required and optional
  argument objects; positional overloads are absent. Hosts can supply catalog `messages`.
  Credential guards narrow the required object's `value`. Error constructors take
  `{ code, message, status }`, then optional `{ details, options }`.
- **BREAKING:** Media catalog/video helpers, renderers, policies, staging, dispatch
  factories/registries/adapters/parsers, DNS lookup ports and async-operation stores
  use required and optional argument objects. Runtime entry points carry ports and
  operation fields in object one; `clock` is the optional callback and recovery
  keeps numeric `now`. Environment credential resolution requires `providerId` and `env`.
  The protected task-store/SQLite factory conversion remains with its active owner.
- **BREAKING:** Shared HTTP sends take `{ request }` with optional body inside the request;
  redirect controls occupy object two. Webhook `markFailed` puts optional `{ deadAtIso }`
  in object two. Credential-store setters take
  `{ credentialStore }`. Extracted credential/webhook error constructors take
  `{ message }` and optional `{ options }` without changing messages or error identity.
- Correct the Composio output overload so only object inputs promise object results;
  preserve scalar, array and null outputs. Immediate connections commit validated
  credentials/account labels without reassigning constant caller options.
- Write merge regression and package-surface tests; strengthen the whole-source
  neutrality guard to reject product names in comments as well as imports/defaults.
  Verification deferred by owner directive. No version bump or dependency changes.

- **BREAKING:** Credentialed-request audit sinks take `{ entry }`; the injected console
  logger takes `{ line }`. Stored entries and emitted diagnostic lines retain their formats.
