---
name: postgresql
version: 1.1.1
last_updated: 2026-04-10
description: Use when writing advanced PostgreSQL queries, implementing triggers, stored functions, full-text search, JSONB operations, partitioning, or diagnosing query performance. Applies to any PostgreSQL host (Supabase, RDS, Railway, Neon, self-hosted).
---

# Skill: PostgreSQL

PostgreSQL is not just a relational database. It is a programmable data platform with strong querying, indexing, search, and performance tooling. Use advanced PostgreSQL features when they solve a real problem, and document why they were chosen.

This skill owns design-time and query-shape scalability checks for PostgreSQL behavior. Runtime verification against a live Supabase project belongs in `skills/supabase/SKILL.md`.

Keep this file lean. Open references only when you need concrete syntax or deeper examples:

- `references/querying-and-data-shapes.md` for table design defaults, CTEs, window functions, and JSONB
- `references/database-programmability.md` for triggers, stored functions, extensions, and full-text search
- `references/performance-and-operations.md` for partitioning, `EXPLAIN ANALYZE`, performance anti-patterns, and transaction isolation

## Upstream References (Progressive Disclosure)

For concrete incorrect-vs-correct SQL examples with metrics, load selectively from the official Supabase Postgres best-practices skill (installed in `<AI_DEV_SHOP_ROOT>/skills/supabase-postgres-best-practices/` — never hand-edit):

- `references/conn-pooling.md` — pooler configuration rules
- `references/conn-limits.md` — connection limit tuning
- `references/conn-idle-timeout.md` — idle timeout behavior
- `references/conn-prepared-statements.md` — prepared statements with poolers
- `references/monitor-pg-stat-statements.md` — query statistics
- `references/monitor-vacuum-analyze.md` — vacuum/analyze tuning
- `references/lock-deadlock-prevention.md` — deadlock prevention
- `references/lock-skip-locked.md` — skip-locked queue pattern
- `references/lock-short-transactions.md` — short transaction rules
- `references/data-n-plus-one.md` — N+1 detection
- `references/data-batch-inserts.md` — batch insert patterns
- `references/data-upsert.md` — upsert patterns

All paths relative to `<AI_DEV_SHOP_ROOT>/skills/supabase-postgres-best-practices/`. Do not load these by default — only when the task specifically involves that concern.

## Working Rules

- A simple `SELECT` does not need a CTE.
- A small table does not need partitioning.
- Do not move logic into triggers or stored functions unless the database is the right ownership boundary.
- Check host support before choosing extensions or operational features.
- When PostgreSQL behavior is part of the architecture, record the choice in the ADR or spec constraints.

## Hard Gates

- Do not approve DDL or API-facing query design for large, hot, or high-traffic tables without a documented indexing rationale, pagination strategy, and a partitioning rationale when partitioning is proposed.
- Do not approve performance-sensitive query work without stating how plan shape will be verified later: static reasoning here, and live verification in the Supabase layer when a live project exists.

## Table Design Guardrails

Apply these defaults before advanced query tuning:

- **Primary keys**: prefer `BIGINT GENERATED ALWAYS AS IDENTITY` unless UUID is required for distributed uniqueness or external opacity.
- **Foreign keys**: PostgreSQL does not auto-index FK columns; add explicit indexes for FK access paths.
- **Type defaults**:
  - use `TIMESTAMPTZ` (not `TIMESTAMP`)
  - use `NUMERIC` for money (not floating point)
  - use `TEXT` by default for strings; add explicit length checks when needed
- **Constraints first**: enforce invariants in schema (`NOT NULL`, `CHECK`, `UNIQUE`) before relying on application validation.
- **Unique-null behavior**: when business rules require nulls to collide, use `UNIQUE ... NULLS NOT DISTINCT` (PG15+).
- **Identifier convention**: use unquoted `snake_case` identifiers to avoid case-sensitive naming traps.

## Pick the Right Reference

| Need | Open |
|---|---|
| Complex query shape, hierarchy traversal, JSON-heavy access patterns | `references/querying-and-data-shapes.md` |
| Trigger behavior, PL/pgSQL, extensions, or search features | `references/database-programmability.md` |
| Slow-query diagnosis, large-table strategy, or transaction semantics | `references/performance-and-operations.md` |

## Core Anti-Patterns

- `SELECT *` in production queries
- `OFFSET` pagination on large tables
- `NOT IN` with nullable subqueries
- wrapping indexed columns in functions inside `WHERE`
- implicit type coercions across join keys
- partitioning tables before size and query shape justify it
- hiding application-owned business logic inside opaque triggers

## Host Notes

- Extension availability differs across Supabase, RDS, Railway, Neon, and self-hosted PostgreSQL.
- Managed hosts may impose limits on connection counts, background workers, or extension support.
- Verify the exact PostgreSQL version when using PG-version-specific features such as `UNIQUE ... NULLS NOT DISTINCT`.
