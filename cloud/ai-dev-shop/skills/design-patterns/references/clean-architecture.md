# Clean Architecture

## What It Is

Organize code in concentric rings where dependencies point inward. Outer rings depend on inner rings. Inner rings know nothing about outer rings. The innermost ring — your core business rules — has zero external dependencies.

```
┌──────────────────────────────────────────────────┐
│  FRAMEWORKS & DRIVERS (outermost)                │
│  Web, DB, UI, External APIs                      │
│  ┌────────────────────────────────────────────┐  │
│  │  INTERFACE ADAPTERS                        │  │
│  │  Controllers, Presenters, Gateways         │  │
│  │  ┌──────────────────────────────────────┐  │  │
│  │  │  USE CASES                           │  │  │
│  │  │  Application-specific business rules │  │  │
│  │  │  ┌──────────────────────────────┐    │  │  │
│  │  │  │  ENTITIES (innermost)        │    │  │  │
│  │  │  │  Core business rules         │    │  │  │
│  │  │  │  Enterprise-wide logic       │    │  │  │
│  │  │  └──────────────────────────────┘    │  │  │
│  │  └──────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘

Dependencies: → inward only. Never outward.
```

## The Dependency Rule (The One Rule That Matters)

Source code dependencies must only point inward. Nothing in an inner ring can know anything about something in an outer ring.

- Entities do not import Use Cases, Controllers, or anything from outer rings
- Use Cases do not import Controllers, Frameworks, or ORMs
- Controllers can import Use Cases but not ORMs directly
- ORMs, web frameworks, and databases live in the outermost ring

This rule is what makes the architecture work. Violating it means your business logic depends on infrastructure, making it impossible to test in isolation and hard to migrate to different infrastructure.

## The Four Rings

### Ring 1: Entities (innermost)

Enterprise-wide business rules. These change least often and are most stable. They have no dependencies — no frameworks, no ORMs, no external libraries.

**What lives here**: Domain objects, business rule methods, value objects, domain events, interfaces for domain services.

**Example**: An `Invoice` entity with its invariants (total must equal sum of line items, status transitions must follow valid paths). This logic does not care whether the invoice is stored in PostgreSQL or MongoDB, or whether it is accessed via REST or GraphQL.

### Ring 2: Use Cases

Application-specific business rules. Orchestrate the flow of data to and from entities to achieve a specific outcome. Use cases depend on entities but on nothing from outer rings.

**What lives here**: `CreateInvoiceUseCase`, `ProcessPaymentUseCase`, `CancelOrderUseCase`. Each use case is a single operation from the application's perspective.

**Key design**: Use cases communicate with outer rings through interfaces (ports) defined in this ring. The use case defines `InvoiceRepository` as an interface — it does not know what implements it.

```typescript
// Function signature paradigm: (required: { ... }, options: { ... } = {})
// Required params in first object — missing one is a type error at the callsite.
// Optional params in second object with defaults — adding new ones never breaks existing calls.

class CreateInvoiceUseCase {
  constructor(
    private readonly invoiceRepo: InvoiceRepository,   // interface, not implementation
    private readonly customerRepo: CustomerRepository
  ) {}

  async execute(
    { customerId, lineItems }: { customerId: string; lineItems: LineItem[] },
    { currency = 'USD', notes }: { currency?: string; notes?: string } = {}
  ): Promise<{ invoiceId: string }> {
    const customer = await this.customerRepo.findById({ id: customerId })
    if (!customer) throw new CustomerNotFoundError({ customerId })
    const invoice = Invoice.create({ customer, lineItems }, { currency, notes })
    await this.invoiceRepo.save({ invoice })
    return { invoiceId: invoice.id }
  }
}
```

### Ring 3: Interface Adapters

Convert data from the format most convenient for use cases and entities into the format most convenient for external agents (web, DB, UI), and vice versa.

**What lives here**:
- **Controllers**: Accept HTTP requests, call use cases, return responses. They do not contain business logic.
- **Presenters**: Transform use case output into a format for the UI or API response.
- **Repository implementations**: `PostgresInvoiceRepository` implements the `InvoiceRepository` interface defined in the use cases ring.
- **Gateway implementations**: `StripePaymentGateway` implements the `PaymentGateway` interface.

### Ring 4: Frameworks & Drivers (outermost)

The web framework, ORM, database driver, message broker client, third-party SDKs. This ring is mostly glue code.

**What lives here**: FastAPI routes, SQLAlchemy models, Kafka consumers, AWS SDK calls, OAuth libraries.

**Key principle**: You should be able to swap anything in this ring — replace PostgreSQL with MongoDB, replace FastAPI with Flask — without touching the two inner rings.

## When to Use

- Long-lived products where frameworks and infrastructure will evolve
- Strong, complex domain logic that must be testable independently
- Systems that need high test coverage on business rules without depending on databases or web servers
- Teams that need strict separation between domain experts and infrastructure engineers

## When to Avoid

- Simple CRUD applications with no complex domain rules — the ring structure adds ceremony without benefit
- Short-lived prototypes where the investment in abstraction is not justified
- Teams new to the pattern — the learning curve is real and violations are subtle

## Difference from Hexagonal Architecture

Both enforce the same core principle: dependencies point inward, core is independent of infrastructure. The difference is structural emphasis:

- **Clean Architecture** provides a prescriptive four-ring model with explicit Use Cases as a distinct ring. Use cases are first-class citizens separate from entities.
- **Hexagonal Architecture** focuses on the port/adapter metaphor — there is a core application and external systems connect through ports. It does not mandate a separate use cases ring.

**Choose Clean Architecture when**: You want an explicit, prescriptive layer structure with use cases as named application operations. Easier to onboard new developers because the structure tells them where everything belongs.

**Choose Hexagonal when**: You want the same principles but more flexibility in internal structure. Better when the "driving" vs "driven" port distinction (inbound vs outbound) is the most important thing to communicate.

## The Composition Root

Dependency injection wires everything together at startup. The composition root is the one place where outer ring implementations are connected to inner ring interfaces. Nothing else in the system knows which implementation is used.

```typescript
// Composition root — only place that knows about concrete implementations
function buildContainer(): Container {
  // Infrastructure (outermost ring)
  const db = new PostgresDatabase({ connectionString: config.DB_URL })
  const stripeClient = new StripeClient({ apiKey: config.STRIPE_KEY })

  // Repositories — Ring 3 implementations wired to Ring 2 interfaces
  const invoiceRepo = new PostgresInvoiceRepository({ db })
  const customerRepo = new PostgresCustomerRepository({ db })
  const paymentGateway = new StripePaymentGateway({ client: stripeClient })

  // Use cases — wired with interfaces only, no concrete types
  const createInvoice = new CreateInvoiceUseCase(invoiceRepo, customerRepo)
  const processPayment = new ProcessPaymentUseCase(paymentGateway, invoiceRepo)

  return new Container({ createInvoice, processPayment })
}

// In tests: swap implementations at the composition root
function buildTestContainer(): Container {
  const invoiceRepo = new InMemoryInvoiceRepository()
  const customerRepo = new InMemoryCustomerRepository()
  const paymentGateway = new FakePaymentGateway()
  return new Container({
    createInvoice: new CreateInvoiceUseCase(invoiceRepo, customerRepo),
    processPayment: new ProcessPaymentUseCase(paymentGateway, invoiceRepo),
  })
}
```

In tests, swap implementations at the composition root: use in-memory repositories instead of Postgres.

## Testing Strategy

- **Entity tests**: Pure unit tests with no mocks. Entities have no dependencies. Test all invariants and business rules.
- **Use case tests**: Inject fake/in-memory implementations of repository interfaces. Test business orchestration without a database.
- **Controller/adapter tests**: Test HTTP input parsing and response formatting separately from business logic.
- **Integration tests**: Test the full stack with real infrastructure but limited to one use case path.

## Common Failure Modes

**Inward dependency violation**: A use case imports an ORM model. An entity imports a web framework type. This is the most common violation — it must be caught in code review.

**Anemic domain model**: Entities have no behavior — they are just bags of fields. All logic ends up in use cases. This is a sign that the entities ring is being used as a data layer, not a behavior layer. Move business rules into entities.

**Fat controllers**: Controllers contain business logic (validation, calculations, state transitions). Business logic belongs in use cases and entities, not in the ring that owns HTTP concerns.

**Interface-per-class over-abstraction**: Creating an interface for every class "just in case." Define interfaces only where substitution is needed (external dependencies, testability boundaries). Unnecessary interfaces add maintenance burden with no benefit.

## Pairs Well With

- **CQRS** — use cases map naturally to commands; queries can bypass the use case layer for performance
- **Domain-Driven Design** — entities and use cases align with DDD aggregates and application services
- **Hexagonal Architecture** — nearly identical principles; choose based on team preference for structure vs flexibility
- **Event Sourcing** — entities emit domain events; event store is an outer-ring infrastructure concern
