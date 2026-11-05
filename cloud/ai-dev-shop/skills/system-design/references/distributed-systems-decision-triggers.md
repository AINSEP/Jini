# Distributed Systems Decision Triggers

Use this reference only when the design has distributed state, replicated data,
multi-region availability, distributed writes, cross-service transactions, or a
cluster/coordinator concern. This is a trigger map, not an interview glossary.
If a trigger fires, capture the decision in the blueprint or ADR and load the
deeper specialist reference that owns the implementation details.

## Do Not Load For

- a single database with stateless application servers
- ordinary CRUD where simpler consistency is acceptable
- detailed schema, index, or migration work; use `sql-data-modeling`
- measured latency or throughput validation; use `performance-engineering`
- retry, queue, cache, rate-limit, or idempotency details already covered by
  `operational-depth-patterns.md`

## Trigger Map

| Trigger | Use When | Decision To Capture | Route Deeper To |
|---|---|---|---|
| CAP / PACELC | The system must keep serving during network partitions, region failure, or replica lag. | What must be consistent, what may be stale, and the latency cost accepted in the normal path. | Software Architect ADR for binding consistency and availability choices. |
| ACID vs BASE | A workflow spans data stores or can tolerate eventual convergence. | Which invariants need transactions, which workflows use eventual consistency, and the convergence SLA. | Database for local transactions; Software Architect for cross-service boundaries. |
| Replication topology | Reads or availability depend on copies of data. | Single-writer vs multi-writer, failover behavior, replica-read staleness, and conflict strategy. | Database or DevOps depending on whether the concern is data semantics or platform operations. |
| Leader election / consensus | Exactly one node must coordinate scheduling, ownership, ordering, or membership. | Why a leader is needed, what happens during failover, and whether stale leaders can cause harm. | Software Architect for protocol choice; DevOps for platform-native coordination. |
| Storage-engine/index internals | Query behavior depends on range scans, write amplification, or append-heavy workloads. | Whether the design needs B-tree-like range access, LSM-like write optimization, or engine-specific limits. | Database / `sql-data-modeling`; do not decide engine internals in Blueprint unless they drive macro topology. |
| WAL / durability log | Recovery, replay, CDC, audit, or crash consistency is part of the requirement. | What must survive crashes, what can be replayed, and where the source-of-truth log lives. | Database, data engineering, or Software Architect depending on ownership. |
| Parallelism limits / Amdahl | Adding workers or shards is proposed as the main performance answer. | The serial bottleneck, expected scaling ceiling, and the first resource that saturates. | Performance engineering for measurement and validation. |

## Blueprint Guidance

- Use these concepts to expose real tradeoffs, not to add distributed machinery.
- If the product can meet its requirements with one durable database and
  stateless app servers, say that and defer the distributed concern.
- When a trigger is active, record the unknowns plainly: consistency boundary,
  freshness tolerance, failover behavior, durability guarantee, and ownership.
- Do not write a binding protocol or database-engine decision in System
  Blueprint unless the user has already constrained it. Hand it to Software Architect,
  Database, DevOps, or Performance as appropriate.
