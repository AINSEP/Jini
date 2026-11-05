# Layered Architecture

## What It Is

Organize code into horizontal layers (Presentation → Application/Service → Domain → Data Access) with strictly one-way dependencies flowing top-to-bottom. No layer may import from a layer above it.

The key constraint: dependency direction is the architecture. Violate it once and the guarantees collapse. A repository may not import from a service; a domain object may not import from infrastructure. The domain layer is the most stable — it has no dependencies except itself.

## When to Use

- CRUD-heavy business systems with stable, well-understood domain rules
- Teams that need simple and familiar structure for fast onboarding
- Moderate complexity where features share significant domain logic (shared rules justify a shared domain layer)
- Single team where uniform architectural patterns matter more than feature isolation

## When NOT to Use

- Multiple feature teams where features have independent delivery cadence — each feature change touches every layer; use Vertical Slice instead
- Complex domain with distinct bounded contexts — a single flat domain layer becomes a coupling magnet; use Clean Architecture or DDD modules
- High-throughput APIs where adding measurable latency from mandatory layer traversal on every request is unacceptable (micro-benchmarks first; often not the bottleneck, but verify)
- Systems that will be split into microservices soon — a shared domain layer creates tight coupling that makes extraction painful

## Decision Signals

| Signal | Layered | Vertical Slice |
|--------|---------|----------------|
| Feature independence | Low — features share domain logic | High — features rarely share rules |
| Team structure | Single team, shared ownership | Multiple teams, per-feature ownership |
| Architectural uniformity | Required — all features same shape | Optional — each slice can vary |
| Domain complexity | Moderate, stable rules | Varies per feature |
| Preferred question | "Where is validation?" → one layer | "Where is CreateTask?" → one folder |

## TypeScript Implementation

```typescript
// Layer structure:
// src/
// ├── presentation/     routes, controllers, DTOs
// ├── application/      services, use-case orchestration
// ├── domain/           entities, value objects, business rules, repository interfaces
// └── infrastructure/   repository implementations, DB clients, external adapters

// domain/invoice.ts — no imports from application or infrastructure
export interface Invoice {
  id: string
  orderId: string
  lineItems: LineItem[]
  status: 'draft' | 'issued' | 'paid' | 'void'
  totalCents: number
}

// domain/invoice-rules.ts — pure business logic, zero infrastructure
export function assertInvoiceIssuable(invoice: Invoice): void {
  if (invoice.status !== 'draft') {
    throw new DomainError(`Cannot issue invoice in status '${invoice.status}'`)
  }
  if (invoice.lineItems.length === 0) {
    throw new DomainError('Invoice must have at least one line item')
  }
}

// domain/invoice-repository.ts — interface lives in domain, implementation in infrastructure
export interface InvoiceRepository {
  findById(id: string): Promise<Invoice | null>
  save(invoice: Invoice): Promise<void>
}

// application/invoice-service.ts — orchestrates domain rules + repository
// Depends on: domain only. Never imports from infrastructure directly.
import type { InvoiceRepository } from '../domain/invoice-repository'
import { assertInvoiceIssuable } from '../domain/invoice-rules'

export class InvoiceService {
  constructor(private readonly repo: InvoiceRepository) {}

  async issueInvoice(invoiceId: string): Promise<void> {
    const invoice = await this.repo.findById(invoiceId)
    if (!invoice) throw new NotFoundError(`Invoice ${invoiceId} not found`)

    assertInvoiceIssuable(invoice)

    await this.repo.save({ ...invoice, status: 'issued' })
  }
}

// infrastructure/postgres-invoice-repo.ts — implements domain interface
import type { InvoiceRepository } from '../domain/invoice-repository'
import { db } from './db-client'

export class PostgresInvoiceRepository implements InvoiceRepository {
  async findById(id: string): Promise<Invoice | null> {
    const row = await db.query('SELECT * FROM invoices WHERE id = $1', [id])
    return row ? mapRowToInvoice(row) : null
  }
  async save(invoice: Invoice): Promise<void> {
    await db.query(
      `UPDATE invoices SET status = $1 WHERE id = $2`,
      [invoice.status, invoice.id]
    )
  }
}

// presentation/invoice-routes.ts — HTTP wiring only, no business logic
router.post('/invoices/:id/issue', authenticate, async (req, res) => {
  await invoiceService.issueInvoice(req.params.id)
  res.status(200).json({ status: 'issued' })
})
```

## Testing Strategy

- **Domain unit tests**: pure functions, no mocks needed — test all invariants and business rules in isolation
- **Service tests with mock repository**: inject an in-memory repository; test orchestration and error paths without hitting the DB
- **API tests for request/response contracts**: test the HTTP layer with a running service; validates DTO mapping and status codes

## Common Failure Modes

**Anemic domain + fat service**: Domain objects are plain data structs with no behavior. All business logic accumulates in the service layer — `InvoiceService` grows to 800 lines. Fix: push invariant checks and state transitions into domain objects and domain functions. If a method doesn't need a repository, it belongs in the domain layer.

**Business logic leaking into controllers**: Controller starts calling `db.query()` directly, or validating business rules before passing to the service. Fix: controllers handle only HTTP concerns (parsing, auth context, response mapping). Any "if this business condition" logic moves to the service or domain.

**Bidirectional dependencies**: Service imports from controller (e.g., shares a DTO type), or domain imports from infrastructure. This makes the architecture circular and untestable in isolation. Fix: types flow down the dependency chain only; define interfaces at the boundary (domain/repository interface is owned by domain, not infrastructure).

**"God service" accumulation**: All orchestration lands in one `XyzService` class because it's the only application-layer file for that domain. Fix: decompose by use case — `IssueInvoiceUseCase`, `VoidInvoiceUseCase` — each class handles one workflow. Or migrate to Vertical Slice if use cases have diverged enough to be independent.

**Repository interface designed for ORM, not domain**: `findAll(options: FindManyOptions<InvoiceEntity>)` leaks ORM types into the domain interface. When the ORM changes, the domain interface breaks. Fix: domain-first interface — `findByStatus(status: InvoiceStatus): Promise<Invoice[]>`. The implementation maps to whatever the ORM needs internally.

## Pairs Well With

- **Repository Pattern** — the data layer IS a repository abstraction; defines the boundary between domain and infrastructure
- **CQRS** — add separate read services (query handlers) that bypass the domain layer for performance; write path stays through service → domain
- **Modular Monolith** — apply layered structure within each module; module boundary is outer isolation, layer structure is inner organization
- **Vertical Slice** — natural migration target when features grow independent; extract per-feature slices when the shared domain layer starts feeling like a bottleneck
