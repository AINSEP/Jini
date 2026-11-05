---
name: sql-data-modeling
version: 1.2.0
last_updated: 2026-05-15
description: Use when designing relational schemas, producing ERDs, planning migrations, selecting data types, defining constraints, or reasoning about normalization and indexing strategy. Platform-agnostic — applies to any SQL database.
---

# Skill: SQL Data Modeling

A schema is a contract. Downstream implementation quality depends on whether the data model correctly represents the domain, enforces invariants in the database, and supports the required query patterns.

This skill owns design-time scalability checks for relational schemas. Runtime verification against a live Supabase project belongs in `skills/supabase/SKILL.md`.

Keep this file lean. Read it for the modeling contract, then load only the reference files needed for the specific task.

## Version Notes

- `1.2.0` adds flat engine-specific design references for PostgreSQL, MySQL, and MariaDB index/capability caveats while keeping the core modeling contract platform-agnostic.
- `1.1.2` makes the design-time scalability boundary explicit and adds an index-coverage hard gate for documented query patterns.
- `1.1.1` clarifies that the lean `SKILL.md` is a routing layer, not a content reduction. The reference files now carry fuller examples for normalization, composite keys, and index design.
- `1.1.0` converted the old monolithic skill into a map-plus-references structure so agents can load only the relevant depth for the task.

## Core Model

Model in this order:

1. Entities and relationships
2. Ownership and cardinality
3. Keys and constraints
4. Query patterns and indexes
5. Migration risk and rollout path

The goal is not maximum normalization. The goal is the minimum structural complexity that preserves correctness, integrity, and required performance.

## Load Strategy

Start here, then load only the reference you need:

- `references/modeling-and-normalization.md` for ERD rules, cardinality, normalization, and denormalization
- `references/keys-constraints-and-indexes.md` for PK/FK design, constraints, junction tables, and index strategy
- `references/migrations-and-lifecycle.md` for migration classification, soft vs hard delete, and timestamp lifecycle patterns
- `references/conventions-and-data-types.md` for naming rules and type selection guidance
- `references/postgresql-engine.md` for PostgreSQL-specific schema/index capabilities and caveats
- `references/mysql-engine.md` for MySQL-specific schema/index capabilities and caveats
- `references/mariadb-engine.md` for MariaDB-specific schema/index capabilities and caveats

Engine references are optional progressive-disclosure supplements. For target implementation work, load the one matching the confirmed database engine before finalizing engine-specific DDL or index recommendations. For explicit engine-comparison questions, consult only the requested engine references and keep the comparison descriptive rather than making this skill responsible for broad database selection.

## When to Use

Use this skill when the task involves:

- designing or reviewing a relational schema
- deciding table boundaries and relationships
- choosing PK, FK, constraint, or index strategy
- planning a migration path
- deciding between normalization and denormalization
- selecting SQL data types

Do not use this skill as a substitute for:

- database-platform-specific behavior such as Supabase RLS or PostgREST
- advanced engine-specific SQL tuning beyond schema design
- application-layer validation decisions that do not belong in the schema

## Required Context

Before modeling, confirm:

- the core entities and their relationships
- ownership rules and lifecycle rules
- required read and write paths
- deletion behavior
- expected data volume and growth
- target database engine and version, if known
- whether the schema is greenfield or a migration of existing data

## Contract by Concern

| Concern | Contract |
|---|---|
| ERD | Model entities, attributes, and relationships explicitly before writing DDL. |
| Cardinality | Mark optional vs required relationships intentionally; nullability must reflect domain truth. |
| Keys | Prefer stable surrogate PKs. Natural keys are usually poor PKs. |
| Foreign Keys | Enforce referential integrity in the database, not just in application code. |
| Constraints | Push invariant enforcement into NOT NULL, UNIQUE, CHECK, and FK constraints whenever possible. |
| Normalization | Normalize by default; denormalize only with explicit justification and sync strategy. |
| Indexes | Index for real query patterns, not out of habit. |
| Migrations | Classify change risk before writing SQL and prefer additive rollout paths. |
| Lifecycle Columns | Be explicit about timestamps, delete strategy, and update behavior. |
| Types | Choose the most precise domain-correct type, not the most permissive one. |

## Hard Gates

- Do not leave ownership or cardinality ambiguous.
- Do not omit FK constraints when the relationship is real.
- Do not approve a schema until every documented query pattern has an explicit index story, including all foreign keys and every column used in `WHERE`, join, or `ORDER BY` predicates, or a written reason why an index is intentionally omitted.
- Do not use application code as the only enforcement layer for schema invariants.
- Do not denormalize without a documented reason and maintenance strategy.
- Do not plan destructive or data-transforming migrations without rollback thinking.
- Do not choose types that allow invalid domain values by default.

## Implementation Defaults

- Prefer plural snake_case table names and singular snake_case column names.
- Prefer `id` as the PK column name and `<referenced_entity>_id` for FKs.
- Prefer `uuid` for externally visible entities and service-crossing references.
- Prefer identity bigint keys for internal high-volume tables where sequential IDs are appropriate.
- Prefer NOT NULL by default unless null is semantically meaningful.
- Prefer explicit CHECK constraints for bounded domains and invariants.
- Prefer indexing FK columns and high-value query predicates, but only when real access patterns justify it.
- Prefer additive-first migrations over one-shot destructive changes.
- Ledger and audit tables are append-only: correct mistakes with new reversing rows and block UPDATE/DELETE through database privileges or a trigger.

## Common Failure Modes

- tables designed from screens instead of domain relationships
- natural keys used as PKs and later forced to change
- nullable FKs used where the relationship is actually required
- denormalization introduced without a sync mechanism
- boolean or enum-like columns indexed without selectivity justification
- destructive migrations planned before compatibility rollout
- soft delete added without query filtering discipline or partial indexes
- timestamps added without a reliable `updated_at` maintenance path

## Compliance Checklist

- entities, attributes, and relationships are explicit
- required vs optional relationships are reflected in nullability
- PK, FK, UNIQUE, CHECK, and NOT NULL decisions are intentional
- indexes map to actual query patterns
- migration risk is classified before SQL is written
- delete strategy is explicit
- timestamp strategy is explicit
- data types match the domain precisely enough to prevent invalid values

## References

- `references/modeling-and-normalization.md`
- `references/keys-constraints-and-indexes.md`
- `references/migrations-and-lifecycle.md`
- `references/conventions-and-data-types.md`
- `references/postgresql-engine.md`
- `references/mysql-engine.md`
- `references/mariadb-engine.md`
