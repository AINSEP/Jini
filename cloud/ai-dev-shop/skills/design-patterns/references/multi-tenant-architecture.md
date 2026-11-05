# Multi-Tenant Architecture

## What It Is

Multi-tenant architecture enables a single deployed application to serve multiple customers (tenants), with each tenant's data isolated from others. The three models differ in where the isolation boundary lives: the row, the schema, or the database.

The key decision: isolation level determines your compliance capability, operational complexity, customization headroom, and cost structure. Choosing the wrong model early is expensive to reverse — pick based on your actual compliance and customization requirements, not aspirational ones.

## When to Use

- SaaS product serving multiple organizations where data isolation between customers is required
- B2B platforms where tenants must not see each other's data under any circumstances
- Products with compliance requirements (GDPR, HIPAA, SOC 2) that mandate data boundary documentation
- Any system billing different customers differently where usage needs to be attributable per tenant

## When NOT to Use

- Single-tenant or internal tool — multi-tenancy adds complexity with no benefit if you only ever have one customer
- Consumer app where "users" are individuals with shared public data — multi-tenancy is for organizational isolation, not user accounts
- Prototype or pre-revenue stage — implement tenant isolation when you have a second customer, not before

## The Three Models

### Model 1: Shared DB, Shared Schema (Row-Level Tenancy)

All tenants share one database and one schema. Every table has a `tenant_id` column. Tenant isolation is enforced by WHERE clauses in every query.

**Pros**: Simplest ops (one DB to manage), lowest cost, easiest cross-tenant analytics, no migration complexity when schema changes.

**Cons**: Highest risk of tenant data leakage (one missing WHERE clause exposes all tenants), no true data isolation for compliance, no per-tenant customization of schema, one large DB is a blast radius for all tenants.

**Use when**: Early-stage SaaS, low compliance requirements, tenant count < 1000, team is small and ops simplicity matters most.

### Model 2: Shared DB, Separate Schema (Schema-Per-Tenant)

One database, but each tenant has their own schema (`tenant_acme.users`, `tenant_globex.users`). Isolation is enforced at the schema boundary by the DB engine.

**Pros**: Strong data isolation without separate DB infrastructure, per-tenant schema migrations are possible, compliance is easier to document than row-level.

**Cons**: Schema migrations must run N times (once per tenant), DB connection limits hit faster (PostgreSQL connection pool shared across schemas), harder to query across tenants, operational complexity grows with tenant count.

**Use when**: Moderate compliance requirements, tenant count < 500, need stronger isolation than row-level but can't justify per-tenant databases.

### Model 3: Separate DB Per Tenant (DB-Per-Tenant)

Each tenant has their own database instance (or cluster). Maximum isolation.

**Pros**: True data isolation — a DB breach exposes one tenant; complete blast radius isolation; easiest compliance documentation; per-tenant backup, restore, and migration; can customize DB settings per tenant.

**Cons**: Highest ops overhead, highest cost, connection pooling complexity (PgBouncer or proxy needed), cross-tenant reporting requires federation, schema migrations require orchestration across N databases.

**Use when**: High compliance requirements (HIPAA, financial, government), enterprise customers requiring data residency in specific regions, customers who need their own database for contractual reasons.

## Decision Signals

| Signal | Shared Schema | Separate Schema | Separate DB |
|--------|--------------|-----------------|-------------|
| Compliance level | Low (SOC 2 Type I) | Medium (SOC 2 Type II) | High (HIPAA, FedRAMP) |
| Tenant count | Hundreds to thousands | Tens to hundreds | Tens (manageable ops) |
| Per-tenant customization | None | Schema-level | Full |
| Cost sensitivity | Lowest | Medium | Highest |
| Data residency required | No | Limited | Yes |
| Cross-tenant queries | Easy | Complex | Requires federation |
| Migration complexity | Low | Medium | High |

## TypeScript Implementation

```typescript
// ── Model 1: Shared Schema with Row-Level Tenancy ────────────────────────────

// Tenant context — injected into every request via middleware
// Never rely on callers to pass tenant_id manually — enforce it at the service layer
export interface TenantContext {
  tenantId: string
}

// Middleware: extract tenant from JWT or subdomain
export function extractTenantMiddleware(req: Request, res: Response, next: NextFunction): void {
  const tenantId = req.headers['x-tenant-id'] as string
    ?? extractTenantFromSubdomain(req.hostname)
  if (!tenantId) {
    res.status(400).json({ error: 'Tenant context required' })
    return
  }
  req.tenant = { tenantId }
  next()
}

// Repository that enforces tenant isolation on every query
export class TenantScopedUserRepository {
  constructor(
    private readonly db: DatabaseClient,
    private readonly tenant: TenantContext
  ) {}

  async findById(userId: string): Promise<User | null> {
    // tenant_id in WHERE is non-negotiable — never query without it
    const row = await this.db.queryOne(
      'SELECT * FROM users WHERE id = $1 AND tenant_id = $2',
      [userId, this.tenant.tenantId]
    )
    return row ? mapRowToUser(row) : null
  }

  async save(user: User): Promise<void> {
    await this.db.query(
      `INSERT INTO users (id, tenant_id, email, name, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id, tenant_id) DO UPDATE
       SET email = EXCLUDED.email, name = EXCLUDED.name, status = EXCLUDED.status`,
      [user.id, this.tenant.tenantId, user.email, user.name, user.status]
    )
  }
}

// ── Model 2: Schema-Per-Tenant ────────────────────────────────────────────────

export class SchemaPerTenantConnectionPool {
  private readonly pools = new Map<string, DatabasePool>()

  getConnection(tenantId: string): DatabasePool {
    if (!this.pools.has(tenantId)) {
      this.pools.set(tenantId, createPool({
        connectionString: process.env.DATABASE_URL,
        // PostgreSQL schema search_path — all queries go to tenant's schema
        options: `-c search_path=${sanitizeTenantId(tenantId)},public`
      }))
    }
    return this.pools.get(tenantId)!
  }
}

// Sanitize tenant ID before using in schema name — prevents SQL injection
function sanitizeTenantId(tenantId: string): string {
  if (!/^[a-z0-9_]+$/.test(tenantId)) {
    throw new Error(`Invalid tenant ID for schema name: ${tenantId}`)
  }
  return `tenant_${tenantId}`
}

// ── Tenant Provisioning ───────────────────────────────────────────────────────
// Both models require a provisioning step when a new tenant is created

// Model 1: Just insert a row — no schema changes needed
async function provisionTenantSharedSchema(tenantId: string, name: string): Promise<void> {
  await db.query(
    'INSERT INTO tenants (id, name, created_at) VALUES ($1, $2, NOW())',
    [tenantId, name]
  )
}

// Model 2: Create schema and run migrations for new tenant
async function provisionTenantSeparateSchema(tenantId: string): Promise<void> {
  const schemaName = sanitizeTenantId(tenantId)
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`)
  // Run migrations scoped to the new schema
  await runMigrations({ schema: schemaName })
}
```

## Testing Strategy

- **Tenant isolation tests**: create data for tenant A; query as tenant B; assert zero results — this is the most critical test class
- **Tenant context injection tests**: make requests without a tenant header; assert 400 / rejection before any DB query executes
- **Cross-tenant leak tests**: insert records for tenant A; run a query that omits `tenant_id` from WHERE; assert the query never reaches the DB (or returns nothing due to row-level security)
- **Provisioning tests**: create a new tenant, verify their schema/rows exist, verify they are isolated from existing tenants

## Common Failure Modes

**Missing `tenant_id` in a single query**: One developer writes `SELECT * FROM invoices WHERE id = $1` without `AND tenant_id = $2`. Tenant A can read Tenant B's invoices by ID. Fix: use a `TenantScopedRepository` base class that enforces `tenant_id` on every query — never allow raw queries that bypass tenant context. Or enable PostgreSQL Row-Level Security (RLS) as a DB-level enforcement backstop.

**Tenant context leaking across async boundaries**: Request for Tenant A sets a module-level `currentTenant` variable. Concurrent request for Tenant B reads Tenant A's context before A's request completes. Fix: never store tenant context in module-level state. Always pass `TenantContext` explicitly through function arguments or use AsyncLocalStorage (Node.js) which is scoped per async execution context.

**Schema migration failing mid-way on shared-schema**: Migration adds a NOT NULL column without a default. Runs, fails partway. Some tenant data is in an inconsistent state. Fix: always make schema changes backward-compatible (add nullable columns, backfill, then add constraint); use a migration runner that transactionally applies per-schema migrations.

**Unbounded connection pool growth in schema-per-tenant**: Each tenant gets a pool of 10 connections. At 200 tenants, that's 2000 connections — PostgreSQL max is typically 100-200. Fix: use a connection proxy (PgBouncer) or a shared pool with schema switching via `SET search_path` per query, not per pool.

**Accidental cross-tenant analytics query**: Reporting query joins `orders` without tenant filter. Works correctly in single-tenant dev, exposes all tenant data in production. Fix: reporting queries that intentionally span tenants must be explicitly marked as `ADMIN_QUERY_CROSS_TENANT` and require an admin role — separate from the standard tenant-scoped query path.

## Pairs Well With

- **Row-Level Security (RLS)** — PostgreSQL RLS as a DB-level enforcement backstop for Model 1; even if application code misses a `tenant_id`, the DB policy rejects the query
- **Modular Monolith** — tenant context flows through module boundaries; each module's service layer is initialized with `TenantContext` at the request boundary
- **Event-Driven Architecture** — domain events must carry `tenantId`; consumers must filter to their tenant's events; event bus partitioning by tenant prevents cross-tenant event processing
- **CQRS** — read model projections are built per-tenant; a global projection without tenant scoping is a data leak risk
