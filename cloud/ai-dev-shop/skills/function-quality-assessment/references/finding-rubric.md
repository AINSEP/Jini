# Function Quality Finding Rubric

There is no numeric quality score. Every assessment unit resolves to a
**disposition**, derived from the findings recorded against it.

## Dispositions

- `NO_RECORDED_FINDINGS` — neither mechanical checks nor semantic review found a
  problem. **This is not positive quality credit.** It establishes only that the
  checks that ran found nothing. A clean metric removes a ceiling; it never earns
  points.
- `RECOMMENDED` — one or more non-blocking improvements.
- `REQUIRED` — at least one blocking finding.
- `INCONCLUSIVE` — required evidence missing, stale, or internally inconsistent.

## Change-level routing

```text
required evidence invalid or unavailable  -> INCONCLUSIVE
else any REQUIRED finding                 -> BLOCKED
else any RECOMMENDED finding              -> PASS_WITH_ADVISORIES
else                                      -> PASS
```

Routing keys on **disposition, not on severity counts.** Counting severities is
score-gating in disguise: splitting one concern into two findings would block
while merging two root causes into one would not.

## Severity Levels

Severity describes **impact**. It does not by itself decide the route.

- `Critical` — likely correctness, data loss, security, privacy, or outage risk.
- `High` — likely production bug, scale failure, hard-to-test behavior, or
  serious maintenance trap.
- `Medium` — maintainability, extensibility, or moderate test fragility risk.
- `Low` — naming, documentation, or small cleanup issue.

## Fixed Severities For Mechanical Findings

A finding produced by a tool carries a fixed severity that a reviewing agent
**may not downgrade**.

**Severity and disposition are separate axes.** The severities below are fixed.
The *dispositions* below apply at `validated` gate status; while a gate is
`unvalidated` per
`<AI_DEV_SHOP_ROOT>/harness-engineering/quality/gate-validation-status.md`, its
`REQUIRED` dispositions are capped at `RECOMMENDED` — the finding is still real
and still carries its stated severity, it just does not block.

**Canonical integrity findings (`INT-1`…`INT-9`) are never capped**, and that
list is **closed**: a sensor may not declare a local exemption from the cap. If
something needs to be uncappable, it is added to the registry first and
referenced by ID.

Read the registry before classifying; do not assume a gate blocks because this
table says `REQUIRED` — the registry owns each gate's status and this file
deliberately does not restate it.

| Mechanical finding | Severity | Disposition |
|---|---|---|
| Cognitive complexity breach on a new or worsened function | `High` | `REQUIRED` unless a justification is upheld |
| Nesting depth breach on a new or worsened function | `High` | `REQUIRED` unless a justification is upheld |
| New dependency cycle or `blocking` boundary violation in changed scope | `High` | `REQUIRED` unless a justification is upheld |
| New Tier A unsafe type operation in changed code | `High` | `REQUIRED` unless a justification is upheld |
| Changed-code branch coverage below floor, or a changed file at 0% | `High` | `REQUIRED` unless a justification is upheld |
| Clone group growth past the rule of three in changed scope | `Medium` | `REQUIRED` unless a justification is upheld |
| New Tier B unsafe type operation (local `any`, `!`, single `as T`) | `Medium` | `RECOMMENDED` |
| `INT-1` — compiler or lint strictness weakened without recorded approval | `High` | `REQUIRED` — never capped |
| `INT-2` — **any** declared threshold, scope, or exclusion loosened, either where it affects an observed finding or at any time without recorded approval | `High` | `REQUIRED` — never capped |
| `INT-3` — an `architecture-fitness` rule's `Severity` downgraded without approval | `High` | `REQUIRED` — never capped |
| `INT-4` — suppression comment added over an existing violation and reported as a fix | `High` | `REQUIRED` — never capped |
| `INT-5` — test deleted, renamed, or skipped so its source leaves a measured scope | `High` | `REQUIRED` — never capped |
| `INT-6` — no-op perturbation moving code across a detector's classification boundary | `High` | `REQUIRED` — never capped |
| `INT-7` — a metric value reported with no authoritative run behind it, or under the wrong field | `High` | `REQUIRED` — never capped |
| `INT-8` — an unverified or detector-inactive zero reported as `PASS` | `High` | `REQUIRED` — never capped |
| `INT-9` — a changed test executes behaviour it does not verify (assertions weakened, removed, or absent from birth) | `High` | `REQUIRED` — never capped |

A coverage-integrity violation is uncapped **only** when it instantiates one of
the IDs above — in practice `INT-2` (exclusions, ignore directives, lowered
gates), `INT-5` (tests removed from scope), or `INT-9` (assertions gutted). An
earlier draft carried a catch-all row that pulled the entire coverage-integrity
policy in by reference, which silently reopened the closed set: every
judgment-laden prohibition in that policy became an unenumerated exemption, which
is exactly what closing the list was meant to prevent. Coverage-integrity
findings that map to no ID are ordinary findings and are capped like any other.

Two mechanical metrics are **reported and never gated** — cyclomatic complexity
and function size (NLOC). A large value in either is not a finding at any
severity, and one must not be synthesized from it. They exist to change how a
gated result reads, not to produce verdicts of their own.

A mechanical result of zero or clean **earns no credit**. It establishes that the
detector found nothing; it never adds quality. A zero produced by a detector that
was never active is `INCONCLUSIVE`, not a pass.

Reviewers may add judgment findings at any severity and may uphold a
justification to clear a mechanical finding. They may **not** relabel an
unresolved mechanical breach to a lower severity to avoid a block. Without this
rule the findings regime has a one-word bypass.

Existing specialised policies remain authoritative and are not weakened here: a
Critical or High security finding escalates per
`<AI_DEV_SHOP_ROOT>/framework/governance/escalation-policy.md`, and any path
violating a spec invariant is Required regardless of reviewer judgment.

## Finding Shape

Every finding must carry enough structure to be compared across two independent
assessments. Free-text paraphrases are not a comparable set.

```text
assessment_unit   - the function or unit assessed
category_tag      - routing tag (see below); routes work, never gates it
location          - file and line
observed          - what the code actually does
violated_contract - the rule, invariant, or convention breached
consequence       - what goes wrong, concretely
severity          - Critical | High | Medium | Low
disposition       - REQUIRED | RECOMMENDED
```

A `RECOMMENDED` finding must name a concrete improvement **and** its consequence.
If neither can be stated, mediocrity has not been established and no finding
should be recorded.

## Category Tags

Tags route work to the right owner. **They gate nothing** — a mis-filed tag
mis-routes a suggestion; it cannot mis-block a merge.

| Tag | Routes to |
|---|---|
| `contract-and-boundary` | Programmer / Architect |
| `effects-and-determinism` | Programmer |
| `structure` | Refactor |
| `test-seam-and-evidence` | TDD |
| `scale-and-resources` | Programmer |
| `safety-and-privacy` | Security |

These are deliberately named differently from the six review dimensions in
`<AI_DEV_SHOP_ROOT>/skills/code-inspection/SKILL.md` (spec alignment, architecture
adherence, test quality, code quality, security, non-functional). They are not
the same list and must never be conflated.

## Calibration Rules

- Do not record `NO_RECORDED_FINDINGS` when a known finding remains.
- A non-trivial change with every unit at `NO_RECORDED_FINDINGS` requires a
  documented zero-findings skepticism pass. Under-reporting is the cheapest
  possible output in a findings regime and is the failure mode that replaces
  score inflation.
- A passing test suite is not sufficient evidence for a clean disposition when
  coverage, adversarial cases, or cross-record behavior are missing.
- If a finding comes from a unit owning too much, name the extraction that would
  resolve it.
- The Programmer/Code Inspection cross-check is a **finding-set diff** — the findings
  Code Inspection recorded that the Programmer's handoff omitted, by severity.
  Comparing content is harder to fabricate agreement on than comparing numbers.
  Code Inspection must flag any omission at `High` or above.
