---
name: backend-implementation
version: 1.0.0
last_updated: 2026-04-10
description: Use when implementing backend, service, worker, or API-handler code so tactical service concerns such as validation, error handling, dependency wiring, caching, jobs, and resilience have one default entrypoint instead of being scattered across multiple skills.
---

# Skill: Backend Implementation

This is the default implementation-facing skill for backend work.

Use it when the task is to build or modify backend application code rather than choose the overall architecture, database schema, or deployment shape. Its job is to keep the day-to-day backend plumbing coherent so the implementer does not have to manually assemble half a dozen related skills on every service change.

This skill sits between:

- API contract and architecture decisions upstream
- database and infrastructure ownership downstream

It governs how to implement the internals of backend services once those outer decisions already exist.

## Use This Skill For

- HTTP handlers, RPC handlers, queue consumers, schedulers, and worker entrypoints
- service-layer orchestration and use-case code
- dependency injection, composition roots, and adapter wiring
- request validation, DTO mapping, and transport-to-domain translation
- structured error handling and transport error mapping
- request context, auth enforcement, and middleware-level cross-cutting behavior
- caching, retries, timeouts, circuit breakers, and other resilience tactics
- background jobs, async workflows, idempotency, and dead-letter handling

## Do Not Use This Skill For

- API style selection, lifecycle policy, or contract design
- schema design, migrations, or query ownership
- infrastructure, deployment, or IaC declarations
- frontend UI, hooks, or client-side state patterns
- threat modeling or formal security review

## Composition Map

This skill is the front door. Load the following skills only when their narrower concern is actually in scope:

- `skills/hexagonal-architecture/SKILL.md` when the chosen ADR uses ports and adapters or the service needs strict framework isolation
- `skills/api-design/SKILL.md` when the interface style, pagination, error model, lifecycle, or webhook semantics are still being chosen
- `skills/api-contracts/SKILL.md` when the concrete request and response shapes must be checked for completeness or compatibility
- `skills/observability-implementation/SKILL.md` for structured logs, metrics, tracing, and external-I/O instrumentation
- `skills/change-management/SKILL.md` when the work includes compatibility windows, phased rollouts, dual writes, backfills, or cutovers
- `skills/sql-data-modeling/SKILL.md` and `skills/postgresql/SKILL.md` only through Database-owned work, not as a substitute for schema ownership

## Core Ownership

### 1. Transport Boundaries

- Keep handlers and consumers thin.
- Parse transport input once at the edge.
- Convert transport shapes into DTOs or application inputs before calling service logic.
- Do not let request objects, framework contexts, ORM models, or vendor SDK types leak into core business code.

### 2. Validation and Serialization

- Validate all external input at the boundary.
- Fail fast on malformed or unauthorized input.
- Keep validation rules explicit and close to the boundary adapter.
- Serialize outbound responses deliberately; do not expose internal entities by accident.

### 3. Error Handling

- Separate domain errors, validation errors, and infrastructure errors.
- Use structured error types or a stable error catalog.
- Map errors to HTTP/RPC/job outcomes at the edge, not deep inside the core.
- Never swallow infrastructure failures without logging, metrics, and an explicit fallback decision.

### 4. Service Orchestration

- Keep application services focused on one use case or transaction boundary.
- Put cross-adapter coordination in services, not in handlers or repositories.
- Make transaction boundaries explicit.
- Use sagas, compensation, or outbox-style coordination when one request spans multiple systems.

### 5. Dependency Injection and Wiring

- Build concrete dependencies in a composition root.
- Inject interfaces, capability objects, or functions rather than constructing dependencies inline.
- Prefer simple explicit wiring over hidden globals or service locators.
- Keep test seams obvious.

### 6. Middleware and Cross-Cutting Behavior

- Centralize request context propagation, correlation IDs, auth enforcement, and rate limiting at the edge.
- Do not duplicate the same auth or tracing setup across handlers.
- Keep middleware responsible for generic concerns, not domain rules.

### 7. Caching

- Add caching only when the read path, invalidation trigger, and freshness tolerance are explicit.
- Choose cache-aside, read-through, or write-through deliberately.
- Define key shape, TTL, invalidation owner, and hot-key risk up front.
- Do not use caching to hide inefficient query or service design without measuring first.

### 8. Background Jobs and Async Work

- Make jobs idempotent.
- Make retries bounded and observable.
- Define dead-letter handling before shipping the worker.
- Keep queue payloads versionable and explicit.
- Record which side effects are safe to replay and which require deduplication.

### 9. Resilience

- Put retries, timeouts, and circuit breakers at infrastructure edges.
- Retry only idempotent operations or operations protected by idempotency keys.
- Protect every non-idempotent external write with an idempotency key and route it through one shared durable outbox; see `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/reliability-patterns.md` for the implementation pattern.
- Use backpressure and queueing instead of unlimited fan-out.
- Prefer graceful degradation over cascading failure when dependencies are unhealthy.

### 10. Configuration

- Treat config as explicit input, not hidden global state.
- Fail fast at startup for required config.
- Separate config loading from business logic.
- Keep secret access behind a small boundary and never inline secret-fetch logic throughout the codebase.

## Default Backend Decision Order

1. Confirm the contract and ADR constraints already exist.
2. Identify the boundary modules: inbound adapter, service, outbound adapter, composition root.
3. Define validation, DTO mapping, and the error taxonomy at the edge.
4. Define transaction and idempotency boundaries before adding retries or async behavior.
5. Add middleware-level concerns such as auth enforcement, request context, and rate limiting.
6. Add caching only after the source of truth and invalidation owner are explicit.
7. Add resilience patterns only at real I/O edges, not as blanket wrappers everywhere.
8. Instrument the path using `observability-implementation`.

## Keep Separate

- `api-design` chooses the external contract shape; this skill implements behind that contract.
- `api-contracts` verifies endpoint completeness and compatibility; this skill consumes the agreed contract.
- `hexagonal-architecture` defines the structural boundary pattern; this skill defines how to build within those boundaries.
- `observability-implementation` governs telemetry details; this skill only tells you where observability must exist.
- `sql-data-modeling` and `postgresql` remain Database-owned for schema and query design.
- `change-management` remains the rollout skill for breaking transitions.
- `security-review` remains the review and threat-model lane; this skill covers only implementation mechanics such as auth enforcement points and request context handling.

## Output Expectations

When this skill is active, the implementation notes or handoff should make these explicit:

- inbound adapter and service ownership for the changed path
- validation boundary and DTO or request-shape mapping
- error taxonomy and transport mapping
- transaction, idempotency, and retry boundaries
- caching choice, invalidation owner, and TTL when caching is used
- async job behavior, retry policy, and DLQ handling when background work is used
- composition root or dependency wiring location
- which follow-on skills were also required
