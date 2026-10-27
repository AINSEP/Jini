# Changelog

## 0.6.13

### Patch Changes

- 4c95673: Redact selected error codes before export, invalidate stale product-analytics consent approvals,
  and share platform-neutral privacy validation between product analytics and visitor ingestion. Async product-analytics consent now
  requires `consentRevision`: without it a promised approval is dropped (fail closed); synchronous
  consent is unchanged. `combineObservabilityPorts` now wraps a
  single enabled adapter too, so its throws never reach the caller.
- af776cd: `@jini-ai/analytics/product`: a vendor-neutral product-analytics contract (`capture({ name, userId, properties })`, `identify({ userId, traits })`, shared frozen noop) and `withProductAnalyticsGuards` (per-event consent, pseudonymous ids, the shared PII property check plus secret redaction). `@jini-ai/analytics/product/posthog`: a PostHog provider over `posthog-node` (optional peer, 5.55.1) returning `{ port, dispose }`, GeoIP and exception autocapture off. Async consent needs `consentRevision`; without one every promised answer is dropped (fail closed) and the wrapper warns once on the console.
- 63bacc5: OpenTelemetry and Sentry observability adapters moved out of `@jini-ai/diagnostics` into the `observability-opentelemetry` and `observability-sentry` provider plugins of `@jini-ai/provider-plugins`. Removed: the `@jini-ai/diagnostics/observability/opentelemetry` and `/observability/sentry` subpaths and every `@opentelemetry/*` / `@sentry/node` dev and optional peer dependency. The OTel plugin accepts any OTLP/HTTP endpoint plus generic request headers. Packages bundled into plugin artifacts now ship their LICENSE file.
- 212cf50: The PostHog product-analytics adapter moved out of `@jini-ai/analytics` into the `analytics-posthog` provider plugin (contract `product_analytics`). Removed: the `@jini-ai/analytics/product/posthog` subpath and the optional `posthog-node` peer. `@jini-ai/analytics/product` is verified to bundle for a browser target with no Node builtin.
- Updated dependencies [7479159]
- Updated dependencies [aef0152]
- Updated dependencies [c31264d]
- Updated dependencies [0728914]
- Updated dependencies [cbce255]
- Updated dependencies [6ecbdb2]
- Updated dependencies [e46b6ec]
- Updated dependencies [63bacc5]
  - @jini-ai/core@0.6.13
  - @jini-ai/agent-runtime@0.6.13

## 0.6.12

### Patch Changes

- @jini-ai/core@0.6.12

## 0.6.11

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @jini-ai/core@0.6.11

## 0.6.10

### Patch Changes

- Updated dependencies [22f0619]
- Updated dependencies [82ed2d3]
- Updated dependencies [5a3de86]
  - @jini-ai/core@0.6.10

## 0.2.2 — 2026-10-22

- 2026-10-22: Vendor forwarder contract, keyed registry, fan-out sink and in-flight cap; provider-load TTL memo moved in from Tovu.

### Minor Changes

- Vendor forwarding (`forwarding.ts`): `AnalyticsForwarder` provider contract + `createAnalyticsForwarderRegistry` (shared `@jini-ai/core/provider-registry`), `selectAnalyticsForwarder`, minimised `toForwardedHit` (no region/sessionId), `createFanOutAnalyticsSink` (primary awaited, forwarders detached and isolated), `composeBeforeIngestHooks` (ordered chain; a throwing handler is skipped and reported). Shared `createAnalyticsForwardLimiter` caps vendor calls in flight (over the cap: dropped + reported, local hits unaffected). `AnalyticsSinkKind` widens to `"local" | string` (forwarder id). Forwarded hits redact email-shaped path segments (literal or percent-encoded, `redactPiiPathSegments`), each vendor gets its own deep copy, and forward/hook failure reports carry fixed codes only (never thrown or vendor text). `cacheAnalyticsProviderLoad` (moved from Tovu): TTL memo for the per-beacon provider load (`DEFAULT_ANALYTICS_PROVIDERS_TTL_MS` 60s; failures never cached).

## 0.2.1

### Patch Changes

- Tovu clean-up release (2026-10-08): code Tovu moved into Jini, plus the Jini clean-up (see the commit log since 0.2.0).

## 0.2.0 — 2026-10-02

### BREAKING

- Analytics is now a standalone domain capability with canonical core primitive contracts, isolated from the platform package.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

- Restore ingestion, IPv6/UA classification, salt custody and buffer-bound rationale beside the canonical code, plus equivalent test rationale. Runtime behavior and public signatures are unchanged.

- Add the standalone analytics capability, moved from platform with its ingestion, salt, storage and privacy-policy tests. No CMS dependency; behavior and derivation bytes are preserved.
- BREAKING: consumers of the former platform analytics subpath/root namespace must import `@jini-ai/analytics`.
