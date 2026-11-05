---
name: refactor-patterns
version: 1.0.2
last_updated: 2026-07-23
description: Use when classifying tech debt, evaluating safe refactoring opportunities, proposing refactors without implementing them, or writing refactor proposals after code review.
---

# Skill: Refactor Patterns

Refactoring is the discipline of improving code structure without changing observable behavior. Every refactor leaves all tests green before and after. If tests break, it was not a refactor — it was a behavior change, and it belongs with the Programmer Agent.

The Refactor Agent proposes. The Coordinator triages. Not every refactor finding is a code problem — some reveal architectural mismatches or spec ambiguities. The Coordinator routes accordingly.

## When to Refactor vs When to Escalate

| Finding | Route |
|---|---|
| Duplicate logic within a module | Refactor Agent handles |
| Naming that doesn't match the domain | Refactor Agent handles |
| Function doing too many things | Refactor Agent handles |
| Logic that violates an architecture boundary | Escalate to Architect |
| Complexity that suggests a missing abstraction in the spec | Escalate to Spec Agent |
| Performance issue requiring algorithm change | Escalate to Programmer |

## Tech Debt Taxonomy

Classify every finding before proposing a fix. This determines priority and risk.

**Type A — Naming Drift**
Variable, function, or class names that no longer match what they do. Often happens when requirements change but code is patched rather than redesigned.

Signs: Functions named `handleData`, `processStuff`, `doThing`. Variables named `temp`, `result`, `data`. Classes whose names haven't kept pace with their expanded responsibilities.

Risk: Low. Safe to rename with IDE-wide refactoring.

---

**Type B — Duplication**
The same logic or structure copied across two or more places. The rule of three: duplication in two places is a warning, not a mandate — extracting at two sites regularly produces a helper parameterized by caller identity, which is worse than the duplication. Three or more places is a refactor unless a reviewer upholds a justification that the sites will diverge. Detection and gate logic live in `<AI_DEV_SHOP_ROOT>/harness-engineering/sensors/duplication.md`; note that an extraction which clears a clone finding while pushing the new helper past the cognitive-complexity gate has traded one finding for another, not improved the code.

Signs: Identical validation logic in multiple handlers. Same transformation applied to data in multiple services. Copy-pasted error handling blocks.

Risk: Low to medium. Extracting to a shared function requires verifying all call sites still behave identically.

---

**Type C — Oversized Unit**
A function, class, or module doing too many things. Single Responsibility Principle violations.

Signs: Functions over 40-50 lines. Classes with more than 5-7 public methods doing unrelated work. Files over 300-400 lines. Functions with more than 3 levels of nesting.

Risk: Medium. Splitting requires careful test coverage of the original before splitting, and verification that split pieces behave the same as the whole.

---

**Type D — Structural Mismatch**
Code whose structure doesn't match the architecture pattern the project uses. Often created when an agent took a shortcut.

Signs: Business logic in route handlers (violates layered/clean architecture). Direct database queries in service classes that should use repositories. Cross-module imports bypassing a module's public API.

Risk: Medium to high. Structural refactors often require changing multiple files and verifying integration points.

---

**Type E — Dead Code**
Code that cannot be reached or that is no longer called. Increases cognitive load with no benefit.

Signs: Unreachable branches after a return statement. Functions with no call sites (verify with IDE search + grep). Feature flag conditions whose flag is always true or always false. Commented-out code blocks older than one sprint.

Risk: Low. Delete it. If it was needed, git history has it.

---

**Type F — Complexity Debt**
Algorithmic or logical complexity that is higher than the problem requires. Often created by premature optimization or over-engineering.

Signs: Nested ternaries where a simple if-else would be clearer. Clever one-liners that require a comment to explain. Abstract base classes with a single implementation. Dependency injection containers for simple scripts.

Risk: Low to medium. Simplifying is usually safe if tests remain green.

## Refactor Proposal Format

Every proposal must include:

```
ID:           REF-001
Type:         B — Duplication
Priority:     Medium
Affected:     src/services/invoice-service.ts:45, src/services/order-service.ts:88

Finding:
Identical customer validation logic duplicated in InvoiceService and OrderService.
Any change to validation rules must be made in two places.

Proposed Fix:
Extract to shared CustomerValidator utility used by both services.
No behavior change — only consolidation.

Risk Assessment:
Low. Both implementations are identical (confirmed by diff). Extracting to a shared
function reduces risk by ensuring future changes apply everywhere.

Tests Required Before Refactor:
- Verify current test coverage on both duplicated paths (currently 87%)
- Add tests for any uncovered branches before refactoring

Estimated Blast Radius:
2 files directly. 0 architecture boundary changes. No contract changes.

Route Recommendation:
Programmer Agent to implement. TestRunner to verify green before and after.
```

## Refactoring Guardrails

**Chesterton's Fence.** Understand why code exists before removing it. Check git blame and surrounding context before simplifying — the apparent complexity may be a deliberate invariant, a workaround for a specific bug, or a constraint not visible in the code. If you can't explain why it's there, don't remove it yet.

**Rule of 500.** If a refactoring would touch more than 500 lines, invest in automation (codemods, AST transforms) rather than manual edits. When this threshold is crossed, load `references/rule-of-500.md` for codemod guidance and the over-simplification failure modes to avoid.

*Source: Addy Osmani / agent-skills / code-simplification*

## Rules of Safe Refactoring

1. **Tests must be green before you start.** Never refactor against failing tests.
2. **Tests must be green after you finish.** If any test fails, the refactor is not done.
3. **One refactor type at a time.** Do not rename AND restructure in the same change. Separate commits for separate concerns.
4. **Small steps.** Large refactors fail because they try to change too much at once. Break into increments, each of which leaves tests green.
5. **Never change behavior.** If the fix requires changing what the code does to make it cleaner, that is a Programmer task, not a Refactor task.
6. **Verify with the test suite, not by reading.** You cannot tell by reading code whether a refactor preserved behavior. Only the tests can tell you.

## Coverage Integrity During Refactoring

Apply
`<AI_DEV_SHOP_ROOT>/harness-engineering/quality/coverage-integrity-policy.md`.
Do not add coverage suppressions, narrow coverage scope, or remove defensive,
validation, compatibility, wire-format, or recovery behavior merely to improve
coverage. A refactor may strengthen structure and testability, but it must
preserve supported capabilities and observable contracts. If the intended
change alters behavior, route it through Spec/Architecture and Programmer
instead of labeling it a refactor.

## What Not to Refactor

- Code that is about to be deleted
- Code that has no test coverage (add tests first, then refactor) — **exception:**
  seam extraction on code classified `untestable coupling` or `dead code` from a
  Coordinator-supplied coverage-gap report is permitted before tests exist, per
  `<AI_DEV_SHOP_ROOT>/harness-engineering/quality/coverage-integrity-policy.md`
  and the Refactor Agent contract; this enables tests, it does not bypass the
  coverage rule
- Code in the middle of an active bug fix (complete the fix, then refactor)
- Code whose "messiness" is a deliberate temporary workaround tracked in `<ADS_MEMORY_ROOT>/knowledge/project_notes.md`
- Working code that is slightly inconsistent with your personal style preferences (style is not tech debt)
