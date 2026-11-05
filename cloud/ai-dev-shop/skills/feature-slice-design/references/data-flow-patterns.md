# Data Flow Patterns

How data enters, transforms, and flows through FSD layers. This is guidance with tradeoffs, not a mandate — the only hard rules are the four invariants.

## Ownership Decision Table

| Concern | Default Owner | Rationale |
|---------|---------------|-----------|
| Transport/HTTP client | `shared/api` | No business semantics; reused everywhere |
| Generated API clients/SDKs | `shared/api/generated` or `shared/generated` | External contracts, not domain models |
| Domain data reads (GET) | Entity `api/` segment | Entity owns its own data shape and fetch logic |
| User-action mutations (POST/PUT/DELETE) | Feature `api/` segment | Feature owns the action; entity owns the result |
| Multi-slice orchestration (page load, wizards, checkout flows) | Page or widget | Higher layers compose; lower layers don't know about each other |
| DTO → domain model mapping | Slice boundary (entity `api/` or feature `api/`) | Raw API shapes stay private; public API exports domain types |
| Server-side data coordination (loaders, server functions) | Framework route shell / page | Route files own the server boundary; pass clean data to FSD code |

## Data Flow Direction

```text
shared/api/client (transport)
       ↑
entities/product/api (domain reads, DTO mapping)
       ↑
features/add-to-cart/api (mutations)
       ↑
pages/product-detail (orchestrates fetches, passes to widgets/features)
       ↑
app/routing (framework route shell — loaders, actions, metadata)
```

Each layer calls downward for data. Results flow upward through return values and props, never through upward imports.

## Generated Clients and DTOs

When using generated API clients (OpenAPI codegen, GraphQL codegen, tRPC):

- Place generated code in `shared/api/generated` or `shared/generated`
- Treat generated types as external contracts, not domain models
- Map DTOs to domain types at slice boundaries (entity or feature `api/` segments)
- Never export raw generated types from a slice's public API as the domain model

## Multi-Feature Orchestration

Complex flows (checkout wizard, onboarding, multi-step forms) involve multiple features without letting features import each other:

| Approach | Where | When to use |
|----------|-------|-------------|
| Page-level composition | `pages/checkout/` | Flow is bound to a single route |
| Widget orchestration | `widgets/checkout-flow/` | Flow appears on multiple pages |
| App-level service | `app/workflows/` | Flow spans routes or needs global lifecycle |

The orchestrator calls features sequentially or in parallel; features don't know about each other.

## Loading, Error, and Empty States

Ownership follows the "closest owner" principle:

| State type | Owner | Example |
|------------|-------|---------|
| Mutation pending/error | Feature that triggered it | "Adding to cart..." spinner inside `features/add-to-cart` |
| Domain data loading | Entity or page | Skeleton in `entities/product/ui` or page-level loader |
| Page-level orchestration status | Page | Full-page loading state while multiple fetches resolve |
| Widget composition loading | Widget | Widget shows placeholder until its composed data arrives |
| Global/app-level errors | App | Network offline banner, session expired modal |

There is no single correct placement — pick the owner closest to the user experience being affected.

## Caching and Invalidation

- Cache domain reads in entity `model/` (store, cache layer, or server state manager)
- Feature mutations should signal cache invalidation to the relevant entity (through return values or events, not direct entity imports from another feature)
- App-level cache configuration (stale times, garbage collection) belongs in `app/` or `shared/api`
