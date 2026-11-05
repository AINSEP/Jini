# Data Migration Contracts

Use this reference when extraction reveals that the rewrite involves a schema change, data store change, or data format change. Produced during Pass 2 (Phase 4) and refined during Pass 5 (synthesis).

## Purpose

The most common rewrite failure mode is: new code works perfectly, old data breaks it. This reference ensures extraction captures everything needed to safely migrate existing data.

## Two-Stage Extraction

Data migration has two stages with different timing:

**Stage 1: Source Data Profile** — extracted during reverse-spec (before Software Architect). Documents what the existing data looks like, its constraints, dirty data, volumes, and risks. This is the input the Software Architect needs to design the target schema.

**Stage 2: Target Migration Mapping** — produced after the Software Architect proposes a target data model. Maps source fields to target fields with transformations. This lives in the architecture/implementation phase, NOT in reverse-spec extraction.

During reverse-spec, produce Stage 1 only. Stage 2 is a placeholder template showing what the Software Architect and implementation team will fill in.

## Stage 1: Source Data Profile (During Reverse-Spec)

### Source Schema Inventory

For each entity/table in the source system:

| Field | Type | Constraints | Nullable | Default | Notes |
|-------|------|------------|----------|---------|-------|
| `users.email` | varchar(255) | unique, not null | no | — | validated format since 2020 |
| `users.type` | varchar | — | no | 'standard' | STI discriminator, 4 known values |
| `orders.total` | decimal(8,2) | — | no | 0.00 | stored as dollars, not cents |
| `users.deleted_at` | timestamp | — | yes | null | soft-delete marker |

### Legacy Data Exceptions

Real databases contain data that violates current validations:

- Null values in fields that are now "required" (added validation after data existed)
- Enum values no longer in the allowed set (removed options, legacy states)
- Orphaned foreign keys (parent deleted without cascade)
- Duplicate records that violate current uniqueness constraints
- Invalid email formats, phone formats, or other validation-era differences
- Records created before a feature existed (missing fields that are now "required")

For each: document what the old system tolerates, what the new system must handle, and the resolution strategy (backfill, canonicalize, reject, grandfather).

### Overloaded/Polymorphic Columns

For unstructured, semi-structured (JSON/XML), or loosely typed text columns: sample the data and extract the **implicit schema variations**. A `varchar` status column or `JSONB` metadata field often holds fundamentally different data shapes depending on entity state, type, or creation era.

If a column holds multiple implicit schemas, document:
- Each distinct shape with representative sample
- What determines which shape applies (entity type, state, creation date, feature flag)
- Whether the shapes are mutually exclusive or composable
- Which consumers depend on which shape

Flag as `[DATA COMPATIBILITY]` with note "polymorphic column." The target must either preserve the polymorphism or split into typed structures — both require understanding every shape.

### ID Strategy

| Entity | Source ID | Target ID | Migration Impact |
|--------|----------|-----------|-----------------|
| Users | autoincrement int | UUID v7 | all FKs must update, client URLs change, cursor pagination breaks |
| Orders | autoincrement int | keep int | preserve for client compatibility |
| API keys | `ak_<random>` | `ak_<random>` | format preserved, clients depend on prefix |

### Preservation Requirements

- `created_at` / `updated_at`: must preserve original timestamps (not overwrite with migration time)
- Audit trails: must reference original record IDs
- Sequence counters: must continue from current value (not restart)
- Soft-deleted records: must survive migration with deletion metadata intact. **Implicit exclusion scan:** when a table has a soft-delete column (`deleted_at`, `is_deleted`), inventory every database read operation targeting that table. Document whether each read implicitly or explicitly filters out soft-deleted records (framework default scope, manual WHERE clause, or no filter). Any read path that exposes soft-deleted rows to an active API response without explicit business justification → flag as `[DATA COMPATIBILITY]`.
- Historical enum values: must be representable even if no longer valid for new records

### Data Volume and Performance

- Total record counts per table
- Growth rate per table
- Expected migration duration at various batch sizes
- Whether migration can run online (dual-write) or requires downtime
- Largest tables that may need chunked migration
- Tables with heavy write traffic during migration window

### Reconciliation

After migration, verify:
- Row counts match (within tolerance for concurrent writes)
- Checksums on critical numeric fields (financial totals, balances)
- Foreign key integrity in target
- Unique constraints hold in target
- Sample random records and compare field-by-field

### Rollback Strategy

- Can the migration be reversed?
- What data is lost if rollback happens after N hours of production writes to new system?
- What is the maximum "point of no return" window?

### Cutover and Dual-Write Contracts

For production rewrites with live traffic, document:

- Source of truth before cutover (old system)
- Source of truth after cutover (new system)
- Whether dual-write is required during transition
- Backfill timing: runs before, during, or after cutover
- How writes during migration window are captured (CDC, WAL/binlog streaming, application-level dual-write, queue replay)
- Old→new and new→old ID mapping storage and lookup mechanism
- Read routing during migration (which system serves reads, how is traffic split)
- Whether rollback requires reverse sync from new→old
- Freeze window (if any — period where writes are paused)
- Point-of-no-return condition (what makes rollback impossible)
- Consistency model during cutover (eventual, strong, read-your-writes)
- How long dual-write must be maintained before old system decommission

Mark findings with `[CUTOVER RISK]` when:
- Live traffic exists during migration
- No freeze window is acceptable
- Dual-write across heterogeneous stores is required
- Rollback after N hours would lose data

## Risk Tags

Mark data migration findings with:

- `[DATA MIGRATION RISK]` — schema cannot represent existing data without transformation
- `[DATA COMPATIBILITY]` — legacy data violates current validations
- `[PRECISION CONTRACT]` — numeric transformation may lose precision
- `[ID FORMAT CHANGE]` — external-facing IDs change, breaking clients
- `[CUTOVER RISK]` — live-traffic migration requires dual-write, routing, or freeze window

## Stage 2: Target Migration Mapping (After Software Architect — Template Only)

This section is NOT filled during reverse-spec extraction. It is a template for the Software Architect and implementation team once the target data model exists.

| Source Field | Source Type | Target Field | Target Type | Transformation | Risk |
|-------------|-------------|-------------|-------------|----------------|------|
| `users.email` | varchar(255) | `users.email` | text | none | low |
| `users.type` | varchar (STI) | — | — | split to separate tables | `[DATA MIGRATION RISK]` |
| `orders.total` | decimal(8,2) | `orders.total_cents` | bigint | multiply by 100 | precision |

The Software Architect fills this mapping after proposing the target schema. The reverse-spec extraction provides the Source Data Profile (Stage 1) as input to those decisions.

## Relationship to Extraction

Data migration contracts are extracted during Phase 4 (database-resident behavior) and refined during synthesis. They feed into:
- Software Architect decisions (can we change the schema or must we preserve it?)
- TDD test design (tests must handle legacy data shapes)
- Programmer implementation (migration scripts, backfill logic)
- Operational planning (downtime window, rollback strategy)

Stage 1 (Source Data Profile) is a reverse-spec output. Stage 2 (Target Mapping) is a Software Architect/implementation output that references Stage 1.
