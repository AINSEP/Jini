---
name: architecture-migration
version: 1.0.0
last_updated: 2026-02-22
description: Use when you have a codebase analysis report and need to plan a migration to clean architecture. Reads ANALYSIS-*.md reports from codebase-analysis/ and produces a phased migration plan with target pattern recommendation, boundary proposals, phase sequencing, and verification gates for each phase.
---

# Skill: Architecture Migration

Architecture migration moves an existing codebase from its current structure to a target architecture without breaking functionality. This skill reads codebase analysis reports and produces a concrete, phase-by-phase migration plan.

**Never recommend a big-bang rewrite.** Migration always happens incrementally — the strangler fig principle applied to architecture. The system stays in production at the end of every phase.

## Inputs

Load from `<ADS_MEMORY_ROOT>/reports/codebase-analysis/`:
- The relevant `ANALYSIS-*.md` report(s) — all parts if split
- Also load `<AI_DEV_SHOP_ROOT>/skills/architecture-decisions/SKILL.md` for pattern selection
- Also load `<AI_DEV_SHOP_ROOT>/skills/design-patterns/SKILL.md` for the target pattern's implementation details

## Step 1 — Classify Current State

Before recommending a target, classify what the analysis report describes:

| Classification | Characteristics |
|---|---|
| **Layered (healthy)** | Clear layers, one-way dependencies, logic in correct layers |
| **Layered (degraded)** | Layers exist but bleed into each other; most common state |
| **Big Ball of Mud** | No consistent structure, logic everywhere, high coupling |
| **Premature Microservices** | Services split without clean internal boundaries — often harder to fix than a monolith |
| **Over-engineered** | Abstractions with no real purpose, patterns applied where not needed |

Most production codebases are **Layered (degraded)**. The migration path differs by classification.

## Step 2 — Select Target Architecture

Map the Critical flaws from the analysis report to the best target:

| Primary Critical Flaw | Recommended Target |
|---|---|
| Business logic in HTTP/route layer | Clean Architecture or Hexagonal |
| No interfaces for external dependencies | Hexagonal (ports and adapters) |
| God modules with mixed concerns | Vertical Slice or Modular Monolith |
| Circular dependencies between modules | Modular Monolith with enforced boundaries |
| Services tightly coupled via shared database | Event-driven with owned data stores |
| Simple CRUD with no real domain complexity | Layered (healthy) — fix the degradation, don't over-architect |

Validate against system drivers using `<AI_DEV_SHOP_ROOT>/skills/architecture-decisions/SKILL.md`. The target must match the actual complexity and team context — not just fix the flaws.

## Step 3 — Identify Migration Seams

The strangler fig works by identifying boundaries between old and new code. Before writing phases, find:

1. **Natural seams**: Places where implicit separation already exists (even if not enforced). These are where the boundary already wants to be.
2. **Highest-leverage extractions**: Domain concepts that, if properly isolated, would resolve multiple Critical/High flaws. Start here.
3. **Lowest-risk starting points**: Modules that already have test coverage. Safer to migrate first — the tests catch regressions.
4. **Phase 0 candidate**: If any module has zero test coverage, Phase 0 is writing tests for that module's current behavior before touching a line of structure.

## Step 4 — Write the Migration Plan

Structure as ordered phases. Each phase must:
- Be independently completable without requiring later phases
- Leave the system running and deployable at its end
- Have a specific verification criterion (ideally a test)
- Be scoped to 1–3 days of work maximum — if it's larger, split it
- For production-facing systems, define expand/contract, backfill,
  reconciliation, observability, rollback, and cutover safety before the phase
  can be executed

```markdown
### Phase 1: Extract Domain Layer

Addresses: FLAW-001, FLAW-003, FLAW-007
Effort: Medium

What moves:
- Invoice calculation logic out of src/routes/invoice.ts
- Payment validation out of src/routes/payment.ts
- Create src/domain/ — pure business logic, zero framework imports

Boundary rules for src/domain/:
- No imports from Express, Fastify, or any HTTP library
- No imports from any ORM or database library
- Accepts and returns plain TypeScript objects only

Verification:
- All domain functions unit-testable without HTTP server
- All existing route tests remain green (no behavior change)
- New unit tests cover extracted domain logic

Rollback: domain/ folder can be deleted; logic reverts to routes unchanged.

---

### Phase 2: Add Repository Interfaces

Addresses: FLAW-002, FLAW-008
...
```

## Step 5 — Output Format

Save to `<ADS_MEMORY_ROOT>/reports/codebase-analysis/MIGRATION-<analysis-id>-<YYYY-MM-DD>.md`.

```markdown
# Architecture Migration Plan: <project-name>

- Migration ID: MIGRATION-001
- Analysis Source: ANALYSIS-001
- Date: <ISO-8601 UTC>
- Current State: Layered (degraded)
- Target Architecture: Hexagonal Architecture

## Why This Target

[2–3 sentences: which Critical flaws drove this choice over alternatives]

## Flaws Addressed

| Flaw ID | Current Impact | Resolved In |
|---|---|---|
| FLAW-001 | Untestable business logic | Phase 1 |
| FLAW-002 | Vendor lock-in to ORM | Phase 2 |

## Flaws NOT Addressed By This Plan

[Explicitly scope out: security findings → Security Agent, performance issues, etc.]

## Phase Plan

[Ordered phases per format above]

## Risk Map

| Phase | Primary Risk | Rollback Strategy |
|---|---|---|
| Phase 1 | Missed logic in routes | Revert domain/ addition, logic unchanged in routes |
| Phase 2 | ORM queries broken by interface | Keep ORM adapter, swap implementation incrementally |

## Production Migration Safety

Required when the migration touches production data, public APIs, auth,
payments, jobs, external integrations, or runtime topology.

| Safety Item | Required Decision / Evidence |
|---|---|
| Expand/contract shape | <additive step, compatibility window, contract removal step> |
| Dual-write or read-routing plan | <needed/not needed with reason; owner if needed> |
| Backfill plan | <source, target, batching, idempotency, retry behavior> |
| Reconciliation | <counts/checksums/domain checks; acceptable variance> |
| Observability | <metrics/logs/alerts/dashboard proving phase health> |
| Rollback test | <exact rollback command/procedure and evidence it was tested> |
| Cutover point | <who approves, when traffic/data authority moves, freeze window if any> |
| Point of no return | <irreversible step or "none"; mitigation if irreversible> |
| Post-cutover verification | <checks that must pass before the phase is complete> |

If any row is unknown for a production-facing phase, mark the phase BLOCKED for
execution and route back to Architect or human review.

## Operational Workflow

Required for production-facing migration plans.

| Step | Owner | Required Evidence |
|---|---|---|
| Preflight | <owner> | source/target schema versions, feature flags, environment, backup/snapshot, validator commands |
| Dry run | <owner> | dry-run command, sampled output, expected duration, known warnings |
| Execution window | <owner> | start criteria, communication channel, freeze window if needed |
| Monitoring | <owner> | dashboard/log query/metric names, alert thresholds, who watches them |
| Decision checkpoints | <owner> | continue/rollback criteria after each irreversible or high-risk step |
| Completion | <owner> | post-cutover verification, cleanup criteria, follow-up issue list |

## Human Review / Waiver Record

Any production-facing migration with a blocked safety row, irreversible step, or
missing characterization coverage requires explicit human approval before
execution.

| Waiver / Review Item | Decision | Reviewer | Date | Expiration / Revisit Trigger |
|---|---|---|---|---|
| <item> | APPROVED / REVISE / REJECTED | <name/role> | <ISO-8601 UTC> | <trigger> |

## Recommended Pipeline Entry Point

After completing Phase [N], the codebase is ready to run new features through the
full AI Dev Shop pipeline starting at the Spec Agent. Suggested first feature: [...]
```

## Principles

**Phase 0 if no tests**: Never migrate structure without tests covering current behavior. If coverage is absent, Phase 0 is: write characterization tests for the module as-is, then proceed.

**Critical/High modules with no detected tests block migration execution**:
When CodeBase Analyzer reports no detected test files and no configured test
command/coverage artifact for a Critical or High module in scope, add Phase 0
characterization tests and do not execute structural migration for that module
until the tests exist.

**Fix root causes, not symptoms**: FLAW-001 (business logic in routes) often causes FLAW-003 (untestable logic) and FLAW-007 (duplication). Fixing the root resolves the symptoms.

**Boundaries before internals**: Establish clean interfaces first. Refactor internals after boundaries are enforced.

**One change type per phase**: Don't rename AND restructure in the same phase. Separate commits for separate concerns — this makes rollback possible.

**No cross-module phases**: One phase touches one module or one boundary type. Broad phases that touch everything fail.

**Confirm with Architect**: The migration plan should be reviewed against the project's ADRs (if any exist) before the Coordinator dispatches the Programmer Agent to execute phases.

## References

When planning system deprecations, sunsetting APIs, or migrating legacy systems, load `references/deprecation-lifecycle.md` for the compulsory vs. advisory deprecation decision framework, the Churn Rule, zombie code identification, and Hyrum's Law applied to deprecation.

*Source: Addy Osmani / agent-skills / deprecation-and-migration*
