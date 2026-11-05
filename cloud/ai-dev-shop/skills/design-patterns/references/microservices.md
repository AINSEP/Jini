# Microservices

## What It Is

Decompose a system into independently deployable services, each owning a single business capability, its own data store, and its own release lifecycle. Services communicate over the network through APIs or messaging.

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   User      │   │   Order     │   │   Payment   │   │  Inventory  │
│  Service    │   │  Service    │   │   Service   │   │   Service   │
│             │   │             │   │             │   │             │
│  [users DB] │   │ [orders DB] │   │ [payment DB]│   │  [inv DB]   │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
       │                 │                 │                  │
       └─────────────────┴─────────────────┴──────────────────┘
                                    │
                            API Gateway / BFF
                                    │
                               Clients
```

## When to Use

- Multiple teams that need to deploy independently without coordinating releases
- Services with genuinely different scaling requirements (search needs 10x more capacity than billing)
- You are past product-market fit and at organizational scale where a monolith is creating deployment bottlenecks
- Services with different technology requirements (ML inference service needs GPUs; billing service needs strong consistency)

## When Not to Use

- Building a new product — distributed systems complexity slows you down when speed matters most
- Small teams — operational overhead per service multiplies with team size
- Shared database across "services" — this is a distributed monolith, not microservices, with all the downsides of both
- When organizational boundaries have not been established yet — services cut along team boundaries, not technical ones

**Default to Modular Monolith first. Migrate to microservices when you have a specific problem a monolith cannot solve.**

## Service Communication Patterns

### Synchronous (Request/Response)

**REST**: HTTP/JSON. Simple, universal, easy to debug. Adequate for most service-to-service communication.

**gRPC**: Binary protocol, strongly typed schemas, bidirectional streaming. Use when performance matters or you need streaming.

**When to use synchronous**: The caller needs the result immediately to continue. Example: "Is this user authorized?" must be answered before the request can proceed.

**Risk**: Tight temporal coupling. If the downstream service is slow or unavailable, the caller is blocked or fails. Always combine synchronous calls with timeouts and circuit breakers (see `resilience-patterns.md`).

### Asynchronous (Message-Based)

Publish events or commands to a message broker. Consumers process independently.

**When to use async**: The caller does not need the result immediately. Example: "Send a confirmation email" can happen after the order is saved — the order doesn't wait for the email.

**Default to async** for inter-service side effects. Reserve sync calls for operations requiring immediate consistency.

## Data Consistency Patterns

Each service owns its own database. You cannot use a database transaction across services. Options for multi-service consistency:

**Saga Pattern**: Sequence of local transactions with compensating transactions for rollback. The primary mechanism for multi-service business operations. See `reliability-patterns.md`.

**Eventual consistency**: Accept that services will be briefly inconsistent. Design UX to handle it (loading states, stale data labeling). Most business operations tolerate brief inconsistency.

**Event-carried state transfer**: When Service B needs data from Service A, Service A publishes events containing the relevant data. Service B maintains its own local copy. No synchronous cross-service reads needed for normal operations.

**Avoid distributed transactions (2PC)**: Two-phase commit across services is slow, fragile, and unavailable in most cloud databases. Use Sagas instead.

## Service Boundaries

Good service boundaries follow business capabilities, not technical layers. "Database service," "API service," "business logic service" are wrong. "Order management," "payment processing," "inventory" are right.

Each service should:
- Own a single business capability end-to-end
- Own its own database (no shared database tables)
- Be deployable without coordinating with other services
- Be testable in isolation with stubbed dependencies

**Database per service is non-negotiable.** Shared databases create hidden coupling that defeats the purpose of microservices. Services that share a database must coordinate schema changes, query patterns, and transaction semantics — exactly what microservices are supposed to eliminate.

## API Edge Layer

Microservices need an edge layer that clients talk to. See `api-patterns.md` for:
- **API Gateway**: Single entry point, centralized auth, rate limiting, routing
- **BFF (Backend for Frontend)**: Client-specific aggregation for mobile, web, third-party

## Resilience

Services fail. Networks partition. Design for partial failure from day one. Apply `resilience-patterns.md` for every inter-service call:
- **Timeout** on every network call
- **Retry with backoff** for transient failures
- **Circuit Breaker** to stop calling failing services
- **Bulkhead** to prevent one failing dependency from starving others

## Distributed Tracing and Observability

Debugging a failure that spans 5 services requires tracing. Instrument every service from day one:
- **Correlation ID**: Generate at the edge (API Gateway or first service to receive the request). Pass through every service call and every event. Log it everywhere.
- **Distributed tracing**: OpenTelemetry is the standard. Traces show the full call tree across services with timing.
- **Centralized logging**: All services ship logs to a central store (Elasticsearch, CloudWatch, Datadog). Search by correlation ID to reconstruct a request.

Without distributed tracing, production debugging in a microservices system is nearly impossible.

## Detailed Example

Marketplace platform. Each service independently deployable:

| Service | Capability | Communication |
|---|---|---|
| User Service | Registration, auth, profiles | Sync: REST for auth checks |
| Listing Service | Products, search, inventory | Sync: REST for reads |
| Order Service | Order creation and lifecycle | Async: publishes OrderPlaced event |
| Payment Service | Charging, refunds | Sync: gRPC (immediate result needed) |
| Notification Service | Email, SMS, push | Async: consumes events |
| Search Service | Full-text search indexing | Async: consumes listing events |

Order placement flow:
1. Order Service receives `POST /orders` (sync)
2. Order Service calls Payment Service via gRPC (sync — needs result immediately)
3. Payment success → Order Service saves order, publishes `OrderPlaced` (async via Outbox)
4. Inventory Service consumes `OrderPlaced`, reserves stock
5. Notification Service consumes `OrderPlaced`, sends confirmation email
6. Analytics Service consumes `OrderPlaced`, updates dashboard

## Testing Strategy

- **Service unit/integration tests**: Test each service in isolation with mocked or stubbed dependencies
- **Contract tests**: Consumer-driven contract tests (Pact) verify that a service's API matches what its consumers expect. Run on every deployment.
- **Component tests**: Test a service against a real database but stub all external services
- **End-to-end tests**: A small set of critical paths tested against real services in a staging environment. Not a replacement for lower-level tests.

## Common Failure Modes

**Shared database**: Services sharing tables or schemas. Creates hidden coupling and defeats independence. Each service must own its data.

**Chatty inter-service calls**: Service A calls Service B which calls Service C which calls Service D in sequence for a single user request. Latency compounds. Redesign to reduce synchronous call depth.

**No circuit breaker on synchronous calls**: One slow service takes down every service that calls it. Every synchronous inter-service call needs a circuit breaker.

**Microservices for a small team**: 5 developers managing 15 microservices spend more time on infrastructure than features. Start with a modular monolith.

**Premature decomposition**: Cutting service boundaries before the domain is understood leads to services that are too small, poorly bounded, and tightly coupled. Understand the domain in a monolith first.

**No distributed tracing**: Production failure affects 3 users. You have no idea which of 12 services is at fault. Tracing is not optional in production.

## Pairs Well With

- **Modular Monolith** → Microservices: Start with a well-modularized monolith; extract services when you have a specific problem to solve
- **Strangler Fig**: Use it to extract services from a legacy monolith incrementally
- **Event-Driven Architecture**: Async messaging is the primary integration pattern for microservices side effects
- **API Patterns** (Gateway + BFF): Required edge layer for any multi-client microservices system
- **Resilience Patterns**: Non-negotiable for any synchronous inter-service calls
- **Reliability Patterns** (Outbox + Saga): Reliable event publishing and distributed transactions
