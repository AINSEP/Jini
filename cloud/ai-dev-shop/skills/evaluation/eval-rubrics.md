# Skill: Evaluation Rubrics

Per-agent scoring rubrics and judge prompt templates. Used by the Observer for LLM-as-judge evaluation passes and benchmark regression detection.

**Scoring scale:** 0–10. A 7 means genuinely good. A 10 means exemplary and rare. A 5 is barely acceptable. Below 5 is a regression.

---

## Spec Agent Rubric

| Dimension | What to Score | Weight |
|-----------|--------------|--------|
| Completeness | Every FR and NFR from the user's request is addressed. No requirement is silently dropped. | 25% |
| Testability | Each AC can be verified with a specific, deterministic assertion. No "should feel fast" or "user-friendly." | 30% |
| Clarity | No vague language. No "may," "could," "should consider." Every requirement is a definitive statement. | 25% |
| Boundary Coverage | Edge cases, error paths, and failure modes are explicitly specified, not implied. | 20% |

**Spec Agent Judge Prompt:**
```
You are evaluating a Spec Agent output for a spec-driven software pipeline.

User request: [INPUT]
Spec output: [OUTPUT]

Score each dimension 0-10. Be critical — a 7 means genuinely good work.

Dimensions:
- Completeness (25%): Does the spec address every requirement in the user request?
- Testability (30%): Can each AC be verified with a specific, deterministic assertion?
- Clarity (25%): Is every statement definitive? Flag any vague language.
- Boundary Coverage (20%): Are edge cases, error paths, and failure modes explicit?

Return:
- Score per dimension
- Weighted overall score
- One sentence identifying the biggest weakness
```

---

## Software Architect Agent Rubric

| Dimension | What to Score | Weight |
|-----------|--------------|--------|
| Pattern Fit | Selected pattern matches the spec's system drivers (complexity, scale, coupling). | 25% |
| Boundary Clarity | Module/service boundaries are unambiguous. No overlapping ownership. | 20% |
| Contract Completeness | All API and event contracts are specified with enough detail for TDD to derive tests. | 20% |
| Constitution Compliance | Constitution Check table is complete. All EXCEPTION entries have Complexity Justification rows. | 20% |
| Justification Quality | Rationale maps decisions to drivers. Alternatives are addressed with specific rejection reasons. | 15% |

**Software Architect Agent Judge Prompt:**
```
You are evaluating an Software Architect Agent ADR output for a spec-driven pipeline with a project constitution.

Spec: [SPEC_SUMMARY]
Constitution articles: Library-First, Test-First, Simplicity Gate, Anti-Abstraction Gate, Integration-First Testing, Security-by-Default, Spec Integrity, Observability
ADR output: [OUTPUT]

Score each dimension 0-10:
- Pattern Fit (25%): Does the selected pattern match the system drivers?
- Boundary Clarity (20%): Are module boundaries unambiguous with no ownership overlap?
- Contract Completeness (20%): Are all API/event contracts specified precisely enough for test design?
- Constitution Compliance (20%): Is the Constitution Check table complete? Are all exceptions justified?
- Justification Quality (15%): Are decisions mapped to drivers? Are alternatives specifically addressed?

Return: score per dimension, weighted overall, biggest weakness.
```

---

## TDD Agent Rubric

| Dimension | What to Score | Weight |
|-----------|--------------|--------|
| AC Coverage | Every acceptance criterion has at least one test. No AC is untested without an explicit gap entry. | 35% |
| Integration-First | Integration tests exist for boundary contracts. Unit tests cover invariants. Ratio is appropriate to spec risk. | 25% |
| Assertion Quality | Assertions test behavior, not implementation internals. Failure messages are descriptive. | 25% |
| Certification Linkage | Every test traces to an AC or invariant. No orphan tests. Spec hash is recorded. | 15% |

**TDD Agent Judge Prompt:**
```
You are evaluating a TDD Agent test suite output.

Spec: [SPEC_SUMMARY]
Test suite: [OUTPUT]

Score each dimension 0-10:
- AC Coverage (35%): Does every AC have at least one test?
- Integration-First (25%): Are integration tests prioritized for boundary contracts?
- Assertion Quality (25%): Do assertions test behavior, not internals? Are failure messages clear?
- Certification Linkage (15%): Does every test trace to a spec requirement?

Return: score per dimension, weighted overall, biggest weakness.
```

---

## Programmer Agent Rubric

| Dimension | What to Score | Weight |
|-----------|--------------|--------|
| Spec Alignment | Implementation matches spec requirements. No behavior that contradicts an AC. | 35% |
| Minimal Change | No changes outside the assigned scope. No speculative refactoring or extra features. | 25% |
| Test Pass Rate | Percentage of certified tests passing. (0=0%, 10=100%) | 25% |
| Software Architecture Compliance | Module boundaries respected. No imports that violate ADR layer rules. | 15% |

---

## Code Inspection Agent Rubric

| Dimension | What to Score | Weight |
|-----------|--------------|--------|
| Finding Precision | Each finding has a specific location, concrete evidence, and clear impact. No vague findings. | 40% |
| Classification Accuracy | Required vs Recommended classification is correct and consistently applied. | 30% |
| Coverage | Review covers spec alignment, architecture, test quality, security surface, and non-functional characteristics. | 30% |

---

## Security Agent Rubric

| Dimension | What to Score | Weight |
|-----------|--------------|--------|
| Threat Coverage | Auth/authz, input validation, sensitive data flows, and business logic abuse are all addressed. | 40% |
| Finding Specificity | Each finding includes an exploit scenario, not just a category label. | 35% |
| Severity Accuracy | Critical/High/Medium/Low classifications are calibrated and consistent. | 25% |

---

## Release Gate

| Condition | Action |
|-----------|--------|
| Any dimension drops > 1.0 vs baseline after a skills.md change | Regression — revert or fix before shipping |
| Overall weighted average drops > 0.5 vs baseline | Regression |
| Any dimension scores below 5.0 | Regression regardless of baseline |
| First-time benchmark (no baseline) | Record score as new baseline, no gate applied |

---

## Observer Responsibilities

- After each pipeline run, run a judge pass on the Spec Agent output (highest value; most common failure point)
- Weekly: run judge passes on all agent outputs from that week's features
- Record each pass as a `[QUALITY]` entry in `<ADS_MEMORY_ROOT>/knowledge/memory-store.md`
- Flag regressions to the Coordinator immediately
- Track constitution compliance scores separately — a declining trend on Software Architect's Constitution Compliance dimension signals ADR template or constitution clarity issues
