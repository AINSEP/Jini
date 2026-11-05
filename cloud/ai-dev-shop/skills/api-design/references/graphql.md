# GraphQL

## Use When

- multiple clients need materially different projections over the same domain graph
- frontend iteration speed and self-serve field selection matter
- a typed schema is the primary contract, not a fixed set of REST resources
- the team is willing to own schema design, resolver discipline, and query governance

## Avoid As The Default When

- the consumer shape is simple and stable
- the team needs strict server-side control over payload size and query shapes
- the system cannot support query-cost limits, resolver performance discipline, or field-level auth decisions
- third-party consumers primarily want generated REST SDKs or ordinary HTTP semantics

## Schema Rules

- Define the schema as the contract first. Do not infer it from ad hoc resolver output.
- Keep root `Query`, `Mutation`, and `Subscription` responsibilities explicit.
- Use typed input objects for non-trivial mutations.
- Prefer a consistent list pattern across the surface. Connection-style pagination is the safest default for public schemas.
- Use `@deprecated` with a concrete migration target and timeline.
- Separate internal helper fields from public schema fields. If a field should not be stable, it should not be public.

## Operational Gates

- Define query depth and complexity limits before launch.
- Define the N+1 mitigation strategy before promising nested access patterns.
- Define auth and visibility at field or resolver boundaries, not only at the HTTP edge.
- Define how partial failures appear to clients and how those errors are classified.
- Define whether introspection is always enabled, environment-gated, or access-controlled.

## Minimum GraphQL Review Questions

- Would a simpler REST surface serve the same consumers with less operational risk?
- Does the schema expose business entities cleanly, or is it leaking storage/layout details?
- Are list fields bounded and paginated?
- Are mutation names and payloads stable enough for long-term consumer use?
- Can the team explain how it will control expensive nested queries?

## Transport Note

If HTTP transport semantics are in scope, the GraphQL-over-HTTP effort is useful background, but it is still a draft and should not be treated as a fully stable governance anchor on its own.

## References

- GraphQL schemas and types: https://graphql.org/learn/schema/
- GraphQL over HTTP draft (informative, still draft): https://graphql.github.io/graphql-over-http/draft/
