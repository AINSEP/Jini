---
name: critical-internal-constraints
version: 1.1.0
last_updated: 2026-07-03
description: Use when a Software Architect must decide whether any unit in a feature carries load-bearing internal constraints (algorithmic correctness, stateful protocol, concurrency/ordering, security-critical sequencing, explicit performance budget, failure/recovery, characterization parity), record those constraints for designated units, record a deliberate NOT TRIGGERED result, or when Coordinator, TDD, or Programmer need the readiness gate, escalate-before-deviate rules, or [CIC_REQUESTED]/[CIC_DEVIATION]/[CIC_PROPOSED] handling.
---

# Critical Internal Constraints

## Purpose

The Critical Internal Constraints (CIC) artifact is a conditional **constraint ledger** for designated complex units only — units where a plausible implementation can satisfy the public contract yet still violate correctness, security, recovery semantics, parity, or an explicit NFR budget.

It records load-bearing internal decisions, not internal design. It is not a low-level design document: no call flows, no class layouts, no pseudo-code. It fills the space the Implementation Outline deliberately excludes, only where a trigger identifies a specific failure mode and a specific constraint downstream stages must preserve. Everything not designated stays Programmer-owned.

**Default stance: do not produce this artifact.** Produce it only when at least one trigger designates a unit.

## Ownership And Path

- Producer: Software Architect. Downstream agents may propose constraints via `[CIC_PROPOSED]` (see Downstream Constraint Promotion).
- Gate owner: Coordinator, inside the combined Design Readiness check (with the Implementation Outline, before `tasks.md`).
- Consumers: TDD Agent and Programmer.
- Artifact path: `<ADS_MEMORY_ROOT>/reports/pipeline/<NNN>-<feature-name>/critical-internal-constraints.md`
- Template: `<AI_DEV_SHOP_ROOT>/framework/templates/critical-internal-constraints-template.md`
- When no unit is designated, do **not** create the file. Record in the ADR and Software Architect handoff: `Critical Internal Constraints: NOT TRIGGERED - <candidate units checked; checked surfaces; why no trigger applies>`

## Relationship To The Implementation Outline

- The Implementation Outline owns structure: module boundaries, public/exported contract shapes, wiring, data ownership, cross-module invariants. The CIC artifact owns load-bearing internal constraints of specific units. Never restate outline content — reference its Contract IDs (`C-xxx`) and Invariant IDs (`INV-xxx`).
- Trigger evaluation is independent. A single-module feature can SKIP the outline yet still designate a CIC unit (e.g. a parser or rate limiter inside one module), and vice versa.
- Candidate units come from the outline's Contract Map and `[internal-invariant]` entries when the outline exists, and from ADR components otherwise.

## Trigger Decision Matrix

Triggers are evaluated **per unit**. A designation is valid only when it names all four of: (1) the candidate unit, (2) a plausible wrong implementation, (3) the property it breaks, (4) the required internal constraint. "Non-obvious" or "complex" alone never designates.

| Trigger | Designate When | Evidence Examples |
|---|---|---|
| Algorithmic Correctness Constraint | A specific algorithm, data-structure, or ordering choice is required for correctness, parity, or bounded complexity, and a plausible alternative violates a traced AC, invariant, red-team finding, or domain rule. | Matching/dedup logic, scheduling, ranking, parsing, money arithmetic and rounding. |
| Stateful Protocol Constraint | Correctness depends on allowed states, transition preconditions, or illegal transitions not fully captured by public contracts. | Order lifecycle, connection handshake, saga steps, subscription state machine. |
| Concurrency / Ordering / Idempotency Constraint | Races, retries, duplicate events, or reordering can corrupt state unless a specific ordering/idempotency constraint is preserved. | Queue-consumer idempotency, optimistic locking, exactly-once effects, event ordering. |
| Security-Critical Sequencing Constraint | A security property depends on internal ordering or validation boundaries. | Authorize-before-effect, verify-before-trust, sanitize-then-use, crypto usage order. |
| Explicit Performance Budget Constraint | A measured or specified NFR budget requires a particular complexity class, batching behavior, cache rule, or data structure. No explicit budget means no trigger. | p99 latency budget, memory cap, avoiding N+1 in a hot loop with a stated budget. |
| Failure / Recovery Constraint | Correctness spans partial failure, rollback, retry, compensation, or recovery after interruption. | Saga compensation, outbox pattern, resumable backfill, crash-safe writes. |
| Characterization Parity Constraint | Brownfield behavior, including quirks, must be preserved and cannot be inferred safely from public contracts. | Rounding or ordering quirks pinned by characterization tests. |

## Not Triggered Rule

`NOT TRIGGERED` is allowed only when every trigger has been checked against every candidate unit. The record must name the candidate units considered and the checked surfaces (Contract Map entries, ADR components, `[internal-invariant]` units, brownfield parity surfaces). Weak reasons such as "simple feature" are not enough when a trigger is present.

When candidate units exceed five, the single line may summarize and point to a compact per-unit checklist in the ADR or handoff (unit → triggers checked → why none applies) — still no file. Division of enforcement: the Coordinator gate verifies the record's presence and fields; reasoning quality is owned by the human Architecture sign-off checkpoint.

## Gate Semantics — Combined Design Readiness Check

There is one Coordinator check, not two. After human ADR approval and before `tasks.md`, the Coordinator verifies a Design Readiness record covering both artifacts:

- Implementation Outline: `PRODUCED` (file exists with `Status: PRODUCED`) or `SKIP - <reason and triggers checked>`.
- Critical Internal Constraints: `PRODUCED` (file exists with `Status: PRODUCED`) or `NOT TRIGGERED - <candidate units checked; checked surfaces; why no trigger applies>`.
- Source sync: every `C-xxx`/`INV-xxx`/ADR/spec ID referenced by a Binding constraint exists; no orphaned constraints; when the outline is SKIPped, every constraint traces directly to ADR/spec evidence. If a referenced ID was renamed, removed, or materially revised, mark the artifact `STALE` and route back to the Software Architect for review.

If any element is missing, route back to Software Architect. When the artifact exists, `tasks.md` records its path and tasks touching designated units reference their Unit IDs; when not triggered, `tasks.md` records the NOT TRIGGERED line.

## Bindingness

The artifact exists to record **Binding** constraints. A Binding constraint means: a plausible alternative implementation would break correctness, security, recovery semantics, parity, or an explicit NFR. Non-binding reasoning is allowed only as a short `Design Context` note per unit and creates no audit obligations.

Escalation markers on Binding constraints:

- `ESCALATE_SECURITY` — deviation may weaken authentication, authorization, validation, sanitization, cryptographic handling, tenant isolation, or secret handling.
- `ESCALATE_IRREVERSIBLE` — deviation may affect money movement, permanent deletion, privilege mutation, non-idempotent external side effects, cross-system writes, or unrecoverable data corruption.

Default marker assignment: constraints designated under the Security-Critical Sequencing trigger default to `ESCALATE_SECURITY`, and constraints whose subject matter involves money movement, permanent deletion, privilege mutation, or non-idempotent external effects default to `ESCALATE_IRREVERSIBLE` — regardless of designating trigger. The Software Architect may omit a default marker only by recording why in that constraint's row.

Deviation rules:

- Escalation-marked constraints: downstream MUST pause and route to Coordinator (who routes to the Software Architect) **before** deviating. Approval is a recorded `[CIC_DEVIATION_APPROVED]` entry (see format below) in the handoff chain or `pipeline-state.md`; deviation from an escalation-marked constraint without a matching approval record is an Architecture Audit **BLOCKER** — prose claims of approval do not count.
- All other Binding constraints: downstream may deviate only with a recorded `[CIC_DEVIATION]` handoff entry — Unit ID, constraint ID, what was done instead, why the constraint was wrong/inferior/infeasible, and the effect on invariants and tests. Unrecorded deviation is an Architecture Audit **WARNING** at minimum.
- Deviation records are design feedback, not failures. The Software Architect reviews them and folds confirmed ones back into the artifact.

## Verification Surface Rule

Every Binding constraint must declare one of:

- **Observable test surface**: public API result, persisted state, emitted event, external-call boundary, error behavior, log/metric contract, recovery result, or documented/approved test seam.
- **Audit-only**: source review or Architecture Audit required because the property cannot be verified behaviorally without coupling tests to private structure. Audit-only constraints are never TDD assertions.

TDD may create state-transition, property, ordering, idempotency, and fault-injection tests only through observable surfaces or approved test seams. TDD must not assert private helper names, branch layout, file structure, or call-graph shape.

For Explicit Performance Budget constraints, prefer operation-count or query-count seams (e.g. counting external calls, queries, or allocations through an approved seam) or integration-level budget assertions over microbenchmarks; audit-only is the last resort for performance constraints, not the default.

## Required Ordering Constraints

Do not describe full call flow. Include only orderings where reversing or omitting the order breaks a named property. Each row names the required ordering, the property protected, the observable verification surface, and the trace. No complete step-by-step implementation flows; no private helper names unless they are approved test seams or public boundaries.

## Re-evaluation And Staleness

Binding constraints must be re-evaluated when implementation discovers: a simpler equivalent algorithm; unavailable dependency behavior; changed persistence or transaction semantics; a changed concurrency model; failed or infeasible verification hooks; performance measurements invalidating the assumed budget; or a brownfield characterization mismatch.

Before final handoff, the Programmer must, for each in-scope Binding constraint, either confirm it still applies, record a `[CIC_DEVIATION]`, or request reclassification from Architect/Coordinator.

## Cross-Feature Persistence

CIC artifacts live per feature (`reports/pipeline/<NNN>-<feature-name>/`), but the units they constrain outlive the feature. Two rules prevent constraints from being lost one feature later:

- **Reverse lookup (consume).** During candidate-unit enumeration, the Software Architect checks prior features' artifacts (`<ADS_MEMORY_ROOT>/reports/pipeline/*/critical-internal-constraints.md`, searched by the touched units' module/contract names) for existing designations of any unit the current feature touches. Prior Binding constraints on touched units are inputs to the current design: re-affirm them (reference the prior artifact), supersede them (record why), or promote them (below). Ignoring a prior designation on a touched unit is an Architecture Audit WARNING.
- **Governance promotion (persist).** When a designated unit's Binding constraints are durable — the unit is shared across features, or the constraint protects a property that outlives this feature — evaluate promotion to the Governance ADR Registry using `<AI_DEV_SHOP_ROOT>/skills/adr-governance/SKILL.md` (the same Promotion workflow the pipeline ADR already uses), recording the CIC artifact path as the source. Promoted constraints are then discovered through `ADR-INDEX.md` scope globs by every future feature, independent of the reverse lookup.

The artifact header records which prior designations were consulted (or "none found") so the reverse lookup is audit-checkable.

## Downstream Constraint Promotion

TDD, Programmer, Code Inspection, Security, or TestRunner may raise `[CIC_PROPOSED]` when implementation or test design reveals a load-bearing internal constraint not captured in the artifact. Proposals must carry the same rigor as a designation:

`[CIC_PROPOSED] Unit=<U-xxx or candidate> Trigger=<trigger> Constraint=<proposed Binding text> Property=<what breaks> VerificationSurface=<observable surface or audit-only> Evidence=<test/code/legacy/ADR/spec trace>`

Coordinator handling:

- If the proposal affects `ESCALATE_SECURITY`/`ESCALATE_IRREVERSIBLE` behavior, pause and route to Architect/Security before proceeding.
- Otherwise, work continues with the proposal recorded, unless the proposing agent marks it blocking.
- Architect or Coordinator must ratify, revise, or reject every proposal before the final Architecture Audit. Ratified proposals update the artifact; when no artifact existed, the Software Architect produces `critical-internal-constraints.md` for the ratified designation (a ratified proposal is a designation) and the Coordinator updates the `tasks.md` metadata line from NOT TRIGGERED to the artifact path.
- Rejected proposals after work continued: the Coordinator routes the rejection back to TDD and Programmer to reconcile any tests or code written assuming the proposed constraint (remove or rework them; certified tests change only through the TDD re-certification path). The rejection and the reconciliation outcome are recorded in the handoff chain.

## Escalation Markers Summary

- `[CIC_REQUESTED]` — a unit in scope meets a trigger but was not designated (or the artifact was not produced and a trigger is now evident). Format: `[CIC_REQUESTED] Unit=<candidate> Trigger=<trigger> PlausibleWrong=<what a competent implementer might do> Property=<what breaks> MissingConstraint=<required constraint> Evidence=<ADR/spec/outline/test/code trace>`. Report before proceeding; Coordinator routes it to the Software Architect.
- `[CIC_DEVIATION]` — recorded deviation from a non-escalation Binding constraint, using the fields above.
- `[CIC_DEVIATION_APPROVED]` — Architect-approved deviation from an escalation-marked constraint. Format: `[CIC_DEVIATION_APPROVED] Unit=<U-xxx> Constraint=<constraint ID> ApprovedBy=<Software Architect via Coordinator> Date=<ISO-8601> Rationale=<one line>`. Recorded by the Coordinator in the handoff chain or `pipeline-state.md` before the deviation is implemented; the Architecture Audit matches deviations on escalation-marked constraints against these records.
- `[CIC_PROPOSED]` — downstream constraint proposal for ratification, using the format above.

## Artifact Boundary

Include, per designated unit only:

- Designation: trigger, plausible wrong implementation, broken property, required constraint, trace to spec/ADR/outline/red-team/NFR/characterization evidence.
- The unit's single responsibility and its outline references (`C-xxx`, `INV-xxx`) or module location.
- Binding constraints table: constraint, escalation marker (if any), property protected, verification surface (observable or audit-only), trace.
- State machine, when a Stateful Protocol Constraint applies: states, events, transitions, illegal states/transitions, state persistence.
- Concurrency/ordering/idempotency constraints and Required Ordering Constraints rows.
- Failure/recovery constraints: failure points, required retry/compensation/rollback behavior, partial-state rules.
- Invariant references only: cite the outline `INV-xxx` IDs or ADR/spec evidence that support the Binding constraints. Do not create a second invariant ledger in this artifact — a newly discovered invariant is expressed as a Binding constraint (or routed through `[CIC_PROPOSED]` for ratification), never as a parallel invariant entry.
- A short optional `Design Context` note (non-binding, no audit obligation).

Exclude:

- Full call flows, class layouts, code, or pseudo-code at any granularity.
- Designs or constraints for non-designated units, including ordinary CRUD, glue, mapping, and presentation code.
- Variable naming, private helper decomposition, file layout (the outline's File Map owns placement).
- Restated contract shapes, wiring, or data boundaries owned by the Implementation Outline.
- Test implementation (TDD owns it) and task sequencing (`tasks.md` owns it).

## Workflow

1. Read the approved spec package, ADR, Implementation Outline (or its SKIP record), constitution exceptions, Red-Team advisories, NFR discovery records, and brownfield/characterization artifacts if present.
2. Enumerate candidate units: outline Contract Map entries, `[internal-invariant]` units, ADR components with non-trivial internals, and brownfield parity surfaces. Run the Cross-Feature Persistence reverse lookup for every touched unit and record prior designations consulted (or "none found").
3. Evaluate every trigger against every candidate unit using the four-part designation test. Record designations, or record the `NOT TRIGGERED` line with candidate units checked, checked surfaces, and why no trigger applies.
4. For each designated unit, record only Binding constraints with their verification surfaces, escalation markers where warranted, and traces. Add Required Ordering Constraints rows for load-bearing orderings.
5. Verify source sync: every referenced `C-xxx`/`INV-xxx`/ADR/spec ID exists.
6. Evaluate Governance promotion for durable unit constraints per Cross-Feature Persistence; promote via `<AI_DEV_SHOP_ROOT>/skills/adr-governance/SKILL.md` or record why not needed.
7. In the Software Architect handoff, report the artifact path with the designated unit list (including prior designations re-affirmed/superseded/promoted), or the exact NOT TRIGGERED line.

## Downstream Consumption

- Coordinator: runs the combined Design Readiness check; records path or NOT TRIGGERED in `tasks.md`; enforces source sync and `STALE` routing; routes `[CIC_REQUESTED]` to the Software Architect; handles `[CIC_PROPOSED]` ratification routing (pausing first for security/irreversible proposals); surfaces `[CIC_DEVIATION]` entries and unresolved CIC reports to the human.
- TDD Agent: encodes each Binding constraint's observable verification surface as tests — state-transition tests, property tests, ordering/idempotency tests, fault-injection/recovery tests. Never asserts private structure; audit-only constraints are not TDD assertions. Reports `[CIC_REQUESTED]` for undesignated triggering units and may raise `[CIC_PROPOSED]`.
- Programmer: extracts Binding constraints for in-scope designated units into the pre-code ADR checklist; escalates before deviating on escalation-marked constraints; records `[CIC_DEVIATION]` otherwise; confirms/deviates/requests-reclassification per constraint before final handoff; includes CIC conformance in the Architecture Audit. May raise `[CIC_PROPOSED]` and `[CIC_REQUESTED]`.

## Anti-Patterns

- Turning the ledger back into a design document: call flows, class layouts, helper inventories, pseudo-code.
- Designating units without the four-part test — "non-obvious" or "while you're at it" designation is scope creep on the Programmer.
- Restating the Implementation Outline's contracts, wiring, or data boundaries instead of referencing IDs.
- Padding units with Design Context prose that smuggles in de facto constraints without audit obligations.
- Recording a constraint without a verification surface, or defaulting to audit-only when an observable surface exists.
- Producing the artifact when nothing triggers, or recording NOT TRIGGERED without naming the candidate units checked.
- Treating `[CIC_DEVIATION]` records as failures to suppress, or `[CIC_PROPOSED]` as an "I'm stuck" button for offloading ordinary implementation decisions.
