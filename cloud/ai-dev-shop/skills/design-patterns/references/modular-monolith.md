# Modular Monolith

## What It Is

A single deployable application with strongly enforced internal module boundaries. Modules communicate only through their public API — never by importing each other's internal files. Inside each module, use whatever internal structure fits (Clean Architecture, layered, etc.). The monolith boundary is the deployment unit; the module boundary is the encapsulation unit.

## When to Use

- Team size ≤ 15, single deployment unit is acceptable
- Early product where you need speed but want a clean extraction path later
- Domain is complex enough to need module separation but not complex enough to justify distributed systems overhead
- You want microservices eventually — but not yet (module boundaries become service boundaries; enforce them now and extraction is straightforward later)
- Shared database is acceptable and co-deployment is not a release bottleneck

## When NOT to Use

- Teams already on different release cadences that can't coordinate deploys — use microservices
- Services with fundamentally different scaling needs (e.g., one module handles 10K rps, another handles 10/day) — independent scaling requires independent deployment
- Organization is structured around independent product teams with separate ownership, not feature teams — Conway's Law will fight module boundaries hard
- You're starting a prototype that will be thrown away — module structure is an investment; don't pay it for throwaway code

## Decision Signals

| Signal | Modular Monolith | Microservices |
|--------|-----------------|---------------|
| Team size | < 15 | > 20 across multiple teams |
| Release cadence | Coordinated | Independent per service |
| Scaling needs | Symmetric or manageable | Asymmetric across services |
| Stage | Pre-PMF or early growth | Post-PMF at scale |
| DB ownership | Shared or per-module tables | Per-service required |

## TypeScript Implementation

The critical implementation challenge is enforcing module boundaries. TypeScript paths + barrel exports + an import linting rule (`eslint-plugin-boundaries` or similar) is the minimum viable enforcement stack.

A module's public API lives in its `index.ts` and uses explicit named exports only; wildcard re-exports (`export *`) are not allowed.

```typescript
// Module public API — the ONLY thing other modules may import
// modules/billing/index.ts
export type { Invoice, InvoiceId, InvoiceStatus } from './domain/invoice'
export type { CreateInvoiceRequest, CreateInvoiceResult } from './application/dto'
export { BillingService } from './application/billing-service'
// ❌ Do NOT export internal repositories, DB models, or implementation details

// modules/notifications/index.ts
// ✅ Correct: import from the module's public API barrel
import type { Invoice } from '../billing'
import { BillingService } from '../billing'

// ❌ Never: import from inside another module's internals
// import { PostgresInvoiceRepository } from '../billing/infrastructure/postgres-invoice-repo'
// import { invoiceTable } from '../billing/infrastructure/schema'


// tsconfig.json — enforce import paths so no one accidentally bypasses the barrel
// {
//   "compilerOptions": {
//     "paths": {
//       "@billing": ["./modules/billing/index.ts"],
//       "@notifications": ["./modules/notifications/index.ts"]
//     }
//   }
// }


// Cross-module communication via service interface (synchronous) or domain event (async)
// modules/checkout/application/checkout-service.ts
import type { BillingService } from '@billing'

export class CheckoutService {
  constructor(private readonly billing: BillingService) {}

  async completeOrder(
    { orderId, lineItems }: { orderId: string; lineItems: LineItem[] }
  ): Promise<void> {
    // Call billing through its public API — not its internals
    const { invoiceId } = await this.billing.createInvoice({ orderId, lineItems })
    await this.orderRepo.markInvoiced({ orderId, invoiceId })
  }
}
```

## Testing Strategy

- **Module contract tests**: test each module's public API from the outside — treat internals as a black box
- **In-process integration tests**: wire multiple modules together in the same test process; use in-memory implementations to keep tests fast
- **Boundary violation linting**: enforce import rules in CI — a module boundary violation caught at lint time is cheaper than one caught in code review

## Common Failure Modes

**The shared "utils" package anti-pattern**: A `shared/` or `common/` package grows to include business logic. Every module imports from it. It becomes the hidden coupling channel that turns your modular monolith into a ball of mud. Rule: `shared/` may contain types, pure utility functions, and infrastructure primitives — never business logic.

**Cross-module database coupling**: Module A queries Module B's database tables directly, bypassing B's API. This makes schema changes in B break A silently. Rule: each module owns its tables; other modules read through the owning module's API or through a read model.

**Circular module dependencies**: A imports from B, B imports from A. Usually a sign that A and B belong together as one module, or that there's a missing third module C that both should depend on. Fix with domain analysis, not technical tricks.

**Leaking internal types across the barrel**: The module exports an ORM entity type that other modules begin using directly. When the ORM entity changes, everything breaks. Exports should be domain types (plain TypeScript interfaces), not infrastructure types.

**Organizational pressure eroding boundaries**: As teams grow, "just this once" cross-module imports accumulate. Without automated linting enforcement, the boundaries degrade silently over months.

## Pairs Well With

- **Event-Driven Architecture** — modules communicate async side effects through domain events instead of direct calls; keeps coupling loose even as the system grows
- **Clean Architecture or Hexagonal** — apply within each module as the internal structure; the module boundary is the outer ring
- **CQRS** — add read model projections per module when read/write shapes diverge; don't prematurely apply CQRS system-wide
- **Strangler Fig** — extract hot modules to services when they genuinely need independent deployment; the module boundary becomes the service boundary
