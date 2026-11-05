# tRPC

## Use When

- the same organization owns both client and server
- both ends are TypeScript-capable and can share type-level contracts
- release cadence is coordinated enough that rapid contract evolution is acceptable
- developer experience and end-to-end type inference matter more than language-agnostic interoperability

## Avoid As The Default When

- the API is public, partner-facing, or must remain language-agnostic
- non-TypeScript consumers matter
- long-lived external compatibility and independently versioned SDKs are primary requirements
- the contract needs to stand on its own without consumers understanding your TypeScript ecosystem

## Design Rules

- Treat router boundaries as real public module boundaries, not just code organization.
- Keep input and output validation explicit.
- Do not leak ORM entities, database rows, or framework-only types through procedures.
- Define auth, pagination, error, timeout, and idempotency semantics in the spec even if the compiler already knows the types.
- Use tRPC as a contract for owned clients, not as a shortcut around API governance.

## OpenAPI Guard

If external HTTP documentation, partner onboarding, generated non-TypeScript SDKs, or durable public contracts are hard requirements, choose REST + OpenAPI as the primary interface. tRPC can still exist internally, but it should not be your only externally meaningful contract.

## Minimum tRPC Review Questions

- Do we truly own every important consumer?
- Can we tolerate coordinated server and client evolution?
- Would a non-TypeScript consumer be blocked or forced into a second-class path?
- Are we using tRPC for owned-client velocity, or just avoiding contract design work?

## References

- tRPC home and docs: https://trpc.io/
- tRPC docs entry point: https://trpc.io/docs
