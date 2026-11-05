# Batch And Bulk Operations

## Use When

- clients need to create, update, or delete many resources efficiently
- the dominant concern is reducing round trips or coordinating many related operations
- the operation may need asynchronous processing with progress reporting

## Avoid As The Default When

- the common case is still single-resource CRUD
- a bulk endpoint would hide weak per-resource modeling
- the system cannot define partial-failure, size-limit, and idempotency behavior clearly

## Policy Rules

- Prefer resource-specific bulk operations for homogeneous work. Example: bulk import invoices, bulk archive users.
- Use a generic `/batch` endpoint only when mixed operations across multiple resources are a real requirement and the extra complexity is justified.
- Define maximum batch size and payload limits explicitly.
- Define partial-success behavior explicitly. Clients must know whether the operation is all-or-nothing, best-effort, or item-by-item.
- Define idempotency and retry behavior explicitly for batch writes.
- If processing can be long-running, prefer an async job resource over a long synchronous request.

## Design Questions

- Is the operation homogeneous bulk work or a true mixed batch?
- What does success mean if only some items succeed?
- Can the client retry the request safely?
- Should long-running work return a job resource instead of blocking the request?

## Reference Boundary

There is no single universal HTTP standard for batch and bulk API design. Treat this as a product-level policy decision anchored in HTTP semantics and documented in the contract and ADR.

## References

- HTTP Semantics (RFC 9110): https://www.rfc-editor.org/rfc/rfc9110.html
- OpenAPI Specification: https://spec.openapis.org/oas/latest.html
