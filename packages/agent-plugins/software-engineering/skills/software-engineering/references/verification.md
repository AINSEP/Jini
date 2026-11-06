# Verification and code review

Run the affected workspace's existing typecheck, lint, build and relevant tests. New feature tests are optional unless required by the task or repository. Bugs start with a failing regression. Never disable, skip, weaken or delete a test, rule or measured scope to manufacture green. Preserve validation, supported behavior and recovery paths.

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

### 1. Spec Alignment
- Does the implementation match the requirements in the active spec?
- Does every acceptance criterion have a corresponding implementation path?
- Are invariants enforced in code (not just in tests)?
- Are edge cases handled as the spec defines?
- Is any out-of-scope behavior implemented? (Scope creep)

### 2. Architecture Adherence
- Does code respect the architecture boundaries defined by the approved design?
- Are dependencies pointing in the right direction (no core logic importing from infrastructure)?
- Are modules only accessed through their public API?
- Are repository/port interfaces used for external dependencies?
- Does folder structure match the chosen architecture pattern?

### 6. Non-Functional Characteristics
- Are there unbounded queries (SELECT * with no LIMIT on a growing table)?
- Is there per-item I/O or query fan-out hidden inside loops or collection transforms?
- Are expensive operations cached where appropriate?
- Are external calls timeout-protected?
- Are error paths logged with enough context to diagnose production failures?
- Are there missing database indexes for new query patterns?

Review the actual consumer, error and permission paths as well as green tests. Check input mutation, stale data, races, misleading names and duplicated rule owners. Include an adversarial aggregate case for batch or reconciliation logic: repeated keys, combined totals, ordering, retry duplication or partial failures.

For new or materially changed logic, require cognitive and cyclomatic complexity ≤10 and nesting ≤3; preserve stricter host rules. Measure with parser-backed tools, recording versions, scope, exclusions and diagnostics. Size is context, not a gate. A compile-time exhaustive switch with delegation-only arms may justify a cyclomatic-only exception with raw metrics and typed evidence; cognitive and nesting limits still apply. Do not fragment dispatch or weaken rules to game metrics.

Added executable tests require a supported scoped mutation runner. Review surviving mutants; report real output, never predicted scores. Missing tools or incomplete measurements mean UNVERIFIED, never PASS. Content-only guidance has no executable implementation to mutate. Report exact commands, results, counts, changed behavior and remaining risks; no executable gate is installed by this guidance.
