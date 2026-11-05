---
name: focused-test
version: 1.0.0
last_updated: 2026-06-03
description: Focused loop skill for running targeted test subsets based on file changes and coverage data. Avoids running the full suite during iteration — runs only what's relevant to the current change.
---

# Skill: Focused Test

Focused operating mode for test-driven iteration. Instead of running the entire test suite on every change (slow, noisy), this skill identifies and runs only the tests that matter for the current change.

## When to Use

- During implementation when the Programmer needs fast test feedback
- When debugging a specific failure and want to iterate on just that test
- When a change touches a known module boundary and you need its integration tests
- Coordinator or Programmer activates this for test-heavy iteration loops

## Loop Structure

```
┌──────────────────────────────────────────────────┐
│  1. Identify changed files                       │
│  2. Resolve targeted test set (see Resolution)   │
│  3. Run only targeted tests                      │
│  4. RED? Fix → re-run targeted set only          │
│  5. GREEN? Expand: run adjacent/dependent tests  │
│  6. Still GREEN? Done — full suite at handoff    │
└──────────────────────────────────────────────────┘
```

## Test Resolution Strategy

Given the changed source files, resolve the minimal test set using this priority order:

### 1. Direct test files
Tests that import or directly test the changed module. Match by:
- Co-located test files (`foo.ts` → `foo.test.ts`, `foo.spec.ts`)
- Test files that import the changed module (grep imports)

### 2. Coverage-mapped tests (only if tooling exists)
If a dedicated utility exists in the workspace to map source files to covering test files (e.g., `bin/find-covering-tests <file>`), use it. This catches indirect coverage. Do NOT manually parse raw coverage files (lcov.info, coverage.json) — they are too large for context and unreliable to reverse-map by hand. If no such utility exists, skip to strategy 3.

### 3. Module-boundary tests
If the change touches a module boundary (API route, service interface, event handler), include integration tests for that boundary.

### 4. Dependency-chain tests
Tests for modules that import the changed module (one level of dependents). Use sparingly — only when the change alters a public interface.

## Workflow

### Phase 1: Identify & Scope

1. **List changed files** from git diff or working-tree state.
2. **Classify each change:**
   - Internal implementation (only direct tests needed)
   - Interface change (direct + dependent tests needed)
   - Cross-cutting change (broader scope — consider module-boundary tests)
3. **Resolve the targeted test set** using the resolution strategy above.
4. **Report scope:** "Running N tests covering M changed files" before execution.

### Phase 2: Iterate

1. **Run targeted tests only.** Use the project's test runner with file/pattern filtering:
   - Jest/Vitest: `--testPathPattern` or specific file args
   - Pytest: specific file/module args or `-k` pattern
   - Go: `./package/...` scoping
2. **On RED:**
   - Read failure output (signal-only — apply programmer-fast-feedback payload limits)
   - Fix the issue
   - Re-run the same targeted set
   - Do NOT expand scope until RED is resolved
3. **On GREEN:**
   - Expand one level: run dependent/adjacent tests
   - If still GREEN: targeted iteration is complete

### Phase 3: Confidence Gate

Before handoff, the Programmer must decide:

- **If change is internal + targeted tests pass:** Confidence is sufficient. Full suite runs at TestRunner stage.
- **If change touches interfaces + expanded tests pass:** Good confidence. Note which tests were run.
- **If change is cross-cutting:** Consider running the full suite now rather than deferring. Flag this to Coordinator if unsure.

The full test suite ALWAYS runs at the TestRunner stage boundary. Focused-test is a development aid, not a replacement for formal certification.

**When this skill is active, it overrides the Programmer's default "run full local suite after each slice" step.** The Programmer runs only the targeted subset during iteration. The full suite defers to the confidence gate or TestRunner dispatch.

## Integration with Existing Skills

- **programmer-fast-feedback** (`harness-engineering/quality/programmer-fast-feedback.md`): The watcher runs continuously and produces stable-failure alerts. Focused-test is for explicit, deliberate test runs during iteration. They complement each other — watcher catches regressions you didn't expect; focused-test verifies changes you did expect.
- **test-design**: Provides the requirement-to-test matrix. Use it to identify which requirements are covered by the targeted set.
- **systematic-debugging**: When RED persists after 2 iterations, switch to the debug playbook instead of guessing.

## Anti-Patterns

- **Full suite on every save:** Wastes time and floods context with irrelevant output. Use focused-test.
- **Only running co-located tests:** Misses regressions in consumers of the changed module. Always expand one level after GREEN.
- **Skipping the confidence gate:** Targeted tests passing does NOT mean the system is correct. Always assess whether the change scope justifies broader coverage before handoff.
- **Ignoring coverage data:** If coverage maps exist, use them. They reveal non-obvious test coverage that filename matching misses.
- **Iterating on the wrong test:** If a test is failing because it's testing old behavior that the spec changed, update the test — don't fix the code to match the old test.
