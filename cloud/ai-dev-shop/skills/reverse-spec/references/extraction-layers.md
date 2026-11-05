# Extraction Layers — Output Schema

Shared across all passes. Defines the requirement output format and layer taxonomy.

## Layer Taxonomy

| Layer ID | Name | What It Captures |
|----------|------|-----------------|
| `api` | API/Service Contracts | Routes, request/response shapes, status codes, headers, pagination, auth |
| `domain` | Domain Rules | Business rules, state machines, invariants, computed values, events |
| `side-effect` | Side Effects | Emails, events, webhooks, jobs, external calls |
| `data` | Data Contracts | Entity schemas, relationships, constraints, retention |
| `database` | Database-Resident | Triggers, stored procs, views, cascades, RLS |
| `access-control` | Access Control | ACL matrix rows, role rules, tenant boundaries |
| `transaction` | Transaction/Atomicity | Transaction boundaries, post-commit effects, idempotency |
| `concurrency` | Concurrency/State | Serialization requirements, locks, in-memory state scope |
| `failure` | Failure Behavior | Error responses, status codes, error shapes per case |
| `integration` | Integration Boundaries | External deps, retry, timeout, fallback, async semantics |
| `compliance` | Privacy/Compliance | GDPR, retention, audit, deletion, consent |
| `performance` | Performance Envelopes | Latency, throughput, payload limits, startup time |
| `observability` | Observability Contracts | Metric names, log schemas, trace spans with consumers |
| `client-invalidation` | Client State Invalidation | WebSocket events, cache headers, push triggers |
| `cache` | Cache Behavior | TTLs, invalidation, stampede, key structure, warm-up |
| `infrastructure` | Infrastructure Behavior | CDN, proxy, env vars, edge config |
| `migration` | Data Migration | Field mapping, type conversion, legacy exceptions |
| `security` | Security Primitives | Hashing, tokens, sessions, CSRF, CORS, encryption |

## Requirement Output Format

```markdown
### REQ-<module>-<number>: <short behavioral description>

**Layer:** <layer ID from taxonomy>
**Status:** confirmed | needs_clarification | likely_dead_code | deprecated | pending_human_input
**Confidence:** tested | runtime-observed | contractual | characterized | observed | implementation-tested | documented-only | test-claimed | inferred
**Criticality:** critical | high | medium | low
**Criticality reason:** money | PII | auth | compliance | high_traffic | fragile_consumer | data_loss | partner_contract | internal_only | low_usage
**Risk tags:** precision_contract | concurrency_contract | data_compatibility | untested_side_effect | migration_risk | contract_vs_implementation | environmental_contract | distributed_transaction_risk | temporal_coupling | cutover_risk | id_format_change

**Source evidence:**
- `<file:line>` (<source type: test | implementation | config | migration | docs>)
- `<file:line>` (<source type>)

**Observed behavior:** <what the current system actually does>
**Normative contract:** <what docs/SLA/API contract say it should do — or "matches observed" if no conflict>
**Rewrite decision:** preserve_actual | fix_to_contract | human_decision_required | not_applicable

**Behavior classification:** intended | accidental | known_bug | compatibility_required | deprecated | unclear
**Preservation decision:** preserve | fix | remove | human_decision_required

**Contract:**
- Input: <what it accepts — types, shapes, validation, with union types for dynamic languages>
- Output: <what it produces — response shape, status, headers, with all possible return shapes>
- Side effects: <what else happens — or "unknown" / "none_observed" / "verified_none" / "not_applicable">
- Invariants: <what must remain true — or "unknown" / "none_observed" / "verified_none">
- Error cases: <failure matrix reference or inline for simple cases>
- Transaction boundary: <atomic scope, post-commit effects — or "unknown" / "none_observed" / "verified_none" / "not_applicable">
- Concurrency: <serialization requirement — or "unknown" / "none_observed" / "verified_none" / "not_applicable">
- Auth requirement: <role, ownership, tenant scope — or "public" / "unknown">

**Open questions:** *(when status != confirmed)*
- <what is uncertain and needs verification>

**Migration notes:** *(implementation hints, NOT requirements)*
- <framework-specific patterns the target must replace>
- <known bugs preserved for compatibility>
- <legacy data exceptions>

**Compatibility risks:** *(when deprecated or migration_risk)*
- <what breaks for existing clients if this changes>
```

## Risk Tag Canonicalization

Human-facing markers (used in review digests and inline flags) map to machine risk tags (used in the `Risk tags` field):

| Human Marker | Machine Risk Tag |
|---|---|
| `[PRECISION CONTRACT]` | `precision_contract` |
| `[CONCURRENCY CONTRACT]` | `concurrency_contract` |
| `[DATA COMPATIBILITY]` | `data_compatibility` |
| `[DATA MIGRATION RISK]` | `migration_risk` |
| `[CONTRACT VS IMPLEMENTATION]` | `contract_vs_implementation` |
| `[ENVIRONMENTAL CONTRACT]` | `environmental_contract` |
| `[DISTRIBUTED TRANSACTION RISK]` | `distributed_transaction_risk` |
| `[TEMPORAL COUPLING]` | `temporal_coupling` |
| `[CUTOVER RISK]` | `cutover_risk` |
| `[ID FORMAT CHANGE]` | `id_format_change` |
| `[UNTESTED SIDE EFFECT]` | `untested_side_effect` |

When raising a human marker inline, also add the corresponding machine tag to the requirement's `Risk tags` field.

## Coverage Map Applicability Rules

Not all requirements need every matrix/layer to be "fully specified." Use `not_applicable` with evidence:

| Scenario | Matrix/Layer | Status | Evidence Required |
|---|---|---|---|
| Public endpoint | ACL row | `not_applicable` | Route intentionally public (no auth middleware) |
| Read-only endpoint | Transaction boundary | `not_applicable` | No state mutation |
| Health check | Failure matrix | `not_applicable` (or minimal) | Only needs "healthy/unhealthy" |
| Background job | HTTP failure matrix | `not_applicable` | Job failure matrix required instead |
| One-way event consumer | Response shape | `not_applicable` | Ack-only, no response body |
| Internal-only endpoint | Consumer compatibility | `not_applicable` | No external consumers (cite evidence) |

A `not_applicable` marking must cite why the concept doesn't apply. Without evidence, use `unknown`.

## Summary Artifacts

Each pass produces requirements in this format. The synthesis pass merges them into:

- **merged-requirements.md** — all REQs grouped by module, then by layer
- Per-requirement cross-references to related REQs (e.g., a side-effect REQ references its triggering domain REQ)
- Deduplication: if two passes extract the same behavior, keep the one with higher confidence and merge evidence
