# Pass 2: Data, Access, and Atomicity

Load this file when executing Pass 2. Reads `artifact-1-core-logic.md`. Produces `artifact-2-data-access.md`.

## References to Load

- `references/extraction-layers.md` — output schema for all requirements produced in this pass
- `references/data-migration.md` — load when extraction reveals schema changes, data store changes, or data format changes between source and target

## Phase 4: Database-Resident Behavior

Logic that lives outside application code:

- Triggers (before/after insert/update/delete)
- Stored procedures and functions
- Views and materialized views
- Generated columns and computed defaults
- Check constraints and enum domains
- Foreign key cascade behavior (ON DELETE CASCADE/SET NULL/RESTRICT)
- Partial indexes that imply query patterns
- Row-level security policies
- Sequences and custom ID generation

### Identifier Format Contracts

External-facing ID format is migration-defining:
- Prefixed IDs that clients parse (e.g., `cus_abc123`, `inv_xyz789`)
- Lexicographic sortability assumptions (ULIDs, KSUIDs)
- Sequential IDs where enumeration is a security concern
- Cross-region uniqueness guarantees
- Autoincrement → UUID migration implications (cursor pagination breaks, client caching breaks, URL patterns change)

Mark ID format as a requirement when clients or external systems depend on the format.

## Phase 5: Access-Control Matrix

For every protected entrypoint, produce:

| Entrypoint | Actor/Role | Ownership Rule | Tenant/Data Scope | Allowed Actions | Denied Behavior (status + response) | Evidence |
|------------|-----------|----------------|-------------------|-----------------|-------------------------------------|----------|

This catches authorization split across controllers, policies, scopes, serializers, and DB filters.

Include:
- Role hierarchy and inheritance rules
- Ownership-based access (user can edit own resources only)
- Tenant boundary enforcement mechanism
- Data-residency-aware access restrictions
- Service-to-service auth (internal APIs)
- Admin/impersonation/break-glass override behavior
- Escalation paths and their audit requirements

**Tenant scope isolation verification:** For every entrypoint documented as tenant-scoped, trace down to the actual database query or ORM invocation. If the query does not explicitly inject a tenant filter (e.g., `WHERE tenant_id = ?`), utilize a verified global scoping mechanism (default scope, RLS policy, middleware-injected filter), or invoke an active Row-Level Security policy, flag with `[NEEDS CLARIFICATION]` at high severity denoting an unverified multi-tenant boundary. Do not assume tenant scoping from the existence of a helper method alone — verify it is applied on the specific code path.

## Phase 6: Transaction and Atomicity Contracts

For each state-changing operation:

- Which writes must commit together (transaction boundary)
- Which side effects happen after commit (emails, events, webhooks)
- Rollback behavior on partial failure
- Idempotency keys and duplicate handling — document the **state persistence store** for idempotency checking (ACID DB table, Redis key with TTL, in-process map, etc.). If the mechanism relies on single-node shared memory or an atomic DB constraint, flag with `[CONCURRENCY CONTRACT]` so the target doesn't accidentally decentralize it.
- Exactly-once illusions (mechanism)
- Partial failure outcomes visible to caller

### Cross-Domain Transaction Flagging

If a database transaction spans multiple distinct business entities or modules (e.g., updating Users AND Billing tables in one transaction), flag as `[DISTRIBUTED TRANSACTION RISK]`. The target architecture must know if splitting these into separate services requires Saga, outbox, or eventual consistency to replace the current atomic boundary.

### Temporal Orchestration Invariants

Scan for temporal dependencies between operations:
- Jobs that assume another job has already completed (implicit ordering)
- Timezone-dependent execution windows (end-of-day banking, market close)
- Hardcoded delays between steps (why does this job wait exactly 5 minutes?)
- Cascading job triggers where order matters
- Cron schedules that must execute within a specific time window relative to external events

Mark temporal dependencies as `[TEMPORAL COUPLING]` — the target must preserve the ordering invariant even if the scheduling mechanism changes.

## Phase 6b: Concurrency and In-Memory State

Catches behavior that works accidentally in the source runtime and breaks in the target.

**Runtime serialization assumptions:**
- Does the source rely on a GIL, single-threaded event loop, or process-per-request model that implicitly serializes access?
- Check-then-act patterns without explicit locking
- Class/module-level mutable variables accessed by multiple requests
- Singleton objects modified at runtime

**Explicit concurrency controls:**
- Pessimistic locks (database advisory locks, `SELECT FOR UPDATE`, file locks, distributed locks)
- Optimistic locks (version columns, ETags, compare-and-swap)
- Application-level mutex/semaphore usage
- Queue-based serialization (one worker per entity)
- Actor/mailbox patterns

**In-memory state:**
- Memoized values persisting across requests (class-level, module-level)
- In-process rate-limit counters or token buckets
- Connection pools (sizing, timeout, sharing behavior)
- WebSocket/SSE connection state
- Background thread state (timers, scheduled flushes)
- In-memory caches (request-scoped vs process-scoped)

**Request isolation:**
- Does each request get isolated state?
- Thread-local / fiber-local / context-local variables
- Sticky session requirements vs stateless horizontal scaling

**Extract as behavioral invariants (not mechanisms):**
- "Operation X must serialize access to resource Y"
- "Counter Z must be atomic across concurrent requests"
- "This value must be visible to all concurrent requests for N seconds" (not "shared in-process" — let target decide how)

Mark as `[CONCURRENCY CONTRACT]`.

## Handoff Artifact: artifact-2-data-access.md

Produce:
- Database behavior inventory (triggers, procs, constraints, cascades)
- ID format contracts
- Access-control matrix (full table)
- Transaction boundary map per state-changing operation
- Cross-domain transaction risks flagged
- Temporal coupling inventory
- Concurrency contracts
- In-memory state inventory
- Open questions from this pass
- Amendments to Pass 1 findings (if any)
