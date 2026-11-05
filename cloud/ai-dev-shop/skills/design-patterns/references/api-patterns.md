# API Patterns: API Gateway and BFF

Every system with external clients has an edge layer. These two patterns define how that layer is structured. Choosing between them — and whether to combine them — is one of the first decisions in any multi-client system design.

---

## Part 1: API Gateway

### What It Is

A single entry point for all client requests to a backend. The gateway handles cross-cutting concerns centrally, so individual services do not need to implement them.

```
                    ┌──────────────────────┐
 Mobile App ──────► │                      │
 Web App    ──────► │    API GATEWAY       │ ──► User Service
 3rd Party  ──────► │                      │ ──► Order Service
                    │  (auth, rate limit,  │ ──► Payment Service
                    │   routing, logging)  │ ──► Product Service
                    └──────────────────────┘
```

### Responsibilities

The gateway handles concerns that would otherwise be duplicated across every service:

- **Authentication**: Validate JWT tokens or API keys before requests reach services
- **Authorization**: Enforce coarse-grained access policies (service-level, not resource-level)
- **Rate limiting**: Protect backend services from overload
- **SSL termination**: Handle HTTPS at the edge; services communicate over HTTP internally
- **Request routing**: Map external URLs to internal service endpoints
- **Request/response transformation**: Normalize headers, add correlation IDs, strip sensitive fields from responses
- **Logging and tracing**: Centralized access log and distributed trace injection
- **Circuit breaking**: Stop forwarding requests to unhealthy services

### When to Use

- Microservices where you need a single external endpoint
- Multiple clients that all authenticate the same way
- You want to enforce rate limiting and logging without duplicating it across services

### When to Avoid

- Monolith or small service sets — the gateway adds an infrastructure component and a network hop
- When different clients have radically different authentication mechanisms or data needs — see BFF below

### Tradeoffs

| Benefit | Tradeoff |
|---|---|
| Centralized cross-cutting concerns | Single point of failure (mitigate with redundancy) |
| Clients have one endpoint | Additional network hop adds latency |
| Easier to enforce org-wide policies | Gateway can become a bottleneck if logic is embedded |
| Simplifies service implementations | Complex routing logic in gateway is hard to test |

**Critical rule**: The gateway must be dumb. It routes, authenticates, and enforces policies. It does not contain business logic. Business logic in a gateway is untestable, uncoupled from domain models, and becomes a maintenance trap.

---

## Part 2: Backend for Frontend (BFF)

### What It Is

A dedicated backend service per client type. Each BFF aggregates and shapes data specifically for its client, rather than having the client make multiple service calls and assemble the data itself.

```
                    ┌───────────────┐
 Mobile App ──────► │   Mobile BFF  │ ──┐
                    └───────────────┘   │
                                        │──► User Service
                    ┌───────────────┐   │──► Order Service
 Web App    ──────► │    Web BFF    │ ──┤──► Product Service
                    └───────────────┘   │──► Inventory Service
                                        │
                    ┌───────────────┐   │
 3rd Party  ──────► │   Public API  │ ──┘
                    └───────────────┘
```

### The Problem BFF Solves

Different clients have different data requirements:
- **Mobile app**: needs compact payloads, prefers fewer round trips, has different auth flows (push notifications, biometrics)
- **Web app**: can handle larger payloads, needs richer data for dashboard views
- **Third-party API**: needs stable, versioned contracts independent of internal data model changes

Without BFF, you face a choice: build one general-purpose API that serves everyone (becomes a bloated, hard-to-evolve compromise) or make clients do multiple calls and assemble data themselves (high client-side complexity, over-fetching).

A BFF gives each client a first-class API designed for that client's exact needs.

### When to Use

- Multiple distinct client types with meaningfully different data requirements
- Mobile clients where reducing round trips and payload size matters significantly
- When you need to maintain stable third-party API contracts independently of internal changes
- When mobile and web teams are separate and need to own their own backend surface

### When Not to Use

- Single client type — a BFF adds service complexity with no benefit
- Clients with nearly identical data requirements — shared API is fine
- Small teams where maintaining multiple backend services adds more overhead than value
- When API Gateway + well-designed service APIs already meet client needs

### Tradeoffs

| Benefit | Tradeoff |
|---|---|
| Optimal data shape per client | More services to build and operate |
| Client teams can own their BFF | Risk of duplicating business logic across BFFs |
| Independent evolution per client API | Need to keep BFF logic thin (no business rules) |
| Reduces client-side data aggregation | Requires discipline to prevent BFF becoming a fat API |

**Critical rule**: A BFF aggregates and transforms. It does not contain business logic. Business logic belongs in domain services. A BFF that starts making business decisions becomes a second domain layer that is impossible to test properly.

---

## API Gateway + BFF Combined

The two patterns compose naturally:

```
Mobile App ──► Mobile BFF ──┐
                             │──► API Gateway ──► Services
Web App    ──► Web BFF   ──┘
```

The API Gateway handles cross-cutting concerns (auth, rate limiting, TLS). The BFFs handle client-specific aggregation and shaping. Each has a single, clear responsibility.

---

## GraphQL as an Alternative

GraphQL is sometimes proposed as an alternative to BFF: one endpoint where clients specify exactly what data they need. This reduces over-fetching and can eliminate the need for multiple BFFs.

**Choose GraphQL over BFF when**: You have many clients with varying data needs and want clients to self-serve their data requirements. Rapid frontend iteration is more valuable than backend control.

**Choose BFF over GraphQL when**: You need strict control over what each client can query (performance, security). Mobile clients benefit more from predictable, compact payloads than from flexible querying. Your team does not want to invest in GraphQL schema design and resolver patterns.

---

## Testing Strategy

**API Gateway:**
- Route mapping tests (correct service for each path)
- Auth enforcement tests (401 for missing/invalid token on protected routes)
- Rate limit tests
- Header injection tests (correlation ID present on every forwarded request)

**BFF:**
- Aggregation tests (correct data from multiple services assembled correctly)
- Client-specific shape tests (mobile payload is compact, web payload is rich)
- Downstream service failure handling tests (partial failure returns graceful response, not 500)
- Contract tests (BFF API contract does not break when downstream services change internally)

## Common Failure Modes

**Business logic in the gateway**: Gateway starts validating business rules. It now owns domain knowledge it should not have, cannot be tested against domain models, and becomes a maintenance problem.

**Business logic in BFFs**: Same problem. BFF aggregates; it does not decide. Discount calculations, order validation, and inventory rules belong in services.

**One BFF per page instead of per client type**: BFFs proliferate into dozens of micro-BFFs, each owned by a different feature team. This creates a maintenance nightmare. BFF granularity should be per client type, not per screen.

**No versioning strategy on the public API BFF**: Third-party clients need stable contracts. Establish API versioning from day one (URL versioning `/v1/`, `/v2/` or header versioning) or breaking changes become expensive incidents.

## Pairs Well With

- **Microservices** — API Gateway is the standard edge layer; BFF manages per-client aggregation
- **Strangler Fig** — the routing layer in a strangler migration is often implemented as an API Gateway
- **Resilience Patterns** — API Gateway is a natural place to implement circuit breaking for backend services
- **Vertical Slice Architecture** — BFF slices align naturally with feature-slice backends
