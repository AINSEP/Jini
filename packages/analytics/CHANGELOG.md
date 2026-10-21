# Changelog

## Unreleased

### Minor Changes

- Vendor forwarding (`forwarding.ts`): `AnalyticsForwarder` provider contract + `createAnalyticsForwarderRegistry` (shared `@jini-ai/core/provider-registry`), `selectAnalyticsForwarder`, minimised `toForwardedHit` (no region/sessionId), `createFanOutAnalyticsSink` (primary awaited, forwarders detached and isolated), `composeBeforeIngestHooks` (ordered chain; a throwing handler is skipped and reported). Shared `createAnalyticsForwardLimiter` caps vendor calls in flight (over the cap: dropped + reported, local hits unaffected). `AnalyticsSinkKind` widens to `"local" | string` (forwarder id). Forwarded hits redact email-shaped path segments (literal or percent-encoded, `redactPiiPathSegments`), each vendor gets its own deep copy, and forward/hook failure reports carry fixed codes only (never thrown or vendor text).

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
