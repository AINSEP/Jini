# Strangler Fig Pattern

## What It Is

Incrementally replace a legacy system by building new functionality alongside it, routing traffic between old and new, and gradually eliminating the legacy code until it is completely replaced — strangled by the new system growing around it.

Named after the strangler fig tree, which grows around a host tree, eventually replacing it entirely.

This is the only safe approach for migrating a live system. Big-bang rewrites fail at a high rate because you cannot run a full rewrite in parallel with ongoing development on the legacy system, and you cannot validate the rewrite until you switch all traffic at once.

```
Phase 1 (start):        Phase 2 (growing):      Phase 3 (complete):

  All traffic            Some traffic             All traffic
      │                  old │  │ new                 │
      ▼                      ▼  ▼                     ▼
 ┌─────────┐           ┌──────────────┐          ┌─────────┐
 │ LEGACY  │           │    PROXY     │           │   NEW   │
 │ System  │           └──────────────┘           │ System  │
 └─────────┘            │old      │new            └─────────┘
                         ▼         ▼
                    ┌────────┐ ┌────────┐
                    │LEGACY  │ │  NEW   │
                    └────────┘ └────────┘
                    (still running)
```

## When to Use

- Migrating from a legacy monolith to modern architecture (modular monolith, microservices, clean architecture)
- Replacing a third-party system with an in-house system (or vice versa)
- Incrementally rewriting a system that cannot be taken offline
- Any situation where a complete cutover is too risky to do at once

## When Not to Use

- Greenfield systems — there is nothing to strangle
- Systems with extremely tight data coupling where separating old and new data stores is not feasible
- Short-lived systems where the migration cost exceeds the benefit

## The Four Steps

### Step 1: Identify a Seam

A seam is a boundary in the legacy system where traffic can be intercepted and redirected. Good seams are:
- HTTP endpoints (route `/new-feature` to the new system, everything else to legacy)
- Database tables that can be owned exclusively by one system
- Background job types
- Event types in a queue

Start with a seam around a low-risk, isolated piece of functionality. Avoid seams that require shared database writes across old and new systems simultaneously.

### Step 2: Install the Routing Layer (Facade)

Insert a proxy or facade in front of the legacy system. All traffic flows through it. Initially, it routes 100% to legacy — no behavioral change.

Options:
- API Gateway routing rules
- Nginx/load balancer routing
- A thin new service that delegates to legacy
- Feature flags

The routing layer must be transparent to clients. They should not need to change anything.

### Step 3: Build the New Functionality

Implement the replacement behind the routing layer. Match the interface the routing layer expects.

Key practices:
- **Anti-Corruption Layer (ACL)**: Protect the new domain model from legacy data shapes. Do not let legacy database schemas or API contracts bleed into the new system's domain model. Write translation code in the ACL.
- **Data synchronization**: If old and new systems must share data temporarily, decide on a sync strategy: replicate from legacy to new (read from new, write to legacy), or dual-write with the new system as source of truth.
- **Feature flags**: Gate new system traffic behind a flag. Start at 1% of traffic, gradually increase, monitor for discrepancies.

### Step 4: Cut Over and Delete Legacy

Once the new system handles a capability completely and is validated in production:
1. Route 100% of that capability's traffic to the new system
2. Remove the routing rule for that capability
3. Delete the legacy code for that capability

Repeat for each seam until nothing routes to the legacy system. Then delete it entirely.

## Anti-Corruption Layer (ACL)

The ACL is the translation boundary between the legacy system's model and the new system's domain model. It prevents the new codebase from being polluted by legacy data shapes, naming conventions, and assumptions.

```
Legacy System            ACL                    New System

LegacyCustomer  ──────►  CustomerTranslator ──► Customer
  {                         .translate()          {
    cust_id,                                        id,
    cust_nm,                                        name,
    addr_ln1,                                       address: Address,
    addr_ln2,                                       status: CustomerStatus
    stat_cd                                       }
  }
```

The ACL owns all knowledge of legacy data shapes. The new domain model is clean.

## Detailed Example

**Legacy monolith with a user management module. Migrating to a new clean architecture service.**

1. **Identify seam**: `POST /users`, `GET /users/:id`, `PUT /users/:id`
2. **Install routing layer**: API Gateway routes all `/users` traffic to legacy. New user service is deployed but receives no traffic.
3. **Build new service**: Implement user management with clean architecture. Anti-Corruption Layer translates legacy user data format for migration endpoint.
4. **Sync data**: Background job reads legacy users table, writes to new service via migration API.
5. **Gradual cutover**: Route `GET /users/:id` to new service first (reads are safer). Monitor error rate. Route `POST /users` to new service. Route `PUT /users`. Write legacy user updates to new service and sync back to legacy (dual-write during transition).
6. **Full cutover**: 100% traffic to new service. Verify for one release cycle. Remove dual-write, delete legacy user module.

## Testing Strategy

- **Parity tests**: Run the same requests against old and new systems, compare responses. Flag any discrepancy.
- **Shadow mode testing**: Route traffic to new system but discard its response, use legacy response. Log differences. Fix differences before switching.
- **Rollback test**: Verify you can route 100% back to legacy at any point with a config change.
- **ACL tests**: Assert that all legacy data shapes are correctly translated to the new domain model.
- **Data sync tests**: Assert that data synced from legacy to new is complete and accurate.

## Common Failure Modes

**Sharing a database between old and new systems**: The most common mistake. Leads to coupling that makes it impossible to evolve either system independently. Give the new system its own database from day one.

**No Anti-Corruption Layer**: Legacy data shapes bleed into the new domain model. The new system becomes a slightly cleaner version of the old mess, not a proper replacement.

**Migrating too many seams at once**: Attempting to migrate 5 capabilities in parallel makes it impossible to attribute problems to a specific migration. One seam at a time.

**Skipping the validation step**: Cutting over 100% traffic before running in parallel long enough to validate parity. Run shadow mode or low-percentage traffic for at least one release cycle before full cutover.

**Not deleting legacy code**: The strangler fig migration is complete when the legacy system is deleted. If it is kept "just in case," it will accumulate new features again, undoing the migration.

## Branch by Abstraction

Branch by Abstraction is the in-place alternative to Strangler Fig. Use it when you need to replace a **component inside a system** rather than replace an entire system running alongside another.

**Strangler Fig**: two systems run in parallel; traffic is routed between them at the edge.
**Branch by Abstraction**: one system, one running instance; the old component is replaced from the inside.

### When to Use Branch by Abstraction

- Replacing an internal dependency (ORM, HTTP client, email provider, payment SDK) without replacing the whole system
- Extracting a tightly-coupled module to a cleaner interface before rewriting the implementation
- Any refactor where "replace the abstraction, keep the callers unchanged" is the goal
- Works without a routing layer — no proxy, no parallel deployment needed

### The Four Steps

1. **Create an abstraction over the existing component** — define an interface that represents what callers need, not what the old implementation provides
2. **Migrate callers to use the abstraction** — all call sites use the interface; the old implementation still backs it; all tests pass; no behavior change
3. **Build the new implementation behind the abstraction** — new implementation satisfies the same interface; testable in isolation
4. **Swap the abstraction** — change the composition root to inject the new implementation; run tests; delete the old implementation if all green

```typescript
// Step 1: Define abstraction over existing Stripe SDK calls
export interface PaymentGateway {
  charge(amount: Money, source: PaymentSource): Promise<ChargeResult>
  refund(chargeId: string, amount: Money): Promise<RefundResult>
}

// Step 2: Wrap the existing implementation — no behavior change, callers updated
export class StripePaymentGateway implements PaymentGateway {
  async charge(amount: Money, source: PaymentSource): Promise<ChargeResult> {
    // existing Stripe SDK calls, unchanged
  }
  async refund(chargeId: string, amount: Money): Promise<RefundResult> {
    // existing Stripe SDK calls, unchanged
  }
}

// Step 3: Build the new implementation
export class AdyenPaymentGateway implements PaymentGateway {
  async charge(amount: Money, source: PaymentSource): Promise<ChargeResult> {
    // new Adyen implementation
  }
  async refund(chargeId: string, amount: Money): Promise<RefundResult> {
    // new Adyen implementation
  }
}

// Step 4: Swap at the composition root — callers don't change
const gateway: PaymentGateway = useAdyen
  ? new AdyenPaymentGateway(adyenConfig)
  : new StripePaymentGateway(stripeConfig)
```

### Key Difference from Strangler Fig

| | Strangler Fig | Branch by Abstraction |
|---|---|---|
| Scope | Full system replacement | Internal component replacement |
| Parallel running | Two systems simultaneously | One system, one instance |
| Traffic routing | Proxy/gateway at the edge | Dependency injection at composition root |
| Rollback | Reroute traffic to old system | Swap back to old implementation |
| Risk unit | Service boundary | Module/dependency boundary |

## Pairs Well With

- **Modular Monolith** — the destination architecture for migrating from a big ball of mud
- **Microservices** — used to extract services one by one from a legacy monolith
- **Event-Driven Architecture** — events can be used to synchronize state between old and new during migration
- **API Patterns** (API Gateway / BFF) — the routing layer is often implemented as an API Gateway rule set
