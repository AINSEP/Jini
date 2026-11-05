# Caching And Freshness

## Use When

- the API serves repeat reads where latency, origin load, or cost matters
- the contract needs explicit freshness or validation behavior
- a CDN, shared cache, browser cache, or client-side cache is part of the delivery path

## Core Rules

- Decide whether each read surface is cacheable, conditionally cacheable, or explicitly non-cacheable.
- Define freshness and validation separately. Freshness controls how long a response can be reused; validation controls how a client checks whether it changed.
- If validators are used, define them consistently. `ETag` is the usual default.
- If cache control differs by auth state, role, or representation, document that explicitly.
- Do not assume a response is safe to share across users just because it is a `GET`.
- If stale data is acceptable, say how stale and in which contexts.

## Contract Questions

- Is the response user-specific or globally shareable?
- What is the expected freshness window?
- Will consumers use validators such as `ETag` or `If-None-Match`?
- Does the API need cache-busting semantics for rapidly changing resources?

## References

- HTTP Caching (RFC 9111): https://www.rfc-editor.org/rfc/rfc9111.html
- HTTP Semantics (RFC 9110): https://www.rfc-editor.org/rfc/rfc9110.html
