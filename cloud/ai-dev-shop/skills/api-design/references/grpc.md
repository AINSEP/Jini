# gRPC

## Use When

- the contract is primarily internal service-to-service
- low latency, efficient binary transport, or streaming matters
- consumers are polyglot but willing to consume generated stubs
- the team wants strongly typed contracts defined in `.proto` files

## Avoid As The Default When

- the API is public internet or partner-facing and ordinary HTTP tooling is a primary requirement
- browser-native consumers are a first-class audience without a deliberate gRPC-Web plan
- the domain is simple CRUD where REST would be easier to inspect, document, and operate

## Contract Rules

- Define services, methods, and messages in `.proto` first. Code is generated from the contract, not the reverse.
- Version packages and namespaces intentionally. Do not rely on directory layout alone to signal versioning.
- Every RPC defines timeout and retry expectations.
- Every non-trivial write RPC defines idempotency expectations.
- Use canonical gRPC status codes only. Do not invent ad hoc error enums when a status code already carries the meaning.
- Use streaming only when the consumer truly benefits from incremental delivery or bidirectional flow control.

## Compatibility Rules

- Add fields; do not reuse field numbers.
- Reserve removed field numbers and names.
- Do not change the meaning of an existing field in place.
- Treat message and method renames as compatibility events, not refactors.

## Operational Gates

- Define deadlines on client calls. "No deadline" is usually a bug.
- Define retry behavior by method safety and idempotency.
- Define auth and transport security expectations.
- Define observability: request metadata, tracing, and status-code reporting.

## Minimum gRPC Review Questions

- Is there a real latency, streaming, or polyglot reason for gRPC, or is REST good enough?
- Are the protobuf messages stable enough for generated client use?
- Are deadlines, retries, and status-code semantics documented?
- Would an HTTP-facing consumer need a separate REST/OpenAPI facade anyway?

## References

- gRPC introduction: https://grpc.io/docs/what-is-grpc/introduction/
- gRPC status codes: https://grpc.io/docs/guides/status-codes/
- Protocol Buffers overview: https://protobuf.dev/overview/
