# Architecture Pattern Library

Use this folder as the Software Architect Agent's reference set. Each file includes: pattern definition, when to use, when NOT to use, decision signals, TypeScript implementation examples, testing guidance, common failure modes, and cross-pattern references.

## Pattern Selection Decision Guide

Use this to navigate to the right pattern quickly.

| Situation | Start Here |
|---|---|
| Greenfield product, small team | `modular-monolith.md` |
| Complex domain logic, long-lived product | `clean-architecture.md` or `hexagonal-architecture.md` |
| Multiple I/O channels (HTTP + CLI + events) | `hexagonal-architecture.md` |
| Feature teams, autonomous delivery | `vertical-slice-architecture.md` |
| Asymmetric read/write workloads | `cqrs.md` |
| Audit trail, financial, compliance | `event-sourcing.md` (pair with CQRS) |
| Async cross-service side effects | `event-driven-architecture.md` |
| Multi-service business transactions | `reliability-patterns.md` (Saga) |
| Reliable event publishing | `reliability-patterns.md` (Outbox) |
| Independent team deployment at scale | `microservices.md` |
| Migrating a legacy system | `strangler-fig.md` |
| Multiple client types (mobile, web, API) | `api-patterns.md` (BFF) |
| Centralized auth, rate limiting at edge | `api-patterns.md` (API Gateway) |
| Preventing cascade failures | `resilience-patterns.md` |
| Bursty traffic, ops-light team | `serverless-architecture.md` |
| Offline batch / ML pipelines | `pipeline-batch-architecture.md` |
| Simple CRUD, familiar team structure | `layered-architecture.md` |
| Domain layer needs data access without DB coupling | `repository-pattern.md` |
| Rich domain with entities, aggregates, value objects | `ddd-tactical-patterns.md` |
| SaaS product with multiple isolated customer organizations | `multi-tenant-architecture.md` |
| Read-heavy workloads, expensive repeated queries, latency reduction | `caching-patterns.md` |

## Structural Patterns

These define how code and services are organized.

| Pattern | File | Summary |
|---|---|---|
| Layered Architecture | `layered-architecture.md` | Horizontal layers, one-way dependencies, familiar structure |
| Clean Architecture | `clean-architecture.md` | Concentric rings, dependencies point inward, testable core |
| Hexagonal Architecture | `hexagonal-architecture.md` | Ports and adapters, driving vs. driven sides |
| Vertical Slice Architecture | `vertical-slice-architecture.md` | Organize by feature, not layer |
| Modular Monolith | `modular-monolith.md` | Single deployment, strict module boundaries |
| Microservices | `microservices.md` | Independent deployable services per capability |
| Serverless | `serverless-architecture.md` | Managed compute, on-demand execution |
| Pipeline / Batch | `pipeline-batch-architecture.md` | Staged processing for offline workloads |
| Multi-Tenant Architecture | `multi-tenant-architecture.md` | Shared schema, separate schema, or separate DB per tenant |

## Domain Modeling Patterns

These define how business concepts are represented and enforced in code.

| Pattern | File | Summary |
|---|---|---|
| DDD Tactical Patterns | `ddd-tactical-patterns.md` | Entities, Value Objects, Aggregates, Domain Events |
| Repository Pattern | `repository-pattern.md` | Abstract data access behind interfaces; domain defines, infrastructure implements |

## Data and Event Patterns

These define how data flows and state is managed.

| Pattern | File | Summary |
|---|---|---|
| CQRS | `cqrs.md` | Separate read and write models |
| Event Sourcing | `event-sourcing.md` | Store events, derive state by replay |
| Event-Driven Architecture | `event-driven-architecture.md` | Pub/sub, async, loose coupling |
| Caching Patterns | `caching-patterns.md` | Cache-aside, write-through, write-behind, invalidation strategies |

## Reliability Patterns

These ensure correctness under failure.

| Pattern | File | Summary |
|---|---|---|
| Outbox Pattern | `reliability-patterns.md` | Atomic state + event publishing |
| Saga Pattern | `reliability-patterns.md` | Distributed transactions with compensation |
| Circuit Breaker | `resilience-patterns.md` | Stop calling failing services |
| Bulkhead | `resilience-patterns.md` | Isolate failure domains |
| Retry + Timeout | `resilience-patterns.md` | Handle transient failures |

## Integration and Migration Patterns

These define how systems connect and evolve.

| Pattern | File | Summary |
|---|---|---|
| API Gateway | `api-patterns.md` | Single edge entry point, cross-cutting concerns |
| BFF (Backend for Frontend) | `api-patterns.md` | Client-specific backend aggregation |
| Strangler Fig | `strangler-fig.md` | Incremental legacy system migration with parallel running |
| Branch by Abstraction | `strangler-fig.md` | In-place component replacement via abstraction layer (see Strangler Fig) |

## Common Pattern Combinations

These combinations are frequently used together in production:

**Event-driven modular monolith** (recommended starting point for most products):
`modular-monolith.md` + `event-driven-architecture.md` + `reliability-patterns.md` (Outbox)

**Audit-ready enterprise system**:
`clean-architecture.md` + `cqrs.md` + `event-sourcing.md`

**High-scale distributed system**:
`microservices.md` + `event-driven-architecture.md` + `reliability-patterns.md` + `resilience-patterns.md` + `api-patterns.md`

**Legacy migration path**:
`strangler-fig.md` → `modular-monolith.md` → `microservices.md` (if needed)

**Rich domain model** (complex business rules, long-lived product):
`clean-architecture.md` or `hexagonal-architecture.md` + `ddd-tactical-patterns.md` + `repository-pattern.md`

**SaaS multi-tenant product**:
`modular-monolith.md` + `multi-tenant-architecture.md` + `repository-pattern.md` + `caching-patterns.md`
