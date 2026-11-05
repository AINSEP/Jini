# Hexagonal Architecture (Ports and Adapters)

## What It Is

The application core is surrounded by ports — interfaces that define how the application communicates with the outside world. Adapters are the concrete implementations that plug into ports. The core depends only on port interfaces, never on adapter implementations.

```
                    ┌──────────────────────────────────────┐
                    │         DRIVING SIDE                 │
                    │  (things that drive the application) │
                    │  HTTP, CLI, Tests, Message Consumers │
                    └────────────────┬─────────────────────┘
                                     │
                    ┌────────────────▼─────────────────────┐
                    │         INBOUND ADAPTERS              │
                    │  RestController, CLIHandler           │
                    │  KafkaConsumer, TestDriver            │
                    └────────────────┬─────────────────────┘
                                     │ (calls through)
                    ┌────────────────▼─────────────────────┐
 DRIVEN SIDE        │  INBOUND PORTS (interfaces)          │
 (things the        │  ICreateInvoice, IProcessPayment     │
 application        │                                      │
 drives)            │       APPLICATION CORE               │
                    │   (business logic, orchestration)    │
 Database  ◄─────── │                                      │
 Email API ◄─────── │  OUTBOUND PORTS (interfaces)         │
 Payment   ◄─────── │  IInvoiceRepository, IPaymentGateway │
 Gateway            └──────────────────────────────────────┘
                    ┌──────────────────────────────────────┐
                    │        OUTBOUND ADAPTERS              │
                    │  PostgresRepo, StripeGateway          │
                    │  SendGridEmailService                 │
                    └──────────────────────────────────────┘
```

## The Driving vs. Driven Distinction

This is the core concept that distinguishes Hexagonal from other patterns.

**Driving side (left side)**: Actors that initiate interactions with the application. They call the application. The application does not call them.
- HTTP request handlers
- CLI commands
- Message queue consumers
- Test runners

**Driven side (right side)**: Actors that the application interacts with to fulfill a request. The application calls them.
- Databases
- External APIs (payment gateways, email services)
- Message brokers (when the app publishes)
- File systems

**Inbound ports**: Interfaces on the application boundary that the driving side calls. They represent what the application can do.

**Outbound ports**: Interfaces the application uses to reach the driven side. The application defines these interfaces; adapters implement them.

```typescript
// Inbound port — the application's offered capabilities
interface IInvoiceService {
  createInvoice(
    { customerId, lineItems }: { customerId: string; lineItems: LineItem[] },
    options?: { currency?: string; notes?: string }
  ): Promise<{ invoiceId: string }>
  getInvoice(
    { invoiceId }: { invoiceId: string }
  ): Promise<Invoice>
}

// Outbound port — what the application needs from infrastructure
interface IInvoiceRepository {
  save({ invoice }: { invoice: Invoice }): Promise<void>
  findById({ invoiceId }: { invoiceId: string }): Promise<Invoice | null>
}

// Core application — depends only on outbound port interfaces
class InvoiceApplicationService implements IInvoiceService {
  constructor(
    private readonly repo: IInvoiceRepository,   // interface, not implementation
    private readonly gateway: IPaymentGateway    // interface, not implementation
  ) {}

  async createInvoice(
    { customerId, lineItems }: { customerId: string; lineItems: LineItem[] },
    { currency = 'USD', notes }: { currency?: string; notes?: string } = {}
  ): Promise<{ invoiceId: string }> {
    const invoice = Invoice.create({ customerId, lineItems }, { currency, notes })
    await this.repo.save({ invoice })
    return { invoiceId: invoice.id }
  }
}

// Inbound adapter — driving side
class RestInvoiceController {
  constructor(private readonly service: IInvoiceService) {}  // calls through inbound port

  async post({ req }: { req: HttpRequest }): Promise<HttpResponse> {
    const { customerId, lineItems } = parseCreateInvoiceRequest(req)
    const result = await this.service.createInvoice({ customerId, lineItems })
    return HttpResponse.ok(result)
  }
}

// Outbound adapter — driven side
class PostgresInvoiceRepository implements IInvoiceRepository {
  async save({ invoice }: { invoice: Invoice }): Promise<void> {
    await this.db.execute('INSERT INTO invoices ...', [invoice])
  }
}
```

## When to Use

- Integration-heavy systems with multiple I/O channels (HTTP, CLI, events, batch)
- Systems where you want to test the application core without databases or web frameworks
- When you need to support multiple inbound entry points for the same core logic (REST API + event consumer + CLI all calling the same application service)
- When you expect to swap infrastructure implementations (database migration, payment provider change)

## Difference from Clean Architecture

Both patterns share the same core principle: the application depends on abstractions, not on infrastructure. The differences are structural:

| | Hexagonal | Clean Architecture |
|---|---|---|
| **Structure** | Core + ports + adapters (flat inside core) | Four concentric rings |
| **Use Cases layer** | No mandatory separate ring; application service handles orchestration | Explicit Use Cases ring separate from Entities |
| **Focus** | Driving vs. driven side distinction; port/adapter metaphor | Ring structure and dependency rule |
| **Flexibility** | More flexible internal structure | More prescriptive about what belongs where |
| **Best for** | Teams who think in terms of "what calls the app" vs "what the app calls" | Teams who want explicit named layers |

**Choose Hexagonal when**: The driving/driven distinction is the most important thing to communicate. You have multiple inbound channels (HTTP, CLI, events) and want to show they all use the same core.

**Choose Clean Architecture when**: You want the ring structure to tell developers exactly where business logic, use cases, and adapters live. Better for onboarding on complex domains.

They are compatible — you can structure the core as Clean Architecture and use the hexagonal port/adapter vocabulary for the boundaries.

## Testing with Hexagonal Architecture

The port/adapter model enables powerful testing:

```typescript
// In-memory adapter for tests — no database needed
class InMemoryInvoiceRepository implements IInvoiceRepository {
  private store = new Map<string, Invoice>()

  async save({ invoice }: { invoice: Invoice }): Promise<void> {
    this.store.set(invoice.id, invoice)
  }

  async findById({ invoiceId }: { invoiceId: string }): Promise<Invoice | null> {
    return this.store.get(invoiceId) ?? null
  }
}

// Test drives the application through inbound port
async function testCreateInvoice() {
  const repo = new InMemoryInvoiceRepository()
  const gateway = new FakePaymentGateway()
  const service = new InvoiceApplicationService(repo, gateway)

  const result = await service.createInvoice(
    { customerId: 'cust-1', lineItems: [{ description: 'Item', amount: 100 }] }
  )

  assert(result.invoiceId !== null)
  assert(await repo.findById({ invoiceId: result.invoiceId }) !== null)
}
```

No HTTP server. No database. No mocks. Just the core logic with simple in-memory adapters. Tests are fast and reliable.

## Testing Strategy

- **Core tests**: Drive through inbound ports using in-memory adapters on the driven side. Tests run in milliseconds.
- **Adapter tests**: Test each adapter in isolation against the real infrastructure (database, external API sandbox). These are integration tests that run less frequently.
- **Contract tests**: Verify that each adapter correctly implements its port interface.
- **End-to-end tests**: Use real adapters on both sides. Limited to critical paths.

## Common Failure Modes

**Business logic in adapters**: Validation, calculations, or state transitions appearing in controllers or repository implementations. The core application owns business logic; adapters are translation and communication only.

**Port interfaces mirroring vendor APIs**: An outbound port that looks like the Stripe API. The port should express the application's needs in the application's language. The adapter translates to Stripe's language.

**No inbound port defined**: The controller calls the application service class directly, not through an interface. Inbound ports enable testing with test drivers and swapping inbound adapters (e.g., REST to GraphQL) without changing the core.

**Thick adapters**: Adapters doing data transformation, business validation, or orchestration. Keep adapters thin — they translate data shapes, not business logic.

**Ignoring the driving/driven distinction**: Treating all ports as the same. Inbound ports are offered capabilities; outbound ports are required capabilities. The distinction matters for understanding who controls the interaction.

## Pairs Well With

- **Clean Architecture** — same principles, compatible vocabulary; use hexagonal framing at the boundary, clean architecture rings internally
- **Domain-Driven Design** — the application core naturally maps to DDD aggregates and application services
- **CQRS** — inbound ports for commands and queries; outbound ports for repositories
- **Event-Driven Architecture** — message consumers are driving-side adapters; event publishers are driven-side adapters
