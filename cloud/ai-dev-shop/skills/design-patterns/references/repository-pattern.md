# Repository Pattern

## What It Is

Encapsulate all data access behind a typed interface. The domain layer defines what it needs (`UserRepository.findById`); the infrastructure layer implements it (`PostgresUserRepository`). Callers never touch SQL, ORM entities, or cloud SDK calls directly — they call the repository interface.

The key separation: the domain defines the contract; infrastructure fulfills it. This means the domain is testable without a database, and the database implementation can be swapped without touching domain or application logic.

## When to Use

- Any architecture that distinguishes between domain/application and data access (Layered, Clean, Hexagonal, DDD)
- Domain logic that needs to be unit-tested without a running database
- Data store is likely to change or vary per environment (PostgreSQL in prod, in-memory in tests)
- Multiple aggregates or services need to query the same entity — consistent access through one interface avoids scattered raw queries
- CQRS write-side: command handlers write through a repository; read-side can use its own read models

## When NOT to Use

- Simple scripts or one-off data processing where a direct DB call is clearer than an abstraction
- Pure CRUD with no domain logic — repository abstraction adds ceremony without benefit; a thin active-record model or query builder is simpler
- Read-heavy reporting queries that return projections (not full aggregates) — use a query service or read model, not a repository; repositories return full domain objects
- Team is using an ORM that already provides a repository-like API (e.g., TypeORM Repository, Prisma Client) and domain rules are minimal — wrapping it further may not be worth the indirection cost

## Decision Signals

| Signal | Repository Pattern | Direct ORM / Query Builder |
|--------|--------------------|---------------------------|
| Domain logic complexity | Moderate to high | Minimal (CRUD only) |
| Test isolation needed | Yes — unit test domain without DB | No — thin data layer, integration tests OK |
| Data store stability | Uncertain or varies per env | Stable, single store |
| Aggregate complexity | Hydrates and saves full aggregates | Returns individual rows or DTOs |
| Team pattern | Clean/Hexagonal/Layered architecture | Active-record or data-mapper with no domain layer |

## TypeScript Implementation

```typescript
// domain/user-repository.ts — interface defined in domain, owned by domain
// Uses domain types only. No ORM imports, no DB types.
export interface UserRepository {
  findById(id: UserId): Promise<User | null>
  findByEmail(email: Email): Promise<User | null>
  save(user: User): Promise<void>
  delete(id: UserId): Promise<void>
}

// domain/user.ts — pure domain entity, no ORM decorators
export interface User {
  id: UserId
  email: Email
  name: string
  status: 'active' | 'suspended' | 'deleted'
  createdAt: string
}

// infrastructure/postgres-user-repository.ts — implements domain interface
// Only this file knows about DB schema; domain is unaware
import type { UserRepository } from '../domain/user-repository'
import type { User, UserId, Email } from '../domain/user'
import { db } from './db-client'

export class PostgresUserRepository implements UserRepository {
  async findById(id: UserId): Promise<User | null> {
    const row = await db.queryOne(
      'SELECT id, email, name, status, created_at FROM users WHERE id = $1',
      [id]
    )
    return row ? this.mapRowToUser(row) : null
  }

  async findByEmail(email: Email): Promise<User | null> {
    const row = await db.queryOne(
      'SELECT id, email, name, status, created_at FROM users WHERE email = $1',
      [email]
    )
    return row ? this.mapRowToUser(row) : null
  }

  async save(user: User): Promise<void> {
    await db.query(
      `INSERT INTO users (id, email, name, status, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email, name = EXCLUDED.name, status = EXCLUDED.status`,
      [user.id, user.email, user.name, user.status, user.createdAt]
    )
  }

  async delete(id: UserId): Promise<void> {
    await db.query('DELETE FROM users WHERE id = $1', [id])
  }

  // Row mapping is private to the implementation — domain never sees DB row shape
  private mapRowToUser(row: Record<string, unknown>): User {
    return {
      id: row.id as UserId,
      email: row.email as Email,
      name: row.name as string,
      status: row.status as User['status'],
      createdAt: row.created_at as string,
    }
  }
}

// infrastructure/in-memory-user-repository.ts — test double, same interface
// Used in unit tests and fast integration tests without a DB connection
export class InMemoryUserRepository implements UserRepository {
  private readonly store = new Map<string, User>()

  async findById(id: UserId): Promise<User | null> {
    return this.store.get(id) ?? null
  }

  async findByEmail(email: Email): Promise<User | null> {
    for (const user of this.store.values()) {
      if (user.email === email) return user
    }
    return null
  }

  async save(user: User): Promise<void> {
    this.store.set(user.id, { ...user })  // clone — prevent external mutation
  }

  async delete(id: UserId): Promise<void> {
    this.store.delete(id)
  }

  // Test helper — seed initial state without going through save()
  seed(users: User[]): void {
    for (const user of users) this.store.set(user.id, { ...user })
  }
}

// application/user-service.ts — depends on interface, not implementation
// Receives the repository via constructor injection — testable without a DB
import type { UserRepository } from '../domain/user-repository'

export class UserService {
  constructor(private readonly users: UserRepository) {}

  async suspendUser(userId: UserId): Promise<void> {
    const user = await this.users.findById(userId)
    if (!user) throw new NotFoundError(`User ${userId} not found`)
    if (user.status === 'deleted') throw new DomainError('Cannot suspend a deleted user')

    await this.users.save({ ...user, status: 'suspended' })
  }
}

// Test — no database needed
const repo = new InMemoryUserRepository()
repo.seed([{ id: 'u1', email: 'a@b.com', name: 'Alice', status: 'active', createdAt: '2026-01-01T00:00:00Z' }])
const service = new UserService(repo)
await service.suspendUser('u1')
const updated = await repo.findById('u1')
assert(updated?.status === 'suspended')
```

## Testing Strategy

- **Domain/service unit tests using InMemoryRepository**: inject the in-memory double; test all domain paths without a DB; these tests run in milliseconds
- **Repository implementation tests against a real DB**: test `PostgresUserRepository` with a test database (Docker or test container); verify SQL correctness, upsert behavior, constraint handling
- **Contract tests**: run the same test suite against both implementations to verify they behave identically — catches cases where in-memory semantics diverge from real DB semantics

## Common Failure Modes

**ORM entity types leaking into the interface**: `findAll(): Promise<UserEntity[]>` where `UserEntity` is a TypeORM decorated class. Other modules import `UserEntity` and start using ORM-specific methods. When the ORM changes or is removed, everything that imported `UserEntity` breaks. Fix: interface returns domain types (plain TypeScript interfaces, no decorators). `mapRowToUser()` is always private to the implementation.

**Repository doing too much — becomes a query dumping ground**: `UserRepository` accumulates 25 methods: `findByEmailAndStatusAndCreatedAfter`, `findActiveUsersWithRecentOrders`, `countByRegionGroupedByStatus`. Fix: repositories handle aggregate identity queries only. Complex cross-aggregate queries or reporting projections go to a dedicated query service or read model. If a query doesn't load a full `User` aggregate, it doesn't belong in `UserRepository`.

**In-memory implementation drifting from DB behavior**: `InMemoryUserRepository.findByEmail()` does case-insensitive matching; `PostgresUserRepository` does case-sensitive (`WHERE email = $1`). Tests pass with in-memory; bug surfaces in production. Fix: contract test suite — run identical test scenarios against both implementations and assert identical behavior. Divergence in the contract test reveals the inconsistency.

**Missing transaction support for multi-repository operations**: Service calls `userRepo.save()` then `auditRepo.save()`. Second call fails; user is updated but audit is not. Fix: for operations that span multiple repositories, pass a transaction context into both, or use the Unit of Work pattern where the transaction is committed only after all writes succeed.

**Saving and reloading creates subtle mutation bugs**: `repo.save(user)` then `user.status = 'deleted'` — the in-memory implementation stored a reference, not a copy. The stored user is now 'deleted' without another `save()` call. Fix: always store clones in the in-memory implementation (`this.store.set(id, { ...user })`), and always return clones from `findById`.

## Pairs Well With

- **Layered Architecture** — the data layer IS the repository implementations; domain/infrastructure boundary is precisely the repository interface
- **Clean Architecture / Hexagonal** — repository interfaces are ports; PostgreSQL/in-memory implementations are adapters; the domain core has zero infrastructure imports
- **DDD (Domain-Driven Design)** — one repository per aggregate root; repositories load and save complete aggregates, not individual fields
- **CQRS** — write side uses repositories for full aggregate persistence; read side uses query services that return optimized projections, bypassing the repository
