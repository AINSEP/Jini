# DDD Tactical Patterns

## What It Is

Domain-Driven Design tactical patterns are the building blocks for modeling complex business domains in code. They describe four kinds of objects and how they relate: **Entities** (identity-based), **Value Objects** (value-based), **Aggregates** (consistency boundaries), and **Domain Events** (facts that happened).

The key idea: different kinds of things in your domain deserve different treatment. Not everything is an entity. Conflating entity, value object, and aggregate is the most common source of consistency bugs and over-engineered persistence.

## When to Use

- Rich domain with complex business rules that span multiple objects (not just CRUD)
- Long-lived product where the domain model will evolve over years
- Clean Architecture, Hexagonal, or Layered architecture — these assume DDD-style domain objects
- Systems where invariants must be enforced regardless of which code path mutates state

## When NOT to Use

- Simple CRUD apps — applying entities and aggregates to a `User` table with no business rules is over-engineering; use plain records and a repository
- Reporting or analytics — read models and projections are not domain aggregates; don't model them as one
- Team unfamiliar with the concepts — poorly applied DDD creates more confusion than a simple layered approach; only apply when the team understands the patterns
- Prototypes — domain modeling is an investment in long-lived systems, not throwaway code

## Decision Signals

| Signal | Use DDD Tactics | Skip DDD Tactics |
|--------|-----------------|------------------|
| Business rule complexity | Many invariants spanning multiple objects | Simple field validation only |
| Object lifecycle | Objects transition through meaningful states | Objects are just data bags |
| Consistency requirements | Strong consistency within a boundary | Each table is independent |
| Codebase longevity | Long-lived, evolving product | Prototype or short-lived |

## The Four Patterns

### Entity

An object with a **unique identity** that persists across time and state changes. Two entities with the same ID are the same thing, even if all their fields differ. Two entities with different IDs are different things, even if all fields match.

Identity is the defining characteristic. Entities are **mutable** — their state changes, but their identity doesn't.

Examples: `User`, `Invoice`, `Order`, `Task`

### Value Object

An object defined entirely by its **values**. No identity. Two instances with the same values are equal and interchangeable. Value objects are **immutable** — you never mutate one, you replace it with a new one.

Represent concepts that are descriptive, not identificative.

Examples: `Money`, `Address`, `Email`, `DateRange`, `PhoneNumber`

### Aggregate

A cluster of entities and value objects that form a **consistency boundary**. One entity is the Aggregate Root — it controls all access to the cluster and enforces all invariants. External code only holds references to the aggregate root, never to internal entities.

You load and save aggregates as a whole. Invariants that span multiple objects within the aggregate are enforced by the root before any save. No partial saves.

Examples: `Order` (root) + `OrderLine[]`, `ShoppingCart` (root) + `CartItem[]`

### Domain Event

An **immutable record of something significant that happened** in the domain. Named in past tense. Raised by aggregates when meaningful state transitions occur. Used to communicate between aggregates and across module boundaries without coupling.

Examples: `OrderPlaced`, `PaymentFailed`, `UserSuspended`, `InvoiceIssued`

## TypeScript Implementation

```typescript
// ── Value Object ─────────────────────────────────────────────────────────────
// Immutable. Equality is structural. Operations return new instances.
export class Money {
  constructor(
    readonly amount: number,
    readonly currency: 'USD' | 'EUR' | 'GBP'
  ) {
    if (amount < 0) throw new DomainError('Money amount cannot be negative')
    Object.freeze(this)
  }

  add(other: Money): Money {
    if (other.currency !== this.currency) {
      throw new DomainError(`Cannot add ${this.currency} and ${other.currency}`)
    }
    return new Money(this.amount + other.amount, this.currency)
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency
  }
}

// ── Entity ────────────────────────────────────────────────────────────────────
// Has identity (id). Mutable state. Equality is identity-based.
export interface OrderLineProps {
  id: string
  productId: string
  quantity: number
  unitPrice: Money
}

export class OrderLine {
  constructor(private props: OrderLineProps) {}

  get id() { return this.props.id }
  get productId() { return this.props.productId }
  get quantity() { return this.props.quantity }
  get unitPrice() { return this.props.unitPrice }

  get total(): Money {
    return new Money(this.props.unitPrice.amount * this.props.quantity, this.props.unitPrice.currency)
  }

  updateQuantity(quantity: number): void {
    if (quantity <= 0) throw new DomainError('Quantity must be positive')
    this.props.quantity = quantity
  }

  equals(other: OrderLine): boolean {
    return this.id === other.id  // identity-based
  }
}

// ── Domain Event ──────────────────────────────────────────────────────────────
export interface OrderPlaced {
  type: 'OrderPlaced'
  orderId: string
  customerId: string
  totalAmount: number
  currency: string
  placedAt: string
}

// ── Aggregate ─────────────────────────────────────────────────────────────────
// Aggregate Root: Order. Controls all access to OrderLines.
// Enforces all invariants before state changes are allowed.
// Raises Domain Events when significant transitions occur.
export class Order {
  private readonly _events: OrderPlaced[] = []

  private constructor(
    private readonly id: string,
    private readonly customerId: string,
    private lines: OrderLine[],
    private status: 'draft' | 'placed' | 'cancelled'
  ) {}

  // Factory method — enforces invariants at creation time
  static create(id: string, customerId: string): Order {
    if (!customerId) throw new DomainError('customerId is required')
    return new Order(id, customerId, [], 'draft')
  }

  // Reconstitute from persistence — bypasses creation invariants
  static reconstitute(
    id: string,
    customerId: string,
    lines: OrderLine[],
    status: 'draft' | 'placed' | 'cancelled'
  ): Order {
    return new Order(id, customerId, lines, status)
  }

  addLine(line: OrderLine): void {
    if (this.status !== 'draft') {
      throw new DomainError('Cannot modify a placed or cancelled order')
    }
    if (this.lines.some(l => l.productId === line.productId)) {
      throw new DomainError(`Product ${line.productId} already in order`)
    }
    this.lines.push(line)
  }

  place(): void {
    if (this.status !== 'draft') throw new DomainError('Order already placed or cancelled')
    if (this.lines.length === 0) throw new DomainError('Cannot place an empty order')

    this.status = 'placed'

    // Raise domain event — consumed by other aggregates or modules
    this._events.push({
      type: 'OrderPlaced',
      orderId: this.id,
      customerId: this.customerId,
      totalAmount: this.total.amount,
      currency: this.total.currency,
      placedAt: new Date().toISOString(),
    })
  }

  get total(): Money {
    return this.lines.reduce(
      (sum, line) => sum.add(line.total),
      new Money(0, 'USD')
    )
  }

  get domainEvents(): OrderPlaced[] { return [...this._events] }
  clearEvents(): void { this._events.length = 0 }

  // Expose read-only state for persistence mapping
  get snapshot() {
    return { id: this.id, customerId: this.customerId, lines: this.lines, status: this.status }
  }
}
```

## Testing Strategy

- **Value Object tests**: equality, immutability, invariant enforcement — all pure functions, no mocks needed
- **Entity tests**: state transitions, identity equality, business rule enforcement on the entity
- **Aggregate tests**: invariant checks (can't place empty order, can't modify placed order), event emission, reconstitution from persistence snapshot
- **Do not test aggregates through repositories**: test the aggregate in isolation; use a separate test to verify the repository round-trips correctly

## Common Failure Modes

**Everything is an entity**: Engineers model `Money`, `Address`, and `Status` as entities with IDs. This produces unnecessary tables, unnecessary joins, and misses the immutability guarantee that makes value objects safe to share. Rule: if two instances with identical values are interchangeable, it's a value object.

**Aggregate too large**: The `Customer` aggregate contains `Customer`, `Order[]`, `Invoice[]`, `Address[]`, `PaymentMethod[]`. Loading a customer loads their entire history. Fix: aggregates are consistency boundaries, not object graphs. If `Invoice` enforces its own invariants independently, it's its own aggregate. Keep aggregates small — usually one to five objects.

**Bypassing the aggregate root**: `order.lines[0].updateQuantity(5)` called from outside the aggregate. The root's invariants are never checked. Fix: `OrderLine` should have no public mutation methods; mutations go through `Order.updateLineQuantity()` which enforces all invariants before delegating.

**Domain events not published to consumers**: The aggregate raises events with `clearEvents()` called but nothing consumes them. Events are lost. Fix: the application service reads `aggregate.domainEvents` after saving, clears them, and publishes them (ideally via Outbox). This is the integration contract.

**Reconstituting aggregates with invalid state**: ORM maps a DB row to an `Order` using the public constructor, invoking creation invariants (e.g., throwing on zero-line orders that were cancelled). Fix: separate `Order.create()` (creation invariants) from `Order.reconstitute()` (bypasses creation invariants, trusts DB state).

## Pairs Well With

- **Repository Pattern** — one repository per aggregate root; repositories load and save complete aggregates, never partial state
- **Clean Architecture / Hexagonal** — aggregates live in the domain layer; repositories are ports; no ORM types leak into aggregates
- **Event-Driven Architecture** — aggregate domain events become integration events; dispatched after persistence via Outbox
- **CQRS** — aggregates handle the write side (command → aggregate → event); read models are separate projections, not aggregates
