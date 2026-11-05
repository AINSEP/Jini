---
name: change-management
version: 1.0.0
last_updated: 2026-02-26
description: Safe patterns for shipping breaking changes, including feature flags, dual writes, backfills, and cutover gates.
---

# Skill: Change Management

Breaking changes are unavoidable. Shipping them safely is not. Every breaking change — schema migration, API contract change, data model restructure — must follow the expand-contract pattern: add the new alongside the old, migrate, then remove the old. Skipping phases is how outages happen.

## The Expand-Contract Pattern (preferred for breaking changes)

- **Phase 1 — Expand**: add new capability alongside old (new column, new endpoint, new behavior behind flag). Old and new code both work.
- **Phase 2 — Migrate**: move traffic/data to new capability. Monitor.
- **Phase 3 — Contract**: remove old capability once migration is complete and verified.
- **Rule**: never skip phases. Combining expand + contract in one deployment is a breaking change.

## Feature Flags

- **Use for**: rolling out new behavior incrementally, enabling rollback without redeployment, A/B testing.
- **Flag types**: boolean (on/off), percentage rollout (0-100%), user segment (specific user IDs or groups).
- **Naming**: `<feature>_<description>_enabled` — e.g. `invoice_v2_line_items_enabled`.
- **Default value**: false for new features (off by default), true for kill switches (enabled by default).
- **Flag lifecycle**: create → enable for internal → canary → full rollout → remove flag from code.
- Never leave flags in code permanently — schedule removal after full rollout.

## Dual-Write Pattern

- **When**: migrating data from one storage location or shape to another.
- Write to both old and new path simultaneously during migration window.
- Read from old path until new path is verified complete and consistent.
- Switch reads to new path only after backfill is complete and verified.
- Stop writing to old path only after reads have moved and been stable.

## Backfill Design

- Backfill jobs must be idempotent — safe to run multiple times.
- Process in batches (1000-10000 rows per batch) with sleep between batches to avoid lock contention.
- Record progress (last processed ID or timestamp) — resumable if interrupted.
- Verify row count before and after: `SELECT COUNT(*) WHERE new_field IS NULL` should reach 0.
- Run backfill on non-peak hours for large datasets.

## Cutover Gates

Observable conditions that must be true before proceeding to the next phase. Each gate must be:
- Measurable (a metric, a count, a test result — not "looks good")
- Automated where possible (CI check, monitoring alert threshold)
- Time-bounded (wait no more than X hours before escalating)

Example gates:
- Error rate on new path < 0.1% for 30 minutes
- Backfill complete: `SELECT COUNT(*) WHERE new_field IS NULL = 0`
- All E2E tests passing against new path
- p99 latency on new path ≤ spec NFR target

## Rollback Triggers and Procedures

- Define rollback trigger before deployment (not after something breaks).
- Rollback trigger examples: error rate > 1%, p99 latency > 2x target, data inconsistency detected.
- Rollback procedure must be documented, tested, and executable by any on-call engineer.
- Database schema changes: never destructive in the deploy that introduces new behavior (separate deploy).
