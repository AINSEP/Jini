---
name: test-design
version: 1.2.0
last_updated: 2026-10-25
description: Use when designing tests, building requirement-to-test matrices, selecting test types, certifying test coverage against a spec, or detecting test drift after spec changes.
---

# Skill: Test Design

Tests in this system are not just verification — they are a second encoding of the spec. The TDD Agent's job is not to check that code works; it is to translate each requirement, invariant, and edge case into an executable assertion before any implementation exists. Tests are the spec made runnable.

Keep this file lean. Open references only when you need deeper implementation guidance:

- `references/contract-testing.md` for ADR-boundary contract testing patterns and certification examples
- `references/property-based-testing.md` for invariant-driven test generation and library guidance

## The Two Roles Tests Play

**Specification role (TDD Agent)**: Write tests before code. Each test is a precise statement of what the system must do, derived directly from the spec. Tests are written against a specific spec version and hash — they certify what they were written against.

**Verification role (TestRunner Agent)**: Execute tests after implementation. Report pass/fail evidence. Identify failure clusters. Route results to Coordinator.

These are distinct jobs. The TDD Agent does not run tests against finished code. The TestRunner Agent does not write new tests.

## TDD Execution Mechanics (Mandatory)

Use strict red-green-refactor execution for every behavior slice.

1. **Red first**: write one failing test before any production code.
2. **Verify red**: confirm it fails for the expected reason (missing behavior), not for setup/typo errors.
3. **Green minimal**: implement the smallest change that makes the test pass.
4. **Verify green**: run the targeted test, then run impacted suites.
5. **Refactor after green only**: cleanup is allowed only while tests stay green.

Hard rules:
- No production code without a failing test first.
- If a new test passes on the first run, it is not proving new behavior; tighten or rewrite the test.
- Do not batch multiple behavior changes in one red-green loop.

## Requirement-to-Test Matrix

Before writing a single test, build the matrix:

| Spec Ref | Type | Test Description | Priority |
|---|---|---|---|
| REQ-01 | Acceptance | Invoice creation p99 latency ≤ 500ms under 100 concurrent requests | High |
| REQ-02 | Acceptance | 422 + CUSTOMER_NOT_FOUND when customer ID does not exist | High |
| INV-01 | Invariant | Invoice total always equals sum of line item subtotals | High |
| INV-02 | Invariant | Paid invoice cannot transition to pending | High |
| EC-01 | Edge Case | Line item with quantity 0 is rejected with validation error | Medium |
| EC-02 | Edge Case | Duplicate submission with same idempotency key returns original, not duplicate | High |

Every requirement must have at least one test. Every test must trace to a requirement. No orphan tests. No untested requirements.

## Test Types and When to Use Each

**Unit Tests**
- Target: single function, class, or module in isolation
- Cover: logic invariants, computation correctness, state transitions
- Mock: all external dependencies
- Priority: invariants first, then core business logic
- Goal: fast, deterministic, no I/O

**Integration Tests**
- Target: boundary contracts between modules or services
- Cover: API contracts, database interactions, event publishing/consuming
- Mock: third-party external services only (not internal boundaries)
- Priority: high-risk integration points, auth flows, data persistence
- Goal: verify modules work together as specified

**Regression Tests**
- Target: previously failing behavior that was fixed
- Cover: exact scenario that caused the failure
- Never delete: regression tests are permanent guards
- Add immediately when a bug is found, before fixing

**Acceptance Tests**
- Target: user-visible behavior from the outside
- Cover: acceptance criteria in the spec, happy path + critical failures
- Written in behavior terms, not implementation terms
- These are what the Convergence Threshold is measured against

## Test Directory Convention (Required)

Place tests in type-specific directories:

- Unit tests: `__tests__/unit/`
- Integration tests: `__tests__/integration/`
- E2E tests: `__tests__/e2e/`

Examples:

- `__tests__/unit/req-001.submit-order.unit.test.ts`
- `__tests__/integration/req-004.model-selection.integration.test.ts`
- `__tests__/e2e/chat-sidebar.e2e.test.ts`

If a repository has an approved existing convention that differs, the override must be documented in `<ADS_MEMORY_ROOT>/knowledge/project_memory.md` and referenced in the certification output. Without an explicit override, this directory rule is mandatory.

## Test File Naming Convention (Required)

Use explicit test-type suffixes in filenames:

- Unit tests: `*.unit.test.ts`
- Integration tests (including internal contract/integration boundary checks): `*.integration.test.ts`
- E2E/browser tests: `*.e2e.test.ts`

Examples:

- `req-001.submit-order.unit.test.ts`
- `req-004.model-selection.integration.test.ts`
- `chat-sidebar.e2e.test.ts`

If a repository has an approved existing convention that differs, the override must be documented in `<ADS_MEMORY_ROOT>/knowledge/project_memory.md` and referenced in the certification output. Without an explicit override, this naming rule is mandatory.

## Test Certification Protocol

Every test suite must include a certification record. This is the mechanism that prevents "green tests, wrong behavior." Use `<AI_DEV_SHOP_ROOT>/framework/templates/test-certification-template.md` as the starting point.

```
# Test Certification
Spec ID:      SPEC-001
Spec Version: 1.2
Spec Hash:    sha256:<hash>
Certified by: TDD Agent
Certified at: 2026-02-21T15:00:00Z
Coverage gaps: EC-03 (currency conversion failure) — deferred, awaiting product decision
```

The spec hash in the certification must match the hash in the spec file. CI enforces this. If the spec changes and the hash changes, all tests certified against the old hash are flagged as stale and require recertification before the next merge.

The certification must also include a sha256 hash for every created or changed
test file plus the expected runnable test count. TestRunner uses this inventory
to detect deleted assertions, modified tests, stale files, and empty-suite
success before it executes the suite.

## Coverage Targets

### Coverage Integrity (Canonical)

Apply
`<AI_DEV_SHOP_ROOT>/harness-engineering/quality/coverage-integrity-policy.md`.
Coverage gates must be met by exercising behavior through real seams, not by
weakening tests, production behavior, contracts, or coverage scope. Any narrow
exception must satisfy that policy's evidence and approval contract.

### Coverage Terminology

- **Big Four**: `% Stmts | % Branch | % Funcs | % Lines` (in this exact order)
- **Big Five**: Big Four + `Uncovered Line #s`

### Hard Coverage Gates (non-negotiable; takes precedence over all other coverage guidance)

The following suite-level gates are mandatory and evaluated per metric, not as an average:

- **Unit test coverage:** `lines >= 98%`, `branches >= 98%`, `functions >= 98%`, `statements >= 98%`
- **Integration test coverage:** `lines >= 90%`, `branches >= 90%`, `functions >= 90%`, `statements >= 90%`
- **E2E test coverage:** `lines >= 80%`, `branches >= 80%`, `functions >= 80%`, `statements >= 80%`

If any one metric is below its gate, coverage is considered failing.

If a suite is marked required in `tasks.md`, a missing coverage artifact for
that suite is a hard failure. If a suite is marked not applicable with a reason,
do not apply that suite's gate.

### Coverage Profile Initialization (configurable with safe defaults)

At pipeline start, Coordinator should ask the human whether to keep defaults or set custom minimums for each suite across all four metrics (lines, branches, functions, statements).

- Default Unit minimums: `98/98/98/98`
- Default Integration minimums: `90/90/90/90`
- Default E2E minimums: `80/80/80/80`

If no custom profile is provided, defaults apply automatically. Persist the active profile in `tasks.md` constraints and reference it in TestRunner output.

### Uncovered Lines Policy

- Target state is **no uncovered lines** in changed or high-priority runtime code paths.
- If uncovered lines remain, they require explicit written justification before stopping the cycle.
- Acceptable justifications are limited to concrete technical constraints (for example: unreachable defensive branch tied to runtime/environment, vendor boundary that cannot be deterministically simulated, or deprecated path pending approved removal).
- Any justification that relies on a narrow-exception category (generated/vendor
  code, compiler-proven unreachable defense, runtime/environment-only path, or
  deprecated path pending approved removal) must satisfy the evidence and
  **human-approval** contract in
  `<AI_DEV_SHOP_ROOT>/harness-engineering/quality/coverage-integrity-policy.md`.
  A specialist may recommend such a justification but may not self-approve it.
- "Not enough time" or "too hard to test" are not valid justifications.

Coverage targets are risk-weighted by module class. Apply the correct threshold based on what the file does, not where it lives in the directory tree.

**Relationship between suite gates and module-class thresholds:** The hard suite
gates above are aggregate minimums across all files in that suite's scope. The
module-class table below defines per-file priority targets for gap triage and
risk classification. Module-class thresholds do not lower the suite gate. If the
default suite gate is impractical for a project, the Coordinator must record a
human-approved coverage profile override in `tasks.md` before TestRunner uses
it.

| Module Class | Examples | Line Coverage | Branch Coverage |
|---|---|---|---|
| Core business logic | Domain services, calculation engines, validators, state machines | 95%+ | 90%+ |
| API adapters / controllers | HTTP handlers, event consumers, queue processors | 90%+ | 85%+ |
| Orchestrators | Use-case orchestrators, pipeline controllers | 85%+ | 80%+ |
| Infrastructure adapters | Repositories, DB clients, external API clients | 80%+ | 75%+ |
| View / UI components | React components, templates, presentational-only code | 70%+ OR documented E2E coverage | — |
| Configuration / type definitions | Constants, enums, pure type files, interface-only files | Exempt | Exempt |

**Touched-file non-regression rule:** Once a file reaches its threshold, a subsequent change to that file cannot drop coverage below that threshold. A PR that regresses a file must either add tests through Coordinator-owned routing or explicitly document the regression justification in the certification record.

**Project-level override:** If the risk profile of a project justifies globally higher or lower thresholds (e.g., a payment processor requiring 100% branch coverage on business logic, or a prototype where 70% is acceptable across the board), document the override in `<ADS_MEMORY_ROOT>/knowledge/project_memory.md` and reference it in the test certification record. Without a documented override, the table above governs.

**Integration and acceptance coverage (non-negotiable regardless of module class):**
- All public API contracts and database boundaries: covered by integration tests
- All acceptance criteria in the spec: covered by acceptance tests
- All concrete edge cases listed in the spec: covered by explicit scenario tests

**Blocking rule takes precedence:** failing any hard coverage gate (unit/integration/e2e) blocks progression to Code Inspection. High-priority gaps in core business logic or API adapters also block progression regardless of module-class discretion. In all cases, uncovered requirements and uncovered lines must be explicitly listed with rationale in the certification record.

## Writing Good Assertions

**Behavior-level, not implementation-level**
Bad: `expect(invoiceService._calculateTotal).toHaveBeenCalled()`
Good: `expect(invoice.total).toBe(150.00)`

**Clear failure messages**
Bad: `expect(result).toBe(true)`
Good: `expect(result.status).toBe('422'), 'Expected 422 when customer does not exist'`

**Deterministic**
No timing-dependent assertions (`setTimeout`, `Date.now()` without mocking). No assertions that depend on ordering of unordered collections. No assertions that depend on external network calls without mocking.

**Grouped by requirement**
```
describe('REQ-02: Invalid customer ID', () => {
  it('returns 422 when customer does not exist', ...)
  it('includes CUSTOMER_NOT_FOUND error code in response body', ...)
  it('does not create a partial invoice record on failure', ...)
})
```

## Mutation-Derived Input Rules

These rules come from a 2026-10-25 mutation run across two TypeScript monorepos (~16k surviving mutants). Almost every survivor was a missing assertion, not a source bug: the code was right, and no test would have noticed it going wrong. Each rule names the input cases that kill the matching mutants. An F-ID points to `<AI_DEV_SHOP_ROOT>/skills/adversarial-test-design/references/testing-mistakes.md`, which explains the underlying mistake; this section adds only the input cases.

- **AP1 Bare-failure assertion** (F1.2). The negative test checks only *that* the call failed. Assert the error class **and** its code. For HTTP, assert the status **and** the body's error code. For a user-visible message, also assert a stable phrase. A bare `toThrow()` or `ok: false` is a review reject.
- **AP2 Singleton collections** (F4.3). Collection code is tested with 0–1 items or already-sorted input, so `some`↔`every`, a dropped sort and a flipped tie-break survive (`redirectUris.some(...)` → `every` survives when every test client has one URI). Use at least 3 items, with the one bad item first, then in the middle, then last, each as its own case. For order-dependent output, feed reverse-sorted input plus one equal-key tie with a stated expected order.
- **AP3 Type-blind validators** (F6.2). Type guards (`typeof x === 'string'`, `isRecord`, `Number.isFinite`, `err.code === 'ENOENT'`) never receive the wrong type, so mutating them to `true` survives. Run one shared `HOSTILE` table through every validator and parser. Each value must produce the documented rejection, never a `TypeError`.

  | Always | Shape swaps | Error helpers also get |
  |---|---|---|
  | `undefined`, `null`, `[]`, `{}`, `0`, `NaN`, `Infinity`, `""`, `"  "`, `true` | a string where an object is expected; an object where a string is expected | an `EACCES` error; a thrown string (and optionally other non-`Error` values) |

- **AP4 Happy-string regex**. A regex is tested with one or two valid strings, so its anchors, quantifiers, classes and alternations are never pinned (dropping `^` from `/^[a-z0-9-]+$/` survives). Write one `it.each` table per regex covering:
  - shortest valid, longest valid, max+1, and empty;
  - leading, trailing (`"ok\n"`, `"ok!"`) and embedded junk;
  - wrong case;
  - each alternation branch;
  - each quantifier at 0, 1 and 2 repeats.

  Host, origin and path regexes also get `evil.<allowed>`, `<allowed>.evil.com`, and an extra leading or trailing path segment.
- **AP5 Unasserted declarative contracts**. Declared data (input schemas, `required`, `additionalProperties`, permission names, annotations, manifests) can become `{}`, `[]` or `true` and nothing fails. Write one contract test per registry: for each entry, `toEqual` the full declaration against an **inline** expected literal, not a regenerated snapshot. Then validate one good input and one input with an extra key.
- **AP6 Unpinned security defaults**. Default-deny values (deny-private-address flags, allowed-scheme lists, `allowedOrigins ?? []`, capability grants, privacy defaults, secret-file modes) can flip silently. Pin every exported policy or default object with `toEqual` against the full literal. Add one behavioural refusal per deny flag: private IP refused, `http:` refused, `data:` blocked, unknown origin rejected.
- **AP7 Security guard with no negative test** (F6.2). An authn, authz, ownership, containment or token check runs only on its allow path. Write its deny tests **first**: unauthenticated, wrong token, wrong owner/principal/tenant, and path escape. Each asserts the specific denial (AP1). In review, for every `throw` or 401/403/404 inside a guard, name the test that triggers it.
- **AP8 Whole-guard negatives** (F4.4). A compound guard (`a || b || c`) is tested only with inputs that break several clauses at once, so each operand set to `false` and every `||`↔`&&` swap survive. Start from one fully valid input. Write one case per clause that breaks **only** that clause (`{ ...valid, field: bad }`), plus the all-valid allow case.
- **AP9 Limit tested without limit±1** (F6.2). Size, count, length and time limits are tested far from the edge, so `>`↔`>=` and `+1`↔`-1` survive. Generate `limit-1`, `limit` and `limit+1` from one helper, plus 0 and a negative value for numeric limits. Assert limit constants by value.
- **AP10 Abort, cleanup and race paths never driven** (F6.2, F7.1). Every abortable or async API gets four tests: pre-aborted, aborted mid-flight, normal completion, and out-of-order resolution (the older request resolves after the newer one). Each asserts the result **and** that listeners and timers are released (listener count back to 0, no pending timers).
- **AP11 Failure ports never injected** (F6.2). `catch {}`, fallback and fail-closed branches never run because no fake ever throws. For each injected port, write a throwing fake three ways: an `Error`, a thrown non-`Error` value, and a rejected promise. Assert the documented fallback or fail-closed result. An empty `catch` needs a test proving the swallow is intended.
- **AP12 Unproven doubles and conformance suites** (F2.6). Fakes, in-memory repos and shared conformance suites are never shown to *fail* on a wrong adapter. Give each conformance suite a broken-adapter self-test: one deliberate defect per check, each expected to fail. Run every in-memory repo through the same contract suite as its real repo.
- **AP13 Memoisation and identity unpinned**. Factory caches, build-once behaviour and DI token ids can be emptied silently. Assert `expect(createX(ports)).toBe(createX(ports))`, that the build step ran once, that different ports give a different instance, and that token ids are distinct and stable.

Tests that are the only guard of an invariant but grep, hash or spawn the source (F1.4), and production files no test imports (F2.3), are code and process problems: see `<AI_DEV_SHOP_ROOT>/harness-engineering/quality/testability-antipatterns.md`. For running the mutation tool itself, see `<AI_DEV_SHOP_ROOT>/harness-engineering/sensors/mutation-quality.md` § Run-Validity Pitfalls.

## Drift Detection

CI must run the following check on every pull request:
1. Read the spec hash from the current spec file
2. Read the certified hash from the test certification record
3. If they differ: block merge, flag tests as stale, and report
   `TDD_RECERTIFICATION_REQUIRED` to Coordinator

This is the connective tissue that keeps specs, tests, and code in provable alignment.

## Anti-Patterns

**Writing tests after implementation**: Defeats the specification purpose. Tests written after code tend to test what the code does, not what it should do.

**Over-prescriptive internals**: Testing private methods, internal state, or implementation details creates brittle tests that break on refactoring without any behavior change.

**Missing negative paths**: Every requirement that defines error behavior needs a test that asserts that specific error. Which inputs those tests need is in § Mutation-Derived Input Rules.

**Flaky tests**: A test that sometimes passes and sometimes fails is worse than no test — it erodes trust in the entire suite. Investigate immediately; do not leave flaky tests in the suite.

Flaky tests block advancement. A known-flaky exclusion may remove a test from
pass-rate math only when it is recorded in
`<ADS_MEMORY_ROOT>/knowledge/known-flaky-tests.md` with `test_id`,
`approved_by`, `approved_at`, `reason`, `stabilization_owner`,
`stabilization_ticket`, and `expires_at` fields. The TestRunner report must
reject malformed or expired registry entries, list every accepted exclusion, and
report the stabilization need to Coordinator.
Use `<AI_DEV_SHOP_ROOT>/framework/templates/known-flaky-tests-template.md` when
initializing the registry.

**Copying spec hash manually**: Automate hash generation and certification. Manual copy-paste is how hashes go stale silently.

**Tests that test the mock**: If your test only verifies that a mock was called with certain arguments, you're not testing behavior — you're testing that you wrote the mock correctly.

**Inconsistent test organization**: Mixing type-specific directories with flat/misc test locations reduces discoverability and breaks suite routing. Use `__tests__/unit/`, `__tests__/integration/`, and `__tests__/e2e/` unless a documented project override exists.

**Inconsistent test suffixes**: Mixing `.test.ts`, `.spec.ts`, and type-specific suffixes hides test intent and breaks automation/reporting. Use the required suffixes (`.unit.test.ts`, `.integration.test.ts`, `.e2e.test.ts`) unless a documented project override exists.

**Overly complex tests as a suppressed signal**: A test that requires an unusually long setup block, many mocks, or convoluted arrange logic is not a test problem — it is a design signal. The function under test is doing too many things. When a test is hard to write, flag it: surface the complexity to the Coordinator and recommend the function be broken into smaller units before proceeding. Do not write a complex test to cover a complex function and move on. The difficulty is the feedback.

## Contract Testing

The ADR defines API and event contracts. Contract tests verify the implementation actually honors those contracts.

Use contract tests for:
- ADR-defined API or event contracts
- module boundaries with explicit schemas or fixtures
- provider/consumer relationships where drift is a material risk

Load `references/contract-testing.md` when you need:
- tool selection by contract type
- certification examples
- gap handling for untestable contracts
- cross-domain drift guidance

## Property-Based Testing

Example-based tests verify named scenarios. Property-based tests verify that an invariant holds across a large range of generated inputs.

Use property tests for:
- numeric or range-based invariants
- validation rules across broad input spaces
- ordering, deduplication, and round-trip guarantees
- idempotency and "no partial write on failure" guarantees

Load `references/property-based-testing.md` when you need:
- AC-to-property derivation patterns
- library guidance
- certification examples

## Test Quality Heuristics

**DAMP over DRY in tests.** A test should tell a complete story without requiring the reader to trace through shared helpers. Clarity is the priority — duplication is the acceptable cost. Shared setup is fine for infrastructure; avoid shared setup for the scenario logic itself.

**Beyoncé Rule.** If you liked it, you should have put a test on it. When an infrastructure change breaks behavior, the test owner is responsible — not the infrastructure change author. Tests claim ownership of what they cover.

**Mock preference order.** Use the most realistic option available: Real implementation > Fake (in-memory) > Stub > Mock (interaction-based). Use mocks only when the real implementation is too slow, non-deterministic, or has uncontrollable side effects.

**Test sizes by resource use** (orthogonal to unit/integration/E2E pyramid): load `references/test-size-model.md` when classifying tests by resource footprint rather than scope.

## Coverage Gaps

When a requirement cannot be tested (missing architecture contract, unresolved spec ambiguity, external dependency not yet available):
1. Add the gap explicitly to the certification record with reason
2. Assign a risk level (High / Medium / Low)
3. Escalate to Coordinator — High-risk gaps block progression to Programmer
4. Do not proceed with implementation against untested High-risk requirements
