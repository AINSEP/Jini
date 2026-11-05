# API Design Checklist

Mark each item PASS, FAIL, or NA with evidence. Do not mark an item PASS without pointing to the design decision, spec section, or contract artifact that satisfies it.

## Fit

- Primary interface style is named.
- Rejected alternatives are named with reasons.
- Consumer audience is named.
- Compatibility horizon is named.
- When architecture work is in scope, the API style decision is captured in `adr.md`.

## Contract

- Resource model or RPC surface is explicit.
- Auth model is explicit.
- Authorization model is explicit at object/property/function level where applicable.
- Error model is explicit.
- Retry and timeout behavior is explicit.
- Idempotency behavior is explicit where writes can be retried.
- Pagination policy is explicit for collections.
- Filtering and sorting allowlists are explicit where supported.
- Sensitive-property exposure and write-allowlist rules are explicit where applicable.
- If multiple representations or sparse fieldsets are supported, that policy is explicit.
- If multiple teams or external consumers depend on the surface, the contract-testing strategy is explicit.
- Examples exist for happy path and at least one failure path.

## Lifecycle

- Versioning strategy is explicit.
- Deprecation policy is explicit.
- Breaking-change path is explicit or delegated to `change-management`.

## Operability

- Request or correlation ID strategy is explicit.
- Rate limits or quotas are explicit for externally callable operations.
- Limit scope, exhaustion behavior, and `429` / `Retry-After` policy are explicit where applicable.
- Observability expectations are explicit.
- If realtime delivery exists, reconnect/replay/ordering policy is explicit.
- If caching matters, freshness and validation behavior are explicit.
- If batch or bulk operations exist, partial-failure and async-job policy are explicit.
- If webhooks or events exist: signature, retry, dedup, replay, and ordering rules are explicit.

## Consumer Experience

- Documentation/discoverability path is explicit.
- SDK expectations are explicit if SDKs matter.
- Contract is understandable without framework-specific knowledge.

## Follow-On Skills

- `api-contracts` loaded if concrete endpoint/event shapes exist
- `change-management` loaded if lifecycle or breaking changes matter
- `spec-writing` loaded if the design is being turned into spec artifacts
