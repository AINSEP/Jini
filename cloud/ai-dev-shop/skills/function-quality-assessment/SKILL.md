---
name: function-quality-assessment
version: 2.0.0
last_updated: 2026-07-26
description: Use when writing, reviewing, or refactoring logic-bearing functions so low-level function quality is assessed consistently with severity-graded findings, complexity notes, and clear pass/advisory/block routing. There is no numeric quality score.
---

# Skill: Function Quality Assessment

Apply this skill to every new or materially changed logic-bearing function.

This skill has two distinct jobs: a pre-coding Design Gate and a post-coding
Assessment Gate. It does not replace the source skills below; it turns their
rules into a per-function assessment with severity findings,
fix-before-handoff behavior, and review reporting.

Use it in two distinct modes:

- **Design Gate (before coding):** shape the function correctly from the start.
  This gate blocks coding when boundaries, seams, contracts, or scale risks are
  still implicit. Do not assign severity findings, dispositions, or pass/debt
  status here.
- **Assessment Gate (after coding):** assess the result, catch gaps, and decide
  whether the change can be handed off. This is the first stage where findings,
  dispositions, and block/pass classification apply.

## Design Gate

The Design Gate passes only when the current slice has an explicit function job,
signature shape, test seam, effect boundary, complexity/resource view, and any
required aggregate-risk note that another agent could implement or review
without guessing.

## Writing Posture

When writing a logic-bearing function:

1. Give the function one clear job. Keep validation, business rules, and
   orchestration separate unless the existing boundary is intentionally broader.
2. Prefer pure functions for rules, calculations, and transformations. Keep
   side effects at explicit boundaries.
3. Do not mutate input objects unless an in-place contract is required by the
   existing API and documented clearly.
4. Make important dependencies explicit. Do not hide behavior behind module
   state, environment reads, clocks, randomness, caches, or feature flags
   unless that dependency is intentional, controlled, and testable.
5. For exported or boundary functions, default to a required input object as
   the first parameter and an optional options object as the second parameter,
   unless compatibility or language convention justifies another shape.
6. Keep return shapes and error behavior stable. Do not mix unrelated failure
   signals such as booleans, strings, `null`, and thrown errors for the same
   kind of problem.
7. Decide the test seam before coding. If the function cannot be tested with
   direct inputs and direct assertions, redesign the boundary first.
8. Think about scale before coding. Identify complexity, query or I/O shape,
   resource bounds, idempotency needs, and concurrency risks for caller-
   controlled or unbounded input.
9. For rule, validation, batch, reducer, or cross-record workflows, name at
   least one aggregate or adversarial edge case before coding and add coverage
   for it before handoff.

## Source Skills

Use these as the source of truth for definitions:

- `<AI_DEV_SHOP_ROOT>/skills/coding-foundations/SKILL.md` — explicit dependencies, pure-by-default decisions, effect boundaries, stable contracts, fail-fast defaults, and small readable units
- `<AI_DEV_SHOP_ROOT>/skills/testable-design-patterns/SKILL.md` — two-object exported signatures, typed contracts, coverage-friendly branch design, test seams, typed error paths, and test anti-pattern bans
- `<AI_DEV_SHOP_ROOT>/skills/implementation-guardrails/SKILL.md` — complexity, scale, query shape, resource bounds, per-item I/O, and tradeoff notes
- `<AI_DEV_SHOP_ROOT>/skills/inline-code-documentation/SKILL.md` — language-idiomatic function documentation format

Use this companion when the workflow has aggregate or cross-item risk:

- `<AI_DEV_SHOP_ROOT>/skills/adversarial-test-design/SKILL.md` — adversarial cases, invariants, property-test fit, and direct-probe selection for workflows that can fail only across multiple records, retries, ordering changes, or partial failures

If this skill appears to conflict with a source skill, keep the source skill's
definition and use this skill only to assess, report, and route the result.

## Ownership

- Programmer applies this skill before and after implementation, fixes locally
  fixable findings, and documents the final disposition per assessment unit.
- Code Inspection validates the Programmer's assessment independently and records a
  Function Quality Assessment section in the saved code review report.
- Refactor uses failed assessment findings as targeted cleanup input.
- Coordinator sees only the routing summary: outcome, Critical/High count,
  blocked flag, and suggested next route.

## Scope

Assess:

- exported functions and public module boundaries
- workflow, orchestration, adapter, rule, validation, and transformation functions
- local helpers with meaningful branching, business logic, I/O, error handling,
  complexity, or reuse pressure

Tiny local helpers may be covered by the closest parent assessment when a full
comment would add noise. Do not use that exception for code that is hard to
test, hard to scale, security-sensitive, or likely to be reused.

Use assessment units, not raw function count. A tiny private helper may inherit
the nearest assessed parent only when it has no meaningful branching, I/O, error
handling, scale risk, security/privacy risk, or independent reuse pressure. If a
helper owns a rule, policy decision, data transformation, effect, error contract,
or complexity tradeoff, assess it directly.

## Programmer Procedure

Before coding a logic-bearing function (Design Gate):

1. State the function's single job and why it is the right boundary for the
   current slice.
2. Identify the function's required input object and optional options object,
   unless existing API compatibility or language convention justifies another
   shape.
3. Identify the test seam and expected assertions.
4. Decide whether the function should be pure decision logic or an explicit
   effect boundary.
5. Identify time complexity, space complexity, query/I/O shape, and resource
   bounds for caller-controlled or unbounded input.
6. If the workflow depends on multiple records, rules, retries, or ordering,
   activate `<AI_DEV_SHOP_ROOT>/skills/adversarial-test-design/SKILL.md` and
   name at least one invariant or adversarial case before coding.

After coding (Assessment Gate):

1. This is the first point where severity findings, dispositions, and
   pass/debt/block routing apply.
2. Apply the checklist in `references/checklist.md` to each assessment unit.
3. Refactor locally fixable findings before handoff.
4. Add or update language-idiomatic function documentation.
5. Include time and space complexity.
6. Include `@tradeoffs` or the language-equivalent section only when the
   tradeoff is meaningful.
7. Record the assessment unit's disposition in the handoff (not in source comments).
8. Include severity-graded findings for every issue found.
9. For rule engines, validators, batch processors, reducers, reconciliation
   logic, or any workflow where behavior depends on multiple records, add at
   least one adversarial aggregate/cross-item test or direct probe.
10. If a non-trivial change has every assessed unit at `NO_RECORDED_FINDINGS`,
    run a zero-findings skepticism pass before handoff. Re-check requirements,
    edge cases, scale, hidden dependencies, error paths, and test coverage. If
    every unit remains clean, state why in the handoff.
11. Report coverage metrics when a local coverage command is available. If
    coverage cannot be measured, say why and identify the direct tests that
    cover each assessed unit.

## Code Inspection Procedure

For every new or materially changed function in scope:

1. Confirm the Programmer assessment exists when required.
2. Confirm the Programmer handoff includes the compact assessment table.
3. Re-assess the function using the same checklist.
4. Compare finding sets: identify findings Code Inspection found that the
   Programmer's handoff omitted, by severity. Comparing content is harder to
   fabricate agreement on than comparing numbers.
5. Flag missing, omitted, or inconsistently severity-graded findings.
6. For non-trivial changes where every unit is `NO_RECORDED_FINDINGS`, verify
   that the Programmer performed and documented the zero-findings skepticism pass.
7. Check whether tiny helpers were over-documented or under-assessed. Treat
   over-documentation as Recommended cleanup unless it hides a required finding.
8. For rule, validation, batch, or reducer workflows, confirm at least one
   adversarial aggregate/cross-item behavior test or probe exists.
9. Classify findings using the thresholds below.
10. Add a Function Quality Assessment section to the saved code review report at
   `<ADS_MEMORY_ROOT>/reports/code-inspection/CR-<feature-id>-<YYYY-MM-DD>.md`.

Do not create a separate function-quality report by default. Code Inspection already
owns the retained review artifact; this assessment belongs inside that report.

## Findings And Blocking

There is no numeric quality score. Use `references/finding-rubric.md` as the
canonical severity rubric.

Scores were removed because the entity assigning the score is the entity that
wants to pass the gate, and an aggregate hid the misjudgment inside a sum. A
finding carries claim, location, consequence, and severity in one reviewable
unit, so a misgrading can be challenged from the record alone. That is an
**auditability** property, not an honesty property — findings are not inherently
more honest than scores, they are cheaper to check.

**Disposition per assessment unit:**

- `NO_RECORDED_FINDINGS` — neither mechanical checks nor semantic review found a
  problem. **This is not positive quality credit.** It establishes only that the
  checks that ran found nothing.
- `RECOMMENDED` — one or more non-blocking improvements, each naming a concrete
  change and its consequence.
- `REQUIRED` — at least one blocking finding.
- `INCONCLUSIVE` — required evidence is missing, stale, or internally
  inconsistent.

**Change-level routing:**

```text
required evidence invalid or unavailable  -> INCONCLUSIVE
else any REQUIRED finding                 -> BLOCKED
else any RECOMMENDED finding              -> PASS_WITH_ADVISORIES
else                                      -> PASS
```

Routing is driven by **disposition, not by counting severities.** Severity
describes impact; it does not decide the route. Count-based gating is score-based
gating in disguise — splitting one concern into two findings would block while
merging two root causes into one would not.

**Fixed severities for mechanical findings.** A breach detected by a tool carries
a severity that a reviewing agent may not downgrade (a cognitive-complexity or
nesting breach on a new or worsened function → `High`, Required unless a
justification is upheld). Reviewers may add judgment findings freely and may
uphold a justification to clear a mechanical finding, but may not relabel an
unresolved mechanical breach to avoid a block.

Existing specialised policies remain authoritative and are not weakened here — a
Critical or High security finding escalates per
`<AI_DEV_SHOP_ROOT>/framework/governance/escalation-policy.md`, and any path
violating a spec invariant is Required regardless of reviewer judgment.

**One local fix cycle** applies to an unresolved judgment-severity `High`. The
cycle must show concrete structural evidence: changed structure in the diff, a
progress-ledger entry, or a handoff-table note naming the attempted
extraction/restructuring/decomposition. Comments-only, formatting-only, or
rename-only changes do not satisfy it. If the finding survives the cycle, handoff
proceeds only with documented tech debt and Coordinator notification, and Code
Review must upgrade it to Required when the claimed fix cycle has no structural
evidence behind it.

**Zero-findings skepticism.** A non-trivial change reporting
`NO_RECORDED_FINDINGS` on every assessment unit requires a documented second
pass — re-check requirements, edge cases, aggregate behavior, hidden
dependencies, error paths, scale, coverage, and security. Under-reporting is the
cheapest possible output in a findings regime and is the failure mode that
replaces score inflation.

## Report Shape

Programmer handoff Style Notes must include:

- a compact function-quality table:
  `unit | disposition | findings (severity:tag:one-line) | local fix attempted`
- zero-findings skepticism result when every assessed unit is
  `NO_RECORDED_FINDINGS` in a non-trivial change
- assessed units with any finding
- Critical/High finding count
- any finding surviving the local fix cycle
- justified deviations from the two-object parameter convention
- adversarial aggregate/cross-item tests or probes added for rule, validation,
  batch, or reducer workflows
- coverage metrics, or the reason coverage could not be measured
- remaining complexity, scale, I/O, determinism, concurrency, security, or
  extensibility risks

Code Inspection report must include:

```text
## Function Quality Assessment

- Outcome: PASS | PASS_WITH_ADVISORIES | BLOCKED | INCONCLUSIVE
- Assessment units: <count>
- Mechanical checks: PASS | FAIL | NOT_AVAILABLE (<command, base..head>)
- Critical findings: <count>
- High findings: <count>
- Recommended findings: <count>
- Missing assessments: <count>
- Missing handoff-table evidence: <yes/no>
- Missing zero-findings skepticism evidence: <yes/no/n/a>
- Missing adversarial aggregate/cross-item evidence: <yes/no/n/a>
- Required fixes: <summary or none>
- Recommended refactors: <summary or none>
- Suggested Coordinator classification: IMPLEMENTATION_FIX_REQUIRED | TDD_RECERTIFICATION_REQUIRED | TEST_EVIDENCE_INVALID | COVERAGE_TRIAGE_REQUIRED | SPEC_REVISION_REVIEW_REQUIRED | REFACTOR_RECOMMENDED | SECURITY_REVIEW_REQUIRED | ARCHITECTURE_REVIEW_REQUIRED | HUMAN_REVIEW_REQUIRED | NONE
```

## References

- `references/checklist.md`
- `references/finding-rubric.md`
