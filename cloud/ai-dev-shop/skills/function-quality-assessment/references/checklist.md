# Function Quality Checklist

Use this checklist for every new or materially changed logic-bearing function.
The goal is a function that is easy to understand, test, scale, and change
without rewriting the workflow around it.

## Documentation Format

Use the language's idiomatic function documentation format:

- TypeScript / JavaScript: TypeDoc or JSDoc
- Python: Google, NumPy, or project-standard docstrings
- Rust: Rustdoc
- Go: Godoc
- C#: XML documentation comments
- Java / Kotlin: Javadoc or KDoc

The documentation must cover purpose, required inputs, optional inputs, return
value, expected errors, side effects, and algorithmic complexity. It must NOT
carry a quality disposition or a cyclomatic/cognitive complexity number — those live in
the handoff and the review report, never in source comments.
Use `@tradeoffs` only when there is a real design tradeoff worth preserving for
future maintainers.

Do not turn every tiny private helper into a full documentation block by
default. Tiny helpers may inherit the nearest parent assessment only when they
have no meaningful branching, I/O, error handling, scale risk, security/privacy
risk, or independent reuse pressure. Assess directly when a helper owns a rule,
policy decision, data transformation, effect, error contract, or complexity
tradeoff.

## TypeScript / JavaScript Example

```typescript
/**
 * Verifies items against the configured rule set and returns stable failures.
 *
 * @param input - Required data for verification.
 * @param options - Optional rules, limits, and injected dependencies.
 * @returns Verification result with valid items and stable failure codes.
 * @throws Never for expected verification failures; throws only for programmer errors.
 *
 * @complexity Time: O(n * r), where n is the number of items and r is the number of rules.
 * @complexity Space: O(f), where f is the number of failures returned.
 * @tradeoffs Uses sequential rule evaluation to keep failure ordering deterministic and easy to test.
 *
 */
export function verifyItems(
  input: { items: Item[] },
  options: {
    rules?: VerificationRule[];
    maxFailures?: number;
  } = {},
): VerificationResult {
  // ...
}
```

## Python Example

```python
def verify_items(
    input: VerifyItemsInput,
    options: VerifyItemsOptions | None = None,
) -> VerificationResult:
    """Verify items against the configured rule set.

    Args:
        input: Required data for verification.
        options: Optional rules, limits, and injected dependencies.

    Returns:
        Verification result with valid items and stable failure codes.

    Raises:
        ProgrammerError: If the function receives impossible internal state.

    Complexity:
        Time: O(n * r), where n is the number of items and r is the number of rules.
        Space: O(f), where f is the number of failures returned.

    Tradeoffs:
        Uses sequential rule evaluation to keep failure ordering deterministic and easy to test.

    """
```

## Checklist

Review each assessed function against these prompts. Source skill references are
listed so the canonical rule stays in one place.

1. **Purpose clarity**
   One clear responsibility and a name that matches behavior.
   Source: `coding-foundations`, `testable-design-patterns`.

2. **Explicit inputs and outputs**
   Required data comes from parameters. Useful results leave through a stable
   return value or a typed thrown/returned error.
   Source: `coding-foundations`, `testable-design-patterns`.

3. **Required and optional argument objects**
   Exported or boundary functions use a required input object and an optional
   options object unless there is a documented reason not to.
   Source: `testable-design-patterns`.

4. **Typed contract**
   Explicit return type, stable result shape, and typed errors or typed result
   failures.
   Source: `testable-design-patterns`.

5. **Pure-by-default logic**
   Business rules and transformations avoid I/O, logging, persistence, random
   reads, time reads, or shared-state mutation.
   Source: `coding-foundations`.

6. **Effect boundary clarity**
   If the function performs I/O, logging, persistence, cache writes, event
   publication, or external calls, those effects are obvious from the contract
   and isolated from pure decision logic where practical.
   Source: `coding-foundations`, `observability-implementation` when external I/O is in scope.

7. **Single responsibility**
   The function does not mix validation, formatting, persistence, orchestration,
   policy decisions, and transport concerns unless it is intentionally an
   orchestrator.
   Source: `coding-foundations`, `testable-design-patterns`.

8. **Small testable unit**
   The function can be tested with focused fixtures, minimal mocks, and direct
   assertions over branches, statements, outputs, and errors.
   Source: `testable-design-patterns`.

9. **Test anti-pattern avoidance**
   Tests should not need brittle mocks, private implementation probes, large
   fixture graphs, sleeps, real network calls, real clocks, or order-dependent
   global state.
   Source: `testable-design-patterns`, `test-design`.

10. **Predictable error handling**
    Expected failures use one consistent shape. Separate expected domain or
    validation failures from unexpected programmer/system failures. Prefer typed
    result failures or typed errors with stable codes. Aggregate errors when the
    caller benefits from seeing all failures. Do not mix `null`, `false`,
    strings, raw errors, and exceptions for the same failure category. Do not let
    raw third-party SDK errors leave adapters.
    Source: `testable-design-patterns`, `api-design` when public API errors are in scope.

11. **No hidden state or hidden branching**
    Behavior does not secretly depend on globals, environment variables, module
    caches, current time, randomness, feature flags, database state, filesystem
    state, or previously mutated object state unless that dependency is passed in
    or explicitly owned by the function.
    Source: `coding-foundations`, `testable-design-patterns`.

12. **Complexity and scale**
    Document time and space complexity. Flag `O(n^2)`, unbounded recursion,
    unbounded memory growth, nested loops over caller-controlled collections,
    and per-item I/O. `O(n^2)` is acceptable only when input size is bounded and
    the bound is documented.
    Source: `implementation-guardrails`.

13. **I/O shape**
    Flag N+1 queries, network calls inside loops, filesystem work inside loops,
    hidden retries, and external calls whose cost is not clear from the function
    contract.
    Source: `implementation-guardrails`, `observability-implementation`.

14. **Resource bounds**
    Check limits, pagination, batch sizes, max payload size, memory growth,
    timeout behavior, cancellation behavior, and retry bounds.
    Source: `implementation-guardrails`, `performance-engineering` when performance constraints are explicit.

15. **Idempotency**
    If the function writes externally, retrying it should not duplicate work,
    corrupt state, or emit misleading events unless the non-idempotent behavior
    is documented and justified.
    Source: `implementation-guardrails`, `change-management` when rollout or dual-write behavior is in scope.

16. **Concurrency safety**
    Avoid unsafe shared mutable state, race-prone caches, order-dependent
    behavior, and mutation that leaks across concurrent callers unless the
    behavior is explicitly documented and guarded.
    Source: `coding-foundations`, `implementation-guardrails`.

17. **Determinism**
    Clocks, randomness, config, environment, feature flags, and policy values are
    passed in or isolated so tests can assert repeatable behavior.
    Source: `coding-foundations`, `testable-design-patterns`.

18. **Observability for effects**
    Effectful boundary functions expose useful logs, metrics, or traces where
    appropriate without leaking secrets, credentials, or personal data.
    Source: `observability-implementation`, `security-review`.

19. **Security and privacy**
    Validate trust boundaries, avoid logging secrets or personal data, avoid
    unsafe string interpolation into queries or commands, and keep untrusted
    data out of executable contexts.
    Source: `security-review`, `api-design`,
    `<AI_DEV_SHOP_ROOT>/framework/governance/data-classification.md`.

20. **Extension point**
    Adding a new rule should mean adding a rule function, strategy, table entry,
    or focused helper, not rewriting the whole workflow.
    Source: `coding-foundations`, `design-patterns`.

21. **Deletion or refactor signal**
    If the score is low because the function owns too much, the finding states
    what should be extracted, split, deleted, or moved.
    Source: `refactor-patterns`, `testable-design-patterns`.

22. **Adversarial aggregate behavior**
    Rule engines, validators, batch processors, reducers, reconciliation logic,
    and cross-record workflows have at least one adversarial test or direct
    probe for aggregate behavior, not only single-record happy/unhappy paths.
    Examples: duplicate totals across records, repeated keys, ordering changes,
    max-limit boundaries, partial invalid batches, retry duplication, and
    conflicting rules.
    Source: `testable-design-patterns`, `implementation-guardrails`, `test-design`.

23. **Coverage evidence**
    The handoff includes coverage metrics when a local coverage command is
    available. If coverage cannot be measured, the handoff states why and maps
    assessed units to direct tests or probes.
    Source: `testable-design-patterns`, `test-design`.

24. **Zero-findings skepticism**
    A non-trivial change with every assessed unit at `NO_RECORDED_FINDINGS`
    includes a documented second-pass check. Re-check requirements, edge cases,
    aggregate behavior, hidden dependencies, error paths, scale, coverage, and
    security before preserving a clean result. Under-reporting is the cheapest
    possible output in a findings regime; this item is the control on it.
    Source: `function-quality-assessment`, `code-inspection`.
