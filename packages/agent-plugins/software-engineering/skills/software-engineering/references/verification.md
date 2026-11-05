# Verification and inspection gates

Discover the affected workspace's existing lint, typecheck, build and test commands. Run required checks and relevant existing tests; a new feature does not require new tests. Bug fixes start with a failing regression test. Use observable behavior and meaningful negative cases, not private helper names, echoed inputs or mock call counts alone. Never weaken, skip or delete a test, rule, assertion or measured scope to manufacture a pass.

## Structure

For every new or materially changed logic-bearing function, require cognitive complexity ≤10 and cyclomatic complexity ≤10; in apps/desktop both are ≤9. Preserve stricter repository rules. Require nesting ≤3. Include handlers, callbacks, transformations and embedded business logic; exclude only genuinely generated/vendor code and declarative markup, not logic hidden in it. Report size without inventing a line-count gate.

Use available parser-backed checkers: for JS/TS, repository ESLint complexity, SonarJS cognitive complexity and max-depth rules can supply these measurements. Record tool versions, exact command, scope, exclusions and raw diagnostics. A cyclomatic-only tool cannot prove cognitive complexity. Unsupported language, unavailable checker, setup failure or incomplete attribution means UNVERIFIED for that measurement, never PASS. Handle permitted setup yourself; do not make the user repair tooling by hand or refuse application boot.

Fix a breach by flattening nesting, separating real responsibilities and reusing existing owners; rerun affected checks. Do not fragment functions merely to lower a number. An unresolved breach remains incomplete.

### Exhaustive-switch exception

A narrow cyclomatic-only exception is allowed for a compile-time exhaustive switch whose arms only delegate. Keep the raw measurement, typed exhaustiveness evidence and explicit rationale in the result. Non-exhaustive switches, mixed logic in arms and ordinary branching still obey the threshold; cognitive and nesting limits still apply. A typed total handler table is acceptable when it preserves payload typing and readability. No blanket switch exclusion and no measurement gaming.

## Added tests and mutation

When adding tests, mutate the implementation those tests cover using a supported, scoped adapter (for example StrykerJS in a configured JS/TS project). Use real runner output, not a predicted score. Review meaningful surviving mutants and strengthen the behavioral assertions or explain a genuinely equivalent mutant with evidence. Never delete production behavior to kill a survivor. Unsupported mutation stacks, missing tooling or a failed run are UNVERIFIED; report the exact missing capability and next executable step. Content-only guidance has no executable implementation to mutate; say so instead of claiming mutation PASS.

## Completion evidence

Inspect the final diff for requirement alignment, architecture and trust boundaries, type safety, resource bounds and useful errors. Separate introduced defects from unchanged debt. Report exact commands, exit results, test counts and any limits or unexecuted checks. Tie evidence to the current source state; rerun only after relevant edits or unresolved failures. Do not claim a checker enforces these policies merely because this guidance states them. This plugin installs no executable gate, hook, watcher or background task.
