---
name: testable-design-patterns
version: 1.4.0
last_updated: 2026-07-26
description: Use when designing or implementing micro-level code so test seams, contracts, and coverage-friendly boundaries stay easy to verify without fragile mocks.
---

# Skill: Testable Design Patterns (Micro-Level)

Apply this skill whenever writing or reviewing code internals that need strict testability constraints. This skill is the child layer on top of `coding-foundations`.

Do not wire this skill by itself. Any agent that loads `testable-design-patterns` must also load `coding-foundations` explicitly.

## Priority Model

1. Macro architecture first: boundaries, ownership, and contracts from ADR.
2. Coding foundations second: the shared baseline defined in `coding-foundations`.
3. Micro testability third: every unit inside those boundaries must be modular, composable, and easy to assert.

If macro and micro conflict, adjust the micro design while preserving macro boundaries. If the foundations and the testability constraints conflict, keep the testability constraint.

## Required Design Rules

1. Return assertion-friendly contracts: named fields and explicit actions.
2. Keep unit boundaries simple enough to test with focused fixtures and minimal mocks.
3. Treat hard-to-test code as a design defect.
4. Apply the anti-metric-gaming and narrow-exception rules in
   `<AI_DEV_SHOP_ROOT>/harness-engineering/quality/coverage-integrity-policy.md`.

## Parameter Convention (Required)

Use a two-object signature for exported functions:

- First parameter: required values object
- Second parameter: optional values object with defaults (`= {}`)

```typescript
export const evaluatePolicy = (
  { policy, context }: { policy: Policy; context: RequestContext },
  { now = new Date(), traceId }: { now?: Date; traceId?: string } = {},
): PolicyDecision => {
  // ...
};
```

## Contracts and Types

- Declare explicit return types for exported boundaries.
- Document public functions with TypeDoc/TSDoc (`@param`, `@returns`, and thrown errors when applicable).
- Keep return contracts stable; avoid ambiguous nested structures.

## Scope Boundary

This skill applies to any module containing decision logic, data transformation, or side effects — regardless of what architectural layer or pattern name it carries.

**UI / Presentation Layer Exemption:** Declarative markup (JSX/templates and the conditional-rendering expressions inside them) is exempt from the strict branch-extraction rules, complexity limits, and named-predicate requirements. Simple conditional rendering (`isLoaded && !error && <Component />`) stays inline. The exemption covers markup, not logic: event handlers, callbacks, and derived-value computations are not exempt because they sit in a component file. For React logic placement, see `<AI_DEV_SHOP_ROOT>/framework/operations/react-skill-operations.md` (React Component Rules). UI coverage is governed by the lower threshold in `<AI_DEV_SHOP_ROOT>/skills/test-design/SKILL.md` (70%+ line, or documented E2E coverage) — not by the stricter rules in this skill.

The risk-weighted coverage thresholds in `<AI_DEV_SHOP_ROOT>/skills/test-design/SKILL.md` and the scope rules here are co-designed: strict rules + high thresholds for logic-bearing code; lighter rules + lower thresholds for UI. Both must be applied together.

- Do not duplicate framework-specific composition rules here.

## Coverage-Friendly Design

The following rules apply to all in-scope modules (see Scope Boundary above). They exist to make branch, statement, function, and line coverage achievable without combinatorial test effort.

### Branch-Friendly
- Replace complex boolean chains with named predicate functions: `if (age >= 18 && hasAccount && !isSuspended)` becomes `if (isEligible(user))`.
- Use guard clauses for simple preconditions — do not extract every guard into a separate function. `if (!user) return null` stays inline.
- Reserve function extraction for complex multi-variable decisions, not single-condition checks.
- **Cognitive complexity** (Sonar definition) in any in-scope function has a review band and a refactor trigger; **the numbers live in `<AI_DEV_SHOP_ROOT>/harness-engineering/sensors/code-structure-quality.md` and are not restated here**. Cognitive complexity — not cyclomatic — is the gated metric, because it charges a `switch` once regardless of arm count and does not compound guard clauses. Cyclomatic complexity is reported as context only and is never on its own a Required finding.
  - **Why not cyclomatic:** this skill *mandates* exhaustive `switch` over discriminated unions with a `never` default (see Function-Coverage-Friendly below). A 14-variant exhaustive switch scores CC≈15 but cognitive≈1. Gating on CC would hard-fail a pattern this file requires, and every compliant escape is worse: splitting the switch destroys single-point exhaustiveness, and converting it to a handler map turns readable control flow into indirection.
  - **Delta rule:** a breach is Required only when the function is **new or the value increased** against the comparison base. Pre-existing functions above the band do not block unless worsened. Improving a legacy function without clearing the band is allowed and earns no positive credit.
  - Branch coverage cost grows roughly linearly with decision count — a 12-decision function needs on the order of 12 focused tests, not 2^12. Combinatorial effort is a property of *path* coverage, which is not gated here. So a breach is a prompt to look for mixed concerns, not proof of a design defect on its own.
  - The bands are **inherited and provisional, not ADS-calibrated.** Treat them as a starting point pending eval evidence. This gate's status is recorded in the registry, and while it is not `validated` its findings are capped at `RECOMMENDED` — see `<AI_DEV_SHOP_ROOT>/harness-engineering/quality/gate-validation-status.md`.
- Maximum nesting depth has a warn band and a refactor trigger, with the numbers in the sensor doc, not here. Nesting is the more actionable structural signal: it compounds the preconditions a reader and a test must hold simultaneously, and unlike raw CC it is not largely a restatement of function length. Flatten with guard clauses and early returns before reaching for extraction.
- Cognitive complexity and nesting are indicators that select functions for human or agent review. They do not by themselves establish that a function is bad, and **a passing value does not establish that it is good** — a clean metric removes a ceiling, it never earns credit.

### Statement / Line-Friendly
- No side effects in conditionals or ternaries: `const x = condition ? sideEffect() : value` is banned.
- No implicit fallthrough paths — every branch must resolve to an explicit return value or throw.
- Functions should be short enough that every statement is reachable by a focused test.
- **Function size (NLOC) is measured and reported on every changed function, and is never a gate.** There is no size threshold in this skill, and a large function is not on its own a Required finding, a Recommended finding, or a refactor trigger. It false-fires on declarative code — a long route table, config object, or validation schema is one long function with no branching and nothing wrong with it. Size is recorded because it changes how a gated result reads: cognitive 14 in 20 lines is dense logic, cognitive 14 in 300 lines is a function doing too many things, and the correct response differs. See `<AI_DEV_SHOP_ROOT>/harness-engineering/sensors/code-structure-quality.md`.

### Function-Coverage-Friendly
- Export pure decision helpers for core business rules so they can be unit-tested in isolation.
- Separate orchestration from business rules: orchestrators coordinate calls; business logic functions decide outcomes.
- Use exhaustive handling for discriminated unions: TypeScript `switch` on a union type must include a `default: const _exhaustive: never = value; throw new Error(...)` check so unhandled variants are compile errors and test signals.

### Test Seam Rules
- Every reachable, behavior-bearing non-trivial branch must be exercisable
  through an observable contract or injectable seam (parameter-injected
  dependency, not global access).
- Error paths must return typed outcomes or throw typed errors — no raw `Error` or opaque string messages at module boundaries.

### Third-Party SDK / Opaque Error Exception
When integrating third-party SDKs (AWS, Stripe, Twilio, etc.) that throw generic or untyped errors:
- Isolate the SDK call inside a single adapter function.
- Catch the opaque error at the adapter edge only.
- Map it to a typed internal error before it leaves the adapter.
- Business logic and orchestrators must never catch raw SDK errors directly.

This preserves the broad-catch ban for all internal code while providing a contained, testable pattern for opaque external boundaries.

---

## Coverage Anti-Patterns (Banned)

These patterns prevent achieving high branch/statement/function coverage and are banned in all in-scope modules (see Scope Boundary above).

| Anti-Pattern | Why It Kills Coverage | Correct Alternative |
|---|---|---|
| Broad `catch` without typed internal error contract | Error path is untestable — no specific outcome to assert | Adapter wraps SDK call; internal errors are typed and rethrown |
| Side effects inside conditional expressions or ternaries | Branch not isolable — side effect fires on evaluation | Extract side effect; use guard clause or named function |
| Dead defensive branches (`if (x) { /* should never happen */ }`) | Branch is unreachable in tests by definition | Assert at the owning boundary with a typed error; remove only when proven dead/out of scope, or use the documented narrow-exception contract |
| Business logic inside framework lifecycle wrappers | Logic trapped in `useEffect`, Express middleware, or Next.js data-fetching cannot be unit tested | Extract to pure function; lifecycle wrapper calls it |
| Complex boolean chain without named predicate | Branch intent is opaque; testing requires understanding the full chain | Extract to named predicate function |
| A cognitive-complexity or nesting breach on a **new or worsened** function, without an accepted justification | Test count scales with decision count; deep nesting compounds the preconditions each test must satisfy and signals mixed concerns | Flatten with guard clauses first, then extract decision logic into smaller, focused functions. Exhaustive union dispatch is the canonical accepted justification — see the justification hatch below |

---

## Refactor Triggers (Immediate)

Refactor when any of these appear:

- Functions with mixed concerns (business rule + side effect + formatting).
- Tests requiring excessive mocks or deep internal probing.
- A cognitive-complexity or nesting breach on a **new or worsened** in-scope function (see Scope Boundary above), without an accepted justification. Review-band values are review prompts, not automatic refactors. **The bands themselves are in the sensor doc.** Cyclomatic complexity is never on its own a refactor trigger.

## Justification Hatch

A breach of the cognitive-complexity or nesting trigger is resolved by **either**
a refactor **or** a documented justification naming the idiom that produces it.
Exhaustive union dispatch is the canonical accepted case.

The justification is itself a reviewable object: it is written by the author and
**upheld or rejected by the non-authoring reviewer**, never self-approved. This
hatch applies identically wherever the trigger appears in this file — the
Coverage-Friendly rules, the Coverage Anti-Patterns table, and the Refactor
Triggers list. One hatch, three statements of the same rule.

## Severity Is Fixed For Mechanical Findings

A metric breach detected by a tool carries a **fixed severity that a reviewing
agent may not downgrade**:

- a cognitive-complexity breach on a new or worsened function → **High**
- a nesting breach on a new or worsened function → **High**

Reviewers may add judgment findings at any severity, and may uphold a
justification to clear a mechanical finding, but may not relabel an unresolved
mechanical breach as Medium or Low to avoid a block. Without this rule the
findings regime has a one-word bypass.

## Test Mapping

- Pure logic -> unit tests (`__tests__/unit/*.unit.test.ts`)
- Boundary adapters (API/storage) -> integration tests (`__tests__/integration/*.integration.test.ts`)

## References

- `references/function-signature-patterns.md`
- `references/testability-patterns-example.md`
