# REST + OpenAPI

## Use When

- the API is public, partner-facing, or likely to be consumed outside your team
- browser debuggability and standard HTTP tooling matter
- generated SDKs, mock servers, or contract diffs are required
- consumers need a durable, language-agnostic contract

## Avoid As The Default When

- the same organization owns both client and server and both are full-stack TypeScript with shared release cadence
- streaming is a first-class requirement
- the consumer needs highly variable graph-shaped projections and REST would force many round-trips or one-off aggregation endpoints

## Resource Modeling Rules

- Use nouns for resources and collections. Example: `/invoices`, `/invoices/{invoiceId}`.
- Reserve verbs in paths for operations that do not fit normal resource state changes. Example: `/invoices/{invoiceId}:send`.
- Keep path depth shallow. Deeply nested resources usually signal ownership confusion.
- Use request bodies for state changes, query parameters for filtering, pagination, sorting, and search.
- Define one canonical identifier per resource surface. Alias IDs multiply support cost.

## Collection Rules

- Every list endpoint defines a stable default sort order.
- Prefer cursor/keyset pagination for large or growing collections.
- Use offset pagination only for bounded admin lists or low-scale internal tools.
- Make cursors opaque to consumers.
- Enforce server-side page-size limits. Clients should not be allowed to request unbounded result sets.
- Filtering and sorting must use an explicit allowlist. Do not expose arbitrary database column names.

## Representation Rules

- If the API supports multiple representations, document `Accept` / `Content-Type` behavior explicitly, including the default media type and unsupported combinations.
- If the API supports sparse fieldsets or partial responses, define the syntax, defaults, authorization behavior, and whether nested selection is allowed.
- If the API does not support sparse fieldsets, say so. Silence creates accidental pseudo-standards.

## Operation Semantics

- `GET` is safe and cacheable by default. Do not hide writes behind `GET`.
- `POST` must define retry and idempotency expectations if clients may retry.
- `PUT` replaces a full resource representation unless explicitly documented otherwise.
- `PATCH` requires documented patch semantics.
- `DELETE` defines whether it is hard delete, soft delete, or state transition.

## Error Model

- Choose one error envelope and use it consistently across the surface.
- For public or polyglot HTTP APIs, prefer RFC 9457 Problem Details or an explicitly documented equivalent.
- Validation errors need machine-readable field-level details, not only prose messages.
- Document which errors are retryable and which require caller action.

## Lifecycle Rules

- Choose one versioning strategy at project start and apply it consistently.
- Deprecation must name the replacement path, notice date, and removal condition.
- Breaking changes require a migration plan, not just a changelog note.

## Minimum REST Review Questions

- Is each path exposing a resource or just mirroring internal code structure?
- Does each write operation define idempotency and conflict behavior?
- Are pagination, filtering, and sorting deterministic and bounded?
- Can a third-party consumer understand the API from the contract alone?
- Would an SDK generated from the OpenAPI document be usable without hand repair?

## References

- OpenAPI Specification: https://spec.openapis.org/oas/latest.html
- Problem Details for HTTP APIs (RFC 9457): https://www.rfc-editor.org/rfc/rfc9457.html
- HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
