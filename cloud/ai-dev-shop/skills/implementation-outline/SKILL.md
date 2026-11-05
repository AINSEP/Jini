---
name: implementation-outline
version: 1.0.0
last_updated: 2026-06-01
description: Use when a Software Architect must decide whether to produce a post-ADR, pre-tasks implementation outline, write the outline, record a deliberate SKIP, or when Coordinator, TDD, or Programmer need the outline readiness gate and downstream consumption rules.
---

# Implementation Outline

## Purpose

The Implementation Outline is a conditional micro-architecture artifact that bridges an approved ADR and Coordinator-generated `tasks.md`.

Use it when tests and task lists would otherwise have to infer cross-module structure, public/exported function contracts, data ownership, or system wiring from a high-level ADR. It does not replace the spec, ADR, or tasks.

## Ownership And Path

- Producer: Software Architect.
- Gate owner: Coordinator.
- Consumers: TDD Agent and Programmer.
- Artifact path: `<ADS_MEMORY_ROOT>/reports/pipeline/<NNN>-<feature-name>/implementation-outline.md`
- Template: `<AI_DEV_SHOP_ROOT>/framework/templates/implementation-outline-template.md`
- Skip record, when no trigger applies: `Implementation Outline: SKIP - <reason and triggers checked>`

## Trigger Decision Matrix

The Software Architect MUST produce `implementation-outline.md` when any trigger applies.

| Trigger | Produce When | Evidence Examples |
|---|---|---|
| Boundary Cross | The feature crosses more than one module, bounded context, package, service, UI/backend boundary, or ownership domain. | One user story requires changes in API + worker + persistence, or shared shell + domain module. |
| Contract Change | The feature adds or materially changes a public/exported contract consumed outside the owning module, or any API, event, webhook, SDK, CLI, or provider-facing contract. | New endpoint, event schema, cross-module exported service method, public validation function consumed by other modules, or compatibility window. |
| System Wiring | Delivery depends on explicit orchestration across packages, services, queues, jobs, webhooks, schedulers, or external integrations. | Queue publish/consume chain, webhook retry flow, cron job handoff, cross-package call graph. |
| Data And Persistence | The feature changes schema, table ownership, persistence boundaries, read routing, dual writes, reconciliation, idempotency, or data retention/privacy behavior. | New table owner, migration bridge, backfill, cross-record invariant, external data sync. |
| Brownfield Dependency | The feature depends on, wraps, preserves, or changes existing public contracts in a brownfield codebase. | Legacy consumer inventory, existing API callers, characterization-test preservation needs. |
| Reverse-Spec Or Migration | Source behavior must be mapped to a target architecture, even when user-visible behavior should remain stable. | Source behavior unit to target module mapping, intentional-change ledger, phased migration. |
| Critical Cross-Boundary Invariant | A load-bearing invariant spans modules, records, tenants, transactions, or external systems. | Prevent double spend, preserve authorization boundary, keep event/order consistency. |
| Parallelization Ambiguity | Coordinator cannot safely derive task order or `[P]` markers from the ADR without extra module/wiring detail. | Two slices appear independent but share data ownership, generated types, or integration contracts. |

## Skip Rule

Skip is allowed only when every trigger has been checked and none apply. The skip must be explicit in the ADR and Software Architect handoff:

`Implementation Outline: SKIP - <reason and triggers checked>`

Good skip reasons name the triggers checked and why tasks can be safely generated from the ADR alone. Weak reasons such as "simple feature" or "not needed" are not enough.

## Gate Semantics

After human ADR approval and before generating `tasks.md`, the Coordinator verifies one of these is true:

- `implementation-outline.md` exists at the pipeline artifact path and its `Status:` field is `PRODUCED` (not `SKIPPED`).
- The ADR or Software Architect handoff contains `Implementation Outline: SKIP - <reason and triggers checked>`.

If neither is true, Coordinator routes back to Software Architect and does not generate `tasks.md`.

When the outline exists, `tasks.md` records its path. When skipped, `tasks.md` records the SKIP reason. If TDD or Programmer later finds the skip insufficient, they report `[OUTLINE_REQUESTED]` with the missing boundary, contract, or wiring decision.

## Artifact Boundary

Include:

- Module/domain responsibilities and ownership.
- Planned files to create or materially change, grouped by module. Each file entry names the public/exported functions, interfaces, or classes it will house.
- Public/exported function, interface, or class contracts with one job, why the contract is needed, inputs, outputs, validation rules, error contracts, side effects, test seam, complexity/resource view, aggregate-risk note when applicable, and trace to spec/ADR.
- API, event, webhook, SDK, CLI, or provider-facing contract shapes.
- Cross-module wiring, transports, and sequencing constraints.
- Data ownership, persistence boundaries, migration/dual-write paths, and side-effect boundaries.
- Observability expectations for production backend/service/worker/API paths, external I/O, async jobs, and alerting surfaces, including correlation, logs, metrics, traces, alert/runbook needs, and privacy constraints.
- Load-bearing invariants that downstream tests and implementation must preserve.

Exclude:

- Private helper inventories.
- Pseudo-code, exact algorithms, branch-by-branch control flow, loop structures, or implementation strategy inside a function body.
- Task sequencing already owned by `tasks.md`.
- Files that are purely organizational and house no public/exported contract, such as incidental barrels or private utility collections with no cross-module consumers.

Internal entries are allowed only for load-bearing invariant units. Tag them `[internal-invariant]` and give a one-line reason tied to corruption, security failure, compatibility preservation, or characterization parity.

## File-Level Boundary Litmus

A file belongs in the outline when it establishes a module boundary or houses at least one public/exported contract. A file that could be merged into its parent module or split arbitrarily without changing any cross-module contract is an implementation detail and should be omitted.

For each included file, list what contracts it houses and why that separation exists. Do not describe private helper layout unless the helper is a tagged `[internal-invariant]` unit.

## Workflow

1. Read the approved spec package, ADR, constitution exceptions, Red-Team advisories, system blueprint if present, and brownfield/reverse-spec artifacts if present.
2. Fill the Trigger Decision Matrix. Record every triggered item, or record the explicit SKIP line.
3. If any trigger applies, produce `implementation-outline.md` from the template.
4. Keep the outline structural and contractual. Describe what modules and contracts must exist, not how private code must implement them.
5. Trace each contract and invariant to spec acceptance criteria, ADR decisions, Red-Team advisories, or brownfield evidence.
6. In the Software Architect handoff, report the outline path or the exact SKIP line.

## Downstream Consumption

- Coordinator: enforces the readiness gate before `tasks.md`; uses the module and wiring maps to derive phase boundaries and safe `[P]` markers.
- TDD Agent: uses the Contract Map, Wiring Map, and Critical Invariants to build the Outcome Matrix and contract/integration tests. If skipped but needed, reports `[OUTLINE_REQUESTED]`.
- Programmer: uses the Contract Map and Wiring Map in the ADR checklist and Architecture Audit. If skipped but needed, reports `[OUTLINE_REQUESTED]`.

## Work Breakdown

Load `references/work-breakdown.md` for:
- Task sizing table (XS–XL with file counts, time estimates, and examples)
- "When to break a task down further" rules (can't describe AC in 3 bullets, crosses two independent subsystems, title contains "and")
- Risk-First Slicing — tackle highest-risk piece first, fail fast before investing in dependent slices
- Contract-First Slicing — define the shared API contract first, then let backend and frontend parallelize against mock data

*Source: Addy Osmani / agent-skills / planning-and-task-breakdown*

## Anti-Patterns

- Turning the outline into pseudo-code.
- Listing every private helper because the user asked for "functions"; include public/exported contracts and load-bearing internal invariant units only.
- Skipping because the artifact feels heavyweight while a trigger is present.
- Duplicating provider-owned spec content instead of referencing spec IDs, acceptance criteria, and hashes.
- Letting Coordinator generate tasks from an ADR with missing outline/SKIP readiness evidence.
