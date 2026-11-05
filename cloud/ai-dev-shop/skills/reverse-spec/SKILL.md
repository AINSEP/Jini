---
name: reverse-spec
version: 2.0.0
last_updated: 2026-05-19
description: Extract language-agnostic behavioral specifications from existing codebases. Use when migrating between languages/frameworks, documenting undocumented systems, or establishing spec coverage for brownfield projects. Produces behavioral contracts that any language can implement.
---

# Skill: Reverse Spec

Extract what a system DOES from what it IS. Produce behavioral specifications that describe contracts, invariants, and side effects without binding to the source language or framework.

## Use This When

- Migrating a codebase to a different language or framework
- Dropping AI Dev Shop into an existing project that lacks specs
- Documenting an undocumented system before feature work begins
- Establishing a behavioral baseline before a major refactor
- Verifying what the system actually does vs what docs claim

## Do Not Use This For

- Greenfield specs from human requirements (use Spec Agent directly)
- Code review or quality assessment (use Code Inspection Agent)
- Architecture analysis without spec extraction (use CodeBase Analyzer alone)
- Generating implementation code (this produces specs, not code)

## Load Strategy

Read this file for the methodology framework, confidence rules, and guardrails. Load references only for the active pass:

- `references/pass-1-core-logic.md` — Phases 0–3b: inventory, test extraction, code extraction, inline docs, conventions, numerical/string precision
- `references/pass-2-data-and-access.md` — Phases 4–6b: database-resident behavior, access-control matrix, transactions, concurrency/in-memory state
- `references/pass-3-boundaries.md` — Phases 7–9: failure matrix, integration boundaries, privacy/compliance, security primitives
- `references/pass-4-external.md` — Phase 10: external control plane, infrastructure behavior, consumer inventory, tool-gating
- `references/pass-5-synthesis.md` — Phase 11: conflict resolution, review digest, coverage map, extraction manifest
- `references/extraction-layers.md` — output schema for all layers (shared across passes)
- `references/characterization-tests.md` — golden-master test pack methodology
- `references/data-migration.md` — data migration contracts for cross-language rewrites

Each pass produces a named handoff artifact consumed by subsequent passes. Do NOT load all references at once.

## Confidence Hierarchy

Two hierarchies apply depending on whether behavior crosses a customer/external boundary:

**For externally observable behavior (API responses, published contracts, client-facing semantics):**

| Priority | Source | Label | Meaning |
|----------|--------|-------|---------|
| 1 | Published external contract | `contractual` | Customer-facing API docs, SLA, partner spec — a commitment |
| 2 | Runtime evidence | `runtime-observed` | Confirmed by production logs, traces, analytics |
| 3 | Passing behavior test | `tested` | Black-box test verifying observable outcome |
| 4 | Characterization sample | `characterized` | Golden-master fixture captured from running system — proves occurrence, not obligation. Pair with behavior classification to distinguish contractual from coincidental. |
| 5 | Running code | `observed` | Reachable code without behavioral test |

**For internal behavior (implementation details, internal orchestration):**

| Priority | Source | Label | Meaning |
|----------|--------|-------|---------|
| 1 | Passing behavior test | `tested` | Black-box test verifying observable outcome |
| 2 | Runtime evidence | `runtime-observed` | Confirmed by production evidence |
| 3 | Running code / factory shapes | `observed` | Code or valid factory definitions |
| 4 | Implementation test | `implementation-tested` | White-box test asserting internal calls/mocks |
| 5 | Internal documentation | `documented-only` | Wiki/internal docs not verified |
| 6 | Skipped/quarantined test | `test-claimed` | Asserted but skipped/flaky/snapshot-only |
| 7 | Inference | `inferred` | Convention, naming, or indirect evidence |

### Hierarchy Clarification

This hierarchy ranks **confidence that a requirement EXISTS as a real behavioral contract**, not whether the implementation matches. A published API contract is the strongest evidence a requirement exists — even if the code diverges. Use the Observed behavior / Normative contract fields to capture divergence between evidence types.

For externally observable behavior with only internal-hierarchy evidence types (`implementation-tested`, `documented-only`, `test-claimed`, `inferred`): set status to `needs_clarification` until external evidence is obtained.

### Test Quality Heuristic

**Behavior test → `tested`:** Exercises system through public boundary; asserts on externally observable outcomes; would still pass after a clean rewrite in a different language; does NOT mock the system-under-test.

**Implementation test → `implementation-tested`:** Asserts on internal method calls, mock interactions, or private state; would break if internals were rewritten even though behavior is preserved.

**Heuristic:** "If I rewrote this module in a completely different language with the same external contract, would this test still make sense?" Yes → behavior. No → implementation.

### Unknown vs None Discipline

When extracting, distinguish clearly:

| Value | Meaning |
|-------|---------|
| `unknown` | Not investigated or evidence missing — requires further extraction |
| `none_observed` | Looked but found no evidence — may still exist |
| `verified_none` | Directly verified absence through tests/runtime/code path analysis |
| `not_applicable` | Concept does not apply to this requirement |

Never confuse "I didn't find it" with "it doesn't exist." An agent that writes `Side effects: none` without investigation is hallucinating absence.

**`verified_none` citation requirement:** To mark any field as `verified_none`, you MUST cite the negative proof — e.g., "empty function body at `file:line`", "test asserts no side effects at `file:line`", or "exhaustive code path analysis shows no callers." Any `verified_none` without a specific citation is a framework violation. If you cannot cite proof of absence, use `none_observed`.

### Actual vs Normative Behavior

For each externally-observable requirement, capture both:

```
Observed behavior: <what the current system actually does>
Normative contract: <what docs/SLA/API contract say it should do>
Rewrite decision: preserve_actual | fix_to_contract | human_decision_required
```

When `Observed behavior` ≠ `Normative contract` for an externally-observable requirement: raise `[CONTRACT VS IMPLEMENTATION]` in the requirement's `Risk tags` field, set `Rewrite decision: human_decision_required`, and the marker appears in the review digest at blocking severity. The extractor does NOT silently "fix" behavior that clients may depend on.

### Known Bugs vs Requirements

```
Behavior classification: intended | accidental | known_bug | compatibility_required | deprecated | unclear
Preservation decision: preserve | fix | remove | human_decision_required
```

**Classification methodology — when to apply each:**

| Classification | Evidence Pattern |
|---|---|
| `intended` | Covered by a passing behavior test that asserts the outcome, OR documented in published contract |
| `accidental` | Reachable code with no test, no commit-history rationale, no documentation, no known consumers |
| `known_bug` | Referenced by an open ticket, TODO/FIXME/HACK comment, or commit message identifying it as broken |
| `compatibility_required` | Runtime-observed with active non-internal consumers depending on the behavior |
| `deprecated` | Annotated `@deprecated`, referenced in deprecation docs, or listed in sunset schedule |
| `unclear` | Default when none of the above patterns match — requires human decision |

**Default preservation mapping:**

| Classification | Default Preservation Decision |
|---|---|
| `intended` | `preserve` |
| `accidental` | `human_decision_required` |
| `known_bug` | `fix` (unless consumers depend on it → `human_decision_required`) |
| `compatibility_required` | `preserve` |
| `deprecated` | `human_decision_required` (removal is a product decision) |
| `unclear` | `human_decision_required` |

## Criticality Assignment

Every requirement must have a `Criticality` and `Criticality reason` field. Assignment methodology:

| Criticality | Evidence Pattern |
|---|---|
| `critical` | Touches money/payments, touches PII/credentials, in auth/authorization path, has named partner consumers with SLA, data loss possible if wrong, compliance-mandated |
| `high` | High traffic (> 1000 daily calls), fragile consumers (mobile apps with pinned versions), compliance-relevant but not mandated, security-adjacent |
| `medium` | Normal feature path, internal but customer-visible, moderate traffic, standard CRUD |
| `low` | Internal-only tooling, low usage, admin convenience, no external consumers |

**Criticality gates:**
- `critical`/`high`: Confirmation Rule 5 requires `tested`/`runtime-observed`/`contractual`/`characterized` confidence. Characterization tests are mandatory.
- `medium`: May proceed with `observed` confidence if all other confirmation rules pass.
- `low`: May proceed with `observed` confidence. Characterization tests are optional.

When in doubt, over-assign criticality. Downgrading later is cheap; missing a critical path is expensive.

## Confirmation Rules

A requirement may be set to `status: confirmed` only when ALL hold:

1. It has at least one `source_evidence` citation.
2. All mandatory contract fields for its layer are filled (not left blank).
3. Unknown-vs-none fields use explicit values (`unknown`, `none_observed`, `verified_none`, or `not_applicable`).
4. No unresolved contradiction affects it.
5. Critical/high-criticality requirements have `tested`, `runtime-observed`, `contractual`, or `characterized` confidence.
6. Requirements with confidence `inferred`, `documented-only`, or `test-claimed` CANNOT be `confirmed` without explicit human approval. They should remain `pending_human_input` until reviewed.

### Batch Approval for Convention-Based Requirements

Phase 3 (Convention Scanner) routinely produces many `inferred` requirements from framework conventions (auto-timestamps, soft deletes, CSRF, pagination defaults, etc.). Requiring per-item human approval for every convention would block exit criteria on any mature codebase.

Resolution: convention-sourced `inferred` requirements may be **batch-confirmed** when the human approves the convention itself:

1. Group all requirements sharing the same framework convention (e.g., "Rails auto-timestamps on all models").
2. Present the convention as a single review item: "Convention X applies to N requirements. Confirm all?"
3. If the human confirms the convention, all grouped requirements move to `confirmed` simultaneously.
4. If the human rejects or modifies the convention, individual requirements remain `pending_human_input`.

This satisfies Exit Criterion 2 without requiring N separate approvals for N instances of the same convention. Non-convention `inferred` requirements (those derived from naming patterns or indirect evidence) still require individual review.

Approved framework conventions are rebuild-critical implementation behavior. When reverse-spec output is curated into `specs_as_built/`, record approved conventions in `global-ubiquitous-language.md` or the owning component `README.md` so target-language implementers know which implicit framework behavior must be rebuilt explicitly.

### Failing Tests

Tests that are running and **failing** (not skipped, not quarantined) are signal:

- If the test asserts behavior that code contradicts → document both the test's claim and the code's behavior as a `[NEEDS CLARIFICATION]` with note "test failing: either known bug or stale test"
- If the test is marked as a known failure (e.g., `expected_failure`, `xfail`, `pending`) → treat as `test-claimed` with note citing the known-failure annotation
- If the failure is intermittent/flaky → treat as `test-claimed` with note "flaky"

Failing tests appear in the review digest under `[NEEDS CLARIFICATION]` with both possibilities documented (test wrong or code wrong). The human decides which to trust.

## Requirement Unit Definition

One requirement = one externally observable behavioral contract:
- One API endpoint's happy path + its failure matrix = one requirement
- One state transition with trigger and side effects = one requirement
- One business rule with enforcement and violation behavior = one requirement

"User can log in" is NOT one requirement — it expands to: password auth, MFA, lockout, session creation, remember-me, password reset. Each has a distinct contract, failure mode, and test surface.

## Execution Model

Extraction runs as a DAG of bounded passes, NOT one monolithic prompt:

```
Pass 1 (Core Logic) → artifact-1.md
Pass 2 (Data & Access) → artifact-2.md (reads artifact-1)
Pass 3 (Boundaries) → artifact-3.md (reads artifact-1, artifact-2)
Pass 4 (External) → artifact-4.md (reads artifact-1, artifact-2, artifact-3)
Pass 5 (Synthesis) → merged-spec.md (reads all artifacts)
```

Each pass produces a structured handoff artifact. Later passes consume earlier artifacts but do NOT re-extract what earlier passes already covered. If a later pass discovers something Pass 1 missed, it adds an `[AMENDMENT]` note that synthesis resolves.

**Handoff artifact structure:** Every `artifact-N.md` must include these sections (order may vary):
1. Requirements produced this pass (in the extraction-layers.md format)
2. Open questions discovered this pass
3. Amendments to prior artifacts (citing affected REQ IDs)
4. Risk tags/markers raised this pass
5. Entrypoints discovered or removed from the inventory

**Sub-chunking:** If any pass exceeds 30 requirements, split by logical category (e.g., by external system type, by module, by entrypoint group). Each sub-chunk produces a partial artifact; synthesis consumes the union.

Cap: 30 requirements per chunk before human review.

## Exit Criteria

Extraction is complete for a module when ALL hold:

1. Every entrypoint in inventory has at least one extracted requirement
2. Every requirement has `status: confirmed` (or explicitly `deprecated`/`likely_dead_code`)
3. Failure matrix exists for every state-changing endpoint
4. Access-control matrix row exists for every protected endpoint
5. Zero unresolved `[NEEDS CLARIFICATION]` markers
6. High-confidence threshold met (default 60% of requirements at `tested`/`runtime-observed`/`contractual`/`characterized` confidence — override via coordinator argument or human decision at synthesis checkpoint)
7. All blocking `[HUMAN DATA REQUEST]` items fulfilled or explicitly waived (see Waiver Format below)
8. Concurrency contracts documented for shared mutable state
9. Precision contracts documented for financial/measurement/accumulation logic
10. Characterization tests exist for critical paths
11. Coverage map produced and reviewed
12. Extraction manifest frozen

**Evaluation timing:** Exit criteria are evaluated after the synthesis-checkpoint human review, not before. Requirements awaiting batch approval (convention-sourced `inferred` per the Batch Approval mechanism) are tracked as `pending_human_input` in the coverage map and convert to `confirmed` upon convention approval. Exit criteria are met once all approvals (individual and batch) are complete.

If criteria cannot be met, document gaps in coverage map. Human decides whether to proceed.

### Waiver Format

When a blocking item is waived rather than fulfilled, record:

| Marker | Affected REQ(s) | Waiver Reason | Owner | Review Date | Risk Accepted |
|---|---|---|---|---|---|
| `[HUMAN DATA REQUEST]` | REQ-billing-003 | No dashboard access; verified behavior from tests instead | @eng-lead | 2026-06-01 | Billing config may drift |

Waivers appear in the review digest and coverage map. They are not silent — they represent explicit risk acceptance.

## Downstream Feedback Loop

When Software Architect, TDD, or Programmer discovers a behavioral question the spec doesn't answer:
1. File `[SPEC AMENDMENT REQUEST]` citing gap and implementation context
2. Return to reverse-spec extraction for that question — implementer does NOT invent the answer
3. Update requirement with new evidence
4. Re-verify exit criteria

## Output Template Precedence

The requirement format in `references/extraction-layers.md` is an intermediate extraction format. The Spec Agent transforms it into the active spec provider's canonical template. Precedence: provider template wins for final shape; extraction format wins during extraction and handoff.

## Specs-As-Built Output

Reverse-spec extraction produces two durable surfaces:

1. Raw evidence and intermediate artifacts under `<ADS_MEMORY_ROOT>/reports/reverse-spec/<run-or-module>/`
2. Curated current-state documentation under `<ADS_MEMORY_ROOT>/specs_as_built/`

The `specs_as_built/` surface is the readable rebuild/migration entrypoint. It summarizes the implemented system by current component, not by historical feature folder. Use:

```text
specs_as_built/
  dependency-graph.yaml
  components/<component>/
  changelog/<spec-id-or-run-id>-impact.md
  _meta/
```

Do not put dense function contracts in provider-native feature spec folders. Feature folders may contain a thin `as-built-impact.md` bridge that links to affected components and the immutable changelog entry.

Generated or hybrid specs-as-built artifacts should record stable language-agnostic IDs (`CMP-*`, `API-*`, `DATA-*`, `ERR-*`, `EFFECT-*`, `FUNC-*`) plus freshness metadata (`source_scope`, `source_fingerprint`, `last_verified_at`, `last_verified_commit`, `reverse_spec_run`) so migration traceability survives renames and `validate_specs_as_built_freshness.py` can detect stale docs after source changes.

### Normalization Safety Rule

The following fields MUST survive normalization regardless of provider template:

- `source_evidence`
- `confidence`
- `status`
- `risk_tags`
- `observed behavior`
- `normative contract`
- `rewrite decision`
- `behavior classification`
- `preservation decision`
- `criticality` and `criticality reason`
- `open questions`
- `compatibility risks`

If the active provider template has no field for any of these, preserve them in a `traceability` or `migration_metadata` block. The Spec Agent must not discard, rewrite, or weaken any of these during normalization.

## Guardrails

- **Never use framework-specific terms in requirement text.** Extract behavior, not implementation.
- **Never preserve implementation structure as requirements.** Concerns, mixins, decorators are not behavioral contracts.
- **Never infer behavior from naming alone.** Verify with tests, callers, or runtime evidence.
- **Always cite source evidence with exact file:line.** `tested` requires test citation + implementation. `observed` requires reachable code.
- **Always include status and risk tags per requirement.**
- **Always apply the unknown-vs-none discipline.** Never write "none" without investigation evidence.
- **Keep migration notes separate from contracts.**
- **Flag framework magic explicitly.** Name the convention so target team implements it explicitly.
- **Write approved framework magic into specs-as-built.** Batch-approved conventions belong in `global-ubiquitous-language.md` or the owning component `README.md`, not only in raw reverse-spec reports.
- **Bound scope.** > 30 source files OR > 15 routes/jobs OR > 3 top-level packages → split by module.
- **Do not extract dead code.** Check: static refs, route registration, runtime logs, tests, docs, owner confirmation.
- **Contradictions are blockers.** Produce `[NEEDS CLARIFICATION]`, never choose silently.
- **Preserve deprecated-but-active behavior.** Removal is a product decision.
- **Extract error behavior systematically.** Every entrypoint needs a failure matrix.
- **Extract transaction boundaries explicitly.** Atomicity is a behavioral requirement.
- **Do not invent evidence from inaccessible sources.** This applies to ALL passes, not just Phase 10. When a source isn't accessible (git history unavailable, no APM/runtime access, no read replica for data sampling, no dashboard access for external config), file `[HUMAN DATA REQUEST]` rather than guessing plausible values. Phase 10 has additional tool-gating specifics, but the principle is universal.

## Review Digest

All human-attention markers aggregate into ONE review surface ordered by blocking severity, grouped into tiers. The canonical tier definitions and ordering live in `references/pass-5-synthesis.md`. Summary:

**Blocking (must resolve before Software Architect proceeds):**
1. `[NEEDS CLARIFICATION]` — contradictions between sources
2. `[HUMAN DATA REQUEST]` (priority: blocking) — external data needed
3. `[CONTRACT VS IMPLEMENTATION]` — observed vs normative conflict on external behavior
4. `[DISTRIBUTED TRANSACTION RISK]` — cross-domain atomicity blocker

**Important (should resolve before implementation):**
5. `[CONCURRENCY CONTRACT]` — serialization requirements needing verification
6. `[PRECISION CONTRACT]` — numerical/string semantics needing verification
7. `[TEMPORAL COUPLING]` — ordering dependencies needing confirmation
8. `[ENVIRONMENTAL CONTRACT]` — OS/binary dependencies needing provisioning plan
9. `[DATA COMPATIBILITY]` — legacy data exceptions needing migration strategy
10. `[CUTOVER RISK]` — dual-write/cutover window needing operational plan

**Advisory (resolve during implementation or defer):**
11. `[UNTESTED SIDE EFFECT]` — side effects without test evidence
12. `[LIKELY DEAD CODE]` — candidates for removal pending owner confirmation
13. `[SPEC AMENDMENT REQUEST]` — downstream-discovered gaps
14. `[HUMAN DATA REQUEST]` (priority: nice-to-have) — non-blocking external data

### `[AMENDMENT]` Handling

When a later pass discovers behavior that an earlier pass missed, it adds an `[AMENDMENT]` note in its artifact referencing the affected requirement(s). During synthesis (Pass 5), amendments are merged into the unified spec — either updating an existing REQ with new evidence or creating a new REQ. The `[AMENDMENT]` tag is a pipeline-internal signal consumed by synthesis, NOT a human-facing review item. If an amendment creates a contradiction, synthesis promotes it to `[NEEDS CLARIFICATION]`.

The synthesis pass produces the review digest as a standalone artifact for the human checkpoint.
