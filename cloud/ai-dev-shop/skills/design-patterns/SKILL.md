---
name: design-patterns
version: 1.0.0
last_updated: 2026-03-05
description: Use when selecting or implementing architecture patterns including hexagonal, clean architecture, CQRS, event sourcing, event-driven, microservices, resilience, DDD tactical patterns, multi-tenant, caching, repository pattern, and more — each with TypeScript examples, tradeoffs, and when-to-use guidance.
---

# Design Patterns Library

19+ production architecture patterns with TypeScript examples, tradeoffs, testing guidance, and failure modes. Load the specific pattern file(s) relevant to the current decision — do not load all at once.

For active ports-and-adapters implementation guidance across non-React stacks, prefer loading `<AI_DEV_SHOP_ROOT>/skills/hexagonal-architecture/SKILL.md` alongside the reference material.

## Default Product Heuristic

For most long-lived products:

- start with a modular monolith as the macro shape,
- organize work by vertical slices or strongly owned modules,
- apply hexagonal boundaries only where external I/O isolation or business-critical logic actually benefits from ports and adapters.

Do not default the entire codebase to full ports-and-adapters ceremony if the work is simple CRUD, scripting, or otherwise low-complexity.

## Pattern Selection Decision Guide

| Situation | Load |
|---|---|
| Greenfield product, small team | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/modular-monolith.md` |
| Complex domain logic, long-lived product | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/clean-architecture.md` or `hexagonal-architecture.md` |
| Multiple I/O channels (HTTP + CLI + events) | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/hexagonal-architecture.md` |
| Feature teams, autonomous delivery | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/vertical-slice-architecture.md` |
| Asymmetric read/write workloads | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/cqrs.md` |
| Audit trail, financial, compliance | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/event-sourcing.md` (pair with CQRS) |
| Async cross-service side effects | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/event-driven-architecture.md` |
| Multi-service business transactions | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/reliability-patterns.md` (Saga) |
| Reliable event publishing | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/reliability-patterns.md` (Outbox) |
| Independent team deployment at scale | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/microservices.md` |
| Migrating a legacy system | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/strangler-fig.md` |
| Multiple client types (mobile, web, API) | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/api-patterns.md` (BFF) |
| Centralized auth, rate limiting at edge | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/api-patterns.md` (API Gateway) |
| Preventing cascade failures | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/resilience-patterns.md` |
| Bursty traffic, ops-light team | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/serverless-architecture.md` |
| Offline batch / ML pipelines | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/pipeline-batch-architecture.md` |
| Simple CRUD, familiar team structure | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/layered-architecture.md` |
| Domain layer needs data access without DB coupling | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/repository-pattern.md` |
| Modeling complex domain with entities, aggregates, value objects | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/ddd-tactical-patterns.md` |
| SaaS product with multiple isolated customers | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/multi-tenant-architecture.md` |
| Read-heavy workloads, expensive repeated queries, latency reduction | `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/caching-patterns.md` |

## Common Pattern Combinations

**Event-driven modular monolith** (recommended starting point for most products):
`modular-monolith` + `event-driven-architecture` + `reliability-patterns` (Outbox)

**Audit-ready enterprise system**:
`clean-architecture` + `cqrs` + `event-sourcing`

**High-scale distributed system**:
`microservices` + `event-driven-architecture` + `reliability-patterns` + `resilience-patterns` + `api-patterns`

**Legacy migration path**:
`strangler-fig` → `modular-monolith` → `microservices` (if needed)

## All Pattern Files

See `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/` for the full set.
