---
name: api-design
version: 1.0.2
last_updated: 2026-03-19
description: Use when choosing between REST/OpenAPI, GraphQL, gRPC, tRPC, or webhooks/events; designing resource models, pagination, errors, lifecycle policy, security minimums, and SDK ergonomics; or reviewing API designs before implementation.
---

# Skill: API Design

API design choices turn into long-lived contracts. A bad style choice, vague error model, or missing lifecycle policy survives far longer than a controller implementation. This skill exists to force the important decisions up front, keep style selection tied to audience and operability, and stop framework preferences from polluting public contracts.

## Load Strategy

Start here, then load only the references needed for the current API surface:

- `references/rest-openapi.md` for public HTTP APIs, partner integrations, browser-debuggable contracts, generated SDKs, and OpenAPI-first governance
- `references/graphql.md` for projection-heavy multi-client APIs and schema-driven product surfaces
- `references/grpc.md` for internal low-latency, streaming, or polyglot service-to-service contracts
- `references/trpc.md` for first-party full-stack TypeScript contracts where the same organization owns both ends
- `references/realtime-websockets-sse.md` when browser-facing realtime delivery is in scope and polling/webhooks are not enough
- `references/webhooks-and-events.md` for outbound push delivery, event contracts, and replay/idempotency rules
- `references/versioning-and-lifecycle.md` when compatibility windows, deprecation, or breaking changes matter
- `references/security-and-resource-limits.md` when the API surface needs object/property/function-level authorization rules, sensitive-data exposure rules, quotas, rate limits, or abuse controls
- `references/caching.md` when freshness, cacheability, validators, or CDN behavior materially shape the contract
- `references/batch-and-bulk.md` when clients need multi-operation, bulk import/update/delete, or async job-style processing
- `references/sdk-and-dx.md` when generated clients, hand-written SDKs, or consumer ergonomics matter
- `references/checklist.md` before finalizing or reviewing the design

Do not load all of these at once. Choose the primary interface first, then load the secondary concerns that are actually in scope.

## Default Decision Heuristic

| Situation | Default |
|---|---|
| Public, partner, or browser-consumed HTTP API | REST + OpenAPI |
| Many clients with materially different projection needs | GraphQL |
| Internal service-to-service, low-latency, streaming, or polyglot contracts | gRPC |
| First-party, same-org, full-stack TypeScript clients with shared release cadence | tRPC |
| Async outbound notifications or integration push | Webhooks / events |

If the system needs more than one interface, name each interface and audience explicitly. Example: external REST/OpenAPI, internal gRPC, outbound webhooks.

## Required Context

Before choosing a style or finalizing a contract, confirm:

- who the consumers are: first-party, third-party, partners, public internet, or internal services
- whether consumers are single-language or polyglot
- whether the same team controls both client and server release cadence
- whether browser tooling, SDK generation, or self-serve docs are required
- whether the workload is request/response, streaming, or async push
- whether the contract needs a stable compatibility horizon measured in months or years
- whether the contract is user-facing, machine-facing, or both
- what auth, retry, timeout, and idempotency semantics are required
- whether pagination, filtering, sorting, and search are part of the contract
- whether deprecation and migration policy must be visible to consumers

## Blocking Gates

Do not finalize an API design until all of the following are explicit:

- primary contract style selected, with rejected alternatives named
- resource model or RPC surface model defined
- auth model defined
- authorization model defined at object, property, or function level as applicable
- error model defined
- timeout, retry, and idempotency behavior defined
- pagination, filtering, and sorting policy defined where collections exist
- versioning and deprecation policy defined
- sensitive-property exposure and write-allowlist rules defined where applicable
- rate-limit or quota policy defined for externally callable operations, including exhaustion behavior
- contract-testing strategy defined for multi-team or externally versioned surfaces
- observability requirements defined: correlation IDs, request IDs, or equivalent
- webhook/event delivery semantics defined if async push is in scope
- SDK or client ergonomics expectations defined if consumers will integrate programmatically

If any gate is unresolved, stop and surface the gap instead of guessing.

## Context Pollution Guards

- Load one primary style reference first. Do not compare REST, GraphQL, gRPC, and tRPC in detail unless the system genuinely has multiple interfaces.
- Keep API style choice separate from framework choice. Do not let Express, Next.js, Fastify, Apollo, Nest, or similar tools drive the contract.
- Use `skills/api-contracts/SKILL.md` only after the primary style is chosen and concrete endpoint/event shapes exist. `api-contracts` validates contract completeness; it does not replace style selection.
- Use `skills/change-management/SKILL.md` for rollout of breaking contract changes; do not duplicate expand-contract procedure here.
- Use `skills/spec-writing/SKILL.md` for typed examples and anti-vagueness rules; keep implementation details out of API specs.
- Use `skills/supabase/SKILL.md` only when PostgREST/RPC, edge functions, or Supabase platform behavior shape the interface.
- Do not recommend GraphQL, gRPC, or tRPC because they are fashionable. Tie the choice to consumer shape, compatibility needs, and operational cost.
- Do not leak framework-only details into public contracts. Public APIs must remain understandable without knowledge of internal libraries.

## Delivery Rules

- Decide audience and compatibility horizon before naming a transport or library.
- When architecture work is in scope, record the chosen API style, rejected alternatives, and compatibility policy in `adr.md`. API style is an architectural decision, not an implementation note.
- Prefer one error model per API surface.
- Treat auth, retries, idempotency, pagination, and deprecation as part of the contract, not implementation trivia.
- Treat authorization boundaries, sensitive-property exposure rules, and resource-consumption controls as part of the contract shape, not a downstream patch.
- For multi-team or externally versioned surfaces, decide whether consumer-driven contract testing is required before implementation begins.
- Document collection semantics with explicit server-side limits, stable ordering, and cursor behavior where applicable.
- Name the migration path for breaking changes at design time, not during rollout.
- If a design mixes interfaces, describe how they relate instead of pretending they are interchangeable.

## API Contract Principles

**Hyrum's Law.** With enough users, every observable behavior of your API becomes a de facto contract — including undocumented quirks, error message text, timing, and ordering. Design with this in mind: anything you expose will be depended upon, whether you intended it or not.

**One-Version Rule.** Maintain one version of the API wherever possible. Multiple versions multiply maintenance cost, create diamond-dependency problems, and signal that the contract wasn't designed with longevity in mind.

When the API is TypeScript-owned, generated TypeScript clients are in scope, or primitive ID mixups are a concrete risk, load `references/branded-types.md` for branded ID types and Input/Output type separation patterns.

*Source: Addy Osmani / agent-skills / api-and-interface-design*

## Composition With Other Skills

- `skills/api-contracts/SKILL.md` after the interface style is chosen and concrete contract shapes exist
- `skills/change-management/SKILL.md` when versioning, deprecation, or contract breakage is in scope
- `skills/security-review/SKILL.md` for downstream verification of the implemented threat surface after design-time minimums are set here
- `skills/spec-writing/SKILL.md` when turning the design into `api.spec.md` and related spec files
- `skills/design-patterns/SKILL.md` when API style depends on BFF, API Gateway, microservices, or event-driven architecture
- `skills/supabase/SKILL.md` when the API surface is PostgREST, RPC, realtime, or edge-function mediated

## Expected Output

- primary interface decision and rejected alternatives
- contract rules for resources or procedures, errors, pagination, auth, and lifecycle
- secondary concerns that must be handled by follow-on skills
- checklist result from `references/checklist.md`
- risks, unknowns, and recommended next assignee
